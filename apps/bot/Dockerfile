FROM oven/bun:1.3-alpine AS build
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile
RUN bunx turbo run build --filter=@management-bot/bot

FROM oven/bun:1.3-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/apps/bot
CMD ["bun", "run", "src/index.ts"]
