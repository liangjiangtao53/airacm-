// 进程内 TTL 缓存:单实例足够。多实例水平扩展时换 Redis(ioredis),
// 接口 cacheGet/cacheSet 不变,业务无感(见 SYSTEM_DESIGN 缓存可降级设计)。
// now 由调用方传入(避免热路径重复取时钟,也便于测试注入)。
interface Entry<T> {
  val: T;
  expiresAt: number; // epoch ms
}

const store = new Map<string, Entry<unknown>>();

export function cacheGet<T>(key: string, now: number): T | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  if (now > e.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return e.val as T;
}

export function cacheSet<T>(key: string, val: T, ttlMs: number, now: number): void {
  store.set(key, { val, expiresAt: now + ttlMs });
}

export function cacheInvalidate(key: string): void {
  store.delete(key);
}
