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
import { WechatMiniProgramModule } from './modules/wechat-mini-program';
import { PublicContentModule } from './modules/public-content';

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
    JwtModule.register({ global: true, secret: env.jwtSecret }),
    // Original limit was hard-coded as 60s/120. Deployment tests need this configurable.
    ThrottlerModule.forRoot([{ ttl: env.throttleTtlMs, limit: env.throttleLimit }]),
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
    WechatMiniProgramModule,
    PublicContentModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
