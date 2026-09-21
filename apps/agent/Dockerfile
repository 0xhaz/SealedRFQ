# Agent service image (Railway, Fly, or anything that runs a container).
#
# Built from the repository root, not from this directory: the agent imports @sealedrfq/shared
# through the pnpm workspace, and it reads contracts/deployments/<chainId>.json for the addresses,
# so neither the lockfile nor those files can be left outside the context.
#
#   docker build -f apps/agent/Dockerfile -t sealedrfq-agent .
#
# better-sqlite3 is a native module, so it is compiled in the builder and the runner uses the same
# base image — a different Node minor between the two stages would make it refuse to load.

FROM node:22-bookworm-slim AS builder
WORKDIR /app

# node-gyp needs these to compile better-sqlite3; they stay out of the final image.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.12.2 --activate

# Manifests first so a source-only change does not reinstall the world.
# tsconfig.base.json is required: both packages extend it, and without it tsc silently
# falls back to an ES5 target and rejects the BigInt literals this codebase is full of.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/agent/package.json apps/agent/
RUN pnpm install --frozen-lockfile --filter @sealedrfq/agent... --filter @sealedrfq/shared...

COPY packages/shared packages/shared
COPY apps/agent apps/agent
RUN pnpm --filter @sealedrfq/shared build && pnpm --filter @sealedrfq/agent build

# Drop dev dependencies now that both packages are compiled.
RUN pnpm prune --prod

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/node_modules node_modules
COPY --from=builder /app/packages/shared packages/shared
COPY --from=builder /app/apps/agent apps/agent
# Contract addresses. ChainService reads ../../contracts/deployments/<chainId>.json relative to the
# working directory unless DEPLOYMENT_JSON says otherwise.
COPY contracts/deployments contracts/deployments

WORKDIR /app/apps/agent

# SQLite must live on a mounted volume. A container filesystem is thrown away on every deploy, and
# losing the database means re-indexing from the deployment's startBlock on each restart.
ENV DATABASE_URL=file:/data/agent.db
VOLUME /data

EXPOSE 4020
# A platform that injects PORT wins; 4020 is only the default.
ENV PORT=4020

# Reports the last indexed block, so a container that is up but not indexing still looks healthy —
# check the block is advancing, not merely that this returns 200.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4020)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
