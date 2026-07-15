import { Controller, Get, Module, Res } from '@nestjs/common';
import type { Response } from 'express';
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
    const contentType = IMAGE_CONTENT_TYPES[extname(env.customerServiceQrPath).toLowerCase()];
    if (!contentType) {
      res.status(404).send('Not found');
      return;
    }

    res.set({
      'Cache-Control': 'no-store, max-age=0',
      'Content-Type': contentType,
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    res.sendFile(env.customerServiceQrPath, (err) => {
      if (err && !res.headersSent) res.status(404).send('Not found');
    });
  }
}

@Module({ controllers: [PublicContentController] })
export class PublicContentModule {}
