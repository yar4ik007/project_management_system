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
} from '@nestjs/common';
import { ProjectStatus } from '@prisma/client';
import { PrismaService } from './prisma.service';

type ProjectInput = {
  name: string;
  code: string;
  description?: string | null;
  status?: ProjectStatus;
  color?: string;
  startDate?: string | null;
  dueDate?: string | null;
};

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService) {}

  async list() {
    const projects = await this.prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        members: { include: { employee: true } },
        tasks: { select: { estimateHours: true, status: true, timeLogs: { select: { hours: true } } } },
      },
    });
    // Считаем прогресс проекта: оценка, факт, доля готовых задач.
    return projects.map((p) => {
      const estimate = p.tasks.reduce((s, t) => s + t.estimateHours, 0);
      const spent = p.tasks.reduce((s, t) => s + t.timeLogs.reduce((a, l) => a + l.hours, 0), 0);
      const done = p.tasks.filter((t) => t.status === 'DONE').length;
      const { tasks, ...rest } = p;
      return { ...rest, stats: { taskCount: tasks.length, doneCount: done, estimateHours: estimate, spentHours: spent } };
    });
  }

  get(id: number) {
    return this.prisma.project.findUnique({
      where: { id },
      include: { members: { include: { employee: true } } },
    });
  }

  create(data: ProjectInput) {
    return this.prisma.project.create({ data: this.clean(data) as any });
  }

  update(id: number, data: Partial<ProjectInput>) {
    return this.prisma.project.update({ where: { id }, data: this.clean(data) });
  }

  remove(id: number) {
    return this.prisma.project.delete({ where: { id } });
  }

  addMember(projectId: number, employeeId: number, roleOnProject?: string) {
    return this.prisma.projectMember.upsert({
      where: { employeeId_projectId: { employeeId, projectId } },
      create: { projectId, employeeId, roleOnProject },
      update: { roleOnProject },
    });
  }

  removeMember(projectId: number, employeeId: number) {
    return this.prisma.projectMember.delete({
      where: { employeeId_projectId: { employeeId, projectId } },
    });
  }

  private clean(data: Partial<ProjectInput>): any {
    const out: Record<string, unknown> = {};
    for (const k of ['name', 'code', 'description', 'status', 'color'] as const) {
      if (data[k] !== undefined) out[k] = data[k];
    }
    if (data.startDate !== undefined) out.startDate = data.startDate ? new Date(data.startDate) : null;
    if (data.dueDate !== undefined) out.dueDate = data.dueDate ? new Date(data.dueDate) : null;
    return out;
  }
}

@Controller('projects')
export class ProjectsController {
  constructor(private svc: ProjectsService) {}

  @Get() list() {
    return this.svc.list();
  }

  @Get(':id') get(@Param('id', ParseIntPipe) id: number) {
    return this.svc.get(id);
  }

  @Post() create(@Body() body: ProjectInput) {
    return this.svc.create(body);
  }

  @Patch(':id') update(@Param('id', ParseIntPipe) id: number, @Body() body: Partial<ProjectInput>) {
    return this.svc.update(id, body);
  }

  @Delete(':id') remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id);
  }

  @Post(':id/members') addMember(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { employeeId: number; roleOnProject?: string },
  ) {
    return this.svc.addMember(id, Number(body.employeeId), body.roleOnProject);
  }

  @Delete(':id/members/:employeeId') removeMember(
    @Param('id', ParseIntPipe) id: number,
    @Param('employeeId', ParseIntPipe) employeeId: number,
  ) {
    return this.svc.removeMember(id, employeeId);
  }
}

@Module({ controllers: [ProjectsController], providers: [ProjectsService, PrismaService] })
export class ProjectsModule {}
