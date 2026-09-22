# AGENTS.md — airacm（维修之翼）

本文件约束所有在此仓库工作的 AI 代理与人类开发者。与全局规则冲突时，以本文件为准。

## 1. 仓库用途

航空机务培训学习平台：顺序学习 · 专题学习（M1-M9 题库）· 在线考试 · 错题本 · 交流论坛。
技术栈：NestJS 10 + TypeORM（MySQL 生产 / better-sqlite3 测试）+ JWT；Next.js 14（App Router + Tailwind）；Vue 3 + uni-app 学员端；Docker Compose + Nginx 部署。

## 2. 目录职责

```
backend-pre/          NestJS 后端（API、题库导入、M1 整包发布、支付、微信小程序）。src/modules/ 按领域一文件一模块
frontend/             Next.js 14 Web 端（学员 + 管理后台），app/ 按 App Router 路由组织
apps/student-uni/     Vue 3 + uni-app 学员端（H5 / Android / 微信小程序）
apps/student-android-shell/  Android 壳工程（防截图 WebView 容器）
deploy/nginx/         Nginx 反代配置；certs/ 存 TLS 证书（绝不入库）
scripts/              运维与打包脚本（备份、生产部署、APK 打包）
docs/                 PRD、系统设计、部署手册、测试文档、规划
mock_learning_app/    本地演示/原型，非生产代码
reverse_*/            逆向分析产物，只读参考，禁止改动或引用进生产代码
docker-compose.yml    整套编排（db + api + frontend + nginx）
.env.example          部署环境变量模板
```

## 3. 构建、测试、检查命令

```bash
# 后端（backend-pre/）
npm run start:dev                 # 开发启动 :8770（默认 sqlite，万能验证码 1234）
npm run build                     # nest build，改后端后必须通过
npx jest --runInBand              # 全量测试（jest 缓存假失败先 npx jest --clearCache）
npx jest --runInBand <spec 名>    # 单套件回归，如 new-features.spec.ts
npm run migration:generate / run / revert   # 改实体必须走 migration，禁止依赖 synchronize
npm run seed                      # 建表 + 幂等写管理员

# Web 前端（frontend/）
npm run dev                       # :3000
npm run build                     # 生产构建（必须先停 next dev）
npm run lint

# 学员端（apps/student-uni/）
npm run dev:h5 / dev:mp-weixin
npm run build:h5 -- --base ./     # H5 构建
npm run typecheck                 # vue-tsc --noEmit
npm run test                      # vitest
npm run build:mp-weixin           # 小程序构建（内置无 UGC 断言）

# 打包与部署（仓库根）
powershell -ExecutionPolicy Bypass -File scripts\package-student-apk.ps1 [-BuildBoth]
powershell -ExecutionPolicy Bypass -File scripts\deploy-prod.ps1
bash scripts/backup-db.sh
```

本地测试用 sqlite：`DB_TYPE=better-sqlite3 DB_SYNC=true`，无需 MySQL。

## 4. 开发和审查流程

1. **定位先行**：先用 Grep/Glob 定位，再精确 Read；不盲目探索性读取。
2. **规划**：复杂功能/重构/多文件改动先产出计划并获确认。
3. **最小 diff**：修复只改必要代码，不顺带重构、不加推测性兼容代码。
4. **测试**：后端改动必须有对应 spec 通过；改实体必须配 migration 并验证幂等。
5. **审查**：改动完成后自查——安全敏感面（认证/支付/上传/用户输入）必须触发安全审查；检查无硬编码密钥、无调试残留、错误显式处理。
6. **提交**：约定式提交（`feat|fix|refactor|docs|test|chore|perf|ci: 描述`），不加 AI 归属。
7. **文档同步**：影响行为/接口/部署的改动同步更新 `docs/`（TESTING.md 回归命令、DEPLOY.md）与 CHANGELOG。

## 5. 不允许违反的硬规则（违反即 BLOCK）

- `.env`、`*.pem`、TLS 证书/私钥、`deploy/nginx/certs/`、`uploads/`、`backend-pre/load-accounts.json` 绝不提交。
- 任何密钥（JWT_SECRET、DB_PASSWORD、阿里云 SMS、微信支付密钥）不得硬编码，必须走环境变量；发现泄露立即轮换。
- 生产 `DB_SYNC` 保持 `false`；改表结构只走 TypeORM migration。
- 开发期间禁止在 `frontend/` 跑 `npm run build`（与 `next dev` 共用 `.next` 会损坏产物）；验证生产构建前先停 dev。
- SQL 一律参数化，禁止字符串拼接；用户输入在边界处校验（class-validator）。
- 不修改 `reverse_*/` 目录内容，不将其代码复制进生产目录。
- 允许截图版 APK（`*-screenshot.apk`）不得复制到 `frontend/public` 或提交。
- 响应统一错误信封；学习列表接口不下发答案（答案走独立接口）。
- 支付回调必须验签 + 幂等；钱包扣费用乐观锁，禁止裸读-改-写。
- 限流配置（登录/发码/注册 1 r/s 等）不得移除或放宽。
- 不删除或绕过 helmet、ValidationPipe 白名单、CORS 白名单、JWT 启动强校验。

## 6. Skill 路由

| 任务 | Skill / 代理 |
|---|---|
| 新功能 / 多文件实现 | `superpowers:brainstorming` → 规划模式 → `superpowers:writing-plans` |
| 修 bug | `superpowers:systematic-debugging`（先复现、再定位根因、后修复） |
| 后端 / TS 改动审查 | `typescript-reviewer`；安全敏感面加 `security-reviewer` |
| NestJS 模式参考 | `nestjs-patterns`；数据库查询 → `postgres-patterns` |
| 部署 / Compose / Nginx | `deployment-patterns`、`docker-patterns` |
| 文档更新 | `doc-updater` |
| 死代码清理 | `refactor-cleaner` |
| 完工验证 | `superpowers:verification-before-completion` |

规则：过程类 skill（brainstorming / systematic-debugging）先于实现类；`/loop`、多代理 workflows 只在用户显式要求时使用。

## 7. Definition of Done

- [ ] 相关构建通过：后端 `npm run build`；前端 `next build`（停 dev 后）；uni-app 改动过 `typecheck` + `build:h5`
- [ ] 相关测试全绿：`npx jest --runInBand`；uni-app 改动过 `vitest`
- [ ] 改实体已配幂等 migration；本地可重复 run/revert
- [ ] 无硬编码密钥、无调试残留、无越权/验签/幂等回退
- [ ] 涉及 M1 发布、支付、权限的改动补/更新了对应 spec
- [ ] 文档与 CHANGELOG 已同步（用户可见行为变化时）
- [ ] 人工点验项（见 `docs/TESTING.md` 3.3 节）已列出待验证清单

## 8. 子目录差异化规则

### backend-pre/（NestJS）
- 一领域一模块文件（`src/modules/*.ts`）；新表/改列必须 migration + spec；测试环境用 `DB_TYPE=better-sqlite3 DB_SYNC=true`。
- 压测脚本（bench*）与 `sim.js` 属临时工具，改动需说明用途。

### frontend/（Next.js 14）
- App Router 结构，页面放 `app/<route>/`；共享逻辑进 `lib/`，组件进 `components/`。
- API 基址经 `lib/api.ts` 的 `NEXT_PUBLIC_API_BASE` 回落，不得散落硬编码地址。
- 生产构建前必须停 `next dev`（见硬规则）。

### apps/student-uni/
- `build:mp-weixin` 内置无 UGC 断言，禁止绕过；小程序端不得引入 UGC 能力。
- 改动后跑 `typecheck` + `vitest`；H5 构建带 `-- --base ./`。

### apps/student-android-shell/
- 防截图属性是安全要求，任何改动不得移除；双包验证流程见 TESTING.md 3.3。

### deploy/nginx/ 与根编排
- 仅 nginx 暴露 80/443；api/db/frontend 保持容器内网，不得新增端口映射。
- 改 conf 需同步 `docs/DEPLOY.md` 与 CSP/限流说明。

### scripts/ 与 docs/
- 生产脚本（deploy-prod.ps1、backup-db.sh）改动需单独说明并附验证记录。
- `docs/plans/`、`docs/_analysis/` 为过程文档，归档不删。
