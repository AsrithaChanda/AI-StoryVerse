# syntax=docker/dockerfile:1

# Build the Vite client and type-check the full application in an isolated stage.
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# The server is intentionally run through tsx, which is a development dependency.
# Keep the installed dependency tree from the build stage so `npm run start` has the
# same runtime it has in a validated local installation.
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8787

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist

# Used only by STORYVERSE_ASSET_STORAGE=local. In production, generated assets
# should use the configured Unity Catalog Volume instead.
RUN mkdir -p /app/data && chown -R node:node /app

USER node
EXPOSE 8787

CMD ["npm", "run", "start"]
