import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  CanActivate,
  UnauthorizedException,
  createParamDecorator,
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { env } from './config';

export type UserRole = 'user' | 'admin';

// 登录态:JWT payload 解出的当前用户。tenantId 随 token 走,后端查询统一带上(D4)。
export interface AuthUser {
  userId: string;
  tenantId: string;
  role: UserRole;
}

export interface JwtPayload {
  sub: string;
  tenantId: string;
  role: UserRole;
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
      req.user = {
        userId: payload.sub,
        tenantId: payload.tenantId,
        role: payload.role ?? 'user',
      } satisfies AuthUser;
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
  return jwt.sign(
    { sub: user.userId, tenantId: user.tenantId, role: user.role } satisfies JwtPayload,
    { secret: env.jwtSecret, expiresIn: env.jwtExpiresIn },
  );
}

// 金额:分 ↔ 元 helper(仅用于展示/录入边界)。
export const yuanToCents = (yuan: number): number => Math.round(yuan * 100);
export const centsToYuan = (cents: number): number => cents / 100;

// 角色鉴权:@Roles('admin') + RolesGuard。管理接口(发码/后台充值/课程上架)强制 admin。
export const ROLES_KEY = 'required_roles';
export const Roles =
  (...roles: UserRole[]) =>
  (target: object, key?: string | symbol, descriptor?: PropertyDescriptor): void => {
    Reflect.defineMetadata(ROLES_KEY, roles, descriptor ? descriptor.value : target);
  };

@Injectable()
export class RolesGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const required: UserRole[] | undefined = Reflect.getMetadata(ROLES_KEY, handler);
    if (!required || required.length === 0) return true;
    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    if (!user || !required.includes(user.role)) {
      throw new UnauthorizedException('需要管理员权限');
    }
    return true;
  }
}

// 全局异常过滤器:统一错误信封 { success:false, data:null, error },与成功响应同构。
// 生产环境对 5xx 脱敏(不回传堆栈/内部错误),仅服务端记录详情。
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务器内部错误';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const m = (body as { message?: string | string[] }).message;
        message = Array.isArray(m) ? m.join('; ') : m ?? exception.message;
      }
    }

    if (status >= 500) {
      // 服务端记录完整错误,客户端只看到通用文案(不泄露内部实现)。
      this.logger.error(
        `${req?.method} ${req?.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      if (env.isProd) message = '服务器内部错误';
    }

    res.status(status).json({ success: false, data: null, error: message });
  }
}
