from fastapi.testclient import TestClient

from spaceconomy.api import app


def test_health_returns_runtime_tick_configuration() -> None:
    response = TestClient(app).get("/api/v1/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "api_version": "v1",
        "simulation_tick_hz": 20,
        "snapshot_tick_hz": 10,
    }
