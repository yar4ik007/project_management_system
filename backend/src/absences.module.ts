import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { AbsenceType } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { Admin } from './auth.module';

type AbsenceInput = {
  employeeId: number;
  type?: AbsenceType;
  startDate: string;
  endDate: string;
  note?: string;
};

@Injectable()
export class AbsencesService {
  constructor(private prisma: PrismaService) {}

  list(from?: string, to?: string) {
    const range = from && to ? { startDate: { lte: new Date(to) }, endDate: { gte: new Date(from) } } : {};
    return this.prisma.absence.findMany({
      where: range,
      orderBy: { startDate: 'asc' },
      include: { employee: true },
    });
  }

  create(data: AbsenceInput) {
    return this.prisma.absence.create({
      data: {
        employeeId: Number(data.employeeId),
        type: data.type || 'VACATION',
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        note: data.note,
      },
      include: { employee: true },
    });
  }

  remove(id: number) {
    return this.prisma.absence.delete({ where: { id } });
  }
}

@Controller('absences')
export class AbsencesController {
  constructor(private svc: AbsencesService) {}

  @Get() list(@Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.list(from, to);
  }

  @Admin() @Post() create(@Body() body: AbsenceInput) {
    return this.svc.create(body);
  }

  @Admin() @Delete(':id') remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id);
  }
}

@Module({ controllers: [AbsencesController], providers: [AbsencesService, PrismaService] })
export class AbsencesModule {}
