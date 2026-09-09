FROM node:20-alpine
# openssl нужен Prisma на alpine
RUN apk add --no-cache openssl
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

ENV PORT=3002
EXPOSE 3002
RUN chmod +x docker-entrypoint.sh
CMD ["./docker-entrypoint.sh"]
