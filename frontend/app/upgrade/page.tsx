const qrUrl = '/images/customer-service-qr.svg';

export default function UpgradePage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <a href="/" className="text-sm font-medium text-sky hover:underline">
        返回首页
      </a>

      <section className="mt-8 grid gap-6 md:grid-cols-[1fr_320px]">
        <div className="card">
          <p className="text-sm font-medium text-sky">专升本咨询</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            咨询请添加客服
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-ink/60">
            扫描右侧二维码添加客服,了解报名条件、课程安排、资料领取和后续服务。
          </p>
          <div className="mt-8 grid gap-3 text-sm text-ink/65 sm:grid-cols-3">
            <div className="rounded-2xl bg-white/50 p-4 ring-1 ring-white/70">
              <p className="font-semibold text-ink">报读咨询</p>
              <p className="mt-2">确认适合的专业与层次</p>
            </div>
            <div className="rounded-2xl bg-white/50 p-4 ring-1 ring-white/70">
              <p className="font-semibold text-ink">资料领取</p>
              <p className="mt-2">获取备考资料与流程说明</p>
            </div>
            <div className="rounded-2xl bg-white/50 p-4 ring-1 ring-white/70">
              <p className="font-semibold text-ink">学习安排</p>
              <p className="mt-2">了解课程节奏和服务方式</p>
            </div>
          </div>
        </div>

        <aside className="card flex flex-col items-center justify-center text-center">
          <img
            src={qrUrl}
            alt="客服二维码"
            className="h-56 w-56 rounded-2xl bg-white p-3 ring-1 ring-ink/10"
          />
          <p className="mt-5 text-base font-semibold text-ink">扫码添加客服</p>
          <p className="mt-2 text-sm leading-6 text-ink/55">
            当前二维码为占位图,替换静态资源后页面自动显示真实二维码。
          </p>
        </aside>
      </section>
    </main>
  );
}
