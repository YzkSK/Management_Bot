FROM oven/bun:1.4-alpine@sha256:d888c0ae6c86d7866ff10c5aafdd9077b36aee6455b33dd270fb93c0dd5cef6f AS build
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile
RUN bunx turbo run build --filter=@management-bot/backup

FROM oven/bun:1.4-alpine@sha256:d888c0ae6c86d7866ff10c5aafdd9077b36aee6455b33dd270fb93c0dd5cef6f AS runtime
ENV NODE_ENV=production
RUN apk add --no-cache postgresql18-client age
# 新規のbackup-dataボリュームはこのディレクトリの所有者を引き継ぐため、非rootでも書き込めるようにする(issue #553)。
RUN mkdir -p /backups && chown bun:bun /backups
WORKDIR /repo
COPY --from=build --chown=bun:bun /repo /repo
WORKDIR /repo/apps/backup
USER bun
CMD ["bun", "run", "src/index.ts"]
