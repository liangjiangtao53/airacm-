import { Controller, Get, Module, Res } from '@nestjs/common';
import type { Response } from 'express';
import { existsSync } from 'fs';
import { extname } from 'path';
import { env } from '../config';

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

@Controller('app')
export class PublicContentController {
  @Get('customer-service-qr')
  customerServiceQr(@Res() res: Response): void {
    // 真实二维码不存在时返回后端内置模拟图；上传同名文件后下一次请求自动切换。
    const qrPath = existsSync(env.customerServiceQrPath)
      ? env.customerServiceQrPath
      : env.customerServiceQrFallbackPath;
    const contentType = IMAGE_CONTENT_TYPES[extname(qrPath).toLowerCase()];
    if (!contentType) {
      res.status(404).send('Not found');
      return;
    }

    res.set({
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': contentType,
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.sendFile(qrPath, (err) => {
      if (err && !res.headersSent) res.status(404).send('Not found');
    });
  }
}

@Module({ controllers: [PublicContentController] })
export class PublicContentModule {}
