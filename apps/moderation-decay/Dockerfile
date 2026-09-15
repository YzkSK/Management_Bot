FROM oven/bun:1.3-alpine AS build
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile
RUN bunx turbo run build --filter=@management-bot/moderation-decay

FROM oven/bun:1.3-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build --chown=bun:bun /repo /repo
WORKDIR /repo/apps/moderation-decay
USER bun
CMD ["bun", "run", "src/index.ts"]
