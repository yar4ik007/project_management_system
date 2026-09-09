import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  OnModuleInit,
  Patch,
  Post,
  Req,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import { PrismaService } from './prisma.service';

const JWT_SECRET = process.env.JWT_SECRET || 'pms-dev-secret-change-me';

// Декораторы доступа
export const Public = () => SetMetadata('isPublic', true);
export const Admin = () => SetMetadata('isAdmin', true);

// Гвард аутентификации: требует валидный JWT, кроме @Public.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwt: JwtService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest();
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) throw new UnauthorizedException('Нужен вход');
    try {
      req.user = this.jwt.verify(token, { secret: JWT_SECRET });
      return true;
    } catch {
      throw new UnauthorizedException('Сессия недействительна');
    }
  }
}

// Гвард админа: методы с @Admin доступны только админам.
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const needAdmin = this.reflector.getAllAndOverride<boolean>('isAdmin', [ctx.getHandler(), ctx.getClass()]);
    if (!needAdmin) return true;
    const req = ctx.switchToHttp().getRequest();
    if (!req.user?.isAdmin) throw new ForbiddenException('Только для администратора');
    return true;
  }
}

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  // Гарантируем скрытого супер-админа при старте (нельзя удалить, не виден в списках).
  async onModuleInit() {
    const existing = await this.prisma.employee.findUnique({ where: { login: 'admin@free.man' } });
    if (!existing) {
      await this.prisma.employee.create({
        data: {
          name: 'Администратор',
          login: 'admin@free.man',
          passwordHash: bcrypt.hashSync('password', 10),
          role: 'MANAGER',
          isAdmin: true,
          hidden: true,
          active: true,
        },
      });
      // eslint-disable-next-line no-console
      console.log('[auth] создан скрытый супер-админ admin@free.man');
    }
  }

  async login(login: string, password: string) {
    const emp = await this.prisma.employee.findUnique({ where: { login } });
    if (!emp || !emp.passwordHash || !bcrypt.compareSync(password, emp.passwordHash)) {
      throw new UnauthorizedException('Неверный логин или пароль');
    }
    // Включена двухфакторка — просим код отдельным шагом (короткий тикет).
    if (emp.twoFactorEnabled) {
      const ticket = this.jwt.sign({ sub: emp.id, stage: '2fa' }, { secret: JWT_SECRET, expiresIn: '5m' });
      return { twoFactorRequired: true, ticket };
    }
    return { token: this.signFull(emp), user: this.publicUser(emp) };
  }

  async verify2fa(ticket: string, code: string) {
    let payload: any;
    try {
      payload = this.jwt.verify(ticket, { secret: JWT_SECRET });
    } catch {
      throw new UnauthorizedException('Сессия входа истекла, войдите заново');
    }
    if (payload.stage !== '2fa') throw new UnauthorizedException('Некорректный тикет');
    const emp = await this.prisma.employee.findUnique({ where: { id: payload.sub } });
    if (!emp?.twoFactorSecret || !authenticator.verify({ token: code, secret: emp.twoFactorSecret })) {
      throw new UnauthorizedException('Неверный код');
    }
    return { token: this.signFull(emp), user: this.publicUser(emp) };
  }

  async me(id: number) {
    const emp = await this.prisma.employee.findUnique({ where: { id } });
    return emp ? this.publicUser(emp) : null;
  }

  // Смена своих логина/пароля. Для смены пароля нужен текущий пароль.
  async updateAccount(id: number, data: { login?: string; currentPassword?: string; newPassword?: string }) {
    const emp = await this.prisma.employee.findUnique({ where: { id } });
    if (!emp) throw new UnauthorizedException();
    const patch: any = {};
    if (data.newPassword) {
      if (!emp.passwordHash || !data.currentPassword || !bcrypt.compareSync(data.currentPassword, emp.passwordHash)) {
        throw new BadRequestException('Неверный текущий пароль');
      }
      patch.passwordHash = bcrypt.hashSync(data.newPassword, 10);
    }
    if (data.login !== undefined && data.login !== emp.login) {
      const taken = data.login ? await this.prisma.employee.findUnique({ where: { login: data.login } }) : null;
      if (taken) throw new BadRequestException('Такой логин уже занят');
      patch.login = data.login || null;
    }
    const updated = await this.prisma.employee.update({ where: { id }, data: patch });
    return this.publicUser(updated);
  }

  // 2FA: генерируем секрет и QR (пока не включено).
  async setup2fa(id: number) {
    const emp = await this.prisma.employee.findUniqueOrThrow({ where: { id } });
    const secret = authenticator.generateSecret();
    await this.prisma.employee.update({ where: { id }, data: { twoFactorSecret: secret, twoFactorEnabled: false } });
    const otpauth = authenticator.keyuri(emp.login || emp.name, 'Eye Of Boss', secret);
    const qrDataUrl = await QRCode.toDataURL(otpauth);
    return { otpauth, qrDataUrl, secret };
  }

  async enable2fa(id: number, code: string) {
    const emp = await this.prisma.employee.findUniqueOrThrow({ where: { id } });
    if (!emp.twoFactorSecret || !authenticator.verify({ token: code, secret: emp.twoFactorSecret })) {
      throw new BadRequestException('Неверный код из приложения');
    }
    await this.prisma.employee.update({ where: { id }, data: { twoFactorEnabled: true } });
    return { enabled: true };
  }

  async disable2fa(id: number, code: string) {
    const emp = await this.prisma.employee.findUniqueOrThrow({ where: { id } });
    if (emp.twoFactorEnabled && (!emp.twoFactorSecret || !authenticator.verify({ token: code, secret: emp.twoFactorSecret }))) {
      throw new BadRequestException('Неверный код');
    }
    await this.prisma.employee.update({ where: { id }, data: { twoFactorEnabled: false, twoFactorSecret: null } });
    return { enabled: false };
  }

  private signFull(emp: any) {
    return this.jwt.sign(
      { sub: emp.id, isAdmin: emp.isAdmin, role: emp.role, name: emp.name },
      { secret: JWT_SECRET, expiresIn: '30d' },
    );
  }

  private publicUser(e: any) {
    const { passwordHash, twoFactorSecret, ...rest } = e;
    return { ...rest, twoFactorEnabled: e.twoFactorEnabled };
  }
}

@Controller('auth')
export class AuthController {
  constructor(private svc: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() body: { login: string; password: string }) {
    return this.svc.login(body.login, body.password);
  }

  @Public()
  @Post('2fa/verify')
  verify2fa(@Body() body: { ticket: string; code: string }) {
    return this.svc.verify2fa(body.ticket, body.code);
  }

  @Get('me')
  me(@Req() req: any) {
    return this.svc.me(req.user.sub);
  }

  @Patch('account')
  updateAccount(@Req() req: any, @Body() body: { login?: string; currentPassword?: string; newPassword?: string }) {
    return this.svc.updateAccount(req.user.sub, body);
  }

  @Post('2fa/setup')
  setup2fa(@Req() req: any) {
    return this.svc.setup2fa(req.user.sub);
  }

  @Post('2fa/enable')
  enable2fa(@Req() req: any, @Body() body: { code: string }) {
    return this.svc.enable2fa(req.user.sub, body.code);
  }

  @Post('2fa/disable')
  disable2fa(@Req() req: any, @Body() body: { code: string }) {
    return this.svc.disable2fa(req.user.sub, body.code);
  }
}

@Module({
  imports: [JwtModule.register({ secret: JWT_SECRET })],
  controllers: [AuthController],
  providers: [
    AuthService,
    PrismaService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AdminGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
