# syntax=docker/dockerfile:1

# The fleet API: Hono on Bun, raw SQL against the shared Postgres (schema
# `fleet` only), dashboard styled with Tailwind compiled at build time.
FROM oven/bun:1.3.11 AS build
WORKDIR /app

COPY package.json bun.lock ./
COPY packages/turborepo-remote-cache/package.json ./packages/turborepo-remote-cache/
COPY packages/assert/package.json ./packages/assert/
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
COPY packages/openrouter/package.json ./packages/openrouter/
COPY packages/portfolio/package.json ./packages/portfolio/
COPY packages/fleet/package.json ./packages/fleet/
COPY packages/fleet-api/package.json ./packages/fleet-api/

RUN bun install --frozen-lockfile

COPY tsconfig.json tsconfig.strict.json turbo.json ./
COPY packages/assert ./packages/assert
COPY packages/logger ./packages/logger
COPY packages/fleet-api ./packages/fleet-api

# dist/ is not in the build context (.dockerignore), so the stylesheet is built here.
RUN cd packages/fleet-api && bun run build:css

FROM oven/bun:1.3.11-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=build /app /app

RUN chown -R bun:bun /app

# Bun takes the JSX settings (hono/jsx) from the tsconfig in the working
# directory, not from the one beside each file, so run from the package.
WORKDIR /app/packages/fleet-api

EXPOSE 8080

USER bun

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["bun", "-e", "const r = await fetch(`http://127.0.0.1:${process.env.PORT ?? 8080}/health`); process.exit(r.ok ? 0 : 1)"]

CMD ["bun", "src/server.ts"]
