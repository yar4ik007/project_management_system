import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { TaskPriority, TaskStatus } from '@prisma/client';
import { PrismaService } from './prisma.service';

type TaskInput = {
  projectId: number;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  priorityRank?: number;
  estimateHours?: number;
  assigneeId?: number | null;
  dueDate?: string | null;
};

const withSpent = <T extends { timeLogs: { hours: number }[] }>(t: T) => {
  const spentHours = t.timeLogs.reduce((a, l) => a + l.hours, 0);
  const { timeLogs, ...rest } = t;
  return { ...rest, spentHours };
};

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  async list(projectId?: number, assigneeId?: number) {
    const tasks = await this.prisma.task.findMany({
      where: { projectId: projectId || undefined, assigneeId: assigneeId || undefined },
      orderBy: [{ priorityRank: 'asc' }, { status: 'asc' }, { createdAt: 'asc' }],
      include: { assignee: true, project: true, timeLogs: { select: { hours: true } } },
    });
    return tasks.map(withSpent);
  }

  async get(id: number) {
    const t = await this.prisma.task.findUnique({
      where: { id },
      include: {
        assignee: true,
        project: true,
        timeLogs: { include: { employee: true }, orderBy: { date: 'desc' } },
      },
    });
    if (!t) return null;
    const spentHours = t.timeLogs.reduce((a, l) => a + l.hours, 0);
    return { ...t, spentHours };
  }

  create(data: TaskInput) {
    return this.prisma.task.create({ data: this.clean(data) as any });
  }

  update(id: number, data: Partial<TaskInput>) {
    return this.prisma.task.update({ where: { id }, data: this.clean(data) });
  }

  remove(id: number) {
    return this.prisma.task.delete({ where: { id } });
  }

  // Таймлоги
  addLog(taskId: number, body: { employeeId: number; hours: number; date?: string; note?: string }) {
    return this.prisma.timeLog.create({
      data: {
        taskId,
        employeeId: Number(body.employeeId),
        hours: Number(body.hours),
        date: body.date ? new Date(body.date) : new Date(),
        note: body.note,
      },
    });
  }

  removeLog(logId: number) {
    return this.prisma.timeLog.delete({ where: { id: logId } });
  }

  private clean(data: Partial<TaskInput>): any {
    const out: Record<string, unknown> = {};
    for (const k of ['projectId', 'title', 'description', 'status', 'priority', 'priorityRank', 'estimateHours', 'assigneeId'] as const) {
      if (data[k] !== undefined) out[k] = data[k];
    }
    if (out.projectId !== undefined) out.projectId = Number(out.projectId);
    if (out.priorityRank !== undefined) out.priorityRank = Number(out.priorityRank);
    if (out.estimateHours !== undefined) out.estimateHours = Number(out.estimateHours);
    if (data.assigneeId !== undefined) out.assigneeId = data.assigneeId ? Number(data.assigneeId) : null;
    if (data.dueDate !== undefined) out.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    return out;
  }
}

@Controller('tasks')
export class TasksController {
  constructor(private svc: TasksService) {}

  @Get() list(@Query('projectId') projectId?: string, @Query('assigneeId') assigneeId?: string) {
    return this.svc.list(projectId ? Number(projectId) : undefined, assigneeId ? Number(assigneeId) : undefined);
  }

  @Get(':id') get(@Param('id', ParseIntPipe) id: number) {
    return this.svc.get(id);
  }

  @Post() create(@Body() body: TaskInput) {
    return this.svc.create(body);
  }

  @Patch(':id') update(@Param('id', ParseIntPipe) id: number, @Body() body: Partial<TaskInput>) {
    return this.svc.update(id, body);
  }

  @Delete(':id') remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id);
  }

  @Post(':id/logs') addLog(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { employeeId: number; hours: number; date?: string; note?: string },
  ) {
    return this.svc.addLog(id, body);
  }

  @Delete('logs/:logId') removeLog(@Param('logId', ParseIntPipe) logId: number) {
    return this.svc.removeLog(logId);
  }
}

@Module({ controllers: [TasksController], providers: [TasksService, PrismaService] })
export class TasksModule {}
