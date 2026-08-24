# 学员端 uni-app 迁移规划

## 结论

当前选择 uni-app 更合适:学员端要同时覆盖 Web 页面、Android App,后续还有小程序可能性。管理端继续保留 Next.js,因为业务管理员和 admin 管理员上传题库、上传 APK、配置业务数据更适合桌面 Web。

## 工程边界

- `apps/student-uni`: 学员端,用 uni-app 维护 H5、Android App、小程序候选端。
- `frontend`: 管理端和过渡期 Web 页面,继续承载 APK 静态下载文件。
- `backend-pre`: 统一 API,学员端和管理端共用。

## 当前信息架构

### Web 登录后首页

- 普通学员:只显示 `交流`、`下载 App`、`专升本`。
- 业务管理员 / 超级管理员:显示 `专题学习`、`在线考试`、`考试回顾`、`错题本`、`交流`、`下载 App`、`专升本`、`管理后台`。
- 设计原则:普通学员在 Web 端保持轻入口,引导下载 App;管理员在 Web 端也能完整验收题库和考试流程。

### Android App 首页

- 显示 `专题学习`、`在线考试`、`考试回顾`、`错题本`、`交流`、`专升本`。
- 不显示 `下载 App`,避免 App 内再下载 App 的循环入口。
- App 端使用 Android 原生 `FLAG_SECURE`,阻止系统截图、录屏和最近任务缩略图泄露学习/考试内容。

## 当前功能闭环

1. 登录:支持手机号密码、卡密登录和资料补全。
2. 学习:M1 先选章节再学习,7 章分别保存续学位置;其他科目保留分页、搜索和跳转。题库发布切换 generation 后,客户端重新加载章节和有效题目。
3. 题目图片:支持 WPS Excel 内嵌图片,导入后学习、考试、考试回顾、错题本均展示。
4. 评论:学习页、考试复盘、错题本按题目展示评论;App 学习页和错题本也支持查看与发表。
5. 考试:按科目组卷、交卷判分、错题自动进入错题本。
6. 专升本:打开后展示“咨询请添加客服”和客服二维码。
7. App 下载:Web 下载页与管理后台 APK 上传共用固定路径 `/downloads/app/airacm-android.apk`。

## 题库导入流程

| 文件类型 | 示例 | 导入科目 | 说明 |
|---|---|---|---|
| 普通 Excel | `3257题目.xlsx` | `M9 航空英语` | 表头驱动解析,不强依赖列顺序 |
| M1 整包 Excel | `docs/M1 20260803.xlsx` | `M1 航空概论` | 管理后台预检固定 7 个工作表、1698 题和 23 个图片单元格,输入确认语后原子发布;普通导入入口拒绝 M1 |
| PDF | `民用航空器维修人员执照英语参考试题M9.pdf` | `M9 new` | 作为新 M9 版本导入,用于和旧 M9 对比 |

## 打包与测试流程

1. Web 构建:
   ```powershell
   npm --prefix frontend run build
   ```
2. uni-app H5 构建:
   ```powershell
   npm --prefix apps/student-uni run build:h5 -- --base ./
   ```
3. 微信小程序构建与禁用内容扫描:
   ```powershell
   npm --prefix apps/student-uni run build:mp-weixin
   ```
4. Android APK 打包:
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\package-student-apk.ps1
   ```
5. 输出位置:
   - `D:\AndroidLab\apk\airacm-android.apk`
   - `frontend/public/downloads/app/airacm-android.apk`
6. 模拟器安装验证:
   ```powershell
   D:\AndroidLab\android-sdk\platform-tools\adb.exe -s emulator-5554 install -r D:\AndroidLab\apk\airacm-android.apk
   D:\AndroidLab\android-sdk\platform-tools\adb.exe -s emulator-5554 shell am start -n com.airacm.student/.MainActivity
   ```

## 后续注意事项

1. 正式包需要把 `MainActivity.java` 中的 `apiBase` 改为生产 HTTPS 域名,不要使用内网测试 IP。
2. 后续每次 APK 升级保持固定下载文件名 `airacm-android.apk`,同时离线保留版本文件便于回滚。
3. 若正式分发,需要补充正式签名证书、版本号递增、隐私合规文案和更新提示策略。
