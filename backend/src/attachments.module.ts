import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { extname, resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
import type { Response } from 'express';
import { PrismaService } from './prisma.service';
import { Public } from './auth.module';

const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const publicAtt = (a: any) => ({
  id: a.id,
  taskId: a.taskId,
  filename: a.filename,
  mimeType: a.mimeType,
  size: a.size,
  url: `/api/files/${a.token}`,
  isImage: a.mimeType?.startsWith('image/'),
  uploader: a.uploader,
  createdAt: a.createdAt,
});

@Injectable()
export class AttachmentsService {
  constructor(private prisma: PrismaService) {}

  // Доступ: админ или исполнитель задачи.
  async assertTaskAccess(taskId: number, user: any) {
    if (user?.isAdmin) return;
    const t = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!t || t.assigneeId !== user?.sub) throw new ForbiddenException('Только исполнитель задачи или администратор');
  }

  async list(taskId: number) {
    const items = await this.prisma.attachment.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
      include: { uploader: true },
    });
    return items.map(publicAtt);
  }

  async remove(id: number, user: any) {
    const a = await this.prisma.attachment.findUnique({ where: { id } });
    if (!a) return { ok: true };
    if (!user?.isAdmin && a.uploadedById !== user?.sub) {
      await this.assertTaskAccess(a.taskId, user);
    }
    await this.prisma.attachment.delete({ where: { id } });
    return { ok: true };
  }
}

@Controller()
export class AttachmentsController {
  constructor(private svc: AttachmentsService, private prisma: PrismaService) {}

  @Post('tasks/:id/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => cb(null, `${randomUUID()}${extname(file.originalname)}`),
      }),
      limits: { fileSize: 25 * 1024 * 1024 }, // 25 МБ
    }),
  )
  async upload(@Param('id', ParseIntPipe) id: number, @UploadedFile() file: any, @Req() req: any) {
    await this.svc.assertTaskAccess(id, req.user);
    const a = await this.prisma.attachment.create({
      data: {
        taskId: id,
        filename: file.originalname,
        storedPath: file.path,
        mimeType: file.mimetype,
        size: file.size,
        token: file.filename,
        uploadedById: req.user?.sub ?? null,
      },
      include: { uploader: true },
    });
    return publicAtt(a);
  }

  @Get('tasks/:id/attachments')
  list(@Param('id', ParseIntPipe) id: number) {
    return this.svc.list(id);
  }

  @Delete('attachments/:id')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    return this.svc.remove(id, req.user);
  }

  // Раздача файла по токену (без авторизации — ссылка неугадываемая).
  @Public()
  @Get('files/:token')
  async serve(@Param('token') token: string, @Res() res: Response) {
    const a = await this.prisma.attachment.findUnique({ where: { token } });
    if (!a) return res.status(404).send('not found');
    res.setHeader('Content-Type', a.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(a.filename)}"`);
    return res.sendFile(resolve(a.storedPath));
  }
}

@Module({ controllers: [AttachmentsController], providers: [AttachmentsService, PrismaService], exports: [AttachmentsService] })
export class AttachmentsModule {}
