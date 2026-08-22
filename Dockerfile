FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN BH_NODE_RUNTIME=1 npm run build

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3007 \
    BH_LISTEN_HOST=0.0.0.0 \
    BH_DATA_DIR=/data \
    BH_DB_PATH=/data/bezenskova-house.sqlite \
    BH_NODE_RUNTIME=1

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY scripts/start-service.sh ./scripts/start-service.sh

EXPOSE 3007

CMD ["npm", "start"]
