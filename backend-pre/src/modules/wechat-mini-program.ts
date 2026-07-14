import {
  BadRequestException,
  Injectable,
  Logger,
  Module,
  ServiceUnavailableException,
} from '@nestjs/common';
import { env } from '../config';

interface WechatErrorResponse {
  errcode?: number;
  errmsg?: string;
}

interface CodeSessionResponse extends WechatErrorResponse {
  openid?: string;
  session_key?: string;
}

interface AccessTokenResponse extends WechatErrorResponse {
  access_token?: string;
  expires_in?: number;
}

interface ContentCheckResponse extends WechatErrorResponse {
  trace_id?: string;
  result?: {
    suggest?: 'pass' | 'review' | 'risky';
    label?: number;
  };
}

export type WechatContentScene = 1 | 2 | 3 | 4;

@Injectable()
export class WechatMiniProgramService {
  private readonly logger = new Logger(WechatMiniProgramService.name);
  private accessToken: { value: string; expiresAt: number } | null = null;
  private accessTokenPromise: Promise<string> | null = null;

  isEnabled(): boolean {
    return env.wechatMini.enabled;
  }

  isContentSecurityEnabled(): boolean {
    return env.wechatMini.enabled && env.wechatMini.contentSecurityEnabled;
  }

  async exchangeCode(code: string): Promise<{ openid: string }> {
    if (!env.wechatMini.enabled) {
      throw new ServiceUnavailableException('微信登录暂未启用');
    }
    const startedAt = Date.now();
    const params = new URLSearchParams({
      appid: env.wechatMini.appId,
      secret: env.wechatMini.appSecret,
      js_code: code,
      grant_type: 'authorization_code',
    });
    try {
      const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${params}`, {
        signal: AbortSignal.timeout(env.wechatMini.timeoutMs),
      });
      const body = (await response.json()) as CodeSessionResponse;
      if (!response.ok || body.errcode || !body.openid) {
        this.logger.warn(
          `code2Session failed errcode=${body.errcode ?? response.status} latencyMs=${Date.now() - startedAt}`,
        );
        throw new UnauthorizedWechatCodeError();
      }
      this.logger.log(`code2Session success latencyMs=${Date.now() - startedAt}`);
      return { openid: body.openid };
    } catch (error) {
      if (error instanceof UnauthorizedWechatCodeError) throw error;
      this.logger.error(`code2Session unavailable latencyMs=${Date.now() - startedAt}`);
      throw new ServiceUnavailableException('微信登录服务暂时不可用，请重试');
    }
  }

  async checkContent(
    content: string,
    scene: WechatContentScene,
    openid?: string | null,
    context?: { userId: string; contentType: string; clientPlatform?: string },
  ): Promise<{ traceId: string | null }> {
    if (!this.isContentSecurityEnabled()) return { traceId: null };
    // Only WeChat-bound identities can be audited by msg_sec_check; other clients keep their existing flow.
    if (!openid) return { traceId: null };
    const body: Record<string, unknown> = { content, version: 2, scene, openid };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const accessToken = await this.getAccessToken();
        const response = await fetch(
          `https://api.weixin.qq.com/wxa/msg_sec_check?access_token=${encodeURIComponent(accessToken)}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(env.wechatMini.timeoutMs),
          },
        );
        const result = (await response.json()) as ContentCheckResponse;
        if ((result.errcode === 40014 || result.errcode === 42001) && attempt === 0) {
          this.accessToken = null;
          continue;
        }
        if (!response.ok || result.errcode) {
          this.logger.warn(
            `content check failed userId=${context?.userId ?? 'unknown'} contentType=${context?.contentType ?? 'unknown'} errcode=${result.errcode ?? response.status}`,
          );
          throw new ServiceUnavailableException('内容审核服务暂时不可用，请稍后重试');
        }
        if (result.result?.suggest !== 'pass') {
          this.logger.warn(
            `content rejected userId=${context?.userId ?? 'unknown'} contentType=${context?.contentType ?? 'unknown'} traceId=${result.trace_id ?? 'none'} label=${result.result?.label ?? 'unknown'}`,
          );
          throw new BadRequestException('内容暂无法发布，请修改后重试');
        }
        return { traceId: result.trace_id ?? null };
      } catch (error) {
        if (error instanceof BadRequestException || error instanceof ServiceUnavailableException) {
          throw error;
        }
        this.logger.error('content check unavailable');
        throw new ServiceUnavailableException('内容审核服务暂时不可用，请稍后重试');
      }
    }
    throw new ServiceUnavailableException('内容审核服务暂时不可用，请稍后重试');
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.accessToken && this.accessToken.expiresAt > now + 60_000) {
      return this.accessToken.value;
    }
    if (!this.accessTokenPromise) {
      this.accessTokenPromise = this.refreshAccessToken().finally(() => {
        this.accessTokenPromise = null;
      });
    }
    return this.accessTokenPromise;
  }

  private async refreshAccessToken(): Promise<string> {
    const params = new URLSearchParams({
      grant_type: 'client_credential',
      appid: env.wechatMini.appId,
      secret: env.wechatMini.appSecret,
    });
    try {
      const response = await fetch(`https://api.weixin.qq.com/cgi-bin/token?${params}`, {
        signal: AbortSignal.timeout(env.wechatMini.timeoutMs),
      });
      const body = (await response.json()) as AccessTokenResponse;
      if (!response.ok || body.errcode || !body.access_token) {
        this.logger.warn(`access token refresh failed errcode=${body.errcode ?? response.status}`);
        throw new Error('provider rejected token request');
      }
      this.accessToken = {
        value: body.access_token,
        expiresAt: Date.now() + Math.max(60, body.expires_in ?? 7200) * 1000,
      };
      return body.access_token;
    } catch {
      this.logger.error('access token refresh unavailable');
      throw new ServiceUnavailableException('内容审核服务暂时不可用，请稍后重试');
    }
  }
}

class UnauthorizedWechatCodeError extends BadRequestException {
  constructor() {
    super('微信登录凭证无效，请重新登录');
  }
}

@Module({
  providers: [WechatMiniProgramService],
  exports: [WechatMiniProgramService],
})
export class WechatMiniProgramModule {}
