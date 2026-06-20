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
import { DataSource, Repository } from 'typeorm';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Course, Entitlement, Order } from '../entities';
import { AuthUser, CurrentUser, JwtAuthGuard } from '../common';
import { WalletModule, WalletService } from './wallet';

class CreateOrderDto {
  @IsString()
  courseId!: string;
}

class OrderQueryDto {
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
export class OrderService {
  constructor(
    @InjectRepository(Order) private readonly orders: Repository<Order>,
    @InjectRepository(Course) private readonly courses: Repository<Course>,
    @InjectRepository(Entitlement) private readonly entitlements: Repository<Entitlement>,
    private readonly wallet: WalletService,
    private readonly dataSource: DataSource,
  ) {}

  // 钱包扣费购课:单事务内 建单(pending)→ 原子扣减 → 发权益 → 置 paid。
  // 任一步失败回滚,不会出现扣了钱没发权益、或发了权益没扣钱(D2)。
  async createWalletOrder(user: AuthUser, courseId: string): Promise<Order> {
    const course = await this.courses.findOne({
      where: { tenantId: user.tenantId, id: courseId },
    });
    if (!course) throw new NotFoundException('课程不存在');

    const owned = await this.entitlements.findOne({
      where: { tenantId: user.tenantId, userId: user.userId, courseId },
    });
    if (owned) throw new BadRequestException('已购买该课程,无需重复购买');

    return this.dataSource.transaction(async (m) => {
      const order = await m.save(
        m.create(Order, {
          tenantId: user.tenantId,
          userId: user.userId,
          courseId,
          amount: course.price,
          status: 'pending',
          payChannel: 'wallet',
        }),
      );

      // 原子扣减;余额不足抛 BadRequest,事务回滚,订单不落库为 paid。
      await this.wallet.consumeWithin(m, user, course.price, order.id);

      await m.save(
        m.create(Entitlement, {
          tenantId: user.tenantId,
          userId: user.userId,
          courseId,
          orderId: order.id,
          expiresAt: null,
        }),
      );

      order.status = 'paid';
      order.paidAt = new Date();
      return m.save(order);
    });
  }

  async list(
    user: AuthUser,
    query: OrderQueryDto,
  ): Promise<{ items: Order[]; total: number; page: number; limit: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const [items, total] = await this.orders.findAndCount({
      where: { tenantId: user.tenantId, userId: user.userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total, page, limit };
  }
}

@UseGuards(JwtAuthGuard)
@Controller('orders')
export class OrderController {
  constructor(private readonly svc: OrderService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateOrderDto) {
    return this.svc.createWalletOrder(user, dto.courseId);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: OrderQueryDto) {
    return this.svc.list(user, query);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Order, Course, Entitlement]), WalletModule],
  controllers: [OrderController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
