const qrUrl = '/images/customer-service-qr.svg';
const advisorUrl = '/images/customer-service-advisor.png';

// 仅展示当前主推院校，其他学校统一引导用户咨询客服确认。
const undergraduateSchoolGroups = [
  {
    title: '主推院校',
    description: '具体报读条件和批次以客服确认为准。',
    schools: [
      {
        name: '西安交通大学',
        tag: '软科全国第10',
        reason: '985/211/双一流，陕西综合排名第一。',
      },
      {
        name: '西北工业大学',
        tag: '软科全国第23',
        reason: '985/211/双一流，工科实力突出。',
      },
      {
        name: '西北大学',
        tag: '软科全国第70',
        reason: '211/双一流，综合类底蕴强。',
      },
    ],
  },
];

const undergraduateSchoolCount = undergraduateSchoolGroups.reduce(
  (total, group) => total + group.schools.length,
  0,
);

const consultSteps = [
  {
    step: '1',
    title: '扫码添加',
    lines: ['添加客服微信'],
    tone: 'border-cyan-200 text-cyan-600',
    badge: 'bg-cyan-400',
    icon: (
      <svg viewBox="0 0 48 48" className="h-10 w-10" aria-hidden="true">
        <rect x="9" y="8" width="24" height="30" rx="4" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="M16 16h10M16 23h10M16 30h6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <circle cx="35" cy="34" r="8" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="m31 34 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    step: '2',
    title: '说明需求',
    lines: ['告诉客服', '你的意向院校/专业/层次', '获取更合适的建议'],
    tone: 'border-blue-200 text-blue-500',
    badge: 'bg-blue-400',
    icon: (
      <svg viewBox="0 0 48 48" className="h-10 w-10" aria-hidden="true">
        <path d="M12 14h24a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6h-8l-7 6v-6h-9a6 6 0 0 1-6-6v-8a6 6 0 0 1 6-6Z" fill="none" stroke="currentColor" strokeWidth="3" />
        <circle cx="18" cy="24" r="2" fill="currentColor" />
        <circle cx="24" cy="24" r="2" fill="currentColor" />
        <circle cx="30" cy="24" r="2" fill="currentColor" />
      </svg>
    ),
  },
  {
    step: '3',
    title: '领取资料',
    lines: ['流程与备考说明', '一对一发送给你'],
    tone: 'border-violet-200 text-violet-500',
    badge: 'bg-violet-500',
    icon: (
      <svg viewBox="0 0 48 48" className="h-10 w-10" aria-hidden="true">
        <path d="M13 7h17l8 8v26H13Z" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="M30 7v10h8M19 24h10M19 31h8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <circle cx="36" cy="36" r="8" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="M36 32v8M32 36h8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    ),
  },
];

export default function UpgradePage() {
  return (
    <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 sm:py-10">
      <a href="/" className="text-sm font-medium text-sky hover:underline">
        返回首页
      </a>

      <section className="relative mt-6 overflow-hidden rounded-[2rem] bg-white/88 shadow-sm ring-1 ring-white/80 backdrop-blur-xl">
        <div className="grid lg:min-h-[520px] lg:grid-cols-[minmax(0,1fr)_390px] xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="grid gap-6 p-6 sm:p-8 lg:min-h-[520px] lg:grid-cols-[minmax(0,1fr)_280px] lg:grid-rows-[1fr_auto] lg:p-10 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="min-w-0">
              <p className="inline-flex rounded-full bg-sky px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-sky/20">
                学历提升咨询
              </p>
              <h1 className="mt-8 max-w-2xl text-4xl font-semibold leading-tight text-ink sm:text-5xl lg:text-6xl">
                先扫码加客服
                <br />
                再确认报读方案
              </h1>
              <p className="mt-8 max-w-2xl text-base leading-8 text-ink/70">
                本科院校、报名条件、资料领取和学习安排均由客服一对一确认。
                <br className="hidden sm:block" />
                添加后直接说明你的意向学校或专业,减少来回沟通。
              </p>
            </div>

            <div className="pointer-events-none relative hidden min-w-0 items-end justify-center lg:flex">
              <div className="absolute -left-24 top-3 max-w-[180px] rotate-[-10deg] rounded-[55%] bg-sky/10 px-6 py-4 text-center text-base font-semibold leading-6 text-sky shadow-sm">
                有问题随时问,
                <br />
                我们一直都在!
              </div>
              <img src={advisorUrl} alt="" className="h-[420px] w-auto object-contain" />
            </div>

            <div className="grid gap-4 sm:grid-cols-3 lg:col-span-2">
              {consultSteps.map((item, index) => (
                <div
                  key={item.step}
                  className={`relative min-h-[128px] rounded-2xl border bg-white/90 p-4 shadow-sm backdrop-blur ${item.tone}`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${item.badge}`}>
                      <span className="text-white">{item.step}</span>
                    </span>
                    <div className="min-w-0">
                      <p className="text-lg font-semibold text-ink">{item.title}</p>
                      <div className="mt-2 space-y-1 text-sm leading-5 text-ink/58">
                        {item.lines.map((line) => (
                          <p key={line}>{line}</p>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="absolute bottom-3 right-4 opacity-70">{item.icon}</div>
                  {index < consultSteps.length - 1 && (
                    <span className="absolute -right-3 top-1/2 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-white text-xl font-semibold text-sky shadow-sm sm:flex">
                      ›
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <aside className="bg-[#2f8ee9] px-6 py-8 text-center text-white sm:px-8 lg:flex lg:flex-col lg:justify-center">
            <p className="text-base font-semibold text-white/85">当前最重要操作</p>
            <h2 className="mt-5 text-3xl font-semibold">扫码添加客服</h2>
            <div className="mx-auto mt-8 w-full max-w-[280px] rounded-[1.75rem] bg-white p-4 shadow-lg shadow-ink/20">
              <img src={qrUrl} alt="客服二维码" className="aspect-square w-full rounded-2xl bg-white" />
            </div>
            <p className="mx-auto mt-8 max-w-xs text-base font-medium leading-8 text-white/90">
              当前二维码为占位图,替换静态资源后页面自动显示真实二维码。
            </p>
          </aside>
        </div>
      </section>

      <section className="mt-6 rounded-[2rem] bg-white/78 p-6 shadow-sm ring-1 ring-white/80 backdrop-blur-xl sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-sky">本科院校</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-ink">可咨询学校名单</h2>
            <p className="mt-2 text-sm leading-6 text-ink/55">
              主推院校按综合排名、办学层次和专业匹配度优先排列,具体报读条件和批次以客服确认为准。
            </p>
          </div>
          <p className="rounded-full bg-mist px-4 py-2 text-sm font-medium text-ink/60">
            共 {undergraduateSchoolCount} 所
          </p>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          {undergraduateSchoolGroups.map((group) => (
            <div key={group.title} className="overflow-hidden rounded-2xl border border-ink/10 bg-white/70">
              <div className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-ink">{group.title}</h3>
                    <p className="mt-1 text-xs leading-5 text-ink/48">{group.description}</p>
                  </div>
                  <span className="text-xs font-medium text-ink/45">{group.schools.length} 所</span>
                </div>
                <div className="mt-4 grid gap-3 xl:grid-cols-2">
                  {group.schools.map((school) => (
                    <div
                      key={school.name}
                      className="rounded-2xl bg-white px-4 py-3 text-left shadow-sm ring-1 ring-ink/[0.08]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold text-ink">{school.name}</p>
                        <span className="shrink-0 rounded-full bg-sky/[0.08] px-2 py-1 text-[11px] font-semibold text-sky">
                          {school.tag}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-ink/55">{school.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-5 text-center text-sm font-medium text-sky">更多学校请咨询客服</p>
      </section>
    </main>
  );
}
