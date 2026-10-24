# Build context is the repository root: Nest imports ../src/lib/cloud contracts.
FROM oven/bun:1.4.2 AS bun
FROM node:22-bookworm-slim AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app/server
COPY server/package.json server/bun.lock ./
RUN bun install --frozen-lockfile
COPY server/tsconfig.json server/nest-cli.json ./
COPY server/src ./src
COPY src/lib/cloud /app/src/lib/cloud
RUN bun run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app/server
COPY --from=build /usr/local/bin/bun /usr/local/bin/bun
COPY server/package.json server/bun.lock ./
RUN bun install --frozen-lockfile --production && rm /usr/local/bin/bun
COPY --from=build /app/server/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s CMD node -e "fetch('http://127.0.0.1:3000/v1/health').then(async r => { const b = await r.json(); process.exit(r.ok && b.database === 'up' ? 0 : 1) }).catch(() => process.exit(1))"
CMD ["node", "dist/server/src/main.js"]
