# ShanGo engineering rules

> **Quyết định mới 2026-10-28:** Target product là web-only responsive cho Customer, Driver, Admin; xem docs/adr-web-only.md và docs/roadmap-web.md. React Native/Expo chỉ là legacy hiện hữu, không phải stack mục tiêu. **Không xóa/chuyển code Expo hoặc CI khi chỉ được giao sửa docs.**

- Work and push on `develop`. Never push implementation directly to `main`.
- `main` receives changes only through a reviewed pull request; do not self-approve or auto-merge.
- Target: NestJS/TypeScript, PostgreSQL/PostGIS, Redis, Socket.io and responsive web frontends. Expo/React Native are legacy pending approved migration.
- Read docs/architecture.md and docs/backlog.md before changing domain behavior.
- PostgreSQL owns orders and money. Redis is ephemeral and must not determine final assignment or balances.
- Validate authorization on the server. Never log OTPs, tokens, or private driver documents.
- Coordinates: WGS84, longitude then latitude in SQL/GeoJSON, distances in meters. Money: integer VND.
- Public OSM tiles/Nominatim and routing demos are not production infrastructure. No public Nominatim autocomplete.
- Run relevant tests and typecheck; report unavailable services honestly.
- Do not deploy production or publish mobile releases without explicit authorization.
