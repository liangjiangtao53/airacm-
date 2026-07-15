import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { isAbsolute, join } from 'path';
import request from 'supertest';
import { env } from '../src/config';
import { PublicContentModule } from '../src/modules/public-content';

describe('PublicContentController', () => {
  let app: INestApplication;
  let tempDir: string;
  const originalQrPath = env.customerServiceQrPath;

  beforeAll(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'airacm-qr-'));
    const moduleRef = await Test.createTestingModule({ imports: [PublicContentModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    env.customerServiceQrPath = originalQrPath;
    await app.close();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('normalizes the configured QR path for Express sendFile', () => {
    expect(isAbsolute(env.customerServiceQrPath)).toBe(true);
  });

  it('returns the backend-managed QR image without client caching', async () => {
    const image = Buffer.from('test-png');
    env.customerServiceQrPath = join(tempDir, 'customer-service-qr.png');
    await writeFile(env.customerServiceQrPath, image);

    const response = await request(app.getHttpServer()).get('/app/customer-service-qr').expect(200);

    expect(response.headers['content-type']).toMatch(/^image\/png/);
    expect(response.headers['cache-control']).toBe('no-store, max-age=0');
    expect(response.body).toEqual(image);
  });

  it('returns 404 when the QR image is not configured', async () => {
    env.customerServiceQrPath = join(tempDir, 'missing.png');
    await request(app.getHttpServer()).get('/app/customer-service-qr').expect(404);
  });
});
