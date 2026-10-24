FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN pnpm install --filter @novo/api... --no-frozen-lockfile
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm --filter @novo/api prisma:generate && pnpm --filter @novo/api build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/packages/contracts ./packages/contracts
COPY --from=build /app/package.json ./package.json
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
