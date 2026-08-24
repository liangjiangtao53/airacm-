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
import { SessionService } from './session';
import { randomUUID } from 'crypto';

// user 普通学员 / admin 业务管理员 / super 超级管理员(全权,自动满足任意 @Roles)。
export type UserRole = 'user' | 'admin' | 'super';

export const PASSWORD_COMPLEXITY_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/;
export const PASSWORD_COMPLEXITY_MESSAGE = '密码必须包含大小写字母、数字和特殊字符';

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
  // 单点登录会话 id。守卫比对 user.sessionId,不一致即踢(仅 role=user)。
  sid?: string;
  // 卡密首次登录的"待补全"态:仅可用于补全资料接口,业务接口一律拒绝。
  pending?: boolean;
}

// 统一响应信封 { success, data, error }(见 patterns)。
export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  code: string | null;
  requestId: string;
}

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = ctx.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const supplied = String(req?.headers?.['x-request-id'] ?? '');
    const requestId = /^[a-zA-Z0-9._:-]{1,100}$/.test(supplied) ? supplied : randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    return next.handle().pipe(
      map((data): ApiResponse<unknown> => ({ success: true, data: data ?? null, error: null, code: null, requestId })),
    );
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly session: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers?.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少登录凭证');
    }
    const token = header.slice('Bearer '.length).trim();
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(token, { secret: env.jwtSecret });
    } catch {
      throw new UnauthorizedException('登录已失效,请重新登录');
    }
    req.user = {
      userId: payload.sub,
      tenantId: payload.tenantId,
      role: payload.role ?? 'user',
    } satisfies AuthUser;
    // 单点登录校验(管理员放行)。校验失败抛 401,不被上面的 catch 吞掉。
    await this.session.validate(payload);
    return true;
  }
}

// 控制器用 @CurrentUser() 注入 AuthUser。
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as AuthUser;
  },
);

export function signToken(jwt: JwtService, user: AuthUser, sid?: string): string {
  return jwt.sign(
    { sub: user.userId, tenantId: user.tenantId, role: user.role, sid } satisfies JwtPayload,
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
    // @Roles 既可标在方法也可标在控制器类上。方法优先,缺失则回退类级,
    // 否则类级 @Roles('admin') 会被静默忽略导致越权(普通用户调管理接口)。
    const required: UserRole[] | undefined =
      Reflect.getMetadata(ROLES_KEY, context.getHandler()) ??
      Reflect.getMetadata(ROLES_KEY, context.getClass());
    if (!required || required.length === 0) return true;
    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    if (!user) throw new UnauthorizedException('需要管理员权限');
    // 超级管理员全权,自动满足任意角色要求。
    if (user.role === 'super') return true;
    if (!required.includes(user.role)) {
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
    let explicitCode = '';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const m = (body as { message?: string | string[]; code?: string }).message;
        explicitCode = (body as { code?: string }).code ?? '';
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

    const supplied = String(req?.requestId ?? req?.headers?.['x-request-id'] ?? '');
    const requestId = /^[a-zA-Z0-9._:-]{1,100}$/.test(supplied) ? supplied : randomUUID();
    const code = explicitCode || this.errorCode(status, message);
    res.setHeader('X-Request-Id', requestId);
    if (status === HttpStatus.SERVICE_UNAVAILABLE && !res.getHeader('Retry-After')) res.setHeader('Retry-After', '2');
    res.status(status).json({ success: false, data: null, error: message, code, requestId });
  }

  private errorCode(status: number, message: string): string {
    if (message.includes('预检批次已过期') || message.includes('预检源文件已清理')) return 'PREVIEW_EXPIRED';
    if (message.includes('题库已更新') || message.includes('题库刚刚')) return 'QUESTION_SET_UPDATED';
    if (status === HttpStatus.BAD_REQUEST || status === HttpStatus.UNPROCESSABLE_ENTITY) return 'VALIDATION_ERROR';
    if (status === HttpStatus.UNAUTHORIZED) return 'UNAUTHORIZED';
    if (status === HttpStatus.FORBIDDEN) return 'FORBIDDEN';
    if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
    if (status === HttpStatus.CONFLICT) return 'CONFLICT';
    if (status === HttpStatus.GONE) return 'GONE';
    if (status === HttpStatus.SERVICE_UNAVAILABLE) return 'SERVICE_BUSY';
    return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED';
  }
}
