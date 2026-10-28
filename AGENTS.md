# ShanGo engineering rules

- Work and push on `develop`. Never push implementation directly to `main`.
- `main` receives changes only through a reviewed pull request; do not self-approve or auto-merge.
- Use NestJS/TypeScript, PostgreSQL/PostGIS, Redis, Socket.io, React Native and React Admin.
- Read docs/architecture.md and docs/backlog.md before changing domain behavior.
- PostgreSQL owns orders and money. Redis is ephemeral and must not determine final assignment or balances.
- Validate authorization on the server. Never log OTPs, tokens, or private driver documents.
- Coordinates: WGS84, longitude then latitude in SQL/GeoJSON, distances in meters. Money: integer VND.
- Public OSM tiles/Nominatim and routing demos are not production infrastructure. No public Nominatim autocomplete.
- Run relevant tests and typecheck; report unavailable services honestly.
- Do not deploy production or publish mobile releases without explicit authorization.
