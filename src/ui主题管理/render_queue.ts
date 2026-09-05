/**
 * 错开预览 iframe 的创建时机.
 *
 * 每个预览 iframe 都要加载酒馆的全部样式表并解析该主题的 custom_css (最大的近 10 万
 * 字符). 快速滚动时若同时创建几十个, 浏览器会卡住数秒, 因此排成队列逐个放行.
 *
 * 移动端优化: 优先使用 requestIdleCallback 在浏览器空闲时渲染, 避免阻塞主线程.
 */

/** 相邻两个 iframe 的创建间隔 (降级到 setTimeout 时使用) */
const RENDER_INTERVAL_MS = 100;

const queue = new Set<() => void>();
let timer: number | undefined;

function pump(): void {
  const next = queue.values().next();
  if (next.done === true) {
    timer = undefined;
    return;
  }
  queue.delete(next.value);
  next.value();

  // 优先用 requestIdleCallback 在浏览器空闲时渲染, 避免阻塞主线程
  // Safari 不支持, 降级到 setTimeout
  if ('requestIdleCallback' in window) {
    timer = window.requestIdleCallback(pump, { timeout: RENDER_INTERVAL_MS * 2 });
  } else {
    timer = window.setTimeout(pump, RENDER_INTERVAL_MS);
  }
}

/**
 * 排队等待渲染.
 *
 * @returns 取消函数. 卡片在轮到自己之前滚出视野时应调用它, 以免把名额浪费在
 * 用户已经划过去的卡片上.
 */
export function queueRender(render: () => void): () => void {
  queue.add(render);
  if (timer === undefined) {
    if ('requestIdleCallback' in window) {
      timer = window.requestIdleCallback(pump);
    } else {
      timer = window.setTimeout(pump, 0);
    }
  }
  return () => queue.delete(render);
}
