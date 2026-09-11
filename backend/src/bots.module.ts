import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { EmployeeRole } from '@prisma/client';
import { Bot, InlineKeyboard, InputFile } from 'grammy';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { extname, join } from 'path';
import { existsSync, mkdirSync, promises as fsp } from 'fs';
import { PrismaService } from './prisma.service';
import { TrackingModule, TrackingService, liveSec } from './tracking.module';
import { DashboardModule, DashboardService } from './dashboard.module';

const ADMIN_BOT_KEY = 'adminBotToken';
const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
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
  private awaitingEstimate = new Map<number, { taskId: number; employeeId: number }>(); // ждём оценку задачи
  private awaitingLogEdit = new Map<number, { logId: number; taskId: number; employeeId: number }>(); // ждём новые часы лога
  private awaitingDesc = new Map<number, { taskId: number; employeeId: number }>(); // ждём текст описания
  private awaitingAttach = new Map<number, { taskId: number; employeeId: number }>(); // ждём файл/фото
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
    // Карточка и управление сотрудником
    bot.callbackQuery(/^a_emp:(\d+)$/, async (ctx) => {
      await ctx.answerCallbackQuery();
      if (!(await this.findAdmin(ctx.from.id))) return;
      await this.adminEmpCard(ctx, Number(ctx.match![1]), true);
    });
    bot.callbackQuery(/^a_emp_name:(\d+)$/, async (ctx) => {
      await ctx.answerCallbackQuery();
      if (!(await this.findAdmin(ctx.from.id))) return;
      this.adminState.set(ctx.from.id, { flow: 'emp_edit_name', id: Number(ctx.match![1]) });
      await ctx.reply('Новое имя сотрудника:');
    });
    bot.callbackQuery(/^a_emp_role:(\d+)$/, async (ctx) => {
      await ctx.answerCallbackQuery();
      if (!(await this.findAdmin(ctx.from.id))) return;
      const id = Number(ctx.match![1]);
      const kb = new InlineKeyboard();
      ROLES.forEach((r) => kb.text(r.label, `a_setrole:${id}:${r.v}`).row());
      kb.text('⬅️ Назад', `a_emp:${id}`);
      await ctx.editMessageText('Новая роль:', { reply_markup: kb }).catch(() => {});
    });
    bot.callbackQuery(/^a_setrole:(\d+):(\w+)$/, async (ctx) => {
      if (!(await this.findAdmin(ctx.from.id))) return ctx.answerCallbackQuery('Нет доступа');
      await this.prisma.employee.update({ where: { id: Number(ctx.match![1]) }, data: { role: ctx.match![2] as EmployeeRole } });
      await ctx.answerCallbackQuery('Роль обновлена');
      await this.adminEmpCard(ctx, Number(ctx.match![1]), true);
    });
    bot.callbackQuery(/^a_emp_active:(\d+)$/, async (ctx) => {
      if (!(await this.findAdmin(ctx.from.id))) return ctx.answerCallbackQuery('Нет доступа');
      const id = Number(ctx.match![1]);
      const e = await this.prisma.employee.findUnique({ where: { id } });
      if (e) await this.prisma.employee.update({ where: { id }, data: { active: !e.active } });
      await ctx.answerCallbackQuery('Готово');
      await this.adminEmpCard(ctx, id, true);
    });
    bot.callbackQuery(/^a_emp_del:(\d+)$/, async (ctx) => {
      if (!(await this.findAdmin(ctx.from.id))) return ctx.answerCallbackQuery('Нет доступа');
      const id = Number(ctx.match![1]);
      const e = await this.prisma.employee.findUnique({ where: { id } });
      if (e?.hidden) return ctx.answerCallbackQuery('Системного админа нельзя удалить');
      await this.prisma.employee.delete({ where: { id } }).catch(() => {});
      await ctx.answerCallbackQuery('Удалён');
      await this.adminEmployees(ctx, true);
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

      if (st.flow === 'emp_edit_name') {
        await this.prisma.employee.update({ where: { id: st.id }, data: { name: text } });
        this.adminState.delete(ctx.from.id);
        await ctx.reply('✅ Имя обновлено.');
        return this.adminEmpCard(ctx, st.id, false);
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
    const kb = new InlineKeyboard();
    emps.forEach((e) =>
      kb.text(`${e.active ? '' : '⛔ '}${!e.role ? '⏳ ' : ''}${e.name}${e.isAdmin ? ' ⭐' : ''}`, `a_emp:${e.id}`).row(),
    );
    kb.text('➕ Добавить сотрудника', 'a_emp_add').row().text('⬅️ Меню', 'a_menu');
    const text = emps.length ? '👥 Сотрудники (нажмите для управления):' : '👥 Сотрудников пока нет.';
    return edit
      ? ctx.editMessageText(text, { reply_markup: kb }).catch(() => ctx.reply(text, { reply_markup: kb }))
      : ctx.reply(text, { reply_markup: kb });
  }

  // Карточка сотрудника с действиями.
  private async adminEmpCard(ctx: any, id: number, edit: boolean) {
    const e = await this.prisma.employee.findUnique({ where: { id } });
    if (!e) return this.adminEmployees(ctx, edit);
    const kb = new InlineKeyboard()
      .text('✏️ Имя', `a_emp_name:${id}`)
      .text('🎭 Роль', `a_emp_role:${id}`)
      .row()
      .text(e.active ? '⛔ Деактивировать' : '✅ Активировать', `a_emp_active:${id}`)
      .row()
      .text('🗑 Удалить', `a_emp_del:${id}`)
      .row()
      .text('⬅️ К списку', 'a_employees');
    const text =
      `👤 ${e.name}\n` +
      `Роль: ${ROLES.find((r) => r.v === e.role)?.label || '⏳ не назначена'}${e.isAdmin ? ' · ⭐ админ' : ''}\n` +
      (e.telegramUsername ? `Telegram: @${e.telegramUsername}\n` : '') +
      `Должность: ${e.position || '—'}\n` +
      `Часов/нед: ${e.weeklyHours}\n` +
      `Статус: ${e.active ? 'активен' : 'неактивен'}`;
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

    const noRoleMsg = '⏳ Вы зарегистрированы и ждёте доступа. Руководитель назначит вам роль — тогда появятся задачи.';
    // Сотрудник с доступом (есть роль) или null.
    const withAccess = async (ctx: any) => {
      const emp = await findEmployee(ctx.from?.id);
      if (!emp) {
        await ctx.answerCallbackQuery?.('Сначала /start');
        return null;
      }
      if (!emp.role) {
        await ctx.answerCallbackQuery?.('Ждите назначения роли');
        return null;
      }
      return emp;
    };

    // /start — авто-регистрация из Telegram + меню задач.
    bot.command('start', async (ctx) => {
      const from = ctx.from!;
      let emp = await findEmployee(from.id);
      if (!emp) {
        emp = await this.registerFromTelegram(from, projectId);
      } else {
        // уже зарегистрирован — привяжем к этому проекту, если ещё не участник
        await this.prisma.projectMember
          .upsert({
            where: { employeeId_projectId: { employeeId: emp.id, projectId } },
            create: { employeeId: emp.id, projectId },
            update: {},
          })
          .catch(() => {});
      }
      if (!emp.role) return ctx.reply(noRoleMsg);
      return this.sendTasks(ctx, projectId, emp.id);
    });

    bot.callbackQuery('tasks', async (ctx) => {
      const emp = await withAccess(ctx);
      await ctx.answerCallbackQuery();
      if (emp) await this.sendTasks(ctx, projectId, emp.id);
    });

    // Заметки сотрудника — список отдельных записей
    bot.callbackQuery('notes', async (ctx) => {
      const emp = await withAccess(ctx);
      await ctx.answerCallbackQuery();
      if (!emp) return;
      await this.sendNotes(ctx, emp.id);
    });
    bot.callbackQuery('note_add', async (ctx) => {
      const emp = await withAccess(ctx);
      await ctx.answerCallbackQuery();
      if (!emp) return;
      this.awaitingNote.set(ctx.from.id, emp.id);
      await ctx.reply('Пришлите текст новой заметки одним сообщением.');
    });
    bot.callbackQuery(/^note_del:(\d+)$/, async (ctx) => {
      const emp = await withAccess(ctx);
      if (!emp) return;
      await this.prisma.note.deleteMany({ where: { id: Number(ctx.match![1]), employeeId: emp.id } });
      await ctx.answerCallbackQuery('Удалено');
      await this.sendNotes(ctx, emp.id, true);
    });

    // Открыть задачу (детали + кнопки внутри)
    bot.callbackQuery(/^open:(\d+)$/, async (ctx) => {
      const emp = await withAccess(ctx);
      await ctx.answerCallbackQuery();
      if (emp) await this.openTask(ctx, emp.id, Number(ctx.match![1]), true);
    });

    // Оценку задаёт исполнитель
    bot.callbackQuery(/^est:(\d+)$/, async (ctx) => {
      const emp = await withAccess(ctx);
      await ctx.answerCallbackQuery();
      if (!emp) return;
      this.awaitingEstimate.set(ctx.from.id, { taskId: Number(ctx.match![1]), employeeId: emp.id });
      await ctx.reply('Введите оценку задачи в часах (можно дробью, напр. 1.5 или 0.5):');
    });

    // Записи времени по задаче (с правкой)
    bot.callbackQuery(/^logs:(\d+)$/, async (ctx) => {
      const emp = await withAccess(ctx);
      await ctx.answerCallbackQuery();
      if (emp) await this.sendTaskLogs(ctx, emp.id, Number(ctx.match![1]), true);
    });
    bot.callbackQuery(/^logedit:(\d+)$/, async (ctx) => {
      const emp = await withAccess(ctx);
      if (!emp) return;
      const logId = Number(ctx.match![1]);
      const log = await this.prisma.timeLog.findUnique({ where: { id: logId } });
      if (!log || log.employeeId !== emp.id) return ctx.answerCallbackQuery('Это не ваша запись');
      await ctx.answerCallbackQuery();
      this.awaitingLogEdit.set(ctx.from.id, { logId, taskId: log.taskId, employeeId: emp.id });
      await ctx.reply(`Текущее: ${log.hours} ч. Введите новые часы (дробью, напр. 1.25):`);
    });

    // Описание задачи
    bot.callbackQuery(/^desc:(\d+)$/, async (ctx) => {
      const emp = await withAccess(ctx);
      await ctx.answerCallbackQuery();
      if (!emp) return;
      this.awaitingDesc.set(ctx.from.id, { taskId: Number(ctx.match![1]), employeeId: emp.id });
      await ctx.reply('Пришлите новое описание задачи одним сообщением:');
    });
    // Прикрепить файл/фото
    bot.callbackQuery(/^attach:(\d+)$/, async (ctx) => {
      const emp = await withAccess(ctx);
      await ctx.answerCallbackQuery();
      if (!emp) return;
      this.awaitingAttach.set(ctx.from.id, { taskId: Number(ctx.match![1]), employeeId: emp.id });
      await ctx.reply('Пришлите фото или документ — приложу к задаче.');
    });
    // Показать вложения
    bot.callbackQuery(/^files:(\d+)$/, async (ctx) => {
      const emp = await withAccess(ctx);
      await ctx.answerCallbackQuery();
      if (!emp) return;
      const atts = await this.prisma.attachment.findMany({ where: { taskId: Number(ctx.match![1]) }, orderBy: { createdAt: 'desc' } });
      if (!atts.length) return ctx.reply('Вложений нет.');
      for (const a of atts) {
        try {
          if (a.mimeType.startsWith('image/')) await ctx.replyWithPhoto(new InputFile(a.storedPath), { caption: a.filename });
          else await ctx.replyWithDocument(new InputFile(a.storedPath), { caption: a.filename });
        } catch {
          /* ignore */
        }
      }
    });

    // Приём фото
    bot.on('message:photo', async (ctx) => {
      const st = this.awaitingAttach.get(ctx.from.id);
      if (!st) return;
      this.awaitingAttach.delete(ctx.from.id);
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      await this.saveTelegramFile(bot.token, ctx, photo.file_id, `photo-${Date.now()}.jpg`, 'image/jpeg', st.taskId, st.employeeId);
      await ctx.reply('📎 Фото приложено к задаче.');
      await this.openTask(ctx, st.employeeId, st.taskId, false);
    });
    // Приём документа
    bot.on('message:document', async (ctx) => {
      const st = this.awaitingAttach.get(ctx.from.id);
      if (!st) return;
      this.awaitingAttach.delete(ctx.from.id);
      const doc = ctx.message.document;
      await this.saveTelegramFile(bot.token, ctx, doc.file_id, doc.file_name || `file-${Date.now()}`, doc.mime_type || 'application/octet-stream', st.taskId, st.employeeId);
      await ctx.reply('📎 Документ приложен к задаче.');
      await this.openTask(ctx, st.employeeId, st.taskId, false);
    });

    // Трекинг — кнопки внутри задачи; после действия обновляем карточку задачи.
    const act =
      (fn: 'start' | 'pause' | 'stop') =>
      async (ctx: any) => {
        const emp = await withAccess(ctx);
        if (!emp) return;
        const taskId = Number(ctx.match[1]);
        await this.tracking[fn](taskId, emp.id);
        const label = fn === 'start' ? '▶️ Пошло' : fn === 'pause' ? '⏸ Пауза, время записано' : '⏹ Стоп, время записано';
        await ctx.answerCallbackQuery(label);
        await this.openTask(ctx, emp.id, taskId, true);
      };
    bot.callbackQuery(/^start:(\d+)$/, act('start'));
    bot.callbackQuery(/^pause:(\d+)$/, act('pause'));
    bot.callbackQuery(/^stop:(\d+)$/, act('stop'));

    // Приём текста: правка лога, оценка задачи, затем заметки. Команды не трогаем.
    bot.on('message:text', async (ctx, next) => {
      const text = ctx.message.text;
      if (text.startsWith('/')) return next();

      const le = this.awaitingLogEdit.get(ctx.from.id);
      if (le) {
        this.awaitingLogEdit.delete(ctx.from.id);
        const val = Number(text.replace(',', '.').trim());
        if (isNaN(val) || val < 0) {
          await ctx.reply('Не понял число. Откройте запись и попробуйте снова.');
          return;
        }
        const log = await this.prisma.timeLog.findUnique({ where: { id: le.logId } });
        if (log && log.employeeId === le.employeeId) {
          await this.prisma.timeLog.update({
            where: { id: le.logId },
            data: {
              hours: Math.round(val * 100) / 100,
              editedAt: new Date(),
              editedById: le.employeeId, // след: правил сам работник
              originalHours: log.originalHours ?? log.hours,
            },
          });
          await ctx.reply(`✅ Запись обновлена: ${val} ч (сохранён след правки).`);
        }
        return this.sendTaskLogs(ctx, le.employeeId, le.taskId, false);
      }

      const desc = this.awaitingDesc.get(ctx.from.id);
      if (desc) {
        this.awaitingDesc.delete(ctx.from.id);
        await this.prisma.task.update({ where: { id: desc.taskId }, data: { description: text } });
        await ctx.reply('✅ Описание обновлено.');
        return this.openTask(ctx, desc.employeeId, desc.taskId, false);
      }

      const est = this.awaitingEstimate.get(ctx.from.id);
      if (est) {
        this.awaitingEstimate.delete(ctx.from.id);
        const val = Number(text.replace(',', '.').trim());
        if (isNaN(val) || val < 0) {
          await ctx.reply('Не понял число. Откройте задачу и нажмите «📝 Оценить» ещё раз.');
          return;
        }
        await this.prisma.task.update({ where: { id: est.taskId }, data: { estimateHours: Math.round(val * 100) / 100 } });
        await ctx.reply(`✅ Оценка сохранена: ${val} ч`);
        return this.openTask(ctx, est.employeeId, est.taskId, false);
      }

      const empId = this.awaitingNote.get(ctx.from.id);
      if (!empId) return next();
      this.awaitingNote.delete(ctx.from.id);
      await this.prisma.note.create({ data: { employeeId: empId, text } });
      await ctx.reply('📝 Заметка добавлена.');
      await this.sendNotes(ctx, empId);
    });
  }

  // Карточка задачи в боте: детали, оценка, отработанное время (в долях часа) и кнопки трекинга.
  private async openTask(ctx: any, employeeId: number, taskId: number, edit = false) {
    const t = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        project: true,
        timeLogs: { select: { hours: true } },
        trackings: { where: { employeeId } },
        attachments: { select: { id: true } },
      },
    });
    if (!t) return;
    const spent = t.timeLogs.reduce((s, l) => s + l.hours, 0);
    const tr = t.trackings[0];
    const running = tr?.state === 'RUNNING';
    const paused = tr?.state === 'PAUSED';
    const live = tr ? liveSec(tr) : 0;

    const kb = new InlineKeyboard();
    if (running) kb.text('⏸ Пауза', `pause:${t.id}`).text('⏹ Стоп', `stop:${t.id}`).row();
    else kb.text(paused ? '▶️ Продолжить' : '▶️ Старт', `start:${t.id}`).row();
    kb.text('📝 Оценить', `est:${t.id}`).text('🕓 Записи времени', `logs:${t.id}`).row();
    kb.text('✏️ Описание', `desc:${t.id}`).text('📎 Прикрепить', `attach:${t.id}`).row();
    if (t.attachments.length) kb.text(`📎 Вложения (${t.attachments.length})`, `files:${t.id}`).row();
    kb.text('⬅️ К задачам', 'tasks');

    const text =
      `📂 #${t.id} ${t.title}\n` +
      `Проект: ${t.project?.name}\n` +
      (t.description ? `\n${t.description}\n` : '\n(описание не задано)\n') +
      `\nПриоритет: P${t.priorityRank} · статус: ${STATUS_RU[t.status]}\n` +
      `Оценка: ${t.estimateHours ? `${t.estimateHours} ч` : '— не задана (нажмите «Оценить») —'}\n` +
      `Отработано: ${spent.toFixed(2)} ч (${Math.round(spent * 60)} мин)` +
      (running ? `\n🟢 Идёт сейчас: ${fmtDur(live)}` : paused ? `\n⏸ На паузе` : '');

    return edit
      ? ctx.editMessageText(text, { reply_markup: kb }).catch(() => ctx.reply(text, { reply_markup: kb }))
      : ctx.reply(text, { reply_markup: kb });
  }

  // Авто-регистрация сотрудника из Telegram при /start бота проекта (без роли — ждёт доступа).
  private async registerFromTelegram(from: any, projectId: number) {
    const id = String(from.id);
    const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
    const name = fullName || (from.username ? `@${from.username}` : `Telegram ${id}`);
    const emp = await this.prisma.employee.create({
      data: {
        name,
        telegramUserId: id,
        telegramUsername: from.username || null,
        email: `telegram-${id}@integration.user`,
        role: null, // роль назначит руководитель
        active: true,
      },
    });
    await this.prisma.projectMember.create({ data: { employeeId: emp.id, projectId } }).catch(() => {});
    return emp;
  }

  // Скачать файл из Telegram и приложить к задаче.
  private async saveTelegramFile(
    token: string,
    ctx: any,
    fileId: string,
    origName: string,
    mimeType: string,
    taskId: number,
    employeeId: number,
  ) {
    try {
      const file = await ctx.api.getFile(fileId);
      const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const ext = extname(file.file_path || origName || '') || '';
      const stored = `${randomUUID()}${ext}`;
      const full = join(UPLOAD_DIR, stored);
      await fsp.writeFile(full, buf);
      await this.prisma.attachment.create({
        data: { taskId, filename: origName, storedPath: full, mimeType, size: buf.length, token: stored, uploadedById: employeeId },
      });
    } catch (e: any) {
      console.warn('[bot] не смог сохранить вложение:', e.message);
    }
  }

  // Записи времени сотрудника по задаче — с возможностью правки (со следом).
  private async sendTaskLogs(ctx: any, employeeId: number, taskId: number, edit = false) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    const logs = await this.prisma.timeLog.findMany({ where: { taskId, employeeId }, orderBy: { date: 'desc' } });
    const kb = new InlineKeyboard();
    logs.forEach((l) => {
      const d = new Date(l.date);
      const dd = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
      kb.text(`✏️ ${dd} · ${l.hours}ч${l.editedAt ? ' (изм.)' : ''}`, `logedit:${l.id}`).row();
    });
    kb.text('⬅️ К задаче', `open:${taskId}`);
    const total = Math.round(logs.reduce((s, l) => s + l.hours, 0) * 100) / 100;
    const text = logs.length
      ? `🕓 Ваши записи времени · ${task?.title}\nВсего: ${total} ч\n\nНажмите запись, чтобы изменить часы:`
      : `🕓 По задаче «${task?.title}» у вас пока нет записей.\nЗапустите таймер ▶️ — время запишется.`;
    return edit ? ctx.editMessageText(text, { reply_markup: kb }).catch(() => {}) : ctx.reply(text, { reply_markup: kb });
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
    const lines: string[] = [`📋 ${project?.name} — ваши задачи (нажмите, чтобы открыть):\n`];
    for (const t of tasks) {
      const spent = t.timeLogs.reduce((s, l) => s + l.hours, 0);
      const tr = t.trackings[0];
      const mark = tr?.state === 'RUNNING' ? '🟢' : tr?.state === 'PAUSED' ? '⏸' : '';
      lines.push(
        `#${t.id} P${t.priorityRank} · ${t.title} ${mark}\n` +
          `   ${STATUS_RU[t.status]} · ${spent.toFixed(2)}ч / оценка ${t.estimateHours ? t.estimateHours + 'ч' : '—'}`,
      );
      kb.text(`${mark || '📂'} #${t.id} ${t.title.slice(0, 24)}`, `open:${t.id}`).row();
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
