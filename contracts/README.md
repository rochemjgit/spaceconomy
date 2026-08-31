# Realtime contracts

Phase 1 game WebSocket messages use versioned MessagePack envelopes. A command/event envelope must include protocol version, message type, request ID when applicable, authoritative server time for events, and a typed payload.

Contract fixtures and schema-validation tests will be added before the realtime gateway is implemented. Browser clients only send intent; positions and velocities are always server-authoritative.
