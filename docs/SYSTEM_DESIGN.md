# 机务在线学习平台 — 系统设计文档

## 1. 技术栈
| 层 | 技术 |
|---|---|
| 后端 | NestJS 10 + TypeScript |
| ORM | TypeORM 0.3 |
| 数据库 | PostgreSQL(生产) / better-sqlite3(测试),DB_TYPE 切换 |
| 认证 | JWT(@nestjs/jwt) |
| 缓存 | 可降级:Redis(ioredis) / 进程内内存 |
| 限流 | @nestjs/throttler |
| Web 前端 | Next.js 14(App Router) + Tailwind CSS |
| App/H5 | uni-app + Vue 3,Android 壳 WebView 打包 |

## 2. 架构
模块化单体(Modular Monolith),当前领域模块:
auth / access-key / wallet / course / order / payment / progress / question / exam / forum / app-release / admin (+ health)

```
Client(Next.js / uni-app / Android WebView) --/api/*--> NestJS
  Controller(路由+鉴权 Guard) -> Service(业务) -> Repository(TypeORM) -> DB
  横切: 全局 ValidationPipe / ThrottlerGuard / 响应信封拦截器 / 异常过滤器
  缓存: cache.ts(Redis 降级内存)
```

分层职责:
- **Controller**: 路由、JwtAuthGuard/RolesGuard 鉴权、DTO 校验
- **Service**: 业务逻辑、事务、缓存
- **Repository**: TypeORM 数据访问
- **统一响应信封** `{success, data, error}` + 全局异常过滤器

## 3. 数据模型(12 表)
tenant, user, wallet, wallet_txn, recharge_code, access_key, course, chapter, lesson,
order, recharge_order, entitlement, progress, question, comment, exam_attempt,
exam_answer, wrong_book, forum_topic, post

设计要点:
- uuid 主键,所有表带 `tenantId`(多租户隔离)
- 复合索引 `(tenantId, ...)`;金额用 integer(分)
- 唯一约束保障幂等: user(tenantId,phone)、wallet(tenantId,userId)、
  recharge_code(tenantId,code)、entitlement(tenantId,userId,courseId)、
  progress(tenantId,userId,lessonId)、部分唯一索引(refId/transactionId WHERE NOT NULL)
- wallet 用 `@VersionColumn` 乐观锁

## 4. 核心并发与一致性设计
| 场景 | 机制 |
|---|---|
| 钱包并发双花 | VersionColumn 乐观锁 + DB 事务,decrementWithin 原子扣减 |
| 充值码重复入账 | 唯一索引 + 状态机(unused→used) |
| 卡密重复登录 | 普通学员单点登录 sessionVersion,后登录踢掉旧 token |
| 微信回调幂等 | transaction_id 唯一 + 预单金额对账 |
| 越权 | JwtAuthGuard(验 token) + RolesGuard(验 role) + tenantId 隔离 |
| 题目图片持久化 | Excel 图片保存到 `QUESTION_IMAGE_DIR`,URL 存入 `question.imageUrls` |

## 5. 性能优化设计(支撑 2000 人学习)
| 优化 | 设计 |
|---|---|
| 课程列表 | findAndCount 分页,pageSize 上限 50 |
| 课程详情消 N+1 | 一次查全部 lessons,内存按 chapterId 分组,固定 4 次查询(3 并行) |
| 读缓存 | TTL 缓存 list/detail 的**共享内容**;owns/locked **每请求按用户算**(避免串用户) |
| 缓存失效 | admin 写课程/章节/课时后主动 cacheInvalidate + 30s TTL 兜底 |
| **进度写缓冲** | 上报先入内存 Map(同课时合并最新),每 3s 批量 upsert 落库;读时缓冲优先 |
| 连接池 | pg max 20(可配)+ 连接/空闲超时 + 慢查询日志(>1s) |
| 限流 | login 5/分、send-code 3/分、全局 120/分,均可配 |
| 缓存可降级 | REDIS_URL 配置则多实例共享,否则内存;接口 async,业务无感 |
| 学习分页 | 学习端支持 10/20/30 每页,默认 10;后端分页返回 total/page/pageSize |
| APK 分发 | 固定下载路径 `/downloads/app/airacm-android.apk`,后台上传覆盖共享目录 |

## 6. 关键 API
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /auth/register、/auth/login、/auth/send-code | 注册/登录/验证码 |
| GET | /auth/me | 当前用户 |
| GET | /courses?page=&pageSize= | 课程列表(分页) |
| GET | /courses/:id | 课程详情(章节/课时) |
| GET | /courses/lessons/:id | 课时详情(权限校验+playUrl) |
| GET | /wallet、POST /wallet/recharge-code | 余额/充值码 |
| POST | /orders | 钱包购课 |
| POST | /payment/recharge/prepay、/payment/wechat/callback | 微信预单/回调 |
| POST | /progress、GET /progress/:lessonId | 进度上报/查询 |
| POST | /admin/recharge-codes、/admin/wallet/recharge、/admin/courses、/admin/chapters、/admin/lessons | 管理(需 admin) |
| GET | /questions/categories | 题库科目 |
| GET | /questions?usage=&category=&page=&pageSize= | 学习题列表(默认不下发答案) |
| GET | /questions/:id/answer | 学习题答案/解析 |
| GET/POST | /questions/:id/comments | 题目评论读取/发表 |
| POST | /admin/questions/import | 管理员导入 Excel/PDF 题库 |
| POST | /exams/start、/exams/:id/submit | 开始考试/交卷判分 |
| GET | /exams/history、/exams/:id/review | 考试历史/复盘 |
| GET/POST | /exams/wrong-book、/exams/wrong-book/:questionId/master | 错题本/标记掌握 |
| GET/POST | /forum/topics、/posts | 交流版块和帖子 |
| GET/POST | /admin/app/apk | APK 状态与上传 |

## 7. 学员端信息架构

| 端 | 角色 | 首页入口 |
|---|---|---|
| Web | 普通学员 | 交流、下载 App、专升本 |
| Web | 业务管理员/超级管理员 | 专题学习、在线考试、考试回顾、错题本、交流、下载 App、专升本、管理后台 |
| Android App | 全部登录用户 | 专题学习、在线考试、考试回顾、错题本、交流、专升本 |

设计取舍:
- Web 对普通学员保持轻入口,降低学习入口分散,主要引导下载 App。
- 管理员保留完整学习/考试入口,便于导入题库后立即验收。
- App 不显示下载 App,避免自我下载入口;Android 壳通过 `FLAG_SECURE` 防截图/录屏。

## 8. 题库导入设计

| 类型 | 支持点 | 输出 |
|---|---|---|
| 普通 Excel | 表头驱动解析,兼容列顺序变化 | 题目、选项、答案、解析 |
| WPS 带图 Excel | 解析 `DISPIMG` 与 workbook 内图片关系 | 图片文件 + `question.imageUrls` |
| PDF | 针对 M9 参考试题解析 | `M9 new` 科目,用于版本对比 |

导入后同一题目数据被学习、考试、考试回顾、错题本复用;图片 URL 通过 `/question-images/:file` 输出,并设置跨源资源策略供 Web 前端加载。

## 9. 部署与扩展路径
- 单实例:当前配置,2000 人学习余量充足
- 水平扩展:多实例 + Redis(缓存/限流共享,代码已就绪) + 负载均衡(JWT 无状态)
- 更高承载:Node cluster 多进程、进度写缓冲升级 Redis、视频/静态走 CDN
- 数据库:synchronize=false + migration(已提供初始 migration)
