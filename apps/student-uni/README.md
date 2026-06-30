# airacm 学员端 uni-app

这是学员端的新工程,目标是同一套 Vue/uni-app 代码逐步覆盖 H5、Android App,后续也能扩展到小程序。

当前范围:

- 登录: 卡密登录、手机号密码登录、补全手机号和昵称。
- 首页: 只保留交流、下载 App、学历提升三个入口。
- 交流: 主题筛选、发帖、帖子列表。
- 下载 App: 指向 Next 前端静态 APK 地址。
- 学历提升: 展示客服二维码。

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
```

`build:app` 生成 App 端资源。Android APK 建议先用 HBuilderX 云打包或本地 App 打包,输出文件固定放到:

```text
frontend/public/downloads/app/airacm-android.apk
```

这样学生访问 `/download-app` 或 uni-app H5 的下载页时,链接都不需要改。
