import { Body, Controller, Get, Module, Patch } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { Admin } from './auth.module';
import { BotsModule, BotsService } from './bots.module';

@Admin()
@Controller('settings')
export class SettingsController {
  constructor(private bots: BotsService) {}

  @Get()
  async get() {
    return {
      adminBotToken: await this.bots.getSetting('adminBotToken'),
      adminBotUsername: await this.bots.getSetting('adminBotUsername'),
    };
  }

  @Patch()
  async update(@Body() body: { adminBotToken?: string | null }) {
    if (body.adminBotToken !== undefined) {
      await this.bots.setSetting('adminBotToken', body.adminBotToken ? body.adminBotToken.trim() : null);
      await this.bots.reloadAdmin();
    }
    return this.get();
  }
}

@Module({ imports: [BotsModule], controllers: [SettingsController], providers: [PrismaService] })
export class SettingsModule {}
