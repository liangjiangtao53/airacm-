# 机务在线学习平台 — 后端 (NestJS)

注册登录 / 钱包充值 / 课程学习 / 题库刷题 / 在线考试 / 错题本 / 认证卡密 / 多角色后台。

## 本地开发

```bash
npm install
cp .env.example .env   # 已自带 .env 则跳过(dev 用 sqlite + 万能码 1234)
npm run seed           # 建表 + 写入管理员账号(幂等)
npm run start:dev      # http://localhost:8770
```

`.env` 关键项:`DB_TYPE=mysql` / `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_DATABASE`。
本地纯单元测试仍会在测试文件里强制使用 `better-sqlite3`。

## 常用命令

```bash
npm run seed                              # 建表 + 引导管理员(超管+业务管理员)
npm run gen:keys -- 20 30                 # 生成 20 个认证卡密,有效期 30 天
npm run import:questions -- <xlsx> "M9 航空英语" both   # 导入题库到指定科目
npm test                                  # 跑测试(自动用内存 sqlite)
npm run build                             # 编译
```

## 默认管理员(seed 写入,生产务必改)

| 角色 | 手机号 | 密码 | 配置项 |
|---|---|---|---|
| 超级管理员 | 13259858973 | Admin@12345 | `ADMIN_PHONE` / `ADMIN_PASSWORD` |
| 业务管理员 | 13772066855 | BizAdmin@12345 | `BIZ_ADMIN_PHONE` / `BIZ_ADMIN_PASSWORD` |

超管可见/管理全部用户(含业务管理员);业务管理员只能管理普通学员。

## 生产部署 (MySQL)

> 本项目暂未提供 TypeORM 迁移文件。首次部署用 `DB_SYNC=true` 让 TypeORM 按实体自动建表,
> 建完**立即改回 false**,避免后续实体变更被自动同步误改生产表结构。

```bash
# .env(生产)示例
NODE_ENV=production
DB_TYPE=mysql
DB_HOST=192.168.22.10
DB_PORT=3306
DB_USER=root
DB_PASSWORD=123456
DB_DATABASE=airacm
JWT_SECRET=<openssl rand -hex 32 生成的强随机串>   # 缺失则拒绝启动
CORS_ORIGINS=https://你的前端域名                    # 生产必填,否则前端跨域被拦
SMS_DEV_MODE=false
ALI_SMS_AK_ID=...   ALI_SMS_AK_SECRET=...   ALI_SMS_SIGN=...   ALI_SMS_TEMPLATE=...

# 生产表结构通过 migration 更新,DB_SYNC 保持 false
npm run migration:run
npm run build && npm run start:prod
```

生产部署已改用正式迁移。后续表结构变更必须提交 `src/migrations/*` 并在上线时执行
`npm run migration:run`。`DB_SYNC=true` 只允许测试/本地一次性建表场景使用,不要用于生产。

## 模块

auth(注册/登录/卡密) · wallet · course · order · payment · progress ·
question(题库/导入/评论) · exam(组卷判分/错题本) · access-key(卡密) · admin(发码/充值/建课/用户管理)

金额一律以「分」存储;钱包扣减乐观锁+原子 UPDATE 防双花;支付/充值码唯一索引幂等。
