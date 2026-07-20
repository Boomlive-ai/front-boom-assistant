# syntax=docker/dockerfile:1.6

# ---------- Stage 1: install production deps ----------
FROM node:20-alpine AS deps
WORKDIR /app

# Copy manifests only, so this layer caches until deps change.
# package-lock.json is optional but recommended — run `npm install` locally
# once to generate it before building.
COPY package.json package-lock.json* ./

RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund; \
    else \
      npm install --omit=dev --no-audit --no-fund; \
    fi

# ---------- Stage 2: runtime ----------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Non-root user
RUN addgroup -S nodejs -g 1001 \
 && adduser  -S nodeapp -u 1001 -G nodejs

# Bring in production node_modules from the deps stage
COPY --from=deps --chown=nodeapp:nodejs /app/node_modules ./node_modules

# App source
COPY --chown=nodeapp:nodejs package.json server.js ./
COPY --chown=nodeapp:nodejs public ./public

USER nodeapp

EXPOSE 3000

# Uses the /health endpoint your server already exposes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["node", "server.js"]