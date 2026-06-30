FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# next build collects page data for every API route, which imports src/db/client.ts — that
# throws at import time if DATABASE_URL is unset. The pg Pool it creates connects lazily, so a
# placeholder is safe here: no connection is attempted during the build, only at runtime, where
# docker-compose's real DATABASE_URL overrides this.
ENV DATABASE_URL=postgres://placeholder:placeholder@localhost:5432/placeholder
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["npm", "start"]
