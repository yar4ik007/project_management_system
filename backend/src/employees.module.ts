import { Body, Controller, Delete, Get, Injectable, Module, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { EmployeeRole } from '@prisma/client';
import { PrismaService } from './prisma.service';

type EmployeeInput = {
  name: string;
  email?: string | null;
  role: EmployeeRole;
  position?: string | null;
  weeklyHours?: number;
  active?: boolean;
};

@Injectable()
export class EmployeesService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.employee.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { members: { include: { project: true } } },
    });
  }

  get(id: number) {
    return this.prisma.employee.findUnique({
      where: { id },
      include: { members: { include: { project: true } }, tasks: true },
    });
  }

  create(data: EmployeeInput) {
    return this.prisma.employee.create({ data: this.clean(data) });
  }

  update(id: number, data: Partial<EmployeeInput>) {
    return this.prisma.employee.update({ where: { id }, data: this.clean(data) });
  }

  remove(id: number) {
    return this.prisma.employee.delete({ where: { id } });
  }

  // Заметки сотрудника — отдельные записи
  listNotes(employeeId: number) {
    return this.prisma.note.findMany({ where: { employeeId }, orderBy: { createdAt: 'desc' } });
  }

  createNote(employeeId: number, text: string) {
    return this.prisma.note.create({ data: { employeeId, text } });
  }

  updateNote(noteId: number, text: string) {
    return this.prisma.note.update({ where: { id: noteId }, data: { text } });
  }

  removeNote(noteId: number) {
    return this.prisma.note.delete({ where: { id: noteId } });
  }

  private clean(data: Partial<EmployeeInput>): any {
    const out: Record<string, unknown> = {};
    for (const k of ['name', 'email', 'role', 'position', 'weeklyHours', 'active'] as const) {
      if (data[k] !== undefined) out[k] = data[k];
    }
    if (typeof out.weeklyHours === 'string') out.weeklyHours = Number(out.weeklyHours);
    if (out.email === '') out.email = null;
    return out;
  }
}

@Controller('employees')
export class EmployeesController {
  constructor(private svc: EmployeesService) {}

  @Get() list() {
    return this.svc.list();
  }

  @Get(':id') get(@Param('id', ParseIntPipe) id: number) {
    return this.svc.get(id);
  }

  @Post() create(@Body() body: EmployeeInput) {
    return this.svc.create(body);
  }

  @Patch(':id') update(@Param('id', ParseIntPipe) id: number, @Body() body: Partial<EmployeeInput>) {
    return this.svc.update(id, body);
  }

  @Delete(':id') remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id);
  }

  @Get(':id/notes') listNotes(@Param('id', ParseIntPipe) id: number) {
    return this.svc.listNotes(id);
  }

  @Post(':id/notes') createNote(@Param('id', ParseIntPipe) id: number, @Body() body: { text: string }) {
    return this.svc.createNote(id, body.text);
  }

  @Patch('notes/:noteId') updateNote(@Param('noteId', ParseIntPipe) noteId: number, @Body() body: { text: string }) {
    return this.svc.updateNote(noteId, body.text);
  }

  @Delete('notes/:noteId') removeNote(@Param('noteId', ParseIntPipe) noteId: number) {
    return this.svc.removeNote(noteId);
  }
}

@Module({ controllers: [EmployeesController], providers: [EmployeesService, PrismaService] })
export class EmployeesModule {}
