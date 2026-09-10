import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { EmployeeRole } from '@prisma/client';
import { Bot, InlineKeyboard } from 'grammy';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from './prisma.service';
import { TrackingModule, TrackingService, liveSec } from './tracking.module';
import { DashboardModule, DashboardService } from './dashboard.module';

const ADMIN_BOT_KEY = 'adminBotToken';
const ROLES: { v: EmployeeRole; label: string }[] = [
  { v: 'OPERATOR', label: 'Оператор' },
  { v: 'MANAGER', label: 'Руководитель' },
  { v: 'DEVELOPER', label: 'Разработчик' },
];
const TASK_ST: [string, string][] = [
  ['TODO', 'в очереди'],
  ['IN_PROGRESS', 'в работе'],
  ['BLOCKED', 'заблок.'],
  ['REVIEW', 'ревью'],
  ['DONE', 'готово'],
];

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
  private adminBot?: Bot; // главный админ-бот
  private adminState = new Map<number, any>(); // tgId -> состояние диалога админ-бота

  constructor(
    private prisma: PrismaService,
    private tracking: TrackingService,
    private dashboard: DashboardService,
  ) {}

  async onModuleInit() {
    const projects = await this.prisma.project.findMany({ where: { NOT: { botToken: null } } });
    for (const p of projects) if (p.botToken) this.launch(p.id, p.botToken);
    // Главный админ-бот (токен в настройках).
    const token = await this.getSetting(ADMIN_BOT_KEY);
    if (token) this.launchAdmin(token);
  }

  // --- Настройки ---
  async getSetting(key: string): Promise<string | null> {
    const s = await this.prisma.setting.findUnique({ where: { key } });
    return s?.value ?? null;
  }
  async setSetting(key: string, value: string | null) {
    await this.prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }

  // --- Главный админ-бот ---
  async reloadAdmin() {
    if (this.adminBot) {
      try {
        await this.adminBot.stop();
      } catch {
        /* ignore */
      }
      this.adminBot = undefined;
    }
    const token = await this.getSetting(ADMIN_BOT_KEY);
    if (token) this.launchAdmin(token);
    else await this.setSetting('adminBotUsername', null);
  }

  private launchAdmin(token: string) {
    const bot = new Bot(token);
    this.wireAdmin(bot);
    bot.catch((err) => console.warn('[admin-bot] ошибка:', err.message));
    bot
      .start({
        onStart: (me) => {
          console.log(`[admin-bot] @${me.username} запущен`);
          this.setSetting('adminBotUsername', me.username).catch(() => {});
        },
      })
      .catch((e) => console.warn(`[admin-bot] не запустился: ${e.message}`));
    this.adminBot = bot;
  }

  private async findAdmin(tgId?: number) {
    if (!tgId) return null;
    const e = await this.prisma.employee.findUnique({ where: { telegramUserId: String(tgId) } });
    return e && e.isAdmin ? e : null;
  }

  private adminMenu() {
    return new InlineKeyboard()
      .text('📊 Дашборд', 'a_dash')
      .text('🟢 В работе', 'a_live')
      .row()
      .text('📁 Проекты', 'a_projects')
      .text('👥 Сотрудники', 'a_employees')
      .row()
      .text('✅ Задачи', 'a_tasks');
  }

  private wireAdmin(bot: Bot) {
    const send = (ctx: any, text: string, kb?: InlineKeyboard, edit = false) =>
      edit
        ? ctx.editMessageText(text, { reply_markup: kb }).catch(() => ctx.reply(text, { reply_markup: kb }))
        : ctx.reply(text, { reply_markup: kb });

    bot.command('start', async (ctx) => {
      const admin = await this.findAdmin(ctx.from?.id);
      if (admin) return ctx.reply(`👑 Админ-панель, ${admin.name}. Выберите раздел:`, { reply_markup: this.adminMenu() });
      this.adminState.set(ctx.from!.id, { flow: 'login', step: 'login' });
      await ctx.reply('Вход в админ-панель. Введите логин:');
    });

    bot.callbackQuery('a_menu', async (ctx) => {
      await ctx.answerCallbackQuery();
      if (await this.findAdmin(ctx.from.id)) await send(ctx, '👑 Админ-панель. Выберите раздел:', this.adminMenu(), true);
    });

    bot.callbackQuery('a_dash', async (ctx) => {
      await ctx.answerCallbackQuery();
      if (!(await this.findAdmin(ctx.from.id))) return;
      const c = await this.dashboard.capacity();
      const s = c.summary;
      const top = c.projectLoad.map((p) => `• ${p.code} ${p.name}: осталось ${p.remainingHours}ч (${p.openTasks} задач)`).join('\n');
      const text =
        `📊 Дашборд (4 недели)\n\n` +
        `Ёмкость: ${s.totalCapacityHours}ч · план: ${s.totalPlannedHours}ч · свободно: ${s.freeCapacityHours}ч\n` +
        `Остаток работ: ${s.totalRemainingHours}ч\n` +
        (s.adequate ? '✅ Ресурсов хватает' : `⚠️ Дефицит ${s.deficitHours}ч`) +
        (top ? `\n\nПроекты:\n${top}` : '');
      await send(ctx, text, new InlineKeyboard().text('⬅️ Меню', 'a_menu'), true);
    });

    bot.callbackQuery('a_live', async (ctx) => {
      await ctx.answerCallbackQuery();
      if (!(await this.findAdmin(ctx.from.id))) return;
      const list = await this.tracking.active();
      const text = list.length
        ? '🟢 Сейчас в работе:\n\n' +
          list
            .map((t: any) => `${t.state === 'RUNNING' ? '🟢' : '⏸'} ${t.employee?.name} — ${t.task?.title} (${fmtDur(liveSec(t))})`)
            .join('\n')
        : 'Сейчас никто не трекает время.';
      await send(ctx, text, new InlineKeyboard().text('⬅️ Меню', 'a_menu'), true);
    });

    // Проекты
    bot.callbackQuery('a_projects', async (ctx) => {
      await ctx.answerCallbackQuery();
      if (!(await this.findAdmin(ctx.from.id))) return;
      await this.adminProjects(ctx, true);
    });
    bot.callbackQuery('a_proj_add', async (ctx) => {
      await ctx.answerCallbackQuery();
      if (!(await this.findAdmin(ctx.from.id))) return;
      this.adminState.set(ctx.from.id, { flow: 'proj_add', step: 'name' });
      await ctx.reply('Название нового проекта:');
    });
    bot.callbackQuery(/^a_proj_del:(\d+)$/, async (ctx) => {
      if (!(await this.findAdmin(ctx.from.id))) return ctx.answerCallbackQuery('Нет доступа');
      await this.prisma.project.delete({ where: { id: Number(ctx.match![1]) } }).catch(() => {});
      await ctx.answerCallbackQuery('Удалён');
      await this.adminProjects(ctx, true);
    });

    // Сотрудники
    bot.callbackQuery('a_employees', async (ctx) => {
      await ctx.answerCallbackQuery();
      if (!(await this.findAdmin(ctx.from.id))) return;
      await this.adminEmployees(ctx, true);
    });
    bot.callbackQuery('a_emp_add', async (ctx) => {
      await ctx.answerCallbackQuery();
      if (!(await this.findAdmin(ctx.from.id))) return;
      this.adminState.set(ctx.from.id, { flow: 'emp_add', step: 'name' });
      await ctx.reply('Имя нового сотрудника:');
    });
    bot.callbackQuery(/^a_emprole:(\w+)$/, async (ctx) => {
      if (!(await this.findAdmin(ctx.from.id))) return ctx.answerCallbackQuery('Нет доступа');
      const st = this.adminState.get(ctx.from.id);
      if (st?.flow !== 'emp_add' || !st.name) return ctx.answerCallbackQuery();
      await this.prisma.employee.create({ data: { name: st.name, role: ctx.match![1] as EmployeeRole } });
      this.adminState.delete(ctx.from.id);
      await ctx.answerCallbackQuery('Сотрудник добавлен');
      await this.adminEmployees(ctx, false);
    });

    // Задачи
    bot.callbackQuery('a_tasks', async (ctx) => {
      await ctx.answerCallbackQuery();
      if (!(await this.findAdmin(ctx.from.id))) return;
      const projects = await this.prisma.project.findMany({ orderBy: { createdAt: 'desc' } });
      const kb = new InlineKeyboard();
      projects.forEach((p) => kb.text(`${p.code} · ${p.name}`, `a_task_proj:${p.id}`).row());
      kb.text('⬅️ Меню', 'a_menu');
      await send(ctx, projects.length ? 'Выберите проект:' : 'Проектов нет.', kb, true);
    });
    bot.callbackQuery(/^a_task_proj:(\d+)$/, async (ctx) => {
      await ctx.answerCallbackQuery();
      if (!(await this.findAdmin(ctx.from.id))) return;
      await this.adminProjectTasks(ctx, Number(ctx.match![1]), true);
    });
    bot.callbackQuery(/^a_task_add:(\d+)$/, async (ctx) => {
      await ctx.answerCallbackQuery();
      if (!(await this.findAdmin(ctx.from.id))) return;
      this.adminState.set(ctx.from.id, { flow: 'task_add', step: 'title', projectId: Number(ctx.match![1]) });
      await ctx.reply('Название задачи:');
    });
    bot.callbackQuery(/^a_task_assignee:(\d+):(\d+)$/, async (ctx) => {
      const admin = await this.findAdmin(ctx.from.id);
      if (!admin) return ctx.answerCallbackQuery('Нет доступа');
      const st = this.adminState.get(ctx.from.id);
      if (st?.flow !== 'task_add') return ctx.answerCallbackQuery();
      const empId = Number(ctx.match![1]);
      await this.prisma.task.create({
        data: {
          projectId: st.projectId,
          title: st.title,
          estimateHours: st.estimate || 0,
          assigneeId: empId || null,
          createdById: admin.id,
        },
      });
      this.adminState.delete(ctx.from.id);
      await ctx.answerCallbackQuery('Задача создана');
      await this.adminProjectTasks(ctx, st.projectId, false);
    });
    bot.callbackQuery(/^a_task_st:(\d+)$/, async (ctx) => {
      await ctx.answerCallbackQuery();
      if (!(await this.findAdmin(ctx.from.id))) return;
      const id = Number(ctx.match![1]);
      const kb = new InlineKeyboard();
      TASK_ST.forEach(([v, l]) => kb.text(l, `a_setst:${id}:${v}`).row());
      await send(ctx, 'Новый статус:', kb, true);
    });
    bot.callbackQuery(/^a_setst:(\d+):(\w+)$/, async (ctx) => {
      if (!(await this.findAdmin(ctx.from.id))) return ctx.answerCallbackQuery('Нет доступа');
      const t = await this.prisma.task.update({
        where: { id: Number(ctx.match![1]) },
        data: { status: ctx.match![2] as any },
      });
      await ctx.answerCallbackQuery('Статус обновлён');
      await this.adminProjectTasks(ctx, t.projectId, true);
    });

    // Приём текста (диалоги)
    bot.on('message:text', async (ctx, next) => {
      const st = this.adminState.get(ctx.from.id);
      const text = ctx.message.text.trim();
      if (!st || text.startsWith('/')) return next();

      if (st.flow === 'login') {
        if (st.step === 'login') {
          st.login = text;
          st.step = 'password';
          return ctx.reply('Пароль:');
        }
        const emp = await this.prisma.employee.findUnique({ where: { login: st.login } });
        this.adminState.delete(ctx.from.id);
        if (!emp || !emp.isAdmin || !emp.passwordHash || !bcrypt.compareSync(text, emp.passwordHash)) {
          return ctx.reply('Неверный логин/пароль или нет прав администратора. /start — попробовать снова.');
        }
        await this.prisma.employee.update({ where: { id: emp.id }, data: { telegramUserId: String(ctx.from.id) } }).catch(() => {});
        return ctx.reply(`👑 Добро пожаловать, ${emp.name}!`, { reply_markup: this.adminMenu() });
      }

      if (!(await this.findAdmin(ctx.from.id))) return next();

      if (st.flow === 'proj_add') {
        if (st.step === 'name') {
          st.name = text;
          st.step = 'code';
          return ctx.reply('Код проекта (коротко, напр. CRM):');
        }
        await this.prisma.project.create({ data: { name: st.name, code: text.toUpperCase(), status: 'PLANNED' } }).catch(() => {});
        this.adminState.delete(ctx.from.id);
        await ctx.reply('✅ Проект создан.');
        return this.adminProjects(ctx, false);
      }

      if (st.flow === 'emp_add' && st.step === 'name') {
        st.name = text;
        st.step = 'role';
        const kb = new InlineKeyboard();
        ROLES.forEach((r) => kb.text(r.label, `a_emprole:${r.v}`));
        return ctx.reply('Роль сотрудника:', { reply_markup: kb });
      }

      if (st.flow === 'task_add') {
        if (st.step === 'title') {
          st.title = text;
          st.step = 'estimate';
          return ctx.reply('Оценка в часах (число, 0 — если нет):');
        }
        if (st.step === 'estimate') {
          st.estimate = Number(text.replace(',', '.')) || 0;
          st.step = 'assignee';
          const emps = await this.prisma.employee.findMany({ where: { hidden: false, active: true }, orderBy: { name: 'asc' } });
          const kb = new InlineKeyboard().text('— без исполнителя —', `a_task_assignee:0:0`).row();
          emps.forEach((e) => kb.text(e.name, `a_task_assignee:${e.id}:0`).row());
          return ctx.reply('Исполнитель:', { reply_markup: kb });
        }
      }
      return next();
    });
  }

  private async adminProjects(ctx: any, edit: boolean) {
    const projects = await this.prisma.project.findMany({ orderBy: { createdAt: 'desc' } });
    const kb = new InlineKeyboard().text('➕ Добавить проект', 'a_proj_add').row();
    projects.forEach((p) => kb.text(`🗑 ${p.code} · ${p.name}`, `a_proj_del:${p.id}`).row());
    kb.text('⬅️ Меню', 'a_menu');
    const text = projects.length
      ? '📁 Проекты (нажмите, чтобы удалить):\n\n' + projects.map((p) => `• ${p.code} — ${p.name} [${p.status}]`).join('\n')
      : '📁 Проектов пока нет.';
    return edit
      ? ctx.editMessageText(text, { reply_markup: kb }).catch(() => ctx.reply(text, { reply_markup: kb }))
      : ctx.reply(text, { reply_markup: kb });
  }

  private async adminEmployees(ctx: any, edit: boolean) {
    const emps = await this.prisma.employee.findMany({ where: { hidden: false }, orderBy: { name: 'asc' } });
    const kb = new InlineKeyboard().text('➕ Добавить сотрудника', 'a_emp_add').row().text('⬅️ Меню', 'a_menu');
    const text = emps.length
      ? '👥 Сотрудники:\n\n' + emps.map((e) => `• ${e.name} — ${ROLES.find((r) => r.v === e.role)?.label}${e.isAdmin ? ' ⭐' : ''}`).join('\n')
      : '👥 Сотрудников пока нет.';
    return edit
      ? ctx.editMessageText(text, { reply_markup: kb }).catch(() => ctx.reply(text, { reply_markup: kb }))
      : ctx.reply(text, { reply_markup: kb });
  }

  private async adminProjectTasks(ctx: any, projectId: number, edit: boolean) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    const tasks = await this.prisma.task.findMany({
      where: { projectId },
      orderBy: [{ priorityRank: 'asc' }, { createdAt: 'asc' }],
      include: { assignee: true },
    });
    const kb = new InlineKeyboard().text('➕ Добавить задачу', `a_task_add:${projectId}`).row();
    tasks.forEach((t) => kb.text(`🔄 #${t.id} ${t.title.slice(0, 22)}`, `a_task_st:${t.id}`).row());
    kb.text('⬅️ К проектам', 'a_tasks');
    const text =
      `✅ Задачи · ${project?.name}\n\n` +
      (tasks.length
        ? tasks
            .map((t) => `#${t.id} ${t.title}\n   ${TASK_ST.find((s) => s[0] === t.status)?.[1]} · ${t.assignee?.name || 'без исполнителя'}`)
            .join('\n')
        : 'Задач нет.');
    return edit
      ? ctx.editMessageText(text, { reply_markup: kb }).catch(() => ctx.reply(text, { reply_markup: kb }))
      : ctx.reply(text, { reply_markup: kb });
  }

  // Перезапуск бота проекта при смене/очистке токена.
  async reload(projectId: number) {
    await this.stop(projectId);
    const p = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (p?.botToken) this.launch(projectId, p.botToken);
    else await this.prisma.project.update({ where: { id: projectId }, data: { botUsername: null } }).catch(() => {});
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
    bot
      .start({
        onStart: (me) => {
          console.log(`[bot ${projectId}] @${me.username} запущен`);
          // Запоминаем @username бота на проекте (для показа в интерфейсе).
          this.prisma.project.update({ where: { id: projectId }, data: { botUsername: me.username } }).catch(() => {});
        },
      })
      .catch((e) => console.warn(`[bot ${projectId}] не запустился: ${e.message}`));
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

    // Заметки сотрудника — список отдельных записей
    bot.callbackQuery('notes', async (ctx) => {
      const emp = await findEmployee(ctx.from?.id);
      await ctx.answerCallbackQuery();
      if (!emp) return;
      await this.sendNotes(ctx, emp.id);
    });
    bot.callbackQuery('note_add', async (ctx) => {
      const emp = await findEmployee(ctx.from?.id);
      await ctx.answerCallbackQuery();
      if (!emp) return;
      this.awaitingNote.set(ctx.from.id, emp.id);
      await ctx.reply('Пришлите текст новой заметки одним сообщением.');
    });
    bot.callbackQuery(/^note_del:(\d+)$/, async (ctx) => {
      const emp = await findEmployee(ctx.from?.id);
      if (!emp) return ctx.answerCallbackQuery('Сначала /start');
      await this.prisma.note.deleteMany({ where: { id: Number(ctx.match![1]), employeeId: emp.id } });
      await ctx.answerCallbackQuery('Удалено');
      await this.sendNotes(ctx, emp.id, true);
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

    // Приём текста новой заметки (когда ждём ввод). Команды не трогаем.
    bot.on('message:text', async (ctx, next) => {
      const empId = this.awaitingNote.get(ctx.from.id);
      if (!empId || ctx.message.text.startsWith('/')) return next();
      this.awaitingNote.delete(ctx.from.id);
      await this.prisma.note.create({ data: { employeeId: empId, text: ctx.message.text } });
      await ctx.reply('📝 Заметка добавлена.');
      await this.sendNotes(ctx, empId);
    });
  }

  private async sendNotes(ctx: any, employeeId: number, edit = false) {
    const notes = await this.prisma.note.findMany({ where: { employeeId }, orderBy: { createdAt: 'desc' } });
    const kb = new InlineKeyboard().text('➕ Добавить заметку', 'note_add').row();
    notes.forEach((n) => kb.text(`🗑 ${n.text.slice(0, 20)}`, `note_del:${n.id}`).row());
    kb.text('⬅️ Задачи', 'tasks');
    const text = notes.length
      ? '📝 Ваши заметки:\n\n' + notes.map((n, i) => `${i + 1}. ${n.text}`).join('\n')
      : '📝 Заметок пока нет.';
    return edit
      ? ctx.editMessageText(text, { reply_markup: kb }).catch(() => {})
      : ctx.reply(text, { reply_markup: kb });
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
  imports: [TrackingModule, DashboardModule],
  providers: [BotsService, PrismaService],
  exports: [BotsService],
})
export class BotsModule {}
