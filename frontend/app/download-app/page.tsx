import { existsSync } from 'fs';
import { join } from 'path';

export const dynamic = 'force-dynamic';

const apkUrl = '/downloads/app/airacm-android.apk';
const wechatQrUrl = '/images/qr/download-app-wechat.png';

export default function DownloadAppPage() {
  const apkExists = existsSync(join(process.cwd(), 'public', 'downloads', 'app', 'airacm-android.apk'));

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <a href="/" className="text-sm font-medium text-sky hover:underline">
        返回首页
      </a>

      <section className="card mt-8">
        <p className="text-sm font-medium text-sky">App 下载</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          安卓安装包
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-ink/60">
          安装包上传后,学员可在这里下载。当前建议先固定文件名,后续更新版本时直接替换文件,
          页面链接不用改。
        </p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a
            href={apkUrl}
            download
            className="inline-flex min-h-11 items-center rounded-full bg-steel px-6 text-sm font-semibold text-white transition hover:bg-ink focus:outline-none focus:ring-2 focus:ring-sky focus:ring-offset-2"
          >
            下载安卓版 APK
          </a>
          {!apkExists && (
            <span className="inline-flex min-h-11 items-center rounded-full bg-ink/10 px-4 text-sm font-semibold text-ink/45">
              安装包待上传
            </span>
          )}
        </div>
        <p className="mt-3 text-xs text-ink/45">
          安装包由管理后台上传并覆盖固定文件名，刷新本页即可下载最新版。
        </p>

        <div className="mt-8 max-w-md">
          <p className="text-lg font-semibold text-ink">添加微信，获取：</p>
          <p className="mt-2 text-base leading-7 text-ink/70">
            课程学习安排｜答疑支持｜后续服务对接
          </p>
          <img
            src={wechatQrUrl}
            alt="学习咨询微信二维码"
            className="mt-5 aspect-square w-full rounded-2xl bg-white object-contain p-3 shadow-sm ring-1 ring-ink/10"
          />
        </div>
      </section>
    </main>
  );
}
