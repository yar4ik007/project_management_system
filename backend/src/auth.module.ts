import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  OnModuleInit,
  Post,
  Req,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
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
    const payload = { sub: emp.id, isAdmin: emp.isAdmin, role: emp.role, name: emp.name };
    const token = this.jwt.sign(payload, { secret: JWT_SECRET, expiresIn: '30d' });
    return { token, user: this.publicUser(emp) };
  }

  async me(id: number) {
    const emp = await this.prisma.employee.findUnique({ where: { id } });
    return emp ? this.publicUser(emp) : null;
  }

  private publicUser(e: any) {
    const { passwordHash, ...rest } = e;
    return rest;
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

  @Get('me')
  me(@Req() req: any) {
    return this.svc.me(req.user.sub);
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
