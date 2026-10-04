FROM oven/bun:1.4-alpine@sha256:d888c0ae6c86d7866ff10c5aafdd9077b36aee6455b33dd270fb93c0dd5cef6f AS build
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN bunx turbo run build --filter=@management-bot/dashboard-web

FROM nginx:1.31-alpine@sha256:df221db836e1754089190208cee7eeda94f233197056426eda74a43ab1abeac2 AS runtime
COPY --from=build /repo/apps/dashboard-web/dist /usr/share/nginx/html
COPY apps/dashboard-web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
