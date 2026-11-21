# syntax=docker/dockerfile:1
# Behind a TLS-inspecting proxy, pass its CA without baking it in:
#   --secret id=npm_ca,src=/path/ca.crt --build-arg HTTPS_PROXY=...
# ShanGo API image (NestJS). Build from the repository root:
#   docker build -f deploy/api.Dockerfile -t shango/api:<git-sha> .
FROM node:24-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --workspace @shango/api --no-audit --no-fund
COPY apps/api apps/api
RUN npm run build --workspace @shango/api

FROM node:24-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
RUN --mount=type=secret,id=npm_ca,required=false \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --workspace @shango/api --omit=dev --no-audit --no-fund && npm cache clean --force && mkdir -p apps/api/node_modules

FROM node:24-bookworm-slim
ENV NODE_OPTIONS=--enable-source-maps \
    PORT=3000 \
    PRIVATE_DOCUMENTS_DIR=/data/private-documents
WORKDIR /app
COPY --from=deps --chown=node:node /repo/node_modules ./node_modules
COPY --from=deps --chown=node:node /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /repo/apps/api/dist ./apps/api/dist
COPY --chown=node:node apps/api/migrations ./apps/api/migrations
COPY --chown=node:node apps/api/package.json ./apps/api/package.json
# Private driver documents live on a dedicated volume, never under a web root.
RUN mkdir -p /data/private-documents && chown node:node /data/private-documents && chmod 700 /data/private-documents
USER node
WORKDIR /app/apps/api
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Migrations run as a separate one-shot: `node dist/migrate.js`.
CMD ["node", "dist/main.js"]
