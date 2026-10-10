# 部署文档

本文说明如何把「日报助手」部署到服务器、如何对外提供 HTTPS 访问，以及之后的更新、备份与回滚。

- 约定目录：`/opt/DailyReport`（可自行调整，下文命令中的路径随之替换）
- 约定容器：`docker compose` 项目名为 `daily-report`，容器名 `daily-report`，数据卷 `daily-report_daily-report-data`
- 配置项详见 [README](../README.md) 的「环境变量」「大模型配置」章节，本文不重复

## 1. 部署方式选择

| 方式 | 适用场景 | 服务器要求 |
|---|---|---|
| **A. 服务器上构建**（`Dockerfile`） | 服务器内存充足 | 内存 ≥ 4GB 为宜，能访问 npm 与基础镜像仓库 |
| **B. 预构建**（`Dockerfile.prebuilt`） | 服务器内存小（1~2GB）或网络受限 | 只运行，几乎不占构建资源 |

`next build` 在 1.6GB 内存的机器上会耗尽内存并拖垮整台服务器（曾导致宝塔面板和 VNC 无响应，只能重启）。**内存小于 4GB 请使用方式 B。**

## 2. 前置条件

- 服务器：Linux，已安装 Docker 与 Compose 插件。`docker compose version` 需 **v2.24 及以上**（compose 文件使用了 `env_file.required`）。
- 方式 B 的本机：Node ≥ 22.19，已执行 `npm ci`。
- 大模型：服务器必须能访问所配置的模型端点（例如内网地址在公网服务器上不可达）。
- 可选：域名（用于 HTTPS）。国内服务器上，域名需完成 ICP 备案才能使用 80/443 端口。

## 3. 首次部署

### 3.1 获取代码
```bash
cd /opt
git clone <仓库地址> DailyReport
cd DailyReport
```

### 3.2 配置 `.env`
```bash
cp .env.example .env
chmod 600 .env
vi .env
```
必改项：

| 变量 | 说明 |
|---|---|
| `APP_PASSWORD` | 访问密码。不设置则任何人可访问，设置页也会变为只读 |
| `SESSION_SECRET` | 会话签名密钥，用 `openssl rand -hex 32` 生成 |
| `BIND_ADDR` | 默认 `127.0.0.1`（仅本机），配合反向代理使用 |
| `COOKIE_SECURE` | 通过 HTTPS 访问时设为 `true`；用 HTTP 访问时必须为 `false`，否则登录后会被踢回登录页 |
| `DOCKERFILE` | 方式 B 时设为 `Dockerfile.prebuilt`，方式 A 留空 |

> 个人配置只写在 `.env`，不要修改被 git 跟踪的文件（如 `.env.example`），否则之后 `git pull` 会因本地修改而中止。`.env` 已被 `.gitignore` 与 `.dockerignore` 排除，不会提交，也不会进入镜像。

### 3.3 模型配置
```bash
cp pi-config/models.example.json   pi-config/models.json     # 按需修改
cp pi-config/settings.example.json pi-config/settings.json
cp pi-config/auth.example.json     pi-config/auth.json
chmod 600 pi-config/auth.json
chown -R 1000:1000 pi-config      # 容器以 uid 1000 运行，目录需对其可写
```
也可以跳过这一步，部署后在页面「大模型设置」里添加（需已设置 `APP_PASSWORD`，且 `pi-config` 对 uid 1000 可写）。

### 3.4 网络受限时的构建加速（可选）
在 `.env` 中设置：

```
NPM_REGISTRY=https://registry.npmmirror.com
NODE_IMAGE=<镜像站前缀>/library/node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
```

- 保留 `@sha256:` 摘要：Docker 会校验镜像内容，第三方镜像站即使被替换内容也会被拒绝。
- 镜像站是第三方服务，可用性随时变化，请自行评估后使用。拉取前先单独测试：
  ```bash
  time docker pull <镜像站前缀>/library/node:24.21.0-bookworm-slim@sha256:…
  ```
- `/etc/docker/daemon.json` 中的 `registry-mirrors` 只对 `docker.io` 生效；若镜像站没有缓存目标镜像，会回退到 Docker Hub 并变得很慢。

### 3.5A 方式 A：服务器上构建
```bash
docker compose up -d --build
```

### 3.5B 方式 B：预构建
**本机**：
```bash
npm ci
npm run pack:prebuilt        # 先 next build，再生成 prebuilt/ 与 daily-report-prebuilt.tgz
scp daily-report-prebuilt.tgz root@<服务器IP>:/opt/DailyReport/
```
**服务器**：
```bash
cd /opt/DailyReport
rm -rf prebuilt && mkdir prebuilt
tar -xzf daily-report-prebuilt.tgz -C prebuilt
# .env 中确认 DOCKERFILE=Dockerfile.prebuilt
docker compose build app && docker compose up -d
```
`pack:prebuilt` 会去除 `.env`、本机绝对路径和非 Linux 二进制，展开指向本机路径的符号链接，并在打包后自检；自检不通过不会生成压缩包。使用 `Dockerfile.prebuilt` 时 compose 可能提示 `NPM_REGISTRY` 等构建参数未使用，可忽略。

### 3.6 验证
```bash
docker compose ps                          # STATUS 应为 healthy
curl http://127.0.0.1:3000/api/health      # {"ok":true}
docker compose logs --tail 30 app
```
然后在页面中依次确认：出现登录页 → 登录 → `/settings` 点「测试连接」成功 → 提交一条日报并「用大模型优化」，日历上先显示「优化中」，完成后显示「优」。

## 4. 对外访问

### 4.1 推荐：域名 + 宝塔反向代理 + HTTPS
先让代理与证书跑通，再收紧端口，这样中途出问题不会把自己锁在外面。

1. **解析**：给域名添加 A 记录，指向服务器公网 IP。
2. **放行端口**：云厂商安全组与宝塔防火墙放行 TCP 80、443。
3. **反向代理**：宝塔 → 网站 → 反向代理 → 添加。域名填你的域名，目标 URL `http://127.0.0.1:3000`，发送域名 `$host`。
4. **证书**：站点设置 → SSL → Let's Encrypt，文件验证申请，成功后开启「强制 HTTPS」。
5. **浏览器验证** `https://你的域名` 能看到登录页。
6. **收紧**：`.env` 改为
   ```
   BIND_ADDR=127.0.0.1
   COOKIE_SECURE=true
   ```
   然后 `docker compose up -d`，`docker compose ps` 的 PORTS 应显示 `127.0.0.1:3000->3000`。
7. **关闭 3000**：在安全组与宝塔防火墙中删除 3000 端口的放行规则。

### 4.2 临时：用 IP 加端口访问
`.env` 设 `BIND_ADDR=0.0.0.0`、`COOKIE_SECURE=false`，访问 `http://<服务器IP>:3000`。这是**明文传输**，登录密码可被窃听。安全组中来源必须限制为你自己的 IP（`你的IP/32`），不要对 `0.0.0.0/0` 放行 3000。

### 4.3 无域名时更安全：SSH 隧道
保持 `BIND_ADDR=127.0.0.1`，在本机执行：
```bash
ssh -L 3000:127.0.0.1:3000 root@<服务器IP>
```
然后访问 `http://127.0.0.1:3000`。流量经 SSH 加密，3000 端口不对公网开放。

## 5. 日常更新流程

### 本机
```bash
npm run typecheck && npm test
git add … && git commit -m "…" && git push
npm run pack:prebuilt
scp daily-report-prebuilt.tgz root@<服务器IP>:/opt/DailyReport/
```
依赖有变动时，先 `npm ci`。

### 服务器
```bash
cd /opt/DailyReport

# 1) 备份（见第 6 节）
# 2) 拉取配置变更
git pull
# 3) 换上新产物（方式 B）
rm -rf prebuilt && mkdir prebuilt
tar -xzf daily-report-prebuilt.tgz -C prebuilt
# 4) 构建并重启（方式 A 用 docker compose up -d --build）
docker compose build app && docker compose up -d
# 5) 验证
docker compose ps
curl http://127.0.0.1:3000/api/health
docker compose logs --tail 30 app
```

注意事项：

- **方式 B 运行的代码来自压缩包，不是 git。** `git pull` 只更新 `Dockerfile.prebuilt`、compose、`.env.example` 等配置。只改了业务代码也必须重新打包上传。请在推送后、用同一份代码打包，避免压缩包与提交不一致。
- 更新后对比 `.env.example` 的变化，把新增的变量补到服务器的 `.env`。
- `up -d` 会重建容器，约几秒不可用；**正在执行的优化、周报、月报任务会被中断**，重启后标记为「服务重启导致任务中断」，点重试即可。尽量在没有任务时更新。
- 数据（数据卷）与 `pi-config/` 不受重建影响；表结构为幂等创建（`CREATE TABLE IF NOT EXISTS`）。若某次变更涉及修改已有表结构，请在发布说明中单独确认并先备份。

## 6. 备份与恢复

### 备份（在线、一致性备份）
```bash
cd /opt/DailyReport
docker compose exec app node -e "const {DatabaseSync,backup}=require('node:sqlite');backup(new DatabaseSync('/data/daily-report.db'),'/data/backup.db').then(()=>console.log('ok'))"
docker compose cp app:/data/backup.db ./backup-$(date +%F).db
```
同时备份 `pi-config/`（含密钥，请妥善保管，不要提交到 git）。建议用宝塔「计划任务」定期执行，并把备份文件复制到服务器之外。

### 恢复
> 恢复步骤未在真实环境演练过，首次使用前建议在测试环境验证一次。

```bash
cd /opt/DailyReport
docker compose stop app
# 清理旧库的 WAL 文件，避免与恢复的库不一致
docker run --rm --entrypoint sh -v daily-report_daily-report-data:/data daily-report:0.1.0 \
  -c "rm -f /data/daily-report.db-wal /data/daily-report.db-shm"
docker compose cp ./backup-YYYY-MM-DD.db app:/data/daily-report.db
docker compose start app
```
恢复会覆盖当前数据，执行前先确认备份文件正确，并另存当前数据。

## 7. 回滚

方式 B：重新解压旧版本的压缩包并构建。建议上传时把压缩包改名为带提交号的名字（如 `daily-report-<提交号>.tgz`），便于找回。
```bash
cd /opt/DailyReport
rm -rf prebuilt && mkdir prebuilt
tar -xzf daily-report-<旧提交号>.tgz -C prebuilt
docker compose build app && docker compose up -d
```
方式 A：`git checkout <旧提交>` 后 `docker compose up -d --build`。

数据库若已被新版本改动，回滚前先评估是否需要用第 6 节的备份恢复。

## 8. 故障排查

| 现象 | 原因与处理 |
|---|---|
| `git pull` 报 `Your local changes … would be overwritten` | 修改过被跟踪的文件。把个人配置迁到 `.env`，再 `git checkout -- <文件>` 后重试 |
| 构建报 `env_file` 语法错误 | Compose 太老（< v2.24）。升级，或把 `env_file` 改成 `- .env` |
| 拉取基础镜像极慢或超时 | 见 3.4；先单独 `docker pull` 测试，成功后镜像已在本地，构建不再下载 |
| 构建时服务器卡死、面板无响应 | 内存不足。改用方式 B；不要在小内存机器上执行 `next build` |
| `open Dockerfile: no such file` | 通过宝塔的 Compose 页面启动时，相对路径指向了宝塔自己的目录。请在项目目录的终端中执行 `docker compose` |
| 设置页提示配置目录只读 / 保存失败 | `pi-config` 未对 uid 1000 可写：`chown -R 1000:1000 pi-config` |
| 登录后又回到登录页 | `COOKIE_SECURE=true` 但在用 HTTP 访问；或反代未传 `Host` |
| 反向代理 502 | 容器未启动或仍在构建，看 `docker compose ps` 与日志 |
| 证书申请失败 | 域名未解析到本机、80 端口未放行，或域名未备案 |
| 优化/周报/月报报「未配置模型」 | `settings.json` 的默认模型不存在；用 `.env` 的 `LLM_PROVIDER`/`LLM_MODEL` 覆盖，或在设置页重新选择默认模型 |
| 优化超时 | 服务器访问不到模型端点（如内网地址）；可调大 `LLM_TIMEOUT_MS` |
| compose 提示构建参数未使用 | 使用 `Dockerfile.prebuilt` 时的正常提示，可忽略 |

## 9. 安全清单

- [ ] 已设置 `APP_PASSWORD` 与 `SESSION_SECRET`
- [ ] 对外访问使用 HTTPS，且 `COOKIE_SECURE=true`
- [ ] `BIND_ADDR=127.0.0.1`，安全组与防火墙中没有放行 3000
- [ ] `.env`、`pi-config/auth.json` 权限为 `600`，且未提交到 git
- [ ] 镜像站、npm 源等第三方来源经过评估；基础镜像保留 `@sha256:` 摘要
- [ ] 已配置定期备份，备份文件保存在服务器之外
- [ ] 服务器上没有对被 git 跟踪的文件做本地修改

## 10. 验证状态说明

- 已验证：预构建产物在本机以不同路径运行并通过完整冒烟测试；服务器上 `Dockerfile.prebuilt` 构建并启动成功（宝塔环境，Docker 26.1.3）。
- 未在真实环境验证：方式 A 的服务器构建、宝塔反向代理与 Let's Encrypt 流程、恢复步骤。首次使用请留意并按需调整。
