FROM oven/bun:1.3-alpine AS build
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN bunx turbo run build --filter=@management-bot/dashboard-web

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/dashboard-web/dist /usr/share/nginx/html
COPY apps/dashboard-web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
