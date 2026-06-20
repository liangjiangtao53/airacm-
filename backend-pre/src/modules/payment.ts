import {
  Body,
  Controller,
  Injectable,
  Module,
  Post,
  UseGuards,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { IsInt, Max, Min } from 'class-validator';
import * as crypto from 'crypto';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common';
import { env } from '../config';
import { RechargeOrder } from '../entities';
import { WalletModule, WalletService } from './wallet';

class PrepayDto {
  @IsInt()
  @Min(100) // 最低充值 1 元
  @Max(10_000_000) // 单笔上限 10 万元,防异常大额
  amount!: number; // 充值金额(分)
}

// 微信支付 v2 异步回调报文(简化字段)。用户/金额以服务端预单为准,不信任回调内的身份。
interface WechatCallbackBody {
  out_trade_no: string;
  transaction_id: string;
  total_fee: number; // 分
  sign: string;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger('Payment');

  constructor(
    @InjectRepository(RechargeOrder) private readonly rechargeOrders: Repository<RechargeOrder>,
    private readonly wallet: WalletService,
    private readonly dataSource: DataSource,
  ) {}

  // 微信 v2 签名:对参数按字典序拼接 + &key=APIKEY,MD5 后大写。
  // 用时间安全比较防时序侧信道(verifySign)。
  private sign(params: Record<string, string | number>): string {
    const keys = Object.keys(params)
      .filter((k) => k !== 'sign' && params[k] !== '' && params[k] !== undefined)
      .sort();
    const base = keys.map((k) => `${k}=${params[k]}`).join('&') + `&key=${env.wechatPay.apiKey}`;
    return crypto.createHash('md5').update(base, 'utf8').digest('hex').toUpperCase();
  }

  private verifySign(expected: string, actual: string): boolean {
    const a = Buffer.from(expected);
    const b = Buffer.from(actual);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  // 下单预支付:落 pending 充值预单(对账锚点)+ 返回客户端拉起支付参数(dev 桩)。
  // 商户资质未开通则拒绝(env 开关,默认关)。
  async prepay(user: AuthUser, amount: number): Promise<Record<string, string>> {
    if (!env.wechatPay.enabled) {
      throw new BadRequestException('在线支付未开通,请使用激活码充值');
    }
    const outTradeNo = `R${user.tenantId}-${user.userId.slice(0, 8)}-${this.randomSuffix()}`;
    await this.rechargeOrders.save(
      this.rechargeOrders.create({
        tenantId: user.tenantId,
        userId: user.userId,
        outTradeNo,
        amount,
        status: 'pending',
      }),
    );
    const prepay = {
      appId: 'dev-appid',
      mchId: env.wechatPay.mchId,
      outTradeNo,
      totalFee: String(amount),
    };
    return { ...prepay, paySign: this.sign(prepay) };
  }

  private randomSuffix(): string {
    return crypto.randomBytes(8).toString('hex');
  }

  // 回调:验签 → 按 out_trade_no 核对预单与金额 → 幂等入账。
  // 安全要点:① 验签拒伪造 ② 金额必须等于预单金额(不信任回调金额)
  // ③ transaction_id 唯一索引 + 预单状态机双重幂等(微信会重发)。
  async handleCallback(
    body: WechatCallbackBody,
  ): Promise<{ code: 'SUCCESS' | 'FAIL'; message: string }> {
    const expected = this.sign({
      out_trade_no: body.out_trade_no,
      transaction_id: body.transaction_id,
      total_fee: body.total_fee,
    });
    if (!this.verifySign(expected, body.sign ?? '')) {
      this.logger.warn(`回调验签失败 out_trade_no=${body.out_trade_no}`);
      return { code: 'FAIL', message: '签名校验失败' };
    }

    const order = await this.rechargeOrders.findOne({
      where: { outTradeNo: body.out_trade_no },
    });
    if (!order) {
      this.logger.warn(`回调无对应预单 out_trade_no=${body.out_trade_no}`);
      return { code: 'FAIL', message: '订单不存在' };
    }
    // 金额对账:回调金额必须严格等于预单金额,防篡改/错单。
    if (order.amount !== body.total_fee) {
      this.logger.error(
        `回调金额不符 out_trade_no=${body.out_trade_no} 预单=${order.amount} 回调=${body.total_fee}`,
      );
      return { code: 'FAIL', message: '金额不符' };
    }
    if (order.status === 'paid') {
      return { code: 'SUCCESS', message: '已处理' }; // 幂等:预单已支付
    }

    const user: AuthUser = { userId: order.userId, tenantId: order.tenantId, role: 'user' };
    try {
      await this.dataSource.transaction(async (m) => {
        // 原子置 paid:status pending→paid,影响行数=1 才入账(并发回调只过一个)。
        const claimed = await m
          .createQueryBuilder()
          .update(RechargeOrder)
          .set({ status: 'paid', transactionId: body.transaction_id, paidAt: () => 'CURRENT_TIMESTAMP' })
          .where('id = :id AND status = :s', { id: order.id, s: 'pending' })
          .execute();
        if (claimed.affected !== 1) {
          throw new BadRequestException('IDEMPOTENT'); // 已被另一回调处理
        }
        // refId = transaction_id,wallet_txn 唯一索引再兜一层幂等。
        await this.wallet.creditWithin(m, user, order.amount, body.transaction_id);
      });
    } catch (e) {
      if (e instanceof BadRequestException && e.message === 'IDEMPOTENT') {
        return { code: 'SUCCESS', message: '已处理' };
      }
      if (e instanceof QueryFailedError) {
        return { code: 'SUCCESS', message: '已处理' }; // 唯一冲突 = 已入账
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
  imports: [TypeOrmModule.forFeature([RechargeOrder]), WalletModule],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentModule {}
