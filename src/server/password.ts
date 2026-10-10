import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/prefs";
import { getDb, transaction } from "./db";
import { AppError } from "./errors";

/**
 * 页面里设置的访问密码。
 *
 * 只存「加盐的 scrypt 摘要」，不存明文，也不会通过任何接口返回；
 * 同时存一份随机的会话签名密钥，修改或关闭密码时一并更换，旧登录态随之全部失效。
 * 环境变量 APP_PASSWORD 优先于这里（部署方的硬性配置不允许被网页覆盖），见 session.ts。
 */

export const KEY_HASH = "auth_password_hash";
export const KEY_SECRET = "auth_session_secret";

const SCRYPT_KEYLEN = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** 常量时间校验；格式不对（被手工改坏）一律视为不匹配 */
export function verifyPasswordHash(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex || !/^[0-9a-f]+$/.test(saltHex) || !/^[0-9a-f]+$/.test(hashHex)) return false;
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), SCRYPT_KEYLEN);
  return timingSafeEqual(actual, expected);
}

export function readAuthSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

/** 校验新密码：长度按字符数算（中文密码也按字符），不接受纯空白 */
export function validateNewPassword(input: unknown): string {
  if (typeof input !== "string") throw new AppError(400, "INVALID_PASSWORD_FORMAT", "密码必须是文本");
  const len = Array.from(input).length;
  if (len < PASSWORD_MIN_LENGTH || len > PASSWORD_MAX_LENGTH) {
    throw new AppError(400, "INVALID_PASSWORD_FORMAT", `密码长度需要在 ${PASSWORD_MIN_LENGTH} 到 ${PASSWORD_MAX_LENGTH} 个字符之间`);
  }
  if (input.trim() === "") throw new AppError(400, "INVALID_PASSWORD_FORMAT", "密码不能全是空白字符");
  return input;
}

/** 写入（或更换）密码，并换一份新的会话签名密钥 */
export function savePagePassword(password: string): void {
  const hash = hashPassword(password);
  const secret = randomBytes(32).toString("hex");
  transaction((db) => {
    const upsert = "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
    db.prepare(upsert).run(KEY_HASH, hash);
    db.prepare(upsert).run(KEY_SECRET, secret);
  });
}

export function clearPagePassword(): void {
  transaction((db) => {
    db.prepare("DELETE FROM settings WHERE key IN (?, ?)").run(KEY_HASH, KEY_SECRET);
  });
}
