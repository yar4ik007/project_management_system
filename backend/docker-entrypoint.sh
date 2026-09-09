#!/bin/sh
set -e

# Ждём БД и накатываем схему (идемпотентно).
echo "[entrypoint] prisma db push…"
npx prisma db push --accept-data-loss --skip-generate

# Сидим демо-данные только если сотрудников ещё нет.
COUNT=$(node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.employee.count().then(c=>{console.log(c);return p.\$disconnect()}).catch(()=>{console.log(0)})" 2>/dev/null | tail -1)
if [ "$COUNT" = "0" ]; then
  echo "[entrypoint] пустая БД — засеваем демо-данные"
  npm run seed || echo "[entrypoint] seed пропущен"
else
  echo "[entrypoint] в БД уже $COUNT сотрудников — сид не нужен"
fi

echo "[entrypoint] старт backend"
exec node dist/main.js
