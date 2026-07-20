# ---- build stage: compile native deps (better-sqlite3 builds from source) ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

# ---- run stage: slim runtime, no build tools ----
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8001
# copy the app + already-compiled node_modules from the build stage
COPY --from=build /app /app
# data/ (sqlite + backups) and uploads/ are provided as volumes at runtime
EXPOSE 8001
CMD ["node", "server/index.js"]
