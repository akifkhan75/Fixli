# Build context is the repository root:
#   docker build -f apps/api/Dockerfile -t fixli-api .
FROM node:22-alpine AS build
RUN corepack enable && apk add --no-cache openssl
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @fixli/api...

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @fixli/shared build \
 && pnpm --filter @fixli/api db:generate && pnpm --filter @fixli/api build
# Self-contained production bundle (prod deps only, workspace links resolved)
RUN pnpm --filter @fixli/api deploy --prod /out \
 && cp -r apps/api/dist /out/dist \
 && cp -r apps/api/prisma /out/prisma \
 && cd /out && npx prisma generate

FROM node:22-alpine AS production
RUN apk add --no-cache openssl tini
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3002/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
