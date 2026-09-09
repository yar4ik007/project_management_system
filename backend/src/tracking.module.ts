import { Body, Controller, Get, Injectable, Module, Post, Query } from '@nestjs/common';
import { TimeTracking } from '@prisma/client';
import { PrismaService } from './prisma.service';

// Потолок одного отрезка: если исполнитель забыл выключить таймер, сверх 8 часов
// в зачёт не идёт (подсмотрено в exchange_bot/taskBot: TASK_WORK_SEGMENT_MAX_HOURS).
const SEGMENT_MAX_SEC = 8 * 3600;

// Секунды текущего ИДУЩЕГО отрезка (на паузе — 0, накопленное уже ушло в TimeLog).
export function liveSec(t: TimeTracking, now = new Date()): number {
  if (t.state !== 'RUNNING' || !t.startedAt) return 0;
  return Math.min(SEGMENT_MAX_SEC, Math.max(0, Math.floor((now.getTime() - t.startedAt.getTime()) / 1000)));
}

const withLive = (t: any) => ({
  ...t,
  liveSec: liveSec(t),
  liveHours: Math.round((liveSec(t) / 3600) * 100) / 100,
});

@Injectable()
export class TrackingService {
  constructor(private prisma: PrismaService) {}

  // Старт/продолжение. Один идущий таймер на человека: остальные его RUNNING
  // ставим на паузу (с фиксацией их отрезков в TimeLog).
  async start(taskId: number, employeeId: number) {
    await this.pauseOthers(employeeId, taskId);
    const existing = await this.prisma.timeTracking.findUnique({
      where: { taskId_employeeId: { taskId, employeeId } },
    });
    if (existing?.state === 'RUNNING') return this.withTask(taskId, employeeId);
    if (existing) {
      await this.prisma.timeTracking.update({ where: { id: existing.id }, data: { state: 'RUNNING', startedAt: new Date() } });
    } else {
      await this.prisma.timeTracking.create({ data: { taskId, employeeId, state: 'RUNNING', startedAt: new Date() } });
    }
    // Задача автоматически «в работе».
    await this.prisma.task.update({ where: { id: taskId }, data: { status: 'IN_PROGRESS' } });
    return this.withTask(taskId, employeeId);
  }

  // Пауза: закрываем текущий отрезок в TimeLog (кусочек), таймер стоит.
  async pause(taskId: number, employeeId: number) {
    const t = await this.prisma.timeTracking.findUnique({ where: { taskId_employeeId: { taskId, employeeId } } });
    if (!t) return null;
    if (t.state === 'RUNNING') {
      await this.commitSegment(t);
      await this.prisma.timeTracking.update({ where: { id: t.id }, data: { state: 'PAUSED', startedAt: null } });
    }
    return this.withTask(taskId, employeeId);
  }

  // Стоп: фиксируем последний отрезок и снимаем трекер.
  async stop(taskId: number, employeeId: number) {
    const t = await this.prisma.timeTracking.findUnique({ where: { taskId_employeeId: { taskId, employeeId } } });
    if (!t) return null;
    const hours = await this.commitSegment(t);
    await this.prisma.timeTracking.delete({ where: { id: t.id } });
    return { taskId, employeeId, loggedHours: hours };
  }

  async active() {
    const list = await this.prisma.timeTracking.findMany({
      orderBy: [{ state: 'asc' }, { updatedAt: 'desc' }],
      include: { employee: true, task: { include: { project: true } } },
    });
    return list.map(withLive);
  }

  byEmployee(employeeId: number) {
    return this.prisma.timeTracking
      .findMany({ where: { employeeId }, include: { task: { include: { project: true } } } })
      .then((l) => l.map(withLive));
  }

  // Записать закрытый отрезок running-таймера в TimeLog. Возвращает записанные часы.
  private async commitSegment(t: TimeTracking): Promise<number> {
    const sec = liveSec(t);
    const hours = Math.round((sec / 3600) * 100) / 100;
    if (hours > 0) {
      await this.prisma.timeLog.create({ data: { taskId: t.taskId, employeeId: t.employeeId, hours, note: 'Трекер' } });
    }
    return hours;
  }

  private async pauseOthers(employeeId: number, exceptTaskId: number) {
    const running = await this.prisma.timeTracking.findMany({
      where: { employeeId, state: 'RUNNING', NOT: { taskId: exceptTaskId } },
    });
    for (const t of running) {
      await this.commitSegment(t);
      await this.prisma.timeTracking.update({ where: { id: t.id }, data: { state: 'PAUSED', startedAt: null } });
    }
  }

  private async withTask(taskId: number, employeeId: number) {
    const t = await this.prisma.timeTracking.findUnique({
      where: { taskId_employeeId: { taskId, employeeId } },
      include: { employee: true, task: { include: { project: true } } },
    });
    return t ? withLive(t) : null;
  }
}

@Controller('tracking')
export class TrackingController {
  constructor(private svc: TrackingService) {}

  @Get() list(@Query('employeeId') employeeId?: string) {
    return employeeId ? this.svc.byEmployee(Number(employeeId)) : this.svc.active();
  }

  @Get('active') active() {
    return this.svc.active();
  }

  @Post('start') start(@Body() b: { taskId: number; employeeId: number }) {
    return this.svc.start(Number(b.taskId), Number(b.employeeId));
  }

  @Post('pause') pause(@Body() b: { taskId: number; employeeId: number }) {
    return this.svc.pause(Number(b.taskId), Number(b.employeeId));
  }

  @Post('stop') stop(@Body() b: { taskId: number; employeeId: number }) {
    return this.svc.stop(Number(b.taskId), Number(b.employeeId));
  }
}

@Module({
  controllers: [TrackingController],
  providers: [TrackingService, PrismaService],
  exports: [TrackingService],
})
export class TrackingModule {}
