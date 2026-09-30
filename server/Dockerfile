# Optional container build for the relay (Railway can also use NIXPACKS via the root railway.json).
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
VOLUME ["/data"]
EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT:-2567}/health || exit 1
# exec form so SIGTERM reaches node (graceful shutdown saves everyone)
CMD ["node", "index.js"]
