import { AppError } from "./errors";

/** 进程内互斥：同一对象的模型调用同时只允许一个，防止重复点击造成重复调用与版本错乱 */
const running = new Set<string>();

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (running.has(key)) {
    throw new AppError(409, "BUSY", "该内容正在生成中，请稍候再试。");
  }
  running.add(key);
  try {
    return await fn();
  } finally {
    running.delete(key);
  }
}
