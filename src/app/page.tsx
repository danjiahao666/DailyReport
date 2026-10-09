import { App } from "@/components/App";
import { authEnabled } from "@/server/session";

// 是否启用密码保护取决于运行时环境变量，不能在构建期固化
export const dynamic = "force-dynamic";

export default function Page() {
  return <App authEnabled={authEnabled()} />;
}
