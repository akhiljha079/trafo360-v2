# Build context is the monorepo root: docker build -f apps/api/Dockerfile .
FROM node:20-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
COPY libs/shared/package.json libs/shared/package.json
COPY prisma prisma
RUN npm ci
COPY tsconfig.base.json ./
COPY libs/shared libs/shared
COPY apps/api apps/api
RUN npm run prisma:generate
RUN npm run build --workspace=libs/shared
RUN npm run build --workspace=apps/api

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/prisma ./prisma
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/libs/shared/dist ./libs/shared/dist
COPY --from=build /repo/libs/shared/package.json ./libs/shared/package.json
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]
