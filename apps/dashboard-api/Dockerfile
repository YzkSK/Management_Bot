FROM oven/bun:1.3-alpine AS build
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile
RUN bunx turbo run build --filter=@management-bot/dashboard-api

FROM oven/bun:1.3-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/apps/dashboard-api
EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
