# syntax=docker/dockerfile:1

FROM oven/bun:1.4.4 AS build
WORKDIR /app
ARG TARGETARCH

COPY package.json bun.lock ./
COPY packages/turborepo-remote-cache/package.json ./packages/turborepo-remote-cache/
COPY packages/assert/package.json ./packages/assert/
COPY packages/admin-ui/package.json ./packages/admin-ui/
COPY packages/auth-relay/package.json ./packages/auth-relay/
COPY packages/infra/package.json ./packages/infra/
COPY packages/logger/package.json ./packages/logger/
COPY packages/object-store/package.json ./packages/object-store/
COPY packages/secret-store/package.json ./packages/secret-store/
COPY packages/secret-string/package.json ./packages/secret-string/
COPY packages/vault/package.json ./packages/vault/
COPY packages/workstation/package.json ./packages/workstation/
COPY packages/password-manager/package.json ./packages/password-manager/
COPY packages/9router/package.json ./packages/9router/
COPY packages/zoomies/package.json ./packages/zoomies/
COPY packages/openrouter/package.json ./packages/openrouter/
COPY packages/portfolio/package.json ./packages/portfolio/

RUN --mount=type=cache,id=bun-1.4.4-${TARGETARCH},target=/root/.bun/install/cache bun install --frozen-lockfile --production --filter @pkgs/turborepo-remote-cache

COPY tsconfig.json turbo.json ./
COPY packages/turborepo-remote-cache ./packages/turborepo-remote-cache
COPY packages/assert ./packages/assert
COPY packages/logger ./packages/logger
COPY packages/object-store ./packages/object-store
COPY packages/secret-store ./packages/secret-store
COPY packages/secret-string ./packages/secret-string
COPY packages/vault ./packages/vault

FROM oven/bun:1.4.4-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY --chown=bun:bun --from=build /app /app
RUN chown bun:bun /app

EXPOSE 8080

USER bun

CMD ["bun", "packages/turborepo-remote-cache/src/server.ts"]
