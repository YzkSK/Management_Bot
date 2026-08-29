FROM oven/bun:1.3-alpine AS build
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile
RUN bunx turbo run build --filter=@management-bot/backup

FROM oven/bun:1.3-alpine AS runtime
ENV NODE_ENV=production
RUN apk add --no-cache postgresql17-client
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/apps/backup
CMD ["bun", "run", "src/index.ts"]
