import type { NextConfig } from "next";

const config: NextConfig = {
  // 生成 standalone 产物，Docker 镜像只需复制该目录
  output: "standalone",
  // pi-ai 含多个 provider SDK，由 Node 运行时直接加载，避免被打包
  serverExternalPackages: ["@earendil-works/pi-ai"],
  poweredByHeader: false,
};

export default config;
