import {
  Body,
  Controller,
  Injectable,
  Module,
  Post,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { IsInt, Min } from 'class-validator';
import * as crypto from 'crypto';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common';
import { env } from '../config';
import { WalletModule, WalletService } from './wallet';

class PrepayDto {
  @IsInt()
  @Min(1)
  amount!: number; // 充值金额(分)
}

// 微信支付 v2 异步回调报文(简化字段)。
interface WechatCallbackBody {
  out_trade_no: string;
  transaction_id: string;
  total_fee: number; // 分
  attach: string; // JSON: { userId, tenantId }
  sign: string;
}

@Injectable()
export class PaymentService {
  constructor(
    private readonly wallet: WalletService,
    private readonly dataSource: DataSource,
  ) {}

  // 微信 v2 签名:对参数按字典序拼接 + &key=APIKEY,MD5 后大写。
  private sign(params: Record<string, string | number>): string {
    const keys = Object.keys(params)
      .filter((k) => k !== 'sign' && params[k] !== '' && params[k] !== undefined)
      .sort();
    const base = keys.map((k) => `${k}=${params[k]}`).join('&') + `&key=${env.wechatPay.apiKey}`;
    return crypto.createHash('md5').update(base, 'utf8').digest('hex').toUpperCase();
  }

  // 下单预支付:返回客户端拉起支付所需参数(dev 桩)。商户资质未开通则拒绝。
  prepay(user: AuthUser, amount: number): Record<string, string> {
    if (!env.wechatPay.enabled) {
      throw new BadRequestException('在线支付未开通,请使用激活码充值');
    }
    const outTradeNo = `R${Date.now()}${user.userId.slice(0, 8)}`;
    const attach = JSON.stringify({ userId: user.userId, tenantId: user.tenantId });
    const prepay = {
      appId: 'dev-appid',
      mchId: env.wechatPay.mchId,
      outTradeNo,
      totalFee: String(amount),
      attach,
    };
    return { ...prepay, paySign: this.sign(prepay) };
  }

  // 回调:验签 → 幂等入账。微信会重发,同 transaction_id 只入账一次(CRITICAL)。
  async handleCallback(
    body: WechatCallbackBody,
  ): Promise<{ code: 'SUCCESS' | 'FAIL'; message: string }> {
    const expected = this.sign({
      out_trade_no: body.out_trade_no,
      transaction_id: body.transaction_id,
      total_fee: body.total_fee,
      attach: body.attach,
    });
    if (expected !== body.sign) {
      // 伪造签名拒绝(CRITICAL)。
      return { code: 'FAIL', message: '签名校验失败' };
    }

    let parsed: { userId: string; tenantId: string };
    try {
      parsed = JSON.parse(body.attach);
    } catch {
      return { code: 'FAIL', message: 'attach 非法' };
    }
    const user: AuthUser = { userId: parsed.userId, tenantId: parsed.tenantId };

    try {
      await this.dataSource.transaction(async (m) => {
        // refId = transaction_id,wallet_txn 唯一索引保证幂等:重复回调触发唯一冲突。
        await this.wallet.creditWithin(m, user, body.total_fee, body.transaction_id);
      });
    } catch (e) {
      if (e instanceof QueryFailedError) {
        // 唯一冲突 = 已入账过,幂等返回成功(微信据此停止重发)。
        return { code: 'SUCCESS', message: '已处理' };
      }
      throw e;
    }
    return { code: 'SUCCESS', message: '入账成功' };
  }
}

@Controller('payment')
export class PaymentController {
  constructor(private readonly svc: PaymentService) {}

  @UseGuards(JwtAuthGuard)
  @Post('recharge/prepay')
  prepay(@CurrentUser() user: AuthUser, @Body() dto: PrepayDto) {
    return this.svc.prepay(user, dto.amount);
  }

  // 微信服务器回调:无登录态,靠验签鉴别真伪。
  @Post('wechat/callback')
  callback(@Body() body: WechatCallbackBody) {
    return this.svc.handleCallback(body);
  }
}

@Module({
  imports: [WalletModule],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
