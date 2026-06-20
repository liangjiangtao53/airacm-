import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
  Query,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { RechargeCode, Wallet, WalletTxn } from '../entities';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common';

class RechargeByCodeDto {
  @IsString()
  code!: string;
}

class TxnQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(WalletTxn) private readonly txns: Repository<WalletTxn>,
    private readonly dataSource: DataSource,
  ) {}

  async getBalance(user: AuthUser): Promise<{ balance: number }> {
    const wallet = await this.wallets.findOne({
      where: { tenantId: user.tenantId, userId: user.userId },
    });
    if (!wallet) throw new NotFoundException('钱包不存在');
    return { balance: wallet.balance };
  }

  async listTxns(
    user: AuthUser,
    query: TxnQueryDto,
  ): Promise<{ items: WalletTxn[]; total: number; page: number; limit: number }> {
    const wallet = await this.wallets.findOne({
      where: { tenantId: user.tenantId, userId: user.userId },
    });
    if (!wallet) throw new NotFoundException('钱包不存在');
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [items, total] = await this.txns.findAndCount({
      where: { tenantId: user.tenantId, walletId: wallet.id },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total, page, limit };
  }

  // 激活码充值:原子认领 code(status unused→used,影响行数=1 才生效),再入账,一个事务。
  // 并发/重复使用只生效一次(CRITICAL 路径)。
  async rechargeByCode(user: AuthUser, code: string): Promise<{ balance: number; amount: number }> {
    return this.dataSource.transaction(async (m) => {
      const claimed = await m
        .createQueryBuilder()
        .update(RechargeCode)
        .set({ status: 'used', usedBy: user.userId, usedAt: () => 'CURRENT_TIMESTAMP' })
        .where('tenantId = :t AND code = :c AND status = :s', {
          t: user.tenantId,
          c: code,
          s: 'unused',
        })
        .execute();
      if (claimed.affected !== 1) {
        throw new BadRequestException('激活码无效或已被使用');
      }
      const codeRow = await m.findOne(RechargeCode, {
        where: { tenantId: user.tenantId, code },
      });
      const amount = codeRow!.amount;
      const balance = await this.creditWithin(m, user, amount, codeRow!.id);
      return { balance, amount };
    });
  }

  // 入账(增加余额 + 流水)。供激活码 / 微信支付到账复用。在调用方事务内执行。
  async creditWithin(
    m: EntityManager,
    user: AuthUser,
    amount: number,
    refId: string | null,
  ): Promise<number> {
    if (amount <= 0) throw new BadRequestException('金额必须大于 0');
    const updated = await m
      .createQueryBuilder()
      .update(Wallet)
      .set({ balance: () => `balance + ${amount}` })
      .where('tenantId = :t AND userId = :u', { t: user.tenantId, u: user.userId })
      .execute();
    if (updated.affected !== 1) throw new NotFoundException('钱包不存在');
    const wallet = await m.findOne(Wallet, {
      where: { tenantId: user.tenantId, userId: user.userId },
    });
    await m.save(
      m.create(WalletTxn, {
        tenantId: user.tenantId,
        walletId: wallet!.id,
        type: 'recharge',
        amount,
        refId,
      }),
    );
    return wallet!.balance;
  }

  // 原子扣减(D2):UPDATE ... WHERE balance >= amount,影响行数=1 才算成功。
  // 并发双花防护核心:数据库行锁保证只扣一次、余额不为负。在调用方事务内执行。
  async consumeWithin(
    m: EntityManager,
    user: AuthUser,
    amount: number,
    refId: string | null,
  ): Promise<number> {
    if (amount <= 0) throw new BadRequestException('金额必须大于 0');
    const result = await m
      .createQueryBuilder()
      .update(Wallet)
      .set({ balance: () => `balance - ${amount}` })
      .where('tenantId = :t AND userId = :u AND balance >= :a', {
        t: user.tenantId,
        u: user.userId,
        a: amount,
      })
      .execute();
    if (result.affected !== 1) {
      throw new BadRequestException('余额不足');
    }
    const wallet = await m.findOne(Wallet, {
      where: { tenantId: user.tenantId, userId: user.userId },
    });
    await m.save(
      m.create(WalletTxn, {
        tenantId: user.tenantId,
        walletId: wallet!.id,
        type: 'consume',
        amount,
        refId,
      }),
    );
    return wallet!.balance;
  }
}

@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly svc: WalletService) {}

  @Get()
  balance(@CurrentUser() user: AuthUser) {
    return this.svc.getBalance(user);
  }

  @Get('txns')
  txns(@CurrentUser() user: AuthUser, @Query() query: TxnQueryDto) {
    return this.svc.listTxns(user, query);
  }

  @Post('recharge')
  recharge(@CurrentUser() user: AuthUser, @Body() dto: RechargeByCodeDto) {
    return this.svc.rechargeByCode(user, dto.code);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Wallet, WalletTxn, RechargeCode])],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
