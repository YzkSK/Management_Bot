FROM oven/bun:1.4-alpine@sha256:4cf82f5686b196504fe119db3fcd9185b191f82ece82c40680e597228ec6070a AS build
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile
RUN bunx turbo run build --filter=@management-bot/backup

FROM oven/bun:1.4-alpine@sha256:4cf82f5686b196504fe119db3fcd9185b191f82ece82c40680e597228ec6070a AS runtime
ENV NODE_ENV=production
# ベースのAlpine 3.22にはpostgresql18-clientが無いため、3.23のリポジトリから入れる(issue #627)。
# ponytail: ベースイメージが3.23以上になったら--repository指定を外す。
RUN apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/v3.23/main postgresql18-client age
# 新規のbackup-dataボリュームはこのディレクトリの所有者を引き継ぐため、非rootでも書き込めるようにする(issue #553)。
RUN mkdir -p /backups && chown bun:bun /backups
WORKDIR /repo
COPY --from=build --chown=bun:bun /repo /repo
WORKDIR /repo/apps/backup
USER bun
CMD ["bun", "run", "src/index.ts"]
