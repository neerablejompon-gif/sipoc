# RMIC Workspace — Cloud Run image
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server ./server
COPY public ./public
USER node
EXPOSE 8080
CMD ["node", "server/index.js"]
