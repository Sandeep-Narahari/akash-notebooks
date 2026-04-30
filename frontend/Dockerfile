FROM node:20-alpine AS base
RUN apk add --no-cache tini
WORKDIR /app

# ── deps layer ────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ── builder ───────────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# BACKEND_URL: server-side URL of the backend used by Next.js rewrites.
# Set to the internal Docker service name in compose, or the public backend URL.
# NEXT_PUBLIC_API_HOST: baked into client JS. Leave empty when the frontend
# proxies all /api/* requests through the Next.js server (default setup).
ARG BACKEND_URL=http://localhost:8000
ARG NEXT_PUBLIC_API_HOST=""
ENV BACKEND_URL=$BACKEND_URL \
    NEXT_PUBLIC_API_HOST=$NEXT_PUBLIC_API_HOST \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

RUN npm run build

# ── final image ───────────────────────────────────────────────────────────────
FROM base AS final

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Non-root user
RUN addgroup -S app && adduser -S app -G app

# Standalone output bundles everything needed; no full node_modules required.
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static

# Ensure public dir exists (Next.js standalone server.js expects it)
RUN mkdir -p ./public

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:3000/ || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
