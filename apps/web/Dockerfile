# Multi-stage production image for @speaking-track/web.
# Stage 1 installs workspace dependencies, stage 2 builds the Next.js app,
# stage 3 is a non-root runtime with only the standalone server output.

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
RUN pnpm install --frozen-lockfile --filter @speaking-track/web...

FROM deps AS builder
COPY tsconfig.base.json ./
COPY apps/web apps/web
COPY packages packages
# Tests and tooling never enter the image context (see .dockerignore).
RUN pnpm --filter @speaking-track/web build

FROM node:22.23-alpine AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
USER node
COPY --from=builder --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
