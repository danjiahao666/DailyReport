import { ApiError } from "./api-client";
import type { JobKind, JobView } from "./types";

export function findJob(jobs: JobView[], kind: JobKind, target: string): JobView | null {
  return jobs.find((j) => j.kind === kind && j.target === target) ?? null;
}

/** 用新的任务状态替换同一对象的旧状态；job 为 null 表示清除 */
export function upsertJob(jobs: JobView[], kind: JobKind, target: string, job: JobView | null): JobView[] {
  const rest = jobs.filter((j) => !(j.kind === kind && j.target === target));
  return job ? [...rest, job] : rest;
}

/** 把失败的任务转换成界面通用的错误对象，复用统一的错误提示组件 */
export function jobError(job: JobView): ApiError {
  return new ApiError(0, job.errorCode ?? "JOB_FAILED", job.errorMessage ?? "任务执行失败，请重试。", { retryable: job.retryable });
}
