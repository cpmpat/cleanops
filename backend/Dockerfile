# ─── Stage 1: Build ──────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm via corepack
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

# Copy dependency files first (better Docker layer caching)
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma/

# Install ALL deps (dev included — needed for nest build + prisma)
RUN pnpm install --frozen-lockfile

# Generate Prisma client
RUN pnpm exec prisma generate

# Copy source and build
COPY . .
RUN pnpm build

# ─── Stage 2: Production ─────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# Install pnpm + openssl (Prisma needs it at runtime on Alpine)
RUN apk add --no-cache openssl && corepack enable && corepack prepare pnpm@10.15.0 --activate

# Copy package files
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./

# Copy entire node_modules from builder (skip the prune — keeps prisma CLI available)
# Trade ~70MB extra image size for reliability
COPY --from=builder /app/node_modules ./node_modules

# Copy built artifacts and Prisma schema
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

# Railway injects PORT at runtime; default to 3001 for local Docker testing
ENV PORT=3001
EXPOSE 3001

# On startup: apply any pending DB migrations, then start the app
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm start:prod"]
