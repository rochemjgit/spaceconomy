"""Container-owned ore and singleton modules, preserving existing inventory.

Revision ID: 20260905_12
Revises: 20260905_11

Online, coordinated maintenance migration: data repair must precede constraints.
No player rows are discarded. Downgrade is intentionally blocked because the old
schema cannot represent station ore, split assays, or public ore provenance.
"""

import json
from uuid import UUID, uuid4

import sqlalchemy as sa

from alembic import op

revision = "20260905_12"
down_revision = "20260905_11"
branch_labels = None
depends_on = None

STATION_ID = UUID("4e32a9a9-5551-4e3f-9b9b-b6b6e22a4f04")
ORE_CHECK = (
    "(ore_asteroid_id IS NULL AND ore_composition IS NULL AND ore_mineral_assay IS NULL) "
    "OR (ore_asteroid_id IS NOT NULL AND ore_composition IS NOT NULL "
    "AND ore_mineral_assay IS NOT NULL AND module_definition_id IS NULL "
    "AND quantity = 1 AND volume_per_unit > 0)"
)


def _reflection_metadata() -> sa.MetaData:
    metadata = sa.MetaData()

    @sa.event.listens_for(metadata, "column_reflect")
    def restore_uuid_type(inspector, table, column):
        # SQLite reflects SQLAlchemy Uuid as CHAR(32), losing bind/result
        # processors. PostgreSQL retains native UUID and needs no adjustment.
        if (
            inspector.bind.dialect.name == "sqlite"
            and isinstance(column["type"], sa.CHAR)
            and column["type"].length == 32
        ):
            column["type"] = sa.Uuid()

    return metadata


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # Maintenance only. Block old application writers throughout the repair.
        bind.execute(
            sa.text(
                "LOCK TABLE ship_states, ships, inventory_containers, inventory_items, "
                "jettisoned_items, mined_ore_lots, fitted_modules IN ACCESS EXCLUSIVE MODE"
            )
        )
    metadata = _reflection_metadata()
    metadata.reflect(bind=bind)
    containers = metadata.tables["inventory_containers"]
    items = metadata.tables["inventory_items"]
    public = metadata.tables["jettisoned_items"]
    ships = metadata.tables["ships"]
    hulls = metadata.tables["hull_definitions"]

    # Safely coalesce duplicate station locations without merging their items.
    stations = {}
    for row in bind.execute(sa.select(containers).order_by(containers.c.id)).mappings().all():
        if row["station_id"] is None:
            continue
        key = (row["pilot_id"], row["station_id"])
        if key not in stations:
            stations[key] = row["id"]
            continue
        bind.execute(
            items.update()
            .where(items.c.container_id == row["id"])
            .values(container_id=stations[key])
        )
        bind.execute(containers.delete().where(containers.c.id == row["id"]))

    # Keep original IDs (including fitted references); expand extras to new IDs.
    for table in (items, public):
        rows = (
            bind.execute(
                sa.select(table).where(
                    table.c.module_definition_id.is_not(None), table.c.quantity > 1
                )
            )
            .mappings()
            .all()
        )
        for row in rows:
            extra = dict(row)
            extra["quantity"] = 1
            if table is items and row["container_id"] is None:
                key = (row["pilot_id"], STATION_ID)
                if key not in stations:
                    stations[key] = uuid4()
                    bind.execute(
                        containers.insert().values(
                            id=stations[key],
                            pilot_id=row["pilot_id"],
                            station_id=STATION_ID,
                            container_type="station_storage",
                            capacity_cubic_meters=0,
                        )
                    )
                extra["container_id"] = stations[key]
            bind.execute(table.update().where(table.c.id == row["id"]).values(quantity=1))
            for _ in range(row["quantity"] - 1):
                bind.execute(table.insert().values(**{**extra, "id": uuid4()}))

    with op.batch_alter_table("mined_ore_lots") as batch:
        batch.add_column(sa.Column("container_id", sa.Uuid(), nullable=True))
    ore = sa.Table("mined_ore_lots", _reflection_metadata(), autoload_with=bind)
    pilot_ids = bind.execute(sa.select(ore.c.pilot_id).distinct()).scalars().all()
    for pilot_id in pilot_ids:
        cargo = (
            bind.execute(
                sa.select(containers.c.id).where(
                    containers.c.pilot_id == pilot_id, containers.c.container_type == "ship_cargo"
                )
            )
            .scalars()
            .all()
        )
        if len(cargo) > 1:
            raise RuntimeError(
                f"Pilot {pilot_id} has ambiguous ship cargo; reconcile before migration"
            )
        if not cargo:
            candidates = (
                bind.execute(
                    sa.select(ships).where(ships.c.pilot_id == pilot_id, ships.c.status == "active")
                )
                .mappings()
                .all()
            )
            if len(candidates) != 1:
                raise RuntimeError(
                    f"Pilot {pilot_id} has no unambiguous active ship; reconcile before migration"
                )
            ship = candidates[0]
            statistics = bind.execute(
                sa.select(hulls.c.base_statistics).where(hulls.c.id == ship["hull_definition_id"])
            ).scalar_one()
            cargo = [uuid4()]
            bind.execute(
                containers.insert().values(
                    id=cargo[0],
                    pilot_id=pilot_id,
                    ship_id=ship["id"],
                    container_type="ship_cargo",
                    capacity_cubic_meters=float(json.loads(statistics).get("cargo_volume", 24.0)),
                )
            )
        bind.execute(ore.update().where(ore.c.pilot_id == pilot_id).values(container_id=cargo[0]))

    unique = next(
        constraint
        for constraint in sa.inspect(bind).get_unique_constraints("mined_ore_lots")
        if set(constraint["column_names"]) == {"pilot_id", "asteroid_id"}
    )
    with op.batch_alter_table(
        "mined_ore_lots", naming_convention={"uq": "uq_%(table_name)s_%(column_0_name)s"}
    ) as batch:
        batch.drop_constraint(unique["name"] or "uq_mined_ore_lots_pilot_id", type_="unique")
        batch.alter_column("container_id", existing_type=sa.Uuid(), nullable=False)
        batch.create_foreign_key(
            "fk_ore_container", "inventory_containers", ["container_id"], ["id"]
        )
        batch.create_index("ix_mined_ore_lots_container_id", ["container_id"])

    with op.batch_alter_table("inventory_containers") as batch:
        batch.create_unique_constraint("uq_pilot_station_container", ["pilot_id", "station_id"])
    with op.batch_alter_table("inventory_items") as batch:
        batch.create_check_constraint(
            "inventory_module_singleton", "module_definition_id IS NULL OR quantity = 1"
        )
    with op.batch_alter_table("jettisoned_items") as batch:
        batch.add_column(sa.Column("ore_asteroid_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("ore_composition", sa.String(64), nullable=True))
        batch.add_column(sa.Column("ore_mineral_assay", sa.Text(), nullable=True))
        batch.create_foreign_key("fk_public_ore_asteroid", "asteroids", ["ore_asteroid_id"], ["id"])
        batch.create_check_constraint(
            "jettisoned_module_singleton", "module_definition_id IS NULL OR quantity = 1"
        )
        batch.create_check_constraint("jettisoned_ore_metadata_valid", ORE_CHECK)


def downgrade() -> None:
    raise RuntimeError(
        "Revision 12 cannot be losslessly downgraded: reconcile/export station and public ore "
        "and split lots before a separately reviewed rollback."
    )
