import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmployeesModule } from './employees.module';
import { ProjectsModule } from './projects.module';
import { TasksModule } from './tasks.module';
import { PlanningModule } from './planning.module';
import { AbsencesModule } from './absences.module';
import { DashboardModule } from './dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EmployeesModule,
    ProjectsModule,
    TasksModule,
    PlanningModule,
    AbsencesModule,
    DashboardModule,
  ],
})
export class AppModule {}
