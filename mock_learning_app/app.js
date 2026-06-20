const STORAGE_KEY = "airacm_learning_mock_v1";

const modules = {
  reference: [
    { id: "ste", name: "STE书写中英", initials: "STE", courseId: 4, active: true },
    { id: "poh", name: "飞行员操作手册规范", initials: "POH", courseId: 32, active: true },
    { id: "spec", name: "资料规范", initials: "SPEC", courseId: 51, active: true },
    { id: "cap", name: "CAP中英对照", initials: "CAP", courseId: 27, active: true },
    { id: "todo-ref-1", name: "待开启", initials: "...", active: false },
    { id: "todo-ref-2", name: "待开启", initials: "...", active: false }
  ],
  practice: [
    { id: "words", name: "背单词", initials: "ABC", active: true, practice: true },
    { id: "sentence", name: "单句", initials: "S", active: true, practice: true },
    { id: "todo-practice", name: "待开启", initials: "...", active: false },
    { id: "m9", name: "M9综合阅读", initials: "M9", active: true, practice: true }
  ]
};

const courses = [
  {
    id: 4,
    title: "ASD-STE100（简化技术英语）规则部分",
    category: "英语学习",
    sourceUrl: "https://www.airacm.com/course-4.html",
    paymentUrl: "video-pay-4.html",
    cartAction: "plugin.php?id=keke_video_base:ajax",
    price: 9,
    originalPrice: 18,
    chapterCount: 9,
    lessonCount: 58,
    summary: "复原自 course-4.html。页面显示学习价格、原价、立即购买、加入购物车和付费课时。",
    lessons: buildLessons(4, 9, 58, "STE规则", ["free", "paid", "paid", "password", "vip"])
  },
  {
    id: 32,
    title: "GAMA SPECIFICATION NO. 1：SPECIFICATION FOR PILOT'S OPERATING HANDBOOK 飞行员操作手册规范",
    category: "英语学习",
    sourceUrl: "https://www.airacm.com/course-32.html",
    paymentUrl: "video-pay-32.html",
    cartAction: "plugin.php?id=keke_video_base:ajax",
    price: 18,
    originalPrice: 36,
    chapterCount: 5,
    lessonCount: 98,
    summary: "复原自 course-32.html。课程购买入口是 video-pay-32.html，购物车走 keke_video_base 插件。",
    lessons: buildLessons(32, 5, 20, "POH规范", ["free", "paid", "paid", "paid", "vip"])
  },
  {
    id: 27,
    title: "GAMA Specification No.7：持续适航方案规范",
    category: "英语学习",
    sourceUrl: "https://www.airacm.com/course-27.html",
    paymentUrl: "video-pay-27.html",
    cartAction: "plugin.php?id=keke_video_base:ajax",
    price: 5,
    originalPrice: 10,
    chapterCount: 3,
    lessonCount: 14,
    summary: "来自课程页推荐区的同类课程，价格按已观察推荐信息复原。",
    lessons: buildLessons(27, 3, 14, "CAP规范", ["free", "paid", "paid", "vip"])
  },
  {
    id: 51,
    title: "GAMA Specification No.2：维修资料规范",
    category: "英语学习",
    sourceUrl: "https://www.airacm.com/course-51.html",
    paymentUrl: "video-pay-51.html",
    cartAction: "plugin.php?id=keke_video_base:ajax",
    price: 15,
    originalPrice: 30,
    chapterCount: 5,
    lessonCount: 98,
    summary: "来自课程页推荐区的同类课程，作为资料规范入口的 mock 课程。",
    lessons: buildLessons(51, 5, 24, "维修资料", ["free", "paid", "password", "paid", "vip"])
  }
];

const payTypes = [
  { id: "wechat", label: "微信" },
  { id: "alipay", label: "支付宝" },
  { id: "wallet", label: "钱包" }
];

let state = loadState();
let activeView = "learning";
let activeFilter = "all";
let activeCourseId = null;
let selectedPayType = "wechat";

const els = {
  cartCount: document.getElementById("cartCount"),
  userStatus: document.getElementById("userStatus"),
  loginButton: document.getElementById("loginButton"),
  ownedCount: document.getElementById("ownedCount"),
  pendingCount: document.getElementById("pendingCount"),
  referenceModules: document.getElementById("referenceModules"),
  practiceModules: document.getElementById("practiceModules"),
  courseList: document.getElementById("courseList"),
  cartList: document.getElementById("cartList"),
  ordersList: document.getElementById("ordersList"),
  mineList: document.getElementById("mineList"),
  clearCartButton: document.getElementById("clearCartButton"),
  detailDrawer: document.getElementById("detailDrawer"),
  detailCategory: document.getElementById("detailCategory"),
  detailTitle: document.getElementById("detailTitle"),
  detailBody: document.getElementById("detailBody"),
  modal: document.getElementById("modal"),
  modalTitle: document.getElementById("modalTitle"),
  modalBody: document.getElementById("modalBody"),
  modalActions: document.getElementById("modalActions"),
  toast: document.getElementById("toast")
};

function buildLessons(courseId, chapterCount, total, prefix, accessCycle) {
  const lessons = [];
  for (let index = 1; index <= total; index += 1) {
    const chapter = Math.min(chapterCount, Math.ceil(index / Math.ceil(total / chapterCount)));
    const access = index === 1 ? "free" : accessCycle[index % accessCycle.length];
    lessons.push({
      id: courseId * 1000 + index,
      courseId,
      chapterId: courseId * 100 + chapter,
      chapterTitle: `第 ${chapter} 章`,
      title: `${prefix}课时 ${String(index).padStart(2, "0")}`,
      type: index % 4 === 0 ? "图文" : "视频",
      access
    });
  }
  return lessons;
}

function defaultState() {
  return {
    user: null,
    cart: [],
    orders: [],
    entitlements: [],
    progress: {}
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function money(value) {
  return `¥${Number(value).toFixed(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function orderId(courseId) {
  const time = new Date();
  const stamp = [
    time.getFullYear(),
    String(time.getMonth() + 1).padStart(2, "0"),
    String(time.getDate()).padStart(2, "0"),
    String(time.getHours()).padStart(2, "0"),
    String(time.getMinutes()).padStart(2, "0"),
    String(time.getSeconds()).padStart(2, "0")
  ].join("");
  return `MOCK-${stamp}-${courseId}-${Math.floor(Math.random() * 900 + 100)}`;
}

function getCourse(courseId) {
  return courses.find(course => course.id === Number(courseId));
}

function isLoggedIn() {
  return Boolean(state.user && state.user.token);
}

function ownsCourse(courseId) {
  if (!isLoggedIn()) return false;
  return state.entitlements.some(item => item.userId === state.user.id && item.courseId === Number(courseId));
}

function pendingOrders() {
  return state.orders.filter(order => order.status === "pending");
}

function statusLabel(status) {
  const map = {
    pending: "待支付",
    paid: "已支付",
    failed: "支付失败",
    cancelled: "已取消"
  };
  return map[status] || status;
}

function statusBadgeClass(status) {
  if (status === "paid") return "ok";
  if (status === "failed" || status === "cancelled") return "danger";
  return "warning";
}

function lessonAccessLabel(access) {
  const map = {
    free: "试听",
    paid: "付费",
    vip: "会员",
    password: "密码"
  };
  return map[access] || access;
}

function canOpenLesson(courseId, lesson) {
  if (lesson.access === "free") return true;
  if (lesson.access === "paid") return ownsCourse(courseId);
  if (lesson.access === "vip") return ownsCourse(courseId);
  if (lesson.access === "password") return isLoggedIn();
  return false;
}

function render() {
  renderShell();
  renderModules();
  renderCourses();
  renderCart();
  renderOrders();
  renderMine();
  if (activeCourseId) renderCourseDetail(activeCourseId);
}

function renderShell() {
  els.userStatus.textContent = isLoggedIn() ? state.user.nickname : "未登录";
  els.loginButton.textContent = isLoggedIn() ? "退出" : "模拟登录";
  els.cartCount.textContent = state.cart.length;
  els.ownedCount.textContent = state.entitlements.length;
  els.pendingCount.textContent = pendingOrders().length;
}

function renderModules() {
  els.referenceModules.innerHTML = modules.reference.map(moduleTile).join("");
  els.practiceModules.innerHTML = modules.practice.map(moduleTile).join("");
}

function moduleTile(item) {
  const active = item.active ? "active" : "";
  const target = item.courseId ? `data-course-id="${item.courseId}"` : "";
  return `
    <button class="module-tile ${active}" ${target} ${item.active ? "" : "disabled"}>
      <span class="module-icon">${item.initials}</span>
      <span class="module-name">${item.name}</span>
    </button>
  `;
}

function renderCourses() {
  const filtered = courses.filter(course => {
    if (activeFilter === "owned") return ownsCourse(course.id);
    if (activeFilter === "free") return course.lessons.some(lesson => lesson.access === "free");
    return true;
  });
  els.courseList.innerHTML = filtered.map(course => {
    const owned = ownsCourse(course.id);
    const inCart = state.cart.includes(course.id);
    const pending = state.orders.some(order => order.courseId === course.id && order.status === "pending");
    return `
      <article class="card">
        <div class="card-top">
          <div>
            <h3>${course.title}</h3>
            <div class="card-meta">${course.chapterCount} 章节 / ${course.lessonCount} 课时</div>
          </div>
          <div>
            <div class="price">${money(course.price)}</div>
            <div class="original-price">${money(course.originalPrice)}</div>
          </div>
        </div>
        <div class="badge-row">
          <span class="badge">${course.category}</span>
          <span class="badge ${owned ? "ok" : ""}">${owned ? "已开通" : "未购买"}</span>
          ${pending ? '<span class="badge warning">待支付订单</span>' : ""}
        </div>
        <p class="course-summary">${course.summary}</p>
        <div class="card-actions">
          <button class="button primary" data-buy-course="${course.id}" ${owned ? "disabled" : ""}>立即购买</button>
          <button class="button" data-cart-course="${course.id}" ${owned || inCart ? "disabled" : ""}>${inCart ? "已在购物车" : "加入购物车"}</button>
          <button class="button ghost" data-detail-course="${course.id}">详情</button>
        </div>
      </article>
    `;
  }).join("") || `<div class="empty">当前筛选没有课程。</div>`;
}

function renderCart() {
  if (!state.cart.length) {
    els.cartList.innerHTML = `<div class="empty">购物车为空。</div>`;
    return;
  }
  const total = state.cart.reduce((sum, id) => sum + getCourse(id).price, 0);
  els.cartList.innerHTML = state.cart.map(courseId => {
    const course = getCourse(courseId);
    return `
      <article class="stack-card">
        <div>
          <h3>${course.title}</h3>
          <div class="card-meta">${course.paymentUrl} / ${course.cartAction}</div>
          <div class="badge-row">
            <span class="badge">${course.chapterCount} 章节</span>
            <span class="badge">${course.lessonCount} 课时</span>
          </div>
        </div>
        <div class="row-actions">
          <strong class="price">${money(course.price)}</strong>
          <button class="button primary" data-checkout-course="${course.id}">结算</button>
          <button class="button danger" data-remove-cart="${course.id}">移除</button>
        </div>
      </article>
    `;
  }).join("") + `
    <article class="stack-card">
      <div>
        <h3>合计</h3>
        <div class="card-meta">本地 mock 购物车，不提交到真实服务端。</div>
      </div>
      <div class="row-actions">
        <strong class="price">${money(total)}</strong>
        <button class="button primary" data-checkout-all>全部结算</button>
      </div>
    </article>
  `;
}

function renderOrders() {
  if (!state.orders.length) {
    els.ordersList.innerHTML = `<div class="empty">还没有订单。</div>`;
    return;
  }
  els.ordersList.innerHTML = state.orders.slice().reverse().map(order => {
    const course = getCourse(order.courseId);
    return `
      <article class="stack-card">
        <div>
          <h3>${course.title}</h3>
          <div class="card-meta">${order.id} / ${new Date(order.createdAt).toLocaleString()}</div>
          <div class="badge-row">
            <span class="badge ${statusBadgeClass(order.status)}">${statusLabel(order.status)}</span>
            <span class="badge">${payTypes.find(item => item.id === order.payType)?.label || "未选择"}</span>
            <span class="badge">业务类型 course</span>
          </div>
        </div>
        <div class="row-actions">
          <strong class="price">${money(order.amount)}</strong>
          ${order.status === "pending" ? `<button class="button primary" data-pay-order="${order.id}">继续支付</button>` : ""}
          ${order.status === "pending" ? `<button class="button danger" data-cancel-order="${order.id}">取消</button>` : ""}
          <button class="button ghost" data-detail-course="${course.id}">课程</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderMine() {
  if (!isLoggedIn()) {
    els.mineList.innerHTML = `<div class="empty">登录后查看已购买课程和学习进度。</div>`;
    return;
  }
  const owned = state.entitlements.filter(item => item.userId === state.user.id);
  if (!owned.length) {
    els.mineList.innerHTML = `<div class="empty">还没有已购买课程。可以先购买并模拟支付成功。</div>`;
    return;
  }
  els.mineList.innerHTML = owned.map(item => {
    const course = getCourse(item.courseId);
    const completed = course.lessons.filter(lesson => state.progress[lesson.id] === "done").length;
    return `
      <article class="stack-card">
        <div>
          <h3>${course.title}</h3>
          <div class="card-meta">权益来自订单 ${item.orderId}</div>
          <div class="badge-row">
            <span class="badge ok">已开通</span>
            <span class="badge">${completed}/${course.lessons.length} 已学</span>
          </div>
        </div>
        <div class="row-actions">
          <button class="button primary" data-detail-course="${course.id}">继续学习</button>
        </div>
      </article>
    `;
  }).join("");
}

function openCourseDetail(courseId) {
  activeCourseId = Number(courseId);
  renderCourseDetail(activeCourseId);
  els.detailDrawer.classList.add("open");
  els.detailDrawer.setAttribute("aria-hidden", "false");
}

function closeCourseDetail() {
  activeCourseId = null;
  els.detailDrawer.classList.remove("open");
  els.detailDrawer.setAttribute("aria-hidden", "true");
}

function renderCourseDetail(courseId) {
  const course = getCourse(courseId);
  if (!course) return;
  const owned = ownsCourse(course.id);
  els.detailCategory.textContent = course.category;
  els.detailTitle.textContent = course.title;
  const lessons = course.lessons.slice(0, 18);
  els.detailBody.innerHTML = `
    <div class="detail-stats">
      <div class="stat-box"><strong>${money(course.price)}</strong><span class="metric-label">学习价格</span></div>
      <div class="stat-box"><strong>${money(course.originalPrice)}</strong><span class="metric-label">原价</span></div>
      <div class="stat-box"><strong>${course.chapterCount}</strong><span class="metric-label">章节</span></div>
      <div class="stat-box"><strong>${course.lessonCount}</strong><span class="metric-label">课时</span></div>
    </div>
    <p class="course-summary">${course.summary}</p>
    <div class="badge-row">
      <span class="badge">来源：${course.sourceUrl}</span>
      <span class="badge">购买：${course.paymentUrl}</span>
      <span class="badge ${owned ? "ok" : "warning"}">${owned ? "已开通权益" : "未开通权益"}</span>
    </div>
    <div class="drawer-actions">
      <button class="button primary" data-buy-course="${course.id}" ${owned ? "disabled" : ""}>立即购买</button>
      <button class="button" data-cart-course="${course.id}" ${owned || state.cart.includes(course.id) ? "disabled" : ""}>加入购物车</button>
      <button class="button ghost" data-source-url="${course.sourceUrl}">打开原课程页</button>
    </div>
    <h2 style="margin-top: 22px;">课时</h2>
    <div class="lesson-list">
      ${lessons.map((lesson, index) => lessonRow(course, lesson, index)).join("")}
    </div>
    ${course.lessons.length > lessons.length ? `<p class="course-summary">第一版展示前 ${lessons.length} 个课时，其余课时按同一访问规则处理。</p>` : ""}
  `;
}

function lessonRow(course, lesson, index) {
  const canOpen = canOpenLesson(course.id, lesson);
  const done = state.progress[lesson.id] === "done";
  return `
    <div class="lesson-row">
      <span class="lesson-index">${index + 1}</span>
      <div>
        <div class="lesson-title">${lesson.chapterTitle} / ${lesson.title}</div>
        <div class="lesson-meta">${lesson.type} · ${lessonAccessLabel(lesson.access)}</div>
      </div>
      <div class="row-actions">
        ${done ? '<span class="badge ok">已学</span>' : ""}
        <button class="button small" data-open-lesson="${lesson.id}" data-course-id="${course.id}" ${canOpen ? "" : "disabled"}>${canOpen ? "学习" : "受限"}</button>
      </div>
    </div>
  `;
}

function requireLogin(actionName) {
  if (isLoggedIn()) return true;
  showModal("需要登录", `<p>${actionName} 需要登录。这里不会连接真实账号，只创建本地 mock token。</p>`, [
    { label: "取消", className: "button", action: closeModal },
    { label: "模拟登录", className: "button primary", action: () => { mockLogin(); closeModal(); } }
  ]);
  return false;
}

function mockLogin() {
  state.user = {
    id: "mock-user-001",
    nickname: "测试机务",
    token: `mock-token-${Date.now()}`
  };
  saveState();
  render();
  toast("已模拟登录");
}

function logout() {
  state.user = null;
  saveState();
  render();
  toast("已退出 mock 登录");
}

function addToCart(courseId) {
  if (!requireLogin("加入购物车")) return;
  const id = Number(courseId);
  if (ownsCourse(id)) {
    toast("该课程已开通");
    return;
  }
  if (!state.cart.includes(id)) {
    state.cart.push(id);
    saveState();
  }
  render();
  toast("已加入购物车");
}

function removeFromCart(courseId) {
  const id = Number(courseId);
  state.cart = state.cart.filter(item => item !== id);
  saveState();
  render();
}

function clearCart() {
  state.cart = [];
  saveState();
  render();
  toast("购物车已清空");
}

function buyNow(courseId) {
  if (!requireLogin("立即购买")) return;
  const course = getCourse(courseId);
  if (ownsCourse(course.id)) {
    toast("该课程已开通");
    return;
  }
  const existing = state.orders.find(order => order.courseId === course.id && order.status === "pending");
  const order = existing || createOrder(course.id, selectedPayType);
  state.cart = state.cart.filter(id => id !== course.id);
  saveState();
  render();
  openPayModal(order.id);
}

function checkoutAll() {
  if (!requireLogin("结算")) return;
  if (!state.cart.length) return;
  const orderIds = [];
  state.cart.forEach(courseId => {
    if (!ownsCourse(courseId)) {
      orderIds.push(createOrder(courseId, selectedPayType).id);
    }
  });
  state.cart = [];
  saveState();
  render();
  if (orderIds.length) openPayModal(orderIds[0]);
}

function createOrder(courseId, payType) {
  const course = getCourse(courseId);
  const order = {
    id: orderId(course.id),
    unionOrderNum: `UNION-${Date.now()}`,
    userId: state.user.id,
    courseId: course.id,
    amount: course.price,
    status: "pending",
    payType,
    bizType: "course",
    createdAt: nowIso(),
    paidAt: null
  };
  state.orders.push(order);
  state.cart = state.cart.filter(id => id !== course.id);
  return order;
}

function openPayModal(orderId) {
  const order = state.orders.find(item => item.id === orderId);
  if (!order) return;
  const course = getCourse(order.courseId);
  selectedPayType = order.payType || "wechat";
  showModal("模拟支付", `
    <p>${course.title}</p>
    <div class="badge-row" style="margin-top: 12px;">
      <span class="badge">订单号：${order.id}</span>
      <span class="badge">金额：${money(order.amount)}</span>
      <span class="badge">状态：${statusLabel(order.status)}</span>
    </div>
    <div class="pay-methods">
      ${payTypes.map(item => `<button class="pay-method ${item.id === selectedPayType ? "active" : ""}" data-pay-type="${item.id}">${item.label}</button>`).join("")}
    </div>
  `, [
    { label: "取消", className: "button", action: closeModal },
    { label: "模拟失败", className: "button danger", action: () => failOrder(order.id) },
    { label: "模拟支付成功", className: "button primary", action: () => payOrder(order.id) }
  ]);
}

function payOrder(orderId) {
  const order = state.orders.find(item => item.id === orderId);
  if (!order || order.status !== "pending") return;
  order.status = "paid";
  order.payType = selectedPayType;
  order.paidAt = nowIso();
  const exists = state.entitlements.some(item => item.courseId === order.courseId && item.userId === order.userId);
  if (!exists) {
    state.entitlements.push({
      id: `ENT-${Date.now()}-${order.courseId}`,
      userId: order.userId,
      courseId: order.courseId,
      orderId: order.id,
      startsAt: nowIso(),
      expiresAt: null
    });
  }
  saveState();
  closeModal();
  render();
  toast("模拟支付成功，权益已开通");
}

function failOrder(orderId) {
  const order = state.orders.find(item => item.id === orderId);
  if (!order || order.status !== "pending") return;
  order.status = "failed";
  order.payType = selectedPayType;
  saveState();
  closeModal();
  render();
  toast("已模拟支付失败");
}

function cancelOrder(orderId) {
  const order = state.orders.find(item => item.id === orderId);
  if (!order || order.status !== "pending") return;
  order.status = "cancelled";
  saveState();
  render();
  toast("订单已取消");
}

function openLesson(courseId, lessonId) {
  const course = getCourse(courseId);
  const lesson = course.lessons.find(item => item.id === Number(lessonId));
  if (!lesson) return;
  if (!canOpenLesson(course.id, lesson)) {
    toast("当前课时需要购买、会员或课程密码");
    return;
  }
  state.progress[lesson.id] = "done";
  saveState();
  render();
  toast(`已学习：${lesson.title}`);
}

function showModal(title, bodyHtml, actions) {
  els.modalTitle.textContent = title;
  els.modalBody.innerHTML = bodyHtml;
  els.modalActions.innerHTML = "";
  actions.forEach((action, index) => {
    const button = document.createElement("button");
    button.className = action.className;
    button.textContent = action.label;
    button.dataset.modalAction = String(index);
    button.addEventListener("click", action.action);
    els.modalActions.appendChild(button);
  });
  els.modal.classList.add("open");
  els.modal.setAttribute("aria-hidden", "false");
}

function closeModal() {
  els.modal.classList.remove("open");
  els.modal.setAttribute("aria-hidden", "true");
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 2200);
}

function switchView(viewName) {
  activeView = viewName;
  document.querySelectorAll(".view").forEach(view => view.classList.remove("active"));
  document.getElementById(`${viewName}View`).classList.add("active");
  document.querySelectorAll(".tab-button").forEach(button => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
}

document.addEventListener("click", event => {
  const target = event.target.closest("button, [data-close-drawer], [data-close-modal]");
  if (!target) return;

  if (target.dataset.view) switchView(target.dataset.view);
  if (target.dataset.filter) {
    activeFilter = target.dataset.filter;
    document.querySelectorAll(".segment").forEach(button => {
      button.classList.toggle("active", button.dataset.filter === activeFilter);
    });
    renderCourses();
  }
  if (target.dataset.courseId && target.classList.contains("module-tile")) openCourseDetail(target.dataset.courseId);
  if (target.dataset.detailCourse) openCourseDetail(target.dataset.detailCourse);
  if (target.dataset.cartCourse) addToCart(target.dataset.cartCourse);
  if (target.dataset.buyCourse) buyNow(target.dataset.buyCourse);
  if (target.dataset.removeCart) removeFromCart(target.dataset.removeCart);
  if (target.dataset.checkoutCourse) buyNow(target.dataset.checkoutCourse);
  if (target.dataset.checkoutAll !== undefined) checkoutAll();
  if (target.dataset.payOrder) openPayModal(target.dataset.payOrder);
  if (target.dataset.cancelOrder) cancelOrder(target.dataset.cancelOrder);
  if (target.dataset.openLesson) openLesson(target.dataset.courseId, target.dataset.openLesson);
  if (target.dataset.payType) {
    selectedPayType = target.dataset.payType;
    document.querySelectorAll(".pay-method").forEach(button => {
      button.classList.toggle("active", button.dataset.payType === selectedPayType);
    });
  }
  if (target.dataset.sourceUrl) window.open(target.dataset.sourceUrl, "_blank", "noopener");
  if (target.dataset.closeDrawer !== undefined) closeCourseDetail();
  if (target.dataset.closeModal !== undefined) closeModal();
});

els.loginButton.addEventListener("click", () => {
  if (isLoggedIn()) logout();
  else mockLogin();
});

els.clearCartButton.addEventListener("click", clearCart);

render();
