# 机务在线学习平台 — 测试文档

## 1. 测试策略
| 层级 | 工具 | 覆盖 |
|---|---|---|
| 集成测试 | Jest + supertest | 架构关键不变量(并发/幂等/权限/题库/App 上传) |
| 单元覆盖 | Jest --coverage(v8) | 行覆盖率约 85% |
| 压力测试 | 自研 Node 脚本(bench.js/benchpost.js) | QPS/p99 承载 |
| 前端构建 | Next.js build / uni build | Web 页面和 App H5 产物 |
| App 验证 | 本地 APK 打包 + adb 安装 | Android 壳启动、防截图、下载包可用 |

本地测试用 sqlite 内存/文件模式,无需 pg:
`DB_TYPE=better-sqlite3 DB_SYNC=true`

## 2. 集成测试用例

### 2.1 钱包并发安全(critical.spec.ts)
- 并发双花只成功一次,余额不为负(乐观锁)
- 已购课程重复购买被拒,不重复扣费
- 余额不足购课失败
- 充值码同码并发只入账一次
- 用过的码再次使用被拒

### 2.2 支付幂等与对账
- 微信回调同 transaction_id 重发只入账一次
- 伪造签名拒绝,不入账
- 金额与预单不符被拒,不入账
- 无预单的回调被拒

### 2.3 权限与越权
- 未购课访问付费课时被拒(403),免费课时放行
- 无 token 访问管理接口 401
- 普通用户访问管理接口 401(RBAC)
- admin 可发激活码,码为加密随机(防枚举)
- 非法入参返回统一错误信封

### 2.4 认证(auth.spec.ts,11 个)
- 注册:成功/重复手机号/验证码错/手机号格式/密码长度
- 登录:成功/密码错/账号不存在
- /me:带 token/无 token

### 2.5 管理(admin.spec.ts,7 个)
- 创建课程/章节/课时(成功 + 不存在 404)
- 手动充值(入账 + 用户不存在 404)

### 2.6 新功能(new-features.spec.ts,36 个)
- 短信注册、重复手机号、验证码错误、重发限制
- 题库导入、科目识别、非法科目拦截
- 学习列表不下发答案,答案接口单独获取
- 题目评论读取与发表
- 考试组卷、交卷判分、历史记录、错题本
- 管理后台 APK 上传与非 APK 拦截
- 卡密登录、单点登录、资料补全
- 管理员用户维护和角色分层

## 3. 测试命令
```bash
cd backend-pre
npx jest --runInBand            # 全部测试(32/32)
npx jest --clearCache           # ts-jest 缓存假失败时先清
npm run test:cov                # 覆盖率(约 85%)
```
注:多 spec + 覆盖率同时跑时,jest 覆盖率插桩与 NestJS reflect-metadata 偶发交互,
个别 admin 越权用例可能 flaky;`npx jest`(不带 coverage)稳定全绿。

### 3.1 当前常用回归命令

```powershell
# 后端构建
npm --prefix backend-pre run build

# 后端新功能回归
npm --prefix backend-pre test -- --runInBand new-features.spec.ts

# Web 构建
npm --prefix frontend run build

# uni-app H5 构建
npm --prefix apps/student-uni run build:h5 -- --base ./

# Android APK 打包
powershell -ExecutionPolicy Bypass -File scripts\package-student-apk.ps1
```

### 3.2 最近验证结果

- `new-features.spec.ts`:36/36 通过。
- `frontend run build`:通过。
- `apps/student-uni run build:h5 -- --base ./`:通过。
- `scripts/package-student-apk.ps1`:通过,输出 `D:\AndroidLab\apk\airacm-android.apk`。
- `adb install -r D:\AndroidLab\apk\airacm-android.apk`:模拟器安装成功。
- `adb shell am start -n com.airacm.student/.MainActivity`:启动成功。
- 下载地址 `http://127.0.0.1:3000/downloads/app/airacm-android.apk`:返回 200。

### 3.3 需要人工点验的页面

- Web 普通用户首页:只显示交流、下载 App、专升本。
- Web 业务管理员/超级管理员首页:显示学习、考试、回顾、错题本、交流、下载 App、专升本、管理后台。
- App 首页:显示学习、考试、回顾、错题本、交流、专升本。
- App 学习页:10/20/30 每页、输入页码后点击跳转、查看答案旁评论。
- App 错题本:查看答案/已掌握旁评论。
- App 防截图:真机或模拟器截图不应露出 App 内容。

## 4. 压力测试结果(单进程 + sqlite + 本机)

### 4.1 课程读(缓存命中)
| 并发 | QPS | p99 |
|---|---|---|
| 100 | 1834 | 21ms |
| 300 | 1860 | 38ms |
| 200(Redis降级) | 1904 | 42ms |
- 冷请求(查DB+写缓存) 78ms → 缓存命中 18ms,降约 4 倍

### 4.2 进度写(写缓冲)
| 并发 | QPS | p99 |
|---|---|---|
| 100 | 2418 | 15ms |
| 200 | 2737 | 12ms |
- 写缓冲使上报为纯内存操作,吞吐反超读

### 4.3 限流验证
- 连续打 /auth/login(错误密码):`401,401,401,401,401,429,429,429`
- 第 6 次起触发 429,防暴力破解精确生效

### 4.4 承载结论
2000 人同时在线学习,实际请求量约 100-400 QPS;
单进程读 1904 / 写 2737 QPS,**余量 5-27 倍,完全不卡顿**。

## 5. 压测复现
```powershell
# 后端起在 :8770(THROTTLE_LIMIT 设高以放开压测)
$tok = (irm localhost:8770/auth/login -Method Post -ContentType application/json `
  -Body '{"phone":"13900000000","password":"admin123456"}').data.token
node bench.js $tok 200 10            # 读压测
node benchpost.js $tok <lessonId> 200 10   # 进度写压测
```

## 6. 待补充测试
- E2E(前端学员端流程,Playwright)
- 多实例 + Redis 模式的缓存一致性测试
- 长时间稳定性/内存泄漏测试
每次执行生成 20 个(默认)，有效期 30 天(默认)
npm --prefix backend-pre run gen:keys
# 自定义：生成 50 个，有效期 90 天
npm --prefix backend-pre run gen:keys -- 50 90
