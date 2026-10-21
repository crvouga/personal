FROM oven/bun:1.3.11 AS build
WORKDIR /app
COPY package.json bun.lock ./
# Standalone image uses the workspace's resolved dependency versions.
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
COPY packages/9router/package.json ./packages/9router/
COPY packages/openrouter/package.json ./packages/openrouter/
COPY packages/portfolio/package.json ./packages/portfolio/
COPY packages/fleet/package.json ./packages/fleet/
COPY packages/fleet-api/package.json ./packages/fleet-api/
COPY packages/auth-relay ./packages/auth-relay
COPY packages/logger ./packages/logger
COPY packages/assert ./packages/assert
WORKDIR /app/packages/auth-relay
RUN bun install --filter @pkgs/auth-relay --production --frozen-lockfile --ignore-scripts && bun run build

FROM oven/bun:1.3.11-slim AS runtime
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/auth-relay/node_modules ./packages/auth-relay/node_modules
COPY --from=build /app/packages/auth-relay/src ./packages/auth-relay/src
COPY --from=build /app/packages/logger ./packages/logger
COPY --from=build /app/packages/assert ./packages/assert
COPY --from=build /app/packages/auth-relay/ui/index.html ./packages/auth-relay/ui/index.html
COPY --from=build /app/packages/auth-relay/ui/style.css ./packages/auth-relay/ui/style.css
COPY --from=build /app/packages/auth-relay/dist ./packages/auth-relay/dist
WORKDIR /app/packages/auth-relay
ENV NODE_ENV=production
USER bun
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD bun -e 'const r=await fetch("http://127.0.0.1:8080/health/live");process.exit(r.ok?0:1)'
CMD ["bun", "src/server.ts"]
