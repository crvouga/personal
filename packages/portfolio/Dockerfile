# syntax=docker/dockerfile:1
#
# Build from the repo root: docker build -f packages/portfolio/Dockerfile .
# Debian, not Alpine: the build renders the resume PDF with Playwright's
# Chromium (src/pages/chris-vouga-resume.pdf.ts), which ships glibc-only.
FROM node:22-bookworm-slim AS build

# bun binary for `bun install --frozen-lockfile`; astro build runs via node.
COPY --from=oven/bun:1.3.11 /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

COPY package.json bun.lock tsconfig.strict.json ./
COPY packages/portfolio/package.json ./packages/portfolio/
COPY packages/fleet/package.json ./packages/fleet/
COPY packages/fleet-api/package.json ./packages/fleet-api/
COPY packages/assert/package.json ./packages/assert/
COPY packages/admin-ui/package.json ./packages/admin-ui/
COPY packages/auth-relay/package.json ./packages/auth-relay/
COPY packages/infra/package.json ./packages/infra/
COPY packages/logger/package.json ./packages/logger/
COPY packages/object-store/package.json ./packages/object-store/
COPY packages/openrouter/package.json ./packages/openrouter/
COPY packages/secret-store/package.json ./packages/secret-store/
COPY packages/secret-string/package.json ./packages/secret-string/
COPY packages/turborepo-remote-cache/package.json ./packages/turborepo-remote-cache/
COPY packages/vault/package.json ./packages/vault/
COPY packages/workstation/package.json ./packages/workstation/
COPY packages/9router/package.json ./packages/9router/

RUN bun install --frozen-lockfile

# Matches the lockfile's Playwright version, and is cached with it: this layer
# only rebuilds when dependencies change, not when content does.
RUN cd packages/portfolio \
  && node node_modules/playwright/cli.js install --with-deps chromium

COPY packages/portfolio ./packages/portfolio

WORKDIR /app/packages/portfolio

RUN --mount=type=secret,id=github_token,required=true \
  PORTFOLIO_GITHUB_TOKEN="$(cat /run/secrets/github_token)" \
  bun run build

FROM nginx:alpine

LABEL org.opencontainers.image.source=https://github.com/crvouga/workspace
LABEL org.opencontainers.image.description="chrisvouga.dev portfolio static site"

RUN rm /etc/nginx/conf.d/default.conf
COPY packages/portfolio/nginx.conf /etc/nginx/conf.d/

COPY --from=build /app/packages/portfolio/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
