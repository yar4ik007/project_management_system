# Система управления проектами (PMS)

Лаконичная система планирования команды: сотрудники, проекты, задачи с оценкой и
таймлогами, календарь долгосрочного планирования с детекцией конфликтов слотов,
учёт отпусков и дашборд ресурсов («хватает ли рук»).

## Стек

- **Backend** — NestJS 10 + Prisma 5 + PostgreSQL (TypeScript)
- **Frontend** — React 18 + Vite + react-router (TypeScript)
- **БД** — PostgreSQL в Docker

## Что умеет

- **Сотрудники** — операторы / руководители / разработчики, часы в неделю, активность.
- **Проекты** — статус, цвет, прогресс; сотрудник назначается на несколько проектов (many-to-many).
- **Задачи** — под проект, оценка в часах, приоритет, статус, исполнитель.
- **Таймлоги** — факт по задачам, прогресс «факт / оценка» с подсветкой перерасхода.
- **Календарь планирования** — недельная сетка «сотрудник × день»; планируем задачи
  на слоты времени наперёд. При добавлении слота **проверяются пересечения** с уже
  назначенными слотами и отпусками — можно создать принудительно.
- **Отпуска/больничные** — в том же календаре, уменьшают ёмкость и блокируют слоты.
- **Дашборд ресурсов** — загрузка по сотрудникам (план vs ёмкость), остаток работ по
  проектам, итог: хватает ли ресурсов на горизонте 1–12 недель или дефицит N часов.

## Запуск локально

```bash
# 1. База данных
docker compose up -d

# 2. Backend (порт 3002)
cd backend
cp .env.example .env        # при необходимости
npm install
npx prisma db push          # накатить схему
npm run seed                # демо-данные (команда 4+3+4, проекты, задачи, план)
npm run start               # или npm run start:dev

# 3. Frontend (порт 5173)
cd ../frontend
npm install
npm run dev
```

Открыть http://localhost:5173

> Порты: БД — `127.0.0.1:5434`, backend — `3002`, frontend — `5173`
> (выбраны так, чтобы не конфликтовать с другими локальными стендами).

## Структура

```
backend/
  prisma/schema.prisma   — модели: Employee, Project, ProjectMember, Task,
                           TimeLog, Assignment, Absence
  prisma/seed.ts         — демо-данные
  src/*.module.ts        — по модулю на домен (controller+service+module)
frontend/
  src/pages/             — Dashboard, Calendar, Projects, ProjectDetail, Employees
  src/api.ts             — типизированный клиент REST API
```

## API (префикс `/api`)

- `GET/POST/PATCH/DELETE /employees`
- `GET/POST/PATCH/DELETE /projects`, `POST /projects/:id/members`, `DELETE /projects/:id/members/:employeeId`
- `GET/POST/PATCH/DELETE /tasks`, `POST /tasks/:id/logs`, `DELETE /tasks/logs/:logId`
- `GET/POST/PATCH/DELETE /assignments` — планирование; при конфликте `409` с деталями,
  `?force=true` чтобы создать поверх. `GET /assignments/preview` — проверка слота.
- `GET/POST/DELETE /absences` — отпуска
- `GET /dashboard/capacity?from=&to=` — аналитика ресурсов
