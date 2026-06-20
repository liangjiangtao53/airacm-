import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  CanActivate,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { env } from './config';

// 登录态:JWT payload 解出的当前用户。tenantId 随 token 走,后端查询统一带上(D4)。
export interface AuthUser {
  userId: string;
  tenantId: string;
}

export interface JwtPayload {
  sub: string;
  tenantId: string;
}

// 统一响应信封 { success, data, error }(见 patterns)。
export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data): ApiResponse<unknown> => ({ success: true, data: data ?? null, error: null })),
    );
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少登录凭证');
    }
    const token = header.slice('Bearer '.length).trim();
    try {
      const payload = this.jwt.verify<JwtPayload>(token, { secret: env.jwtSecret });
      req.user = { userId: payload.sub, tenantId: payload.tenantId } satisfies AuthUser;
      return true;
    } catch {
      throw new UnauthorizedException('登录已失效,请重新登录');
    }
  }
}

// 控制器用 @CurrentUser() 注入 AuthUser。
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as AuthUser;
  },
);

export function signToken(jwt: JwtService, user: AuthUser): string {
  return jwt.sign({ sub: user.userId, tenantId: user.tenantId } satisfies JwtPayload, {
    secret: env.jwtSecret,
    expiresIn: '30d',
  });
}

// 金额:分 ↔ 元 helper(仅用于展示/录入边界)。
export const yuanToCents = (yuan: number): number => Math.round(yuan * 100);
export const centsToYuan = (cents: number): number => cents / 100;
