import { PrismaClient, EmployeeRole } from '@prisma/client';

const prisma = new PrismaClient();

// Ближайший понедельник (для читаемого календаря демо).
function monday(): Date {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  const shift = (d.getDay() + 6) % 7; // пн=0
  d.setDate(d.getDate() - shift);
  return d;
}

function at(base: Date, addDays: number, hour: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + addDays);
  d.setHours(hour, 0, 0, 0);
  return d;
}

async function main() {
  // Чистим в порядке зависимостей.
  await prisma.assignment.deleteMany();
  await prisma.timeLog.deleteMany();
  await prisma.absence.deleteMany();
  await prisma.task.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.project.deleteMany();
  await prisma.employee.deleteMany();

  const team: { name: string; role: EmployeeRole; position: string }[] = [
    { name: 'Оператор Анна', role: 'OPERATOR', position: 'Поддержка' },
    { name: 'Оператор Борис', role: 'OPERATOR', position: 'Поддержка' },
    { name: 'Оператор Вера', role: 'OPERATOR', position: 'Поддержка' },
    { name: 'Оператор Глеб', role: 'OPERATOR', position: 'Поддержка' },
    { name: 'Руководитель Дмитрий', role: 'MANAGER', position: 'Тимлид' },
    { name: 'Руководитель Елена', role: 'MANAGER', position: 'Проджект' },
    { name: 'Руководитель Жанна', role: 'MANAGER', position: 'Продукт' },
    { name: 'Разработчик Игорь', role: 'DEVELOPER', position: 'Backend' },
    { name: 'Разработчик Кирилл', role: 'DEVELOPER', position: 'Frontend' },
    { name: 'Разработчик Лев', role: 'DEVELOPER', position: 'Fullstack' },
    { name: 'Разработчик Мария', role: 'DEVELOPER', position: 'QA' },
  ];

  const employees: any[] = [];
  for (const t of team) {
    employees.push(
      await prisma.employee.create({
        data: { name: t.name, role: t.role, position: t.position, weeklyHours: 40 },
      }),
    );
  }
  const byName = (part: string) => employees.find((e) => e.name.includes(part))!;

  const projects = await Promise.all([
    prisma.project.create({
      data: { name: 'CRM-платформа', code: 'CRM', status: 'ACTIVE', color: '#3b82f6', description: 'Внутренняя CRM' },
    }),
    prisma.project.create({
      data: { name: 'Мобильное приложение', code: 'MOB', status: 'ACTIVE', color: '#10b981', description: 'iOS/Android' },
    }),
    prisma.project.create({
      data: { name: 'Поддержка клиентов', code: 'SUP', status: 'ACTIVE', color: '#f59e0b', description: 'Линия поддержки' },
    }),
    prisma.project.create({
      data: { name: 'Новый лендинг', code: 'LAND', status: 'PLANNED', color: '#8b5cf6', description: 'Маркетинговый сайт' },
    }),
  ]);
  const [crm, mob, sup, land] = projects;

  // Назначения на проекты (по нескольку на сотрудника).
  const memberships: [number, number, string][] = [
    [byName('Дмитрий').id, crm.id, 'Тимлид'],
    [byName('Игорь').id, crm.id, 'Backend'],
    [byName('Кирилл').id, crm.id, 'Frontend'],
    [byName('Елена').id, mob.id, 'Проджект'],
    [byName('Лев').id, mob.id, 'Fullstack'],
    [byName('Мария').id, mob.id, 'QA'],
    [byName('Кирилл').id, mob.id, 'Frontend'],
    [byName('Жанна').id, sup.id, 'Руководитель'],
    [byName('Анна').id, sup.id, 'Оператор'],
    [byName('Борис').id, sup.id, 'Оператор'],
    [byName('Вера').id, sup.id, 'Оператор'],
    [byName('Глеб').id, sup.id, 'Оператор'],
    [byName('Дмитрий').id, land.id, 'Тимлид'],
    [byName('Кирилл').id, land.id, 'Frontend'],
  ];
  for (const [employeeId, projectId, roleOnProject] of memberships) {
    await prisma.projectMember.create({ data: { employeeId, projectId, roleOnProject } });
  }

  // Задачи с оценками.
  const tasks = await Promise.all([
    prisma.task.create({
      data: { projectId: crm.id, title: 'API пользователей', estimateHours: 24, priority: 'HIGH', status: 'IN_PROGRESS', assigneeId: byName('Игорь').id },
    }),
    prisma.task.create({
      data: { projectId: crm.id, title: 'Экран списка клиентов', estimateHours: 16, priority: 'MEDIUM', status: 'TODO', assigneeId: byName('Кирилл').id },
    }),
    prisma.task.create({
      data: { projectId: mob.id, title: 'Авторизация', estimateHours: 20, priority: 'URGENT', status: 'IN_PROGRESS', assigneeId: byName('Лев').id },
    }),
    prisma.task.create({
      data: { projectId: mob.id, title: 'Тест-план релиза', estimateHours: 12, priority: 'MEDIUM', status: 'TODO', assigneeId: byName('Мария').id },
    }),
    prisma.task.create({
      data: { projectId: sup.id, title: 'Разбор тикетов неделя', estimateHours: 30, priority: 'MEDIUM', status: 'IN_PROGRESS', assigneeId: byName('Анна').id },
    }),
    prisma.task.create({
      data: { projectId: land.id, title: 'Вёрстка главной', estimateHours: 18, priority: 'LOW', status: 'TODO', assigneeId: byName('Кирилл').id },
    }),
  ]);

  // Немного факта (таймлоги).
  await prisma.timeLog.create({ data: { taskId: tasks[0].id, employeeId: byName('Игорь').id, hours: 8, note: 'Каркас API' } });
  await prisma.timeLog.create({ data: { taskId: tasks[2].id, employeeId: byName('Лев').id, hours: 6, note: 'OAuth' } });
  await prisma.timeLog.create({ data: { taskId: tasks[4].id, employeeId: byName('Анна').id, hours: 12, note: 'Тикеты пн-вт' } });

  // Плановые слоты в календаре (эта неделя).
  const mon = monday();
  const slots: [number, number, number, number, number][] = [
    // employee, task, dayOffset, startHour, endHour
    [byName('Игорь').id, tasks[0].id, 0, 10, 14],
    [byName('Игорь').id, tasks[0].id, 1, 10, 18],
    [byName('Кирилл').id, tasks[1].id, 0, 10, 16],
    [byName('Лев').id, tasks[2].id, 0, 9, 17],
    [byName('Лев').id, tasks[2].id, 2, 9, 13],
    [byName('Анна').id, tasks[4].id, 0, 9, 18],
    [byName('Анна').id, tasks[4].id, 1, 9, 18],
    [byName('Мария').id, tasks[3].id, 3, 10, 15],
  ];
  for (const [employeeId, taskId, day, h1, h2] of slots) {
    await prisma.assignment.create({
      data: { employeeId, taskId, startAt: at(mon, day, h1), endAt: at(mon, day, h2) },
    });
  }

  // Отпуск (со след. недели).
  await prisma.absence.create({
    data: {
      employeeId: byName('Борис').id,
      type: 'VACATION',
      startDate: at(mon, 7, 0),
      endDate: at(mon, 11, 0),
      note: 'Плановый отпуск',
    },
  });

  console.log(`Готово: ${employees.length} сотрудников, ${projects.length} проектов, ${tasks.length} задач.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
