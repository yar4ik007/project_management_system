import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EmployeesModule } from './employees.module';
import { ProjectsModule } from './projects.module';
import { TasksModule } from './tasks.module';
import { PlanningModule } from './planning.module';
import { AbsencesModule } from './absences.module';
import { DashboardModule } from './dashboard.module';
import { TrackingModule } from './tracking.module';
import { BotsModule } from './bots.module';
import { AuthModule } from './auth.module';
import { SettingsModule } from './settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    EmployeesModule,
    ProjectsModule,
    TasksModule,
    PlanningModule,
    AbsencesModule,
    DashboardModule,
    TrackingModule,
    BotsModule,
    SettingsModule,
  ],
})
export class AppModule {}
