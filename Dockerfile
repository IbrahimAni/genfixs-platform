# GenFixs API + dashboard, single image.
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY packages ./packages
COPY examples ./examples
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @genfixs/web build

FROM node:22-slim
RUN corepack enable
WORKDIR /app
COPY --from=build /app ./
ENV NODE_ENV=production
ENV GENFIXS_DATA_DIR=/data/artifacts
VOLUME /data
EXPOSE 4000
CMD ["pnpm", "--filter", "@genfixs/api", "start"]
