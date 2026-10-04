FROM oven/bun:1.3-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS build
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile
RUN bunx turbo run build --filter=@management-bot/backup

FROM oven/bun:1.3-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0 AS runtime
ENV NODE_ENV=production
RUN apk add --no-cache postgresql17-client age
# 新規のbackup-dataボリュームはこのディレクトリの所有者を引き継ぐため、非rootでも書き込めるようにする(issue #553)。
RUN mkdir -p /backups && chown bun:bun /backups
WORKDIR /repo
COPY --from=build --chown=bun:bun /repo /repo
WORKDIR /repo/apps/backup
USER bun
CMD ["bun", "run", "src/index.ts"]
