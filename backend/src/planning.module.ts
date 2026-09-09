import {
  Body,
  ConflictException,
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
import { PrismaService } from './prisma.service';

type AssignmentInput = {
  employeeId: number;
  taskId: number;
  startAt: string;
  endAt: string;
  note?: string;
};

// Начало/конец дня для сравнения дат отпусков с границами слота.
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0);
const dayEnd = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);

@Injectable()
export class PlanningService {
  constructor(private prisma: PrismaService) {}

  list(from?: string, to?: string, employeeId?: number) {
    const range =
      from && to ? { startAt: { lt: new Date(to) }, endAt: { gt: new Date(from) } } : {};
    return this.prisma.assignment.findMany({
      where: { ...range, employeeId: employeeId || undefined },
      orderBy: { startAt: 'asc' },
      include: { employee: true, task: { include: { project: true } } },
    });
  }

  // Ищем конфликты ДО создания: пересечение слотов сотрудника и отпуск на эти дни.
  async findConflicts(employeeId: number, startAt: Date, endAt: Date, ignoreId?: number) {
    const overlapping = await this.prisma.assignment.findMany({
      where: {
        employeeId,
        id: ignoreId ? { not: ignoreId } : undefined,
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
      include: { task: { include: { project: true } } },
    });
    const absences = await this.prisma.absence.findMany({
      where: {
        employeeId,
        startDate: { lte: dayEnd(endAt) },
        endDate: { gte: dayStart(startAt) },
      },
    });
    return { overlapping, absences };
  }

  async preview(employeeId: number, startAt: string, endAt: string, ignoreId?: number) {
    const { overlapping, absences } = await this.findConflicts(
      employeeId,
      new Date(startAt),
      new Date(endAt),
      ignoreId,
    );
    return { hasConflict: overlapping.length > 0 || absences.length > 0, overlapping, absences };
  }

  async create(data: AssignmentInput, force = false) {
    const startAt = new Date(data.startAt);
    const endAt = new Date(data.endAt);
    if (endAt <= startAt) throw new ConflictException('Конец слота должен быть позже начала');
    if (!force) {
      const { overlapping, absences } = await this.findConflicts(Number(data.employeeId), startAt, endAt);
      if (overlapping.length || absences.length) {
        throw new ConflictException({
          message: 'Слот занят: у сотрудника уже есть назначение или отпуск на это время',
          overlapping,
          absences,
        });
      }
    }
    return this.prisma.assignment.create({
      data: {
        employeeId: Number(data.employeeId),
        taskId: Number(data.taskId),
        startAt,
        endAt,
        note: data.note,
      },
      include: { employee: true, task: { include: { project: true } } },
    });
  }

  async update(id: number, data: Partial<AssignmentInput>, force = false) {
    const current = await this.prisma.assignment.findUniqueOrThrow({ where: { id } });
    const employeeId = data.employeeId ? Number(data.employeeId) : current.employeeId;
    const startAt = data.startAt ? new Date(data.startAt) : current.startAt;
    const endAt = data.endAt ? new Date(data.endAt) : current.endAt;
    if (endAt <= startAt) throw new ConflictException('Конец слота должен быть позже начала');
    if (!force) {
      const { overlapping, absences } = await this.findConflicts(employeeId, startAt, endAt, id);
      if (overlapping.length || absences.length) {
        throw new ConflictException({ message: 'Слот занят', overlapping, absences });
      }
    }
    return this.prisma.assignment.update({
      where: { id },
      data: {
        employeeId,
        taskId: data.taskId ? Number(data.taskId) : current.taskId,
        startAt,
        endAt,
        note: data.note,
      },
      include: { employee: true, task: { include: { project: true } } },
    });
  }

  remove(id: number) {
    return this.prisma.assignment.delete({ where: { id } });
  }
}

@Controller('assignments')
export class PlanningController {
  constructor(private svc: PlanningService) {}

  @Get() list(@Query('from') from?: string, @Query('to') to?: string, @Query('employeeId') employeeId?: string) {
    return this.svc.list(from, to, employeeId ? Number(employeeId) : undefined);
  }

  @Get('preview') preview(
    @Query('employeeId') employeeId: string,
    @Query('startAt') startAt: string,
    @Query('endAt') endAt: string,
    @Query('ignoreId') ignoreId?: string,
  ) {
    return this.svc.preview(Number(employeeId), startAt, endAt, ignoreId ? Number(ignoreId) : undefined);
  }

  @Post() create(@Body() body: AssignmentInput, @Query('force') force?: string) {
    return this.svc.create(body, force === 'true');
  }

  @Patch(':id') update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: Partial<AssignmentInput>,
    @Query('force') force?: string,
  ) {
    return this.svc.update(id, body, force === 'true');
  }

  @Delete(':id') remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id);
  }
}

@Module({ controllers: [PlanningController], providers: [PlanningService, PrismaService] })
export class PlanningModule {}
