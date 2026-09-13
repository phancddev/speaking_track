# Multi-stage production image for @speaking-track/worker.
# Stage 1 installs dependencies and bundles the TypeScript entry point with
# esbuild into ONE self-contained CommonJS file (bullmq's CommonDB requires
# node builtins like child_process, which ESM bundles cannot satisfy);
# stage 2 runs that bundle as a non-root user.

FROM node:22.23-alpine AS deps
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/queue/package.json packages/queue/
COPY packages/storage/package.json packages/storage/
COPY packages/youtube/package.json packages/youtube/
RUN pnpm install --frozen-lockfile --filter @speaking-track/worker...

FROM deps AS builder
COPY tsconfig.base.json ./
COPY apps/worker apps/worker
COPY packages packages
RUN pnpm --filter @speaking-track/worker build

FROM node:22.23-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
USER node
COPY --from=builder --chown=node:node /repo/apps/worker/dist ./
CMD ["node", "main.js"]
