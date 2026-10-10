# syntax=docker/dockerfile:1
# 固定到具体版本与摘要，保证可复现构建。升级时同时更新版本号与摘要（docker buildx imagetools inspect node:<版本>-bookworm-slim）。
ARG NODE_IMAGE=node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20

# ---------- 依赖 ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# 可选的 npm 源（国内服务器访问 npmjs.org 慢时设置，如 https://registry.npmmirror.com）；留空则用默认源。
# lockfile 中的 registry.npmjs.org 地址会被自动替换为该源，完整性校验（integrity）不变。
ARG NPM_REGISTRY=""
# 不执行依赖的生命周期脚本；本项目依赖均为纯 JS / 预编译产物，SQLite 使用 Node 内置的 node:sqlite
RUN npm ci --ignore-scripts ${NPM_REGISTRY:+--registry=${NPM_REGISTRY}}

# ---------- 构建 ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------- 运行 ----------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/data \
    PI_CODING_AGENT_DIR=/pi-config \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

RUN mkdir -p /data /pi-config && chown node:node /data /pi-config

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static

USER node
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
