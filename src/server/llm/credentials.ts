import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { resolveConfigValue } from "./config-value";

/**
 * 基于 auth.json 的 CredentialStore，格式与 pi 的 auth.json 一致：
 *   { "<providerId>": { "type": "api_key", "key": "..." } }
 *
 * - key 支持 $ENV 引用（与 pi 一致），在读取时解析；
 * - 每次读取都检查文件修改，更新密钥无需重启服务；
 * - 只有凭据确实发生变化（如 OAuth 刷新）时才写回，写入采用临时文件 + rename；
 *   配置目录若以只读方式挂载，写回会失败并给出明确错误。
 */
export class FileCredentialStore implements CredentialStore {
  private readonly file: string;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(file: string) {
    this.file = file;
  }

  private load(): Record<string, Credential> {
    if (!existsSync(this.file)) return {};
    const text = readFileSync(this.file, "utf-8").replace(/^\uFEFF/, "");
    if (text.trim() === "") return {};
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("auth.json 格式错误：顶层必须是对象");
    }
    return parsed as Record<string, Credential>;
  }

  private resolved(credential: Credential | undefined): Credential | undefined {
    if (!credential || credential.type !== "api_key" || !credential.key) return credential;
    const key = resolveConfigValue(credential.key, { ...process.env, ...(credential.env ?? {}) });
    // 引用的环境变量缺失时视为未配置，让 provider 回退到自身的环境变量规则
    return key === undefined ? undefined : { ...credential, key };
  }

  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();
    return this.resolved(this.load()[providerId]);
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted();
    return Object.entries(this.load()).map(([providerId, c]) => ({ providerId, type: c.type }));
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    const run = async () => {
      options?.signal?.throwIfAborted();
      const all = this.load();
      const stored = all[providerId];
      const next = await fn(this.resolved(stored));
      if (next === undefined) return this.resolved(stored);
      // 仅在原始存储值确实变化时写回，避免把已解析的明文密钥写进文件
      if (!isDeepStrictEqual(next, this.resolved(stored))) {
        all[providerId] = next;
        this.write(all);
      }
      return next;
    };
    const queued = this.chain.then(run, run);
    this.chain = queued.catch(() => undefined);
    return queued;
  }

  async delete(providerId: string): Promise<void> {
    const run = async () => {
      const all = this.load();
      if (!(providerId in all)) return;
      delete all[providerId];
      this.write(all);
    };
    const queued = this.chain.then(run, run);
    this.chain = queued.catch(() => undefined);
    await queued;
  }

  private write(data: Record<string, Credential>): void {
    try {
      mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600 });
      renameSync(tmp, this.file);
    } catch {
      throw new Error("无法写入 auth.json（配置目录可能以只读方式挂载），凭据刷新失败");
    }
  }
}
