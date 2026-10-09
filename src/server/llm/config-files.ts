import { accessSync, constants, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * 配置文件（models.json / auth.json / settings.json）的原始读写。
 * 读：只接受合法 JSON 对象，否则报错而不是当作空文件——避免“读不出来 → 写回空内容 → 覆盖用户配置”。
 * 写：同目录临时文件 + rename，写入失败不会留下半个文件；新文件权限 0600。
 */

export type ConfigFileErrorCode = "INVALID" | "WRITE";

export class ConfigFileError extends Error {
  readonly code: ConfigFileErrorCode;
  readonly file: string;

  constructor(code: ConfigFileErrorCode, file: string, message: string) {
    super(message);
    this.code = code;
    this.file = path.basename(file);
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 文件不存在或为空返回 undefined；内容不是 JSON 对象时抛 INVALID */
export function readJsonObject(file: string): Record<string, unknown> | undefined {
  const name = path.basename(file);
  if (!existsSync(file)) return undefined;
  let text: string;
  try {
    text = readFileSync(file, "utf-8").replace(/^\uFEFF/, "");
  } catch {
    throw new ConfigFileError("INVALID", file, `无法读取 ${name}，请检查文件权限`);
  }
  if (text.trim() === "") return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ConfigFileError(
      "INVALID",
      file,
      `${name} 不是合法的 JSON（含注释也不支持）。为避免覆盖你的内容，已拒绝修改，请先手动修正该文件`,
    );
  }
  if (!isRecord(parsed)) {
    throw new ConfigFileError("INVALID", file, `${name} 的顶层必须是 JSON 对象，已拒绝修改`);
  }
  return parsed;
}

export function writeJsonAtomic(file: string, data: unknown): void {
  const name = path.basename(file);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
    renameSync(tmp, file);
  } catch {
    try {
      unlinkSync(tmp);
    } catch {
      /* 临时文件可能尚未创建 */
    }
    throw new ConfigFileError("WRITE", file, `无法写入 ${name}，请确认配置目录可写（Docker 部署时不要以只读方式挂载 pi-config）`);
  }
}

/** 目录（或其最近的已存在上级目录）是否可写 */
export function dirWritable(dir: string): boolean {
  let current = path.resolve(dir);
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
  try {
    accessSync(current, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
