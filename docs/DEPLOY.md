# 维修之翼 — 阿里云 ECS 部署手册(本地打包上传)

把本地已配置好的项目打包,上传到阿里云 ECS,在服务器上 `docker compose` 起来。
不依赖 git,适合私有代码 / 内网仓库。

架构:仅 Nginx 暴露公网 80/443,前端/后端/数据库全在容器内网。

```
公网 ──80/443──> nginx(TLS 终止,唯一出口)
                   ├ /      → frontend:3000  (内网)
                   ├ /downloads/app/ → uploads/app/airacm-android.apk
                   └ /api/  → api:8770        (内网,去 /api 前缀)
                                ├ question-images/ → uploads/question-images/
                                └ db:5432      (内网)
```

---

## 0. 准备阿里云 ECS

1. 购买 ECS 实例:
   - 地域:就近(如华东1·杭州)
   - 规格:2 核 2G 起步(题库 3000+ 题建议 2 核 4G)
   - 镜像:**Ubuntu 22.04 64 位**
   - 公网:分配公网 IP,带宽按需(1-3M 够用,大流量选按量)
   - 系统盘:40G 以上(数据库 + 镜像)

2. **安全组**(阿里云控制台 → ECS → 安全组 → 配置规则 → 入方向):
   | 端口 | 协议 | 授权对象 | 说明 |
   |---|---|---|---|
   | 22 | TCP | 你的办公 IP(或 0.0.0.0/0) | SSH |
   | 80 | TCP | 0.0.0.0/0 | HTTP(跳转 HTTPS) |
   | 443 | TCP | 0.0.0.0/0 | HTTPS |

   > 不要放行 3000/8770/5432,它们只在容器内网。

3. 域名(可选但强烈建议):在阿里云域名控制台把 **A 记录解析到 ECS 公网 IP**。签 TLS 证书必需。

---

## 1. 本地打包(Windows)

在本地项目根 `C:\Users\leifeng\Documents\airacm` 打开 PowerShell:

```powershell
cd C:\Users\leifeng\Documents\airacm

# 打包源码 + 配置(排除 node_modules / 构建产物 / git / 本地证书)
# Windows 10/11 自带 tar
tar --exclude=node_modules --exclude=.next --exclude=dist --exclude=.git `
    --exclude=coverage --exclude=deploy/nginx/certs `
    -czf airacm.tar.gz `
    backend-pre frontend deploy docker-compose.yml .env .env.example
```

> 包里**含你已配好的 `.env`**(密钥、管理员密码),所以上传后服务器不用再配。
> 不含 `node_modules`/`dist`/`.next`——这些在服务器 `docker compose build` 时重新生成。
> 不含 `deploy/nginx/certs`——证书在服务器签(本地自签证书不适合生产域名)。

---

## 2. 上传到 ECS 并解压

把 `<ECS公网IP>` 换成你的服务器 IP。Windows 10/11 自带 `scp`:

```powershell
# 本地 PowerShell:上传压缩包
scp airacm.tar.gz root@<ECS公网IP>:/opt/
```

然后 SSH 登录服务器解压:

```bash
# SSH 进 ECS
ssh root@<ECS公网IP>

# 解压到 /opt/airacm
cd /opt
mkdir -p airacm
tar -xzf airacm.tar.gz -C airacm
cd airacm
ls -la        # 应看到 backend-pre/ frontend/ deploy/ docker-compose.yml .env
```

> 之后服务器上所有命令都在 `/opt/airacm` 下执行。

---

## 3. 服务器安装 Docker(含阿里云镜像加速)

```bash
# 安装官方 Docker
curl -fsSL https://get.docker.com | sh

# 配置阿里云镜像加速(拉取基础镜像更快)
# 专属加速地址见: 阿里云控制台 → 容器镜像服务 → 镜像加速器
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": [
    "https://你的ID.mirror.aliyuncs.com",
    "https://docker.mirrors.ustc.edu.cn"
  ]
}
EOF
systemctl daemon-reload
systemctl restart docker

# 验证
docker --version
docker compose version
```

> 把 `https://你的ID.mirror.aliyuncs.com` 换成你账号的专属加速地址;没有就先用下面的 USTC 公共镜像也行。

---

## 4. 检查 `.env`

`.env` 随包带上来了,确认关键项(尤其密码强度):

```bash
cat .env
```

需要确认/调整:

| 变量 | 说明 |
|---|---|
| `DB_PASSWORD` / `JWT_SECRET` | 强随机值(本地已生成);如担心聊天/本地泄露,在服务器重新生成见下 |
| `ADMIN_PASSWORD` / `BIZ_ADMIN_PASSWORD` | 管理员密码,确保是强密码 |
| `JWT_EXPIRES_IN` | 登录有效期,默认 `30d` |
| `APP_UPLOAD_DIR` | App 安装包共享目录,默认 `./uploads/app` |
| `QUESTION_IMAGE_DIR` | 题库图片共享目录,默认 `./uploads/question-images` |
| `DB_MIGRATIONS_RUN` | 启动时自动执行数据库 migration,默认 `true` |
| `SMS_DEV_MODE` / `ALI_SMS_*` | 要发注册短信则关 dev 模式并填阿里云短信密钥 |

服务器上重新生成密钥(可选,更安全):

```bash
# 重新生成后手动填回 .env 的 DB_PASSWORD / JWT_SECRET
node -e "const c=require('crypto');console.log('DB_PASSWORD='+c.randomBytes(24).toString('hex'));console.log('JWT_SECRET='+c.randomBytes(48).toString('base64'))" 2>/dev/null \
  || (echo DB_PASSWORD=$(openssl rand -hex 24); echo JWT_SECRET=$(openssl rand -base64 48))
```

> 改 `.env` 后用 `nano .env` / `vim .env` 编辑。

---

## 5. 申请 TLS 证书(Let's Encrypt,免费)

```bash
mkdir -p deploy/certbot deploy/nginx/certs

# 用 docker 跑 certbot 签发(把 your-domain.com / 邮箱换成你的)
docker run --rm -p 80:80 \
  -v /opt/airacm/deploy/nginx/certs:/etc/letsencrypt \
  certbot/certbot certonly --standalone \
  -d your-domain.com \
  --email you@example.com --agree-tos --no-eff-email

# 拷到 nginx 期望的固定路径
cp deploy/nginx/certs/live/your-domain.com/fullchain.pem deploy/nginx/certs/fullchain.pem
cp deploy/nginx/certs/live/your-domain.com/privkey.pem   deploy/nginx/certs/privkey.pem
```

> 也可用阿里云免费 DV 证书(数字证书管理服务),下载 Nginx 格式后放到
> `deploy/nginx/certs/fullchain.pem` 与 `privkey.pem`。

**没有域名、先跑通验证**(浏览器告警):

```bash
mkdir -p deploy/nginx/certs
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout deploy/nginx/certs/privkey.pem \
  -out deploy/nginx/certs/fullchain.pem -subj "/CN=localhost"
```

---

## 6. 改 Nginx 域名

```bash
sed -i 's/your-domain.com/你的真实域名/g' deploy/nginx/airacm.conf
```

---

## 7. 构建、初始化、启动

```bash
# App 安装包、题库图片共享目录:api 写入,nginx/frontend 读取。
mkdir -p uploads/app uploads/question-images
# 首次部署如本地包里已有测试 APK,先复制一份到共享目录;后续由后台上传覆盖。
cp -n frontend/public/downloads/app/airacm-android.apk uploads/app/airacm-android.apk 2>/dev/null || true
# api 容器以 node 用户(UID 1000)运行,需要写权限。
chown -R 1000:1000 uploads

# 构建镜像
docker compose build

# 首次建表 + 写入管理员(幂等;SEED_DEMO=false 只建表+管理员)
docker compose run --rm -e SEED_DEMO=false api node dist/seed.js
# 看到 "seed done (schema + admin only)" 即成功

# 启动全栈
docker compose up -d

# 状态:四个服务应都是 running/healthy
docker compose ps
```

浏览器访问 `https://你的域名`,看到"维修之翼"首页。
登录:超管 `13259858973` / 业务管理员 `13772066855`,密码 = `.env` 里设的值。

### App 安装包上传 / 下载

1. 登录后台 → `App 安装包` → 上传新版 `airacm-android.apk`。
2. 后台会写入服务器目录: `/opt/airacm/uploads/app/airacm-android.apk`。
3. 用户固定下载地址: `https://你的域名/downloads/app/airacm-android.apk`。
4. 上传后可在服务器验证:

```bash
ls -lh uploads/app/airacm-android.apk
curl -I https://你的域名/downloads/app/airacm-android.apk
```

后续 APK 升级建议:

- 普通用户始终使用固定文件名 `airacm-android.apk`,页面链接不用改。
- 每次正式发版同时离线保留一份版本文件,例如 `airacm-android-v2.apk`,便于回滚。
- Android 包每次发版递增 `versionCode` / `versionName`,并使用同一个签名证书。
- 正式包不要写死内网测试 IP,应改成生产域名或 HTTPS API 地址后再打包。
- 当前 nginx 允许上传 150MB 以内 APK;如果安装包更大,调整 `deploy/nginx/airacm.conf` 的 `/api/admin/app/apk` 上限。

### 本地重新打包 Android App

当前 Android 壳入口在 `apps/student-android-shell/src/com/airacm/student/MainActivity.java`。
测试包会通过 URL 参数把 App API 指向服务器:

```java
file:///android_asset/www/index.html?platform=app&apiBase=http%3A%2F%2F192.168.2.7%3A8770#/pages/index/index
```

如果部署到其他服务器,先把 `apiBase` 改成新服务器地址或生产 HTTPS 域名,再打包:

```powershell
cd C:\Users\leifeng\Documents\airacm
powershell -ExecutionPolicy Bypass -File scripts\package-student-apk.ps1
```

打包输出:

- `D:\AndroidLab\apk\airacm-android.apk`
- `frontend/public/downloads/app/airacm-android.apk`

本地验证:

```powershell
D:\AndroidLab\android-sdk\platform-tools\adb.exe -s emulator-5554 install -r D:\AndroidLab\apk\airacm-android.apk
D:\AndroidLab\android-sdk\platform-tools\adb.exe -s emulator-5554 shell am start -n com.airacm.student/.MainActivity
```

App 已启用 Android `FLAG_SECURE`,系统截图/录屏不应露出 App 内容。真机验证时用系统截图和录屏各测一次。

服务器内防火墙(阿里云安全组之外再加一层,可选):

```bash
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

---

## 8. 更新部署(本地改完代码后)

每次本地改了代码,重新打包上传覆盖:

```powershell
# 本地 PowerShell:重新打包
cd C:\Users\leifeng\Documents\airacm
tar --exclude=node_modules --exclude=.next --exclude=dist --exclude=.git `
    --exclude=coverage --exclude=deploy/nginx/certs `
    -czf airacm.tar.gz backend-pre frontend deploy docker-compose.yml .env .env.example

# 上传
scp airacm.tar.gz root@<ECS公网IP>:/opt/
```

```bash
# 服务器:解压覆盖 + 重建(证书目录因打包已排除,不会被覆盖)
cd /opt && tar -xzf airacm.tar.gz -C airacm
cd /opt/airacm
docker compose build
docker compose up -d
```

> 数据库数据在 `pgdata` 卷里,App 安装包在 `uploads/app` 目录里,题目图片在 `uploads/question-images` 目录里,重新部署不丢。

---

## 9. 证书自动续期

Let's Encrypt 证书 90 天到期。`crontab -e` 加一行(路径与域名按实际改):

```
0 3 * * 1 docker run --rm -v /opt/airacm/deploy/nginx/certs:/etc/letsencrypt certbot/certbot renew --quiet && cp /opt/airacm/deploy/nginx/certs/live/你的域名/*.pem /opt/airacm/deploy/nginx/certs/ && cd /opt/airacm && docker compose exec nginx nginx -s reload
```

---

## 10. 运维

```bash
# 状态 / 日志
docker compose ps
docker compose logs -f api          # 后端日志
docker compose logs -f nginx        # 反代日志

# 停止(保留数据卷)
docker compose down

# 重启
docker compose restart
```

### 数据库备份 / 恢复

当前生产已安装备份脚本:

```bash
/home/ubuntu/airacm/bin/backup-db.sh
```

备份目录:

```bash
/home/ubuntu/airacm/db-backups
```

部署脚本会在 migration 前自动执行:

```bash
/home/ubuntu/airacm/bin/backup-db.sh predeploy
```

每日备份 cron:

```bash
20 3 * * * /home/ubuntu/airacm/bin/backup-db.sh daily >> /home/ubuntu/airacm/db-backups/backup.log 2>&1
```

保留策略:

- `daily`:保留 14 天,至少保留最近 7 份。
- `weekly`:每周日复制一份,保留 8 周,至少保留最近 4 份。
- `predeploy`:保留 14 天,至少保留最近 10 份。
- `manual`:保留 7 天,至少保留最近 3 份。
- 备份目录超过 5G 会清理最老备份。
- 可用空间低于 8G 会告警,低于 2G 会拒绝继续备份。

手动备份:

```bash
/home/ubuntu/airacm/bin/backup-db.sh manual
```

2026-07-03 已完成恢复演练:使用部署后 manual 备份恢复到临时 MySQL,验证 `question`、`question_import_batch`、`admin_operation_log` 和 `question.importBatchId` 成功。

```bash
# 备份
/home/ubuntu/airacm/bin/backup-db.sh manual

# 恢复演练请恢复到临时 MySQL,不要直接覆盖生产库。
# 生产覆盖恢复必须先停服务并二次确认。
```

> 建议加进 crontab 每日备份,并把备份同步到阿里云 OSS。

### 导入题库 / 生成卡密

- 题库 Excel:登录后台 → 数据维护 → 上传 Excel,选科目与"考试+学习"
- 生成卡密:
  ```bash
  docker compose exec api node dist/gen-keys.js          # 默认 20 个 / 30 天
  docker compose exec api node dist/gen-keys.js 50 90    # 50 个 / 90 天
  ```

---

## 11. 故障排查

| 现象 | 排查 |
|---|---|
| `docker compose up` 报 `DB_PASSWORD required` | `.env` 没填 `DB_PASSWORD` 或 `JWT_SECRET` |
| `docker pull` 很慢/超时 | 第 3 步阿里云镜像加速没配好 |
| 访问 https 证书错误 | 确认 `deploy/nginx/certs/{fullchain,privkey}.pem` 存在 |
| 页面开但接口 502 | api 没起,看 `docker compose logs api` |
| 登录提示账号不存在 | seed 没跑,补 `docker compose run --rm -e SEED_DEMO=false api node dist/seed.js` |
| 注册收不到验证码 | `SMS_DEV_MODE` 仍 true,或阿里云 `ALI_SMS_*` 没填对 |
| 改 `.env` 不生效 | 改完要 `docker compose up -d` 重建容器 |
| 网站打不开 | 阿里云**安全组**没放行 80/443 |
| 后台上传 APK 成功但下载仍是旧包 | 确认 `APP_UPLOAD_DIR` 指向同一目录,并执行 `docker compose up -d` 重建挂载 |
| `/downloads/app/airacm-android.apk` 返回 404 | 确认 `/opt/airacm/uploads/app/airacm-android.apk` 存在 |
| 导入题库后题目图片不显示 | 确认 `/opt/airacm/uploads/question-images` 存在且 api 容器有写权限 |
| 上传 APK 直接 413 | APK 超过 nginx `/api/admin/app/apk` 的 `client_max_body_size` |

---

## 12. 上线前安全清单

- [ ] `JWT_SECRET` / `DB_PASSWORD` 强随机,未外泄
- [ ] `ADMIN_PASSWORD` / `BIZ_ADMIN_PASSWORD` 已改强密码
- [ ] 安全组只开 22 / 80 / 443
- [ ] 生产短信关 dev 模式(`SMS_DEV_MODE=false`)
- [ ] TLS 证书有效,续期 cron 已配
- [ ] 数据库每日备份,验证过能恢复
- [ ] `DB_SYNC` 保持 `false`
- [ ] `uploads/app`、`uploads/question-images` 已创建,后台上传 APK 后下载地址返回 200

---

## 附:涉及文件

| 文件 | 作用 |
|---|---|
| `docker-compose.yml` | 整套编排(db + api + frontend + nginx) |
| `.env` | 真实配置(随包上传,不进 git) |
| `deploy/nginx/airacm.conf` | Nginx 反代 + TLS + 限流 + 安全头 |
| `deploy/nginx/airacm_proxy_common.conf` | 公共反代头 |
| `deploy/nginx/certs/` | TLS 证书(服务器签,不打包) |
| `uploads/app/` | App 安装包共享目录(服务器持久化,不进镜像) |
| `uploads/question-images/` | 题库图片共享目录(服务器持久化,不进镜像) |
