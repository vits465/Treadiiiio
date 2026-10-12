# -------------------------------------------------------------
# Stage 1: Build TypeScript Engine
# -------------------------------------------------------------
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install native build tools for better-sqlite3
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build

# -------------------------------------------------------------
# Stage 2: Production Runtime
# -------------------------------------------------------------
FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Install runtime utilities & compilation tools for native node modules
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev \
    && apt-get purge -y --auto-remove make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/dist ./dist

# Create folders for SQLite storage and log outputs
RUN mkdir -p /app/data /app/logs

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT:-4000}/api/health || exit 1

CMD ["node", "dist/index.js"]

