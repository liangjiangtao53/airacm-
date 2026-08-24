# airacm 学员端 uni-app

这是学员端工程,同一套 Vue 3/uni-app 代码覆盖 H5、Android App 和微信小程序。

当前范围:

- 登录:卡密、手机号密码、微信快捷登录与账号绑定,未使用卡密可补全手机号和昵称。
- 学习:M1 按章节展示并独立续学;其他科目保留分页学习,题库发布更新时自动恢复到有效范围。
- 考试:单科组卷、草稿恢复、交卷、回顾和错题本。
- H5 / Android:保留交流、评论、下载 App(H5)和学历提升。
- 微信小程序:保留学习、考试、回顾、错题本和学历提升;个人主体提审包不编译论坛、评论和下载 App 入口。
- 学历提升:从后端读取可热替换的客服二维码。

## 本地运行

```bash
npm --prefix apps/student-uni install
Copy-Item apps/student-uni/.env.example apps/student-uni/.env.local
npm --prefix apps/student-uni run dev:h5
```

默认接口:

- 后端 API: `http://127.0.0.1:8770`
- APK 下载: `http://127.0.0.1:3000/downloads/app/airacm-android.apk`

## 构建

```bash
npm --prefix apps/student-uni run build:h5
npm --prefix apps/student-uni run build:app
npm --prefix apps/student-uni run build:mp-weixin
```

生产构建必须显式配置 API 地址;小程序构建还必须提供 AppID,构建脚本会检查产物不包含 localhost、AppSecret 或禁用的 UGC 标记。

Android APK 使用仓库脚本打包:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\package-student-apk.ps1
```

正式 APK 输出文件固定放到:

```text
frontend/public/downloads/app/airacm-android.apk
```

这样学生访问 `/download-app` 或 uni-app H5 的下载页时,链接都不需要改。
