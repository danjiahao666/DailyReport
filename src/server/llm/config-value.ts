/**
 * 配置值解析，与 pi 的约定一致：字面量、$NAME / ${NAME} 环境变量插值、$$ 转义。
 * 与 pi 不同的是：服务端不执行以 "!" 开头的 shell 命令（不在服务进程里执行配置文件中的命令）。
 */

export class ConfigValueError extends Error {}

const REF_RE = /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

/** 返回解析结果；引用的环境变量缺失时返回 undefined */
export function resolveConfigValue(
  raw: string,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (raw.startsWith("!")) {
    throw new ConfigValueError("服务端不支持以 ! 开头的命令型配置值，请改用环境变量引用（如 $MY_API_KEY）");
  }
  let missing = false;
  const value = raw.replace(REF_RE, (match, braced?: string, bare?: string) => {
    if (match === "$$") return "$";
    const name = braced ?? bare ?? "";
    const v = env[name];
    if (v === undefined || v === "") {
      missing = true;
      return "";
    }
    return v;
  });
  return missing ? undefined : value;
}
