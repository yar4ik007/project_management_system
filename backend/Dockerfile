FROM node:20-slim
# openssl нужен Prisma; Debian-база надёжнее alpine на РФ-сети (нет тормозов apk CDN)
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

ENV PORT=3002
EXPOSE 3002
RUN chmod +x docker-entrypoint.sh
CMD ["./docker-entrypoint.sh"]
