import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { buildDataSourceOptions, env } from './config';
import { ApiResponseInterceptor } from './common';
import { AuthModule } from './modules/auth';
import { WalletModule } from './modules/wallet';
import { CourseModule } from './modules/course';
import { OrderModule } from './modules/order';
import { PaymentModule } from './modules/payment';
import { ProgressModule } from './modules/progress';

@Module({
  imports: [
    TypeOrmModule.forRoot(buildDataSourceOptions()),
    // 全局 JWT:各模块 JwtAuthGuard 可解析 JwtService。
    JwtModule.register({ global: true, secret: env.jwtSecret }),
    AuthModule,
    WalletModule,
    CourseModule,
    OrderModule,
    PaymentModule,
    ProgressModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor }],
})
export class AppModule {}
