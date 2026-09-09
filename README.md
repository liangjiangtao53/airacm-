# 维修之翼

航空机务培训学习平台。顺序学习 · 专题学习(M1-M9 题库) · 在线考试 · 错题本 · 交流。

- **后端**:NestJS 10 + TypeORM(MySQL 生产 / better-sqlite3 测试) + JWT
- **前端**:Next.js 14 (App Router, Tailwind)
- **部署**:Docker Compose 一键起,Nginx 反代 + TLS 统一入口

---

## 目录结构

```
backend-pre/        NestJS 后端(含自有 Dockerfile / dev compose)
frontend/           Next.js 前端(standalone 容器化)
apps/student-uni/   Vue 3 + uni-app 学员端(H5 / Android / 微信小程序)
deploy/nginx/       Nginx 反代配置 + 证书目录
docs/               产品、系统、部署和测试文档
docker-compose.yml  整套编排(db + api + frontend + nginx)
.env.example        部署环境变量模板
```

详细说明从 [文档索引](docs/README.md) 进入；生产操作请先阅读 [部署手册](docs/DEPLOY.md)，回归范围见 [测试文档](docs/TESTING.md)。

---

## 本地开发

```bash
# 后端(默认 sqlite,万能验证码 1234)
cd backend-pre && npm install && npm run start:dev      # :8770

# 前端
cd frontend && npm install && npm run dev               # :3000
```

开发态前端默认调 `http://localhost:8770`(见 `frontend/lib/api.ts` 的 `NEXT_PUBLIC_API_BASE` 回落)。

> 注意:开发期间不要跑 `npm run build`。`next dev` 与 `next build` 共用 `.next` 目录,混用会导致 CSS/产物损坏。要验证生产构建,先停 dev。

---

## 整套部署(Docker Compose 一键)

仅 `nginx` 暴露公网 80/443;`api` / `db` / `frontend` 全部限容器内网。

```
公网 ──80/443──> nginx(TLS 终止,唯一出口)
                   ├ /      → frontend:3000  (内网)
                   └ /api/  → api:8770        (内网,去 /api 前缀)
                                └ db:3306      (内网)
```

### 步骤

```bash
# 1. 配置环境变量
cp .env.example .env
#    至少填: DB_PASSWORD、JWT_SECRET(openssl rand -base64 48)
#    生产短信: SMS_DEV_MODE=false 并填阿里云 ALI_SMS_* 密钥

# 2. TLS 证书 → deploy/nginx/certs/{fullchain.pem,privkey.pem}
#    正式(需已解析域名):
certbot certonly --webroot -w deploy/certbot -d your-domain.com
#    或无域名先自签测试(浏览器告警,仅验证链路):
mkdir -p deploy/nginx/certs
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout deploy/nginx/certs/privkey.pem \
  -out deploy/nginx/certs/fullchain.pem -subj "/CN=localhost"

# 3. 改 deploy/nginx/airacm.conf 里的 server_name 为你的域名

# 4. 构建镜像
docker compose build

# 5. 首次建表 + 写入管理员(seed 幂等)。
#    务必先在 .env 设好 ADMIN_PASSWORD / BIZ_ADMIN_PASSWORD,否则用弱默认值!
#    SEED_DEMO=false 只建表+管理员,不灌示例课程/激活码。
docker compose run --rm -e SEED_DEMO=false api node dist/seed.js
#    seed 内部 synchronize 已建表,DB_SYNC 保持 false 即可。

# 6. 启动全栈
docker compose up -d

# 7. 防火墙: 仅放行 80/443,关闭 3000/8770/3306 公网入站

# 默认管理员(手机号见 .env): 超管 13259858973 / 业务管理员 13772066855
# 密码 = .env 里的 ADMIN_PASSWORD / BIZ_ADMIN_PASSWORD
```

访问 `https://你的域名`。前端构建期已把 API 基址注入为同域 `/api`,无跨域。

### 常用运维

```bash
docker compose ps                 # 状态
docker compose logs -f api        # 后端日志
docker compose up -d --build api  # 仅重建后端
docker compose down               # 停止服务(MySQL 数据保留在 mysql_data 卷)
```

---

## 安全加固现状

已落地:

- Nginx TLS(TLSv1.2/1.3)、HSTS、X-Frame-Options、X-Content-Type-Options、Referrer-Policy、Permissions-Policy、CSP
- 限流:普通 30 r/s;登录/发码/注册/卡密登录 1 r/s(叠加后端 `@Throttle` 双层)
- body 上限:全局 2m,APK/普通题库上传路径 150m,M1 预检入口 6m;M1 整包只接受不超过 5MiB 的 `.xlsx`,解压总量不超过 25MiB
- 后端 `helmet()`、`ValidationPipe`(白名单)、CORS 白名单、JWT 强校验(缺失启动失败)
- 数据库仅容器内网,不暴露 3306;容器非 root 运行
- 短信防刷:同号 60s 不重发

部署前务必确认:

- [ ] `JWT_SECRET` 强随机(32 字节以上)、`DB_PASSWORD` 强密码
- [ ] `.env` 不进 git(已在 `.gitignore`)
- [ ] 首次用 `node dist/seed.js` 建表 + 写管理员;`DB_SYNC` 保持 false(改实体可能丢数据)
- [ ] `ADMIN_PASSWORD` / `BIZ_ADMIN_PASSWORD` 在 seed 前设成强密码(默认占位是弱密码)
- [ ] 防火墙只开 80/443
- [ ] 生产关闭短信 dev 模式(`SMS_DEV_MODE=false`)
- [ ] MySQL 定时备份(`mysqldump` 或云数据库快照)

### 当前上线状态(2026-08-24)

- 生产已改为 TypeORM migration 流程,`DB_SYNC` 保持 `false`。
- 生产数据库每日 03:20 自动备份到 `/home/ubuntu/airacm/db-backups`。
- 部署脚本会在 migration 前自动执行 `predeploy` 数据库备份。
- 2026-07-03 已完成一次备份恢复演练:临时 MySQL 恢复成功,题库表和新增审计表可恢复。
- M1 改为按 7 个工作表整包预检、确认和原子发布;Web 与 Android 学习端按章节展示并分别续学。

### 待办(P1)

- CSP 收紧为 nonce 方案(当前含 `'unsafe-inline'` 以兼容 Next 运行时)
