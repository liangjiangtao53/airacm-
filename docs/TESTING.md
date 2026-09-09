# 机务在线学习平台 — 测试文档

## 1. 测试策略
| 层级 | 工具 | 覆盖 |
|---|---|---|
| 集成测试 | Jest + supertest | 架构关键不变量(并发/幂等/权限/M1 原子发布/App 上传) |
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

### 2.7 M1 整包发布与公共协议
- `m1-workbook.release.spec.ts`:仅接受 `.xlsx`,限制压缩/解压大小,校验旧版 7 工作表和当前 23 章节汇总表的章节顺序、各章题数、总题量和图片数量；覆盖标准 Drawing 图片提取、预检过期、确认语错误、源文件缺失/篡改、重复发布和并发代际冲突。
- 发布后只保留新 generation,清理章节学习进度,放弃所有尚未完成的 M1 考试(含历史 `activeKey=NULL` 记录),保留已提交历史。
- `m1-migration.spec.ts`:M1 字段、generation 表和索引可幂等创建,兼容既有数据库。
- `common-protocol.spec.ts`:成功/失败响应都带 `code`、`requestId` 和 `X-Request-Id`;题库切换使用稳定码 `QUESTION_SET_UPDATED`。
- `access-key-assigned-migration.spec.ts`:卡密人工分配字段迁移可重复执行。

## 3. 测试命令
```bash
cd backend-pre
npx jest --runInBand            # 当前全部测试(11 suites / 110 tests)
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

# 同时生成两个包：正式防截图包会更新公开下载文件，允许截图包只保留在 D:\AndroidLab\apk 用于本机 QA
powershell -ExecutionPolicy Bypass -File scripts\package-student-apk.ps1 -BuildBoth
```

### 3.2 最近验证结果

- 后端全量 Jest:11 个测试套件、110 项测试通过。
- 后端 `npm run build`:通过。
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
- Web / App M1 学习页:显示当前题库返回的全部章节及各章题量,切换章节后从该章独立续学位置恢复;快速切章不能显示上一章的迟到响应。
- Web / App 发布恢复:学习中发布新 M1 后,页面能识别 `QUESTION_SET_UPDATED`,重新加载章节并落到有效题目。
- App 其他科目学习页:20 题分页、输入页码后点击跳转、查看答案旁评论。
- App 错题本:查看答案/已掌握旁评论。
- App 防截图:真机或模拟器截图不应露出 App 内容。
- 双包截图验证:先安装 `D:\AndroidLab\apk\airacm-android-screenshot.apk`，截图应显示 App；再安装 `D:\AndroidLab\apk\airacm-android.apk`，截图应隐藏 App 内容。允许截图包不得复制到 `frontend/public` 或提交。

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

## 7. 2026-06-29 200 并发复测与部署容量建议

### 7.1 本地复测条件
- 后端: NestJS 单进程,端口 8781。
- 数据库: better-sqlite3 本地文件,用于压测参考;生产已切换为独立 MySQL 服务。
- 限流: `THROTTLE_LIMIT=100000`,避免测到限流而不是服务容量。
- 每个接口: 4000 次请求,200 并发。

### 7.2 结果
| 接口 | 成功率 | QPS | p99 |
|---|---:|---:|---:|
| `/health` | 4000/4000 | 4516.5 | 116.0ms |
| `/auth/me` | 4000/4000 | 2048.0 | 116.6ms |
| `/courses` | 4000/4000 | 2050.4 | 159.9ms |
| `/questions?page=1&pageSize=20` | 4000/4000 | 660.6 | 360.5ms |
| `/forum/topics` | 4000/4000 | 2199.3 | 105.5ms |

### 7.3 结论
- 200 并发在当前业务量下可以承载,瓶颈主要在题库分页读取。
- 线上不要用 sqlite。生产数据库使用独立 MySQL,连接池建议从 `DB_POOL_MAX=20` 起步。
- 200 并发不是 200 QPS。学习类 App 通常 200 人同时在线的真实请求峰值约 20-80 QPS,考试开始/提交时可能短时冲到 100-200 QPS。
- 云服务器起步建议:应用 2C4G + 数据库 2C4G;更稳妥建议:应用 4C8G + 数据库 4C8G,数据盘 SSD 100GB 起。
- 如果数据库和应用放同一台机器,建议至少 4C8G;如果需要留出后续增长和导入题库余量,建议 8C16G。
- 2026-06-29 首次切换 MySQL 配置后,本机连接 `192.168.2.222:3306` 超时,真实 MySQL 压测需先放通网络/防火墙/MySQL 监听。

## 8. 2026-06-29 App 接口压测

### 8.1 条件
- 后端:当前代码单进程,端口 8785。
- 数据库:better-sqlite3 本地文件,仅作 App API 基准;真实 MySQL 压测曾被 `192.168.2.222:3306` 超时阻塞。
- 读接口:4000 次请求,200 并发。
- 登录/考试开始:800 次请求,50 并发。
- 发帖/评论写入:100 次请求,10 并发,避免污染测试库。

### 8.2 结果
| App 接口 | 成功率 | QPS | p99 |
|---|---:|---:|---:|
| `POST /auth/login` | 9/800,其余 429 | 736.0 | 764.7ms |
| `GET /auth/me` | 4000/4000 | 1746.4 | 298.5ms |
| `GET /questions/categories` | 4000/4000 | 1365.8 | 322.8ms |
| `GET /questions?usage=study&page=1&pageSize=20` | 4000/4000 | 534.5 | 508.6ms |
| `GET /questions/:id/answer` | 4000/4000 | 2078.4 | 123.6ms |
| `GET /exams/history` | 4000/4000 | 2023.6 | 132.1ms |
| `GET /exams/wrong-book` | 4000/4000 | 1557.9 | 169.4ms |
| `GET /questions/:id/comments` | 4000/4000 | 2272.8 | 103.6ms |
| `GET /forum/topics` | 4000/4000 | 2270.5 | 105.6ms |
| `GET /posts?page=1&pageSize=20` | 4000/4000 | 1237.1 | 214.8ms |
| `POST /exams/start` | 799/800,1 次 sqlite 500 | 63.2 | 2223.9ms |
| `POST /posts` | 100/100 | 75.7 | 169.1ms |
| `POST /questions/:id/comments` | 100/100 | 79.9 | 137.7ms |

### 8.3 结论
- App 高频读接口整体能覆盖 200 并发;最慢读接口是题目分页,p99 约 509ms。
- 登录接口命中安全限流,429 是预期结果,不按吞吐能力评价。
- 考试开始接口最重,会随机抽题并写入考试记录;sqlite 下 50 并发出现 1 次磁盘 I/O 错误。生产必须用 MySQL 后复测。
- 当前容量建议仍按 MySQL 独立部署:应用 4C8G + MySQL 4C8G 更稳;预算紧张可应用 2C4G + MySQL 2C4G 起步。

## 9. 2026-06-29 真实 MySQL App 接口压测

### 9.1 条件
- MySQL: `192.168.22.10:3306`, MySQL 8.0.30, database `airacm`。
- 后端:当前代码单进程,端口 8786,`DB_TYPE=mysql`,`DB_POOL_MAX=20`。
- 数据量:临时插入 3000 条 `perf-` 题目用于压测;压测结束后已删除临时题目和考试尝试记录。
- 限流:测试服务调高 `THROTTLE_LIMIT`,避免测到限流。

### 9.2 结果
| App 接口 | 并发 | 成功率 | QPS | p99 |
|---|---:|---:|---:|---:|
| `GET /questions?usage=study&page=1&pageSize=20` | 50 | 1000/1000 | 194.7 | 373.5ms |
| `GET /questions?usage=study&page=10&pageSize=20` | 50 | 1000/1000 | 180.9 | 430.5ms |
| `GET /questions?usage=study&page=1&pageSize=20` | 100 | 1000/1000 | 165.2 | 846.6ms |
| `GET /questions?usage=study&page=10&pageSize=20` | 100 | 1000/1000 | 163.1 | 911.1ms |
| `GET /questions?usage=study&page=1&pageSize=20` | 200 | 1000/1000 | 199.1 | 1111.0ms |
| `GET /questions?usage=study&page=10&pageSize=20` | 200 | 1000/1000 | 182.5 | 1313.5ms |
| `GET /questions/:id/answer` | 200 | 2000/2000 | 1860.4 | 144.9ms |
| `POST /exams/start` | 50 | 200/200 | 43.2 | 1677.7ms |

### 9.3 调整
- 题目列表接口不再从数据库读取 `answer/analysis` 两个字段。
- 新增 `question(tenantId, usage, order)` 和 `question(tenantId, order)` 索引。
- `EXPLAIN` 已确认列表分页改走 `IDX_question_tenant_order`,不再 `Using filesort`。

### 9.4 服务器评估
- 4核 CPU、4GB 内存可以作为起步机型,但建议只承担应用服务或轻量应用+MySQL 同机部署。
- 如果 App 和 MySQL 同机,4C4G 在 200 个同时请求题目分页时已经接近上限,p99 约 1.1-1.3s;真实 200 在线用户通常低于这个压力,可以先用,但余量不大。
- 更稳妥生产配置:应用 4C4G/4C8G + MySQL 4C8G 分开部署;如果必须单机,建议 4C8G 起步,数据盘用 SSD/NVMe。

## 10. 2026-06-29 题目列表 SQL 优化复测

### 10.1 优化内容
- 题目列表不再使用 `findAndCount`,改为轻量分页查询 + 总数短 TTL 缓存。
- 总数缓存增加 in-flight 合并,避免缓存过期瞬间 200 个请求同时打 `COUNT(*)`。
- MySQL 下题目分页显式使用 `USE INDEX`,避免优化器误选 `tenantId+category` 后 `Using filesort`。
- 新增筛选分页索引:`question(tenantId, category, order)` 和 `question(tenantId, courseId, order)`。

### 10.2 真实 MySQL 结果
| App 接口 | 并发 | 成功率 | QPS | p99 |
|---|---:|---:|---:|---:|
| `GET /questions?usage=study&page=1&pageSize=20` | 50 | 1000/1000 | 814.7 | 167.4ms |
| `GET /questions?usage=study&page=10&pageSize=20` | 50 | 1000/1000 | 1279.0 | 48.6ms |
| `GET /questions?usage=study&category=M1&page=1&pageSize=20` | 50 | 1000/1000 | 1260.4 | 52.5ms |
| `GET /questions?usage=study&page=1&pageSize=20` | 100 | 1000/1000 | 1124.2 | 156.9ms |
| `GET /questions?usage=study&page=10&pageSize=20` | 100 | 1000/1000 | 1258.3 | 103.4ms |
| `GET /questions?usage=study&category=M1&page=1&pageSize=20` | 100 | 1000/1000 | 1072.1 | 143.9ms |
| `GET /questions?usage=study&page=1&pageSize=20` | 200 | 1000/1000 | 849.4 | 386.5ms |
| `GET /questions?usage=study&page=10&pageSize=20` | 200 | 1000/1000 | 1069.6 | 221.2ms |

### 10.3 结论
- 优化前 200 并发题目分页 p99 约 1.1-1.3s;优化后 p99 约 0.22-0.39s。
- 4C4G 服务器作为应用服务或轻量同机部署更可行;如果题库继续增长到数万题,仍建议 MySQL 独立 4C8G。
- 关键字搜索仍是潜在瓶颈,因为 `%关键词%` 无法使用普通 BTree 索引;后续题量大时应考虑 MySQL ngram fulltext 或搜索服务。
