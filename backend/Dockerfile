# ─── Stage 1: Build ──────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy dependency files first (better Docker layer caching)
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

# Install ALL deps (dev included — needed for nest build)
RUN pnpm install --frozen-lockfile

# Generate Prisma client
RUN pnpm exec prisma generate

# Copy source and build
COPY . .
RUN pnpm build

# Strip dev dependencies from node_modules (smaller production image)
RUN CI=true pnpm prune --prod --config.confirmModulesPurge=false

# ─── Stage 2: Production ─────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Install pnpm in production stage too (needed for `prisma migrate deploy` and `start:prod`)
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy everything we need from builder: package.json, lockfile, pruned node_modules, built dist, prisma schema + generated client
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Railway injects PORT at runtime; default to 3001 for local Docker testing
ENV PORT=3001
EXPOSE 3001

# On startup: apply any pending DB migrations, then start the app
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm start:prod"]
