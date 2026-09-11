import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Admin } from './auth.module';

const HOURS = 36e5;

// Кол-во рабочих дней (пн–пт) в полуинтервале [from, to).
function workdays(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (d < to) {
    const wd = d.getDay();
    if (wd !== 0 && wd !== 6) days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  // Отработанные часы по сотрудникам и дням (для графиков). projectId — фильтр по проекту.
  async worklog(fromStr?: string, toStr?: string, projectId?: number) {
    const from = fromStr ? new Date(fromStr) : new Date(Date.now() - 13 * 24 * HOURS);
    const to = toStr ? new Date(toStr) : new Date();
    const fromDay = new Date(from.getFullYear(), from.getMonth(), from.getDate());
    const toDay = new Date(to.getFullYear(), to.getMonth(), to.getDate());

    // Список дней в диапазоне (включительно).
    const days: string[] = [];
    for (const d = new Date(fromDay); d <= toDay; d.setDate(d.getDate() + 1)) days.push(ymd(new Date(d)));
    const dayIndex = new Map(days.map((d, i) => [d, i]));

    const logs = await this.prisma.timeLog.findMany({
      where: {
        date: { gte: fromDay, lt: new Date(toDay.getTime() + 24 * HOURS) },
        ...(projectId ? { task: { projectId } } : {}),
      },
      select: { employeeId: true, date: true, hours: true, employee: { select: { name: true, hidden: true } } },
    });

    // Группируем по сотруднику.
    const byEmp = new Map<number, { name: string; perDay: number[] }>();
    for (const l of logs) {
      if (l.employee.hidden) continue;
      const i = dayIndex.get(ymd(new Date(l.date)));
      if (i === undefined) continue;
      let e = byEmp.get(l.employeeId);
      if (!e) {
        e = { name: l.employee.name, perDay: new Array(days.length).fill(0) };
        byEmp.set(l.employeeId, e);
      }
      e.perDay[i] += l.hours;
    }

    const employees = [...byEmp.entries()]
      .map(([id, e]) => ({
        id,
        name: e.name,
        perDay: e.perDay.map((h) => Math.round(h * 100) / 100),
        total: Math.round(e.perDay.reduce((a, b) => a + b, 0) * 100) / 100,
      }))
      .sort((a, b) => b.total - a.total)
      .map((e, i) => ({ ...e, color: PALETTE[i % PALETTE.length] }));

    return { from: fromDay, to: toDay, days, employees };
  }

  async capacity(fromStr?: string, toStr?: string) {
    const from = fromStr ? new Date(fromStr) : new Date();
    const to = toStr ? new Date(toStr) : new Date(from.getTime() + 28 * 24 * HOURS);
    const days = workdays(from, to);
    const totalWorkdays = days.length;

    const employees = await this.prisma.employee.findMany({
      where: { active: true, hidden: false, role: { not: null } }, // без роли — ещё не в работе
      orderBy: { name: 'asc' },
    });
    const assignments = await this.prisma.assignment.findMany({
      where: { startAt: { lt: to }, endAt: { gt: from } },
    });
    const absences = await this.prisma.absence.findMany({
      where: { startDate: { lt: to }, endDate: { gte: from } },
    });

    const perEmployee = employees.map((e) => {
      const dailyHours = e.weeklyHours / 5;
      // Дни отпуска этого сотрудника, попавшие в рабочие дни диапазона.
      const absDays = days.filter((day) =>
        absences.some(
          (a) =>
            a.employeeId === e.id &&
            day >= new Date(a.startDate.getFullYear(), a.startDate.getMonth(), a.startDate.getDate()) &&
            day <= new Date(a.endDate.getFullYear(), a.endDate.getMonth(), a.endDate.getDate()),
        ),
      ).length;
      const capacityHours = Math.max(0, (totalWorkdays - absDays) * dailyHours);
      const plannedHours = assignments
        .filter((a) => a.employeeId === e.id)
        .reduce((s, a) => {
          const start = Math.max(a.startAt.getTime(), from.getTime());
          const end = Math.min(a.endAt.getTime(), to.getTime());
          return s + Math.max(0, (end - start) / HOURS);
        }, 0);
      return {
        id: e.id,
        name: e.name,
        role: e.role,
        weeklyHours: e.weeklyHours,
        capacityHours: round(capacityHours),
        plannedHours: round(plannedHours),
        vacationDays: absDays,
        freeHours: round(capacityHours - plannedHours),
        utilization: capacityHours > 0 ? round((plannedHours / capacityHours) * 100) : 0,
      };
    });

    // Остаток работ по активным/запланированным проектам.
    const projects = await this.prisma.project.findMany({
      where: { status: { in: ['ACTIVE', 'PLANNED', 'ON_HOLD'] } },
      include: { tasks: { include: { timeLogs: { select: { hours: true } } } } },
    });
    const projectLoad = projects.map((p) => {
      const estimate = p.tasks.reduce((s, t) => s + t.estimateHours, 0);
      const spent = p.tasks.reduce((s, t) => s + t.timeLogs.reduce((a, l) => a + l.hours, 0), 0);
      const open = p.tasks.filter((t) => t.status !== 'DONE');
      const remaining = open.reduce((s, t) => {
        const tSpent = t.timeLogs.reduce((a, l) => a + l.hours, 0);
        return s + Math.max(0, t.estimateHours - tSpent);
      }, 0);
      return {
        id: p.id,
        name: p.name,
        code: p.code,
        status: p.status,
        color: p.color,
        estimateHours: round(estimate),
        spentHours: round(spent),
        remainingHours: round(remaining),
        openTasks: open.length,
      };
    });

    const totalCapacity = perEmployee.reduce((s, e) => s + e.capacityHours, 0);
    const totalPlanned = perEmployee.reduce((s, e) => s + e.plannedHours, 0);
    const totalRemaining = projectLoad.reduce((s, p) => s + p.remainingHours, 0);
    const freeCapacity = totalCapacity - totalPlanned;

    return {
      range: { from, to, workdays: totalWorkdays },
      perEmployee,
      projectLoad,
      summary: {
        totalCapacityHours: round(totalCapacity),
        totalPlannedHours: round(totalPlanned),
        freeCapacityHours: round(freeCapacity),
        totalRemainingHours: round(totalRemaining),
        // Хватает ли ресурсов: остаток работ против свободной ёмкости.
        adequate: totalRemaining <= freeCapacity,
        deficitHours: round(Math.max(0, totalRemaining - freeCapacity)),
      },
    };
  }
}

function round(n: number) {
  return Math.round(n * 100) / 100; // 2 знака — чтобы минуты (доли часа) не терялись
}

// Палитра для линий/столбиков (каждому сотруднику свой цвет).
const PALETTE = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899',
  '#06b6d4', '#84cc16', '#f97316', '#6366f1', '#14b8a6', '#e11d48',
];

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

@Controller('dashboard')
export class DashboardController {
  constructor(private svc: DashboardService) {}

  @Admin() @Get('capacity') capacity(@Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.capacity(from, to);
  }

  @Admin() @Get('worklog') worklog(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.svc.worklog(from, to, projectId ? Number(projectId) : undefined);
  }
}

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, PrismaService],
  exports: [DashboardService],
})
export class DashboardModule {}
