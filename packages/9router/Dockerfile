# Upstream application stays unmodified. Pin both upstream images by digest.
FROM litestream/litestream:0.5.17@sha256:4b02b9859a6b6b4087d8b8944e15f7e984bd7957cba322bbeee38b0e27b9656a AS litestream
FROM decolua/9router:0.5.104@sha256:5fc7020f3cf1ca6831bffe80314ecab9dde915d27ee3c479a4bb66f45dabbc27
USER root
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
