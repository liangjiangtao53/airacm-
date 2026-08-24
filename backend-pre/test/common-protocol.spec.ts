import { ConflictException, Controller, Get, INestApplication, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter, ApiResponseInterceptor } from '../src/common';

@Controller('protocol-test')
class ProtocolTestController {
  @Get('ok')
  ok() {
    return { ok: true };
  }

  @Get('question-updated')
  questionUpdated(): never {
    throw new ConflictException('题库已更新，请重新加载当前章节');
  }

  @Get('busy')
  busy(): never {
    throw new ServiceUnavailableException('服务繁忙');
  }
}

describe('public API response protocol', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ProtocolTestController] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new ApiResponseInterceptor());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => app.close());

  it('echoes a valid request id in the success envelope and response header', async () => {
    const response = await request(app.getHttpServer())
      .get('/protocol-test/ok')
      .set('X-Request-Id', 'm1-release-test-1')
      .expect(200);

    expect(response.headers['x-request-id']).toBe('m1-release-test-1');
    expect(response.body).toEqual({
      success: true,
      data: { ok: true },
      error: null,
      code: null,
      requestId: 'm1-release-test-1',
    });
  });

  it('maps question generation conflicts to a stable public error code', async () => {
    const response = await request(app.getHttpServer()).get('/protocol-test/question-updated').expect(409);

    expect(response.body).toMatchObject({
      success: false,
      data: null,
      code: 'QUESTION_SET_UPDATED',
    });
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
    expect(response.body.requestId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('adds a retry hint and stable code for temporary service failures', async () => {
    const response = await request(app.getHttpServer()).get('/protocol-test/busy').expect(503);

    expect(response.headers['retry-after']).toBe('2');
    expect(response.body.code).toBe('SERVICE_BUSY');
  });
});
