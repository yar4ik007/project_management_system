import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { Bot, InlineKeyboard } from 'grammy';
import { PrismaService } from './prisma.service';
import { TrackingModule, TrackingService, liveSec } from './tracking.module';

const fmtDur = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}ч ${m}м` : `${m}м`;
};

const STATUS_RU: Record<string, string> = {
  TODO: 'в очереди',
  IN_PROGRESS: 'в работе',
  BLOCKED: 'заблокирована',
  REVIEW: 'на ревью',
  DONE: 'готово',
};

/**
 * Менеджер Telegram-ботов: по боту на проект (токен в настройках проекта).
 * Бот подхватывает задачи и сотрудников СВОЕГО проекта, даёт исполнителю
 * трекать время кусочками: старт / пауза / продолжить / стоп.
 */
@Injectable()
export class BotsService implements OnModuleInit {
  private bots = new Map<number, Bot>(); // projectId -> bot
  private awaitingNote = new Map<number, number>(); // tgId -> employeeId (ждём текст заметки)

  constructor(
    private prisma: PrismaService,
    private tracking: TrackingService,
  ) {}

  async onModuleInit() {
    const projects = await this.prisma.project.findMany({ where: { NOT: { botToken: null } } });
    for (const p of projects) if (p.botToken) this.launch(p.id, p.botToken);
  }

  // Перезапуск бота проекта при смене/очистке токена.
  async reload(projectId: number) {
    await this.stop(projectId);
    const p = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (p?.botToken) this.launch(projectId, p.botToken);
  }

  private async stop(projectId: number) {
    const bot = this.bots.get(projectId);
    if (bot) {
      try {
        await bot.stop();
      } catch {
        /* ignore */
      }
      this.bots.delete(projectId);
    }
  }

  private launch(projectId: number, token: string) {
    const bot = new Bot(token);
    this.wire(bot, projectId);
    bot.catch((err) => console.warn(`[bot ${projectId}] ошибка:`, err.message));
    // start() крутит long-polling бесконечно; не ждём. Невалидный токен ловим в catch.
    bot.start({ onStart: (me) => console.log(`[bot ${projectId}] @${me.username} запущен`) }).catch((e) =>
      console.warn(`[bot ${projectId}] не запустился: ${e.message}`),
    );
    this.bots.set(projectId, bot);
  }

  private wire(bot: Bot, projectId: number) {
    const findEmployee = (tgId?: number) =>
      tgId ? this.prisma.employee.findUnique({ where: { telegramUserId: String(tgId) } }) : Promise.resolve(null);

    // /start — привязка или меню задач.
    bot.command('start', async (ctx) => {
      const emp = await findEmployee(ctx.from?.id);
      if (emp) return this.sendTasks(ctx, projectId, emp.id);
      // не привязан — предложить выбрать себя среди участников проекта
      const members = await this.prisma.projectMember.findMany({
        where: { projectId },
        include: { employee: true },
      });
      const free = members.filter((m) => !m.employee.telegramUserId);
      if (!free.length) return ctx.reply('Все участники проекта уже привязаны. Обратитесь к руководителю.');
      const kb = new InlineKeyboard();
      free.forEach((m) => kb.text(m.employee.name, `link:${m.employee.id}`).row());
      await ctx.reply('Кто вы? Выберите себя из участников проекта:', { reply_markup: kb });
    });

    bot.callbackQuery(/^link:(\d+)$/, async (ctx) => {
      const empId = Number(ctx.match![1]);
      const exists = await this.prisma.employee.findUnique({ where: { telegramUserId: String(ctx.from.id) } });
      if (!exists) {
        await this.prisma.employee.update({ where: { id: empId }, data: { telegramUserId: String(ctx.from.id) } });
      }
      await ctx.answerCallbackQuery('Готово, вы привязаны');
      await this.sendTasks(ctx, projectId, empId);
    });

    bot.callbackQuery('tasks', async (ctx) => {
      const emp = await findEmployee(ctx.from?.id);
      await ctx.answerCallbackQuery();
      if (emp) await this.sendTasks(ctx, projectId, emp.id);
    });

    // Заметочная сотрудника
    bot.callbackQuery('notes', async (ctx) => {
      const emp = await findEmployee(ctx.from?.id);
      await ctx.answerCallbackQuery();
      if (!emp) return;
      const kb = new InlineKeyboard().text('✏️ Изменить', 'note_edit').text('⬅️ Задачи', 'tasks');
      await ctx.reply(`📝 Ваша заметочная:\n\n${emp.notes || '(пусто)'}`, { reply_markup: kb });
    });
    bot.callbackQuery('note_edit', async (ctx) => {
      const emp = await findEmployee(ctx.from?.id);
      await ctx.answerCallbackQuery();
      if (!emp) return;
      this.awaitingNote.set(ctx.from.id, emp.id);
      await ctx.reply('Пришлите текст заметки одним сообщением (заменит текущую).');
    });

    // Трекинг
    const act =
      (fn: 'start' | 'pause' | 'stop') =>
      async (ctx: any) => {
        const emp = await findEmployee(ctx.from?.id);
        if (!emp) return ctx.answerCallbackQuery('Сначала /start');
        const taskId = Number(ctx.match[1]);
        await this.tracking[fn](taskId, emp.id);
        const label = fn === 'start' ? '▶️ Пошло' : fn === 'pause' ? '⏸ Пауза' : '⏹ Остановлено, время записано';
        await ctx.answerCallbackQuery(label);
        await this.sendTasks(ctx, projectId, emp.id, true);
      };
    bot.callbackQuery(/^start:(\d+)$/, act('start'));
    bot.callbackQuery(/^pause:(\d+)$/, act('pause'));
    bot.callbackQuery(/^stop:(\d+)$/, act('stop'));

    // Приём текста заметки (когда ждём ввод). Команды не трогаем.
    bot.on('message:text', async (ctx, next) => {
      const empId = this.awaitingNote.get(ctx.from.id);
      if (!empId || ctx.message.text.startsWith('/')) return next();
      this.awaitingNote.delete(ctx.from.id);
      await this.prisma.employee.update({ where: { id: empId }, data: { notes: ctx.message.text } });
      await ctx.reply('📝 Заметка сохранена.');
      await this.sendTasks(ctx, projectId, empId);
    });
  }

  // Список задач проекта, назначенных сотруднику, с кнопками трекинга.
  private async sendTasks(ctx: any, projectId: number, employeeId: number, edit = false) {
    const tasks = await this.prisma.task.findMany({
      where: { projectId, assigneeId: employeeId, NOT: { status: 'DONE' } },
      orderBy: [{ priorityRank: 'asc' }, { createdAt: 'asc' }],
      include: { timeLogs: { select: { hours: true } }, trackings: { where: { employeeId } } },
    });
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });

    if (!tasks.length) {
      const text = `📋 ${project?.name}\n\nНа вас нет открытых задач.`;
      const kb = new InlineKeyboard().text('🔄 Обновить', 'tasks').text('📝 Заметки', 'notes');
      return edit
        ? ctx.editMessageText(text, { reply_markup: kb }).catch(() => {})
        : ctx.reply(text, { reply_markup: kb });
    }

    const kb = new InlineKeyboard();
    const lines: string[] = [`📋 ${project?.name} — ваши задачи:\n`];
    for (const t of tasks) {
      const spent = t.timeLogs.reduce((s, l) => s + l.hours, 0);
      const tr = t.trackings[0];
      const running = tr?.state === 'RUNNING';
      const paused = tr?.state === 'PAUSED';
      const live = tr ? liveSec(tr) : 0;
      const mark = running ? '🟢 идёт' : paused ? '⏸ пауза' : '';
      lines.push(
        `#${t.id} P${t.priorityRank} · ${t.title}\n` +
          `   ${STATUS_RU[t.status]} · факт ${spent.toFixed(1)}ч / оценка ${t.estimateHours}ч ${
            running ? `· сейчас ${fmtDur(live)} ${mark}` : mark ? `· ${mark}` : ''
          }`,
      );
      if (running) {
        kb.text(`⏸ ${t.id}`, `pause:${t.id}`).text(`⏹ ${t.id}`, `stop:${t.id}`).row();
      } else {
        kb.text(`▶️ ${t.id} ${t.title.slice(0, 18)}`, `start:${t.id}`).row();
      }
    }
    kb.text('🔄 Обновить', 'tasks').text('📝 Заметки', 'notes');
    const text = lines.join('\n');
    if (edit) return ctx.editMessageText(text, { reply_markup: kb }).catch(() => {});
    return ctx.reply(text, { reply_markup: kb });
  }
}

@Module({
  imports: [TrackingModule],
  providers: [BotsService, PrismaService],
  exports: [BotsService],
})
export class BotsModule {}
