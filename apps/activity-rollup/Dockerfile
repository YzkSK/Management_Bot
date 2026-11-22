FROM oven/bun:1.4-alpine@sha256:da816670775f4c2b4e990b6b1847cf5540dcdc721a42033dd331ce7a88ba6a3b AS build
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile
RUN bunx turbo run build --filter=@management-bot/activity-rollup

FROM oven/bun:1.4-alpine@sha256:da816670775f4c2b4e990b6b1847cf5540dcdc721a42033dd331ce7a88ba6a3b AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build --chown=bun:bun /repo /repo
WORKDIR /repo/apps/activity-rollup
USER bun
CMD ["bun", "run", "src/index.ts"]
