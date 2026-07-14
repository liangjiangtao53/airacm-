import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { env } from '../src/config';
import { WechatMiniProgramService } from '../src/modules/wechat-mini-program';

describe('WechatMiniProgramService', () => {
  const original = { ...env.wechatMini };
  const originalFetch = global.fetch;

  beforeEach(() => {
    Object.assign(env.wechatMini, {
      enabled: true,
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
      contentSecurityEnabled: true,
      timeoutMs: 1000,
    });
  });

  afterEach(() => {
    Object.assign(env.wechatMini, original);
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('exchanges a code without exposing provider credentials', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ openid: 'openid-result' }),
    })) as unknown as typeof fetch;
    await expect(new WechatMiniProgramService().exchangeCode('one-use-code')).resolves.toEqual({
      openid: 'openid-result',
    });
  });

  it('rejects login when the feature is disabled', async () => {
    env.wechatMini.enabled = false;
    await expect(new WechatMiniProgramService().exchangeCode('unused-code')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('normalizes invalid codes and provider outages', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ errcode: 40029, errmsg: 'invalid code' }),
    })) as unknown as typeof fetch;
    await expect(new WechatMiniProgramService().exchangeCode('invalid-code')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    global.fetch = jest.fn(async () => {
      throw new Error('network unavailable');
    }) as unknown as typeof fetch;
    await expect(new WechatMiniProgramService().exchangeCode('fresh-code')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('caches access tokens and rejects risky content', async () => {
    const responses = [
      { access_token: 'cached-token', expires_in: 7200 },
      { errcode: 0, trace_id: 'trace-pass', result: { suggest: 'pass' } },
      { errcode: 0, trace_id: 'trace-risky', result: { suggest: 'risky', label: 100 } },
    ];
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => responses.shift(),
    })) as unknown as typeof fetch;
    const service = new WechatMiniProgramService();
    await expect(service.checkContent('normal content', 3, 'openid', {
      userId: 'user-1',
      contentType: 'forum_post',
      clientPlatform: 'mp-weixin',
    })).resolves.toEqual({
      traceId: 'trace-pass',
    });
    await expect(service.checkContent('risky content', 2, 'openid', {
      userId: 'user-1',
      contentType: 'forum_reply',
      clientPlatform: 'mp-weixin',
    })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('shares one access-token refresh across concurrent content checks', async () => {
    let tokenRequests = 0;
    global.fetch = jest.fn(async (input: string | URL | Request) => {
      if (String(input).includes('/cgi-bin/token')) {
        tokenRequests++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return {
          ok: true,
          json: async () => ({ access_token: 'shared-token', expires_in: 7200 }),
        };
      }
      return {
        ok: true,
        json: async () => ({ errcode: 0, trace_id: 'trace-pass', result: { suggest: 'pass' } }),
      };
    }) as unknown as typeof fetch;
    const service = new WechatMiniProgramService();
    await Promise.all([
      service.checkContent('first', 2, 'openid', {
        userId: 'user-1',
        contentType: 'question_comment',
        clientPlatform: 'mp-weixin',
      }),
      service.checkContent('second', 3, 'openid', {
        userId: 'user-1',
        contentType: 'forum_post',
        clientPlatform: 'mp-weixin',
      }),
    ]);
    expect(tokenRequests).toBe(1);
  });

  it('refreshes an access token once when WeChat reports it expired', async () => {
    const responses = [
      { access_token: 'expired-token', expires_in: 7200 },
      { errcode: 42001, errmsg: 'access token expired' },
      { access_token: 'fresh-token', expires_in: 7200 },
      { errcode: 0, trace_id: 'trace-after-refresh', result: { suggest: 'pass' } },
    ];
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => responses.shift(),
    })) as unknown as typeof fetch;

    await expect(new WechatMiniProgramService().checkContent('content', 2, 'openid', {
      userId: 'user-1',
      contentType: 'question_comment',
    })).resolves.toEqual({ traceId: 'trace-after-refresh' });
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it('audits by bound identity instead of trusting the client platform header', async () => {
    const service = new WechatMiniProgramService();
    global.fetch = jest.fn() as unknown as typeof fetch;

    await expect(service.checkContent('h5 content', 2, null, {
      userId: 'user-1',
      contentType: 'question_comment',
      clientPlatform: 'h5',
    })).resolves.toEqual({ traceId: null });
    await expect(service.checkContent('mini content', 2, null, {
      userId: 'user-1',
      contentType: 'question_comment',
      clientPlatform: 'mp-weixin',
    })).resolves.toEqual({ traceId: null });
    expect(global.fetch).not.toHaveBeenCalled();

    const responses = [
      { access_token: 'token', expires_in: 7200 },
      { errcode: 0, trace_id: 'trace-h5', result: { suggest: 'pass' } },
    ];
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => responses.shift(),
    })) as unknown as typeof fetch;
    await expect(service.checkContent('bound h5 content', 2, 'openid', {
      userId: 'user-1',
      contentType: 'question_comment',
      clientPlatform: 'h5',
    })).resolves.toEqual({ traceId: 'trace-h5' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});
