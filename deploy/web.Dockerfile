# syntax=docker/dockerfile:1
# Behind a TLS-inspecting proxy, pass its CA without baking it in:
#   --secret id=npm_ca,src=/path/ca.crt --build-arg HTTPS_PROXY=...
# Customer, Driver and Admin static builds served by Caddy (TLS, security headers, /api proxy).
#   docker build -f deploy/web.Dockerfile -t shango/web:<git-sha> .
FROM node:24-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/customer-web/package.json apps/customer-web/
COPY apps/driver-web/package.json apps/driver-web/
COPY apps/admin/package.json apps/admin/
COPY packages/ui/package.json packages/ui/
COPY packages/api-client/package.json packages/api-client/
COPY packages/contracts/package.json packages/contracts/
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --no-audit --no-fund \
      --workspace @shango/customer-web --workspace @shango/driver-web --workspace @shango/admin \
      --workspace @shango/ui --workspace @shango/api-client --workspace @shango/contracts
COPY packages packages
COPY apps/customer-web apps/customer-web
COPY apps/driver-web apps/driver-web
COPY apps/admin apps/admin
# Same-origin API through Caddy; tile source is optional and must be authorized.
ARG VITE_MAP_TILE_URL=""
ARG VITE_MAP_TILE_ATTRIBUTION=""
ENV VITE_API_URL=/api/v1 \
    VITE_MAP_TILE_URL=$VITE_MAP_TILE_URL \
    VITE_MAP_TILE_ATTRIBUTION=$VITE_MAP_TILE_ATTRIBUTION
RUN npm run build --workspace @shango/customer-web \
 && npm run build --workspace @shango/driver-web \
 && VITE_WEB_AUTH_ENABLED=true npm run build --workspace @shango/admin

FROM caddy:2.10-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/customer-web/dist /srv/customer
COPY --from=build /repo/apps/driver-web/dist /srv/driver
COPY --from=build /repo/apps/admin/dist /srv/admin
