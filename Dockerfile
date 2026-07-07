# GenFixs production images. The SaaS platform runs the API and web app as
# separately scalable processes while sharing one pnpm workspace build.
FROM node:22-slim AS deps
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages ./packages
COPY examples ./examples
RUN pnpm install --frozen-lockfile

FROM deps AS build
RUN pnpm -r typecheck
RUN pnpm --filter @genfixs/web build

FROM node:22-slim AS api
RUN corepack enable
WORKDIR /app
COPY --from=build /app ./
ENV NODE_ENV=production
ENV GENFIXS_DATA_DIR=/data/artifacts
VOLUME /data
EXPOSE 4000
CMD ["pnpm", "--filter", "@genfixs/api", "start"]

FROM node:22-slim AS web
RUN corepack enable
WORKDIR /app
COPY --from=build /app ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "--filter", "@genfixs/web", "start", "--", "-p", "3000"]
