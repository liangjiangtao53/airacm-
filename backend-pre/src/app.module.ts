import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { buildDataSourceOptions, env } from './config';
import { AllExceptionsFilter, ApiResponseInterceptor } from './common';
import { SessionModule } from './session';
import { AuthModule } from './modules/auth';
import { WalletModule } from './modules/wallet';
import { CourseModule } from './modules/course';
import { OrderModule } from './modules/order';
import { PaymentModule } from './modules/payment';
import { ProgressModule } from './modules/progress';
import { AdminModule } from './modules/admin';
import { QuestionModule } from './modules/question';
import { ExamModule } from './modules/exam';
import { AccessKeyModule } from './modules/access-key';
import { ForumModule } from './modules/forum';
import { AppReleaseModule } from './modules/app-release';

// 健康检查:容器/网关探活用,无需鉴权。
@Controller()
class HealthController {
  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }
}

@Module({
  imports: [
    TypeOrmModule.forRoot(buildDataSourceOptions()),
    // 全局 JWT:各模块 JwtAuthGuard 可解析 JwtService。
    JwtModule.register({ global: true, secret: env.jwtSecret }),
    // 全局限流:默认 60s 内 120 次(防爆破/刷接口)。敏感端点用 @Throttle 收紧。
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    // 全局单点登录:JwtAuthGuard 注入 SessionService(各模块无需自备 User 仓库)。
    SessionModule,
    AuthModule,
    WalletModule,
    CourseModule,
    OrderModule,
    PaymentModule,
    ProgressModule,
    AdminModule,
    QuestionModule,
    ExamModule,
    AccessKeyModule,
    ForumModule,
    AppReleaseModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
