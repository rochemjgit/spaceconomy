# Spaceconomy

Browser-based, single-system space MMO. The Phase 1 goal is an authoritative local multiplayer flight and warp vertical slice.

## Project layout

- `client/`: Vite + TypeScript + Babylon.js browser client.
- `server/`: FastAPI authoritative API and future realtime simulation.
- `contracts/`: versioned REST and MessagePack realtime contract material.
- `compose.yaml`: local PostgreSQL, Redis, and API services.
- `Phase I.md`: authoritative Phase 1 implementation plan.

## Current implementation

The repository now contains the first implementation slice: the Vite client baseline, the FastAPI health endpoint, container setup, and shared-contract documentation. Authentication, persistence, simulation, realtime presence, and warp will follow the implementation order in the Phase 1 plan.
