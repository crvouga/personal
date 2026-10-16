# Pin upstream runtime and source; only the approved hosted OAuth UI is patched.
FROM litestream/litestream:0.5.17@sha256:4b02b9859a6b6b4087d8b8944e15f7e984bd7957cba322bbeee38b0e27b9656a AS litestream
FROM decolua/9router:0.5.104@sha256:5fc7020f3cf1ca6831bffe80314ecab9dde915d27ee3c479a4bb66f45dabbc27 AS upstream

FROM upstream AS oauth-build
USER root
WORKDIR /build
ADD --checksum=sha256:19ef5a68603672c8efe9b140e917fcd71a0b28be930600e2bbfa914819f1ea27 https://codeload.github.com/decolua/9router/tar.gz/87a74e1bda3677193c6f71a7e2100c90311f0689 /tmp/upstream.tar.gz
RUN tar -xzf /tmp/upstream.tar.gz --strip-components=1 && rm /tmp/upstream.tar.gz
RUN apk add --no-cache python3 make g++ linux-headers patch
COPY upstream-package-lock.json ./package-lock.json
RUN --mount=type=cache,target=/root/.npm npm ci --include=dev --no-audit --no-fund
COPY hosted-oauth.patch /patches/hosted-oauth.patch
COPY oauth-browser.mjs oauth-browser.test.mjs /patches/
RUN node --test /patches/oauth-browser.test.mjs && patch -p1 --fuzz=0 < /patches/hosted-oauth.patch && cp /patches/oauth-browser.mjs src/lib/oauth/oauth-browser.mjs
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM upstream
USER root
# Copy the complete rebuilt application so Next's server and client manifests,
# chunk names and cache hashes all agree. Never edit compiled JS in place.
RUN rm -rf /app/.next
COPY --from=oauth-build /build/.next/standalone/ /app/
COPY --from=oauth-build /build/.next/static/ /app/.next/static/
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
WORKDIR /runtime
COPY package.json package-lock.json ./
RUN litestream version && npm ci --omit=dev --ignore-scripts && mkdir -p /tmp/9router && chown node:node /tmp/9router
COPY runtime.mjs ./
COPY litestream.yml /etc/litestream.yml
ENV DATA_DIR=/tmp/9router
WORKDIR /app
USER node
ENTRYPOINT ["node", "/runtime/runtime.mjs"]
CMD []
