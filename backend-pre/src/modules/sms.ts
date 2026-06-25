import { Injectable, Module, Logger, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as https from 'https';
import { env } from '../config';

// 验证码内存存储:单实例足够(当前部署形态)。多实例水平扩展时改 Redis,
// 接口已收敛到 SmsCodeStore,替换实现即可,业务无感。
interface CodeEntry {
  code: string;
  expiresAt: number; // epoch ms
  lastSentAt: number;
}

@Injectable()
export class SmsCodeStore {
  private readonly map = new Map<string, CodeEntry>();

  // 距上次发送是否已过重发间隔(防短信轰炸)。
  canResend(phone: string): boolean {
    const e = this.map.get(phone);
    if (!e) return true;
    return Date.now() - e.lastSentAt >= env.sms.resendIntervalSec * 1000;
  }

  save(phone: string, code: string): void {
    const now = Date.now();
    this.map.set(phone, {
      code,
      expiresAt: now + env.sms.codeTtlSec * 1000,
      lastSentAt: now,
    });
  }

  // 校验并消费:命中即删,验证码一次性。
  verifyAndConsume(phone: string, code: string): boolean {
    const e = this.map.get(phone);
    if (!e) return false;
    if (Date.now() > e.expiresAt) {
      this.map.delete(phone);
      return false;
    }
    if (e.code !== code) return false;
    this.map.delete(phone);
    return true;
  }
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger('Sms');

  constructor(private readonly store: SmsCodeStore) {}

  // 发送验证码:生成 6 位码 → 存储 → 投递。返回前做重发频控。
  async sendCode(phone: string): Promise<void> {
    if (!this.store.canResend(phone)) {
      throw new BadRequestException(`请 ${env.sms.resendIntervalSec} 秒后再试`);
    }
    const code = env.sms.devMode ? env.sms.devCode : this.gen6();
    this.store.save(phone, code);
    await this.deliver(phone, code);
  }

  verify(phone: string, code: string): boolean {
    return this.store.verifyAndConsume(phone, code);
  }

  private gen6(): string {
    // 100000–999999,均匀随机,不含前导 0。
    return String(crypto.randomInt(100000, 1000000));
  }

  private async deliver(phone: string, code: string): Promise<void> {
    if (env.sms.devMode) {
      // 开发态不真发,打日志便于联调。生产务必 SMS_DEV_MODE=false。
      this.logger.log(`[dev] 验证码 ${code} -> ${phone}`);
      return;
    }
    try {
      await this.sendViaAliyun(phone, code);
    } catch (e) {
      this.logger.error(
        `阿里云短信发送失败 phone=${phone}`,
        e instanceof Error ? e.stack : String(e),
      );
      throw new BadRequestException('验证码发送失败,请稍后重试');
    }
  }

  // 阿里云短信 Dysmsapi(2017-05-25)RPC 风格调用,用内置 crypto 做 HMAC-SHA1 签名,
  // 零额外依赖。配好 ALI_SMS_* 密钥 + SMS_DEV_MODE=false 即生效。
  private sendViaAliyun(phone: string, code: string): Promise<void> {
    const params: Record<string, string> = {
      AccessKeyId: env.sms.accessKeyId,
      Action: 'SendSms',
      Format: 'JSON',
      PhoneNumbers: phone,
      RegionId: 'cn-hangzhou',
      SignName: env.sms.signName,
      SignatureMethod: 'HMAC-SHA1',
      SignatureNonce: crypto.randomUUID(),
      SignatureVersion: '1.0',
      TemplateCode: env.sms.templateCode,
      TemplateParam: JSON.stringify({ code }),
      Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
      Version: '2017-05-25',
    };

    const sortedQs = Object.keys(params)
      .sort()
      .map((k) => `${this.pctEncode(k)}=${this.pctEncode(params[k])}`)
      .join('&');
    const stringToSign = `GET&${this.pctEncode('/')}&${this.pctEncode(sortedQs)}`;
    const signature = crypto
      .createHmac('sha1', `${env.sms.accessKeySecret}&`)
      .update(stringToSign)
      .digest('base64');

    const url = `https://${env.sms.endpoint}/?Signature=${this.pctEncode(signature)}&${sortedQs}`;

    return new Promise<void>((resolve, reject) => {
      const req = https.get(url, (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          try {
            const body = JSON.parse(raw) as { Code?: string; Message?: string };
            if (body.Code === 'OK') resolve();
            else reject(new Error(`${body.Code}: ${body.Message}`));
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => req.destroy(new Error('短信网关超时')));
    });
  }

  // 阿里云专用 percent-encode:在 encodeURIComponent 基础上修正 + * ~ 三处。
  private pctEncode(s: string): string {
    return encodeURIComponent(s)
      .replace(/\+/g, '%20')
      .replace(/\*/g, '%2A')
      .replace(/%7E/g, '~');
  }
}

@Module({
  providers: [SmsCodeStore, SmsService],
  exports: [SmsService],
})
export class SmsModule {}
