# Build context is the monorepo root: docker build -f apps/web/Dockerfile .
FROM node:20-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY libs/shared/package.json libs/shared/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY libs/shared libs/shared
COPY apps/web apps/web
RUN npm run build --workspace=libs/shared
RUN npm run build --workspace=apps/web

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.spa.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
