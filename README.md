# 日报助手

记录每天的日报，按日历查看；可选让大模型优化日报；一键汇总成周报、月报，并保留全部历史版本。

- 技术栈：Next.js 16（App Router）+ TypeScript + Tailwind，SQLite（Node 内置 `node:sqlite`），Docker Compose 部署
- 大模型：直接使用 `@earendil-works/pi-ai`（版本与仓库内 `pi/packages/ai` 一致，固定为 1.1.0），模型配置与密钥管理沿用 pi 的约定（见下文）

## 功能

| 模块 | 说明 |
|---|---|
| 日报 | 按日期提交，一天一条；同一天重复提交时弹窗选择“覆盖”或“追加”；日历上有日报的日期带圆点，点击可查看、编辑、删除 |
| 日报优化 | 提交时可勾选，或事后点“用大模型优化”。优化稿与原文并存，由你决定“采用”哪一版，随时“回退到原文”。提示词强约束不得编造；优化稿出现原文没有的数字时会给出提示 |
| 周报 | 汇总指定自然周的日报：本周完成事项 / 重点成果 / 遇到的问题 / 下周计划建议。周起始日默认周一，页面右上角可改。该周没有日报时直接提示，不调用大模型 |
| 月报 | 可选数据来源“本月日报”或“已有周报”，页面会预览逐周的取数规则。内容：月度工作概览 / 主要成果 / 问题与反思 / 下月计划建议 |
| 版本 | 周报、月报支持手动编辑、重新生成、恢复历史版本；每次操作都新增版本，**不覆盖**已有内容；当前版本是手动编辑时，重新生成需二次确认；来源日报变化后提示“已过期” |
| 日历 | 蓝点 = 日报，绿色按钮 = 周报（每行左侧），紫色按钮 = 月报（标题右侧）；虚线表示尚未生成 |
| 访问保护 | 设置 `APP_PASSWORD` 后，页面和接口都需要登录 |

### 业务规则

- **一天一条**：同日再次提交必须选择覆盖或追加。覆盖会清除已有优化稿；追加会把已有优化稿标记为过期，并回退采用原文。
- **周报/月报使用“当前采用的版本”**：采用了优化稿的日期用优化稿，否则用原文。
- **跨月周按日期归属拆分，不整周归入某月**：
  - 来源=日报：只取属于该月日期的日报。
  - 来源=周报：整周都在本月且已有周报的周，使用该周周报；跨月周（周报无法按日期拆分）和尚无周报的周，改用其落在本月内日期的日报。
  - 例：周起始日为周一时，2026-09-28 ~ 2026-10-04 这一周，十月月报只取 10-01 ~ 10-04 的日报，九月月报只取 09-28 ~ 09-30。
- **大模型调用是异步任务**：日报优化、周报、月报点击后立即返回，模型在服务端后台执行。进行中/失败的状态保存在数据库里，并显示在日历对应的位置（日期格“优化中”、周报按钮“生成中”、月份按钮“生成中”，失败显示红色“失败”）。期间可以切换日期、月份甚至离开页面，回来或刷新后仍能看到正确状态，完成后结果自动出现。同一对象重复点击不会重复调用模型；失败的状态会一直保留，直到重试成功或点“忽略”。没有日报、需要确认覆盖等校验仍在点击时立即提示，不会创建任务。
- **失败不影响数据**：日报先保存、再优化，两步独立；模型失败、超时、返回空内容或被截断时，只返回明确的中文提示和“重试”，已保存的日报与历史版本不变。

## 大模型配置（沿用 pi-ai 约定）

调用方式：`createModels()` + `Models.completeSimple()`，按 `stopReason` 判定成败（pi-ai 约定请求失败不抛异常）。配置约定与 pi 一致，**配置目录由环境变量 `PI_CODING_AGENT_DIR` 指定**（本地默认 `~/.pi/agent`，容器内为 `/pi-config`，对应宿主机的 `./pi-config`）：

| 文件 | 作用 |
|---|---|
| `auth.json` | 各 provider 的凭据：`{ "<provider>": { "type": "api_key", "key": "..." } }`；`key` 可写 `$ENV_NAME` 引用环境变量 |
| `models.json` | 自定义/兼容端点：`providers.<id>.{ baseUrl, api, apiKey, headers, compat, models[] }`；`apiKey` 可写 `$ENV_NAME` |
| `settings.json` | 默认模型：`defaultProvider` / `defaultModel` |
| 环境变量 | pi-ai 内置 provider 的标准变量（`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`GEMINI_API_KEY`……）无需任何文件即可使用 |

密钥优先级与 pi 相同：`auth.json` 凭据 > `models.json` 的 `apiKey` > provider 的环境变量。选择模型的顺序：`LLM_PROVIDER` / `LLM_MODEL` 环境变量 > `settings.json` > 第一个已配置密钥的模型。

与 pi 的差异（出于服务端安全考虑）：

- 不执行 `!命令` 形式的配置值（会报错），请改用环境变量引用。
- `models.json` 中的 provider 需要同时给出 `models` 才会生效，且会整体替换同名的内置 provider。
- 不支持需要刷新令牌的 OAuth 凭据（页面也不会覆盖 auth.json 里已有的 OAuth 凭据），请使用 API Key。
- 在页面上保存的修改立即生效；**手工编辑 `models.json` / `settings.json` 后需重启服务**（`auth.json` 与环境变量引用每次调用时重新读取）。

### 在页面上配置（推荐）

右上角“大模型设置”（`/settings`）可以可视化完成上述配置，读写的就是上面这三个 pi 文件：

- **自定义 provider**：新增/编辑/删除，填写接口地址、协议、密钥和模型列表；密钥写入 `auth.json`，不会写进 `models.json`。
  - **获取模型列表**：填好接口地址（和密钥）后点「获取模型列表」，服务端会请求供应商的 `/models` 接口，之后「模型 ID」可直接下拉选择，并自动带出显示名、上下文窗口和最大输出（接口提供时）；列表里没有想要的，可选「手动输入」。支持 OpenAI 兼容（含 Ollama、vLLM、各类网关）、Anthropic、Gemini、Mistral；Azure 按部署调用，没有统一列表，需手动填写。编辑已有 provider 时留空密钥会沿用已保存的密钥，但**接口地址改动后不会再沿用**，需重新填写。
- **内置 provider 密钥**：为 OpenAI、Anthropic、Gemini 等填写或清除 API 密钥。
- **默认模型**：从已配置密钥的模型中选择，写入 `settings.json`。
- **测试连接**：对某个模型发一次极短的真实请求，立即看到成功耗时或明确的失败原因。

安全约束：

- **必须启用访问保护才能修改**（环境变量 `APP_PASSWORD`，或在「设置中心」里设置访问密码），否则页面只读（只能查看状态）；配置目录不可写时同样只读。
- 接口和页面**永远不返回密钥**，只显示“已配置”和来源（`auth.json` / 环境变量名 / `models.json`）。
- 修改采用读-改-写，保留文件里页面不认识的字段与其它 provider；文件不是合法 JSON（例如含注释）时拒绝修改，不会覆盖你的内容。
- 接口地址只允许 `http(s)`、不允许内嵌账号密码、禁止云平台元数据地址；内网地址允许（自建网关常见），因此请保护好登录密码。
- 「获取模型列表」是服务端带着密钥向你填写的地址发请求，所以同样要求编辑权限；另外不跟随重定向、15 秒超时、响应体上限 2 MB，且不会把上游返回的正文原样回传或写入日志。
- 环境变量 `LLM_PROVIDER` / `LLM_MODEL` 若已设置会覆盖页面选择的默认模型，页面会提示。

示例见 `pi-config/*.example.json`。**不要把真实密钥提交到仓库**（`pi-config/auth.json`、`models.json`、`settings.json`、`.env` 已在 `.gitignore` 中）。

## 本地运行

要求 Node.js >= 22.19（使用内置 `node:sqlite`）。

```bash
npm ci --ignore-scripts
cp .env.example .env            # 可选：本地开发直接用环境变量即可
export PI_CODING_AGENT_DIR=./pi-config   # 放置 models.json / auth.json / settings.json，或直接用 ~/.pi/agent
npm run dev                     # http://localhost:3000
```

没有真实模型密钥也可以体验：另开一个终端 `npm run fake-llm`（本地假的 OpenAI 兼容服务，只会机械整理输入），再把 `pi-config/models.json` 指向 `http://127.0.0.1:4010/v1`，`apiKey` 随便写。

### 像素字体

界面采用 2D 像素卡通风格，标题与标签使用 [Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font)（SIL OFL-1.1，许可证见 `assets/fonts/`）。完整字体约 645 KB，已按源码里出现的汉字子集化为 `src/app/fonts/pixel-zh.woff2`（约 27 KB，已提交，构建与 Docker 不依赖 Python）。**新增中文文案后若出现缺字方块**，重跑子集化：

```bash
pip install fonttools brotli
node scripts/subset-font.mjs     # 可用环境变量 PYFTSUBSET 指定 pyftsubset 路径
```

注意：`npm run dev` 的 Next.js 可能在项目根目录自动生成 `AGENTS.md`，它不属于本项目，不要提交。

## Docker Compose 部署

服务器需安装 Docker 及 Compose 插件。

> 完整的服务器部署流程（含宝塔反向代理与 HTTPS、日常更新、备份与回滚、故障排查）见 [docs/DEPLOY.md](docs/DEPLOY.md)。

```bash
# 1. 获取代码后进入目录
cd DailyReport

# 2. 环境变量：务必设置 APP_PASSWORD；如使用 HTTPS 反向代理再设 COOKIE_SECURE=true
cp .env.example .env
vi .env

# 3. 模型配置（二选一或组合）
#   a) 只用标准环境变量：在 .env 里填 OPENAI_API_KEY 等即可，可跳过本步
#   b) 自定义端点/默认模型（也可以跳过这步，启动后在页面“大模型设置”里添加）：
cp pi-config/models.example.json   pi-config/models.json     # 按需修改
cp pi-config/settings.example.json pi-config/settings.json
cp pi-config/auth.example.json     pi-config/auth.json       # 或把密钥放 .env，用 $MY_API_KEY 引用
# 容器以非 root 用户(uid 1000)运行；配置目录需对它可写，页面“大模型设置”才能保存
sudo chown -R 1000:1000 pi-config

# 4. 构建并启动
docker compose up -d --build

# 5. 验证
docker compose ps                         # STATUS 应为 healthy
curl http://127.0.0.1:3000/api/health     # {"ok":true}
docker compose logs -f app
```

要点：

- 默认只监听 `127.0.0.1:3000`，建议用 Nginx/Caddy 等反向代理提供 HTTPS（此时设置 `COOKIE_SECURE=true`）。如需直接对外访问，在 `.env` 设 `BIND_ADDR=0.0.0.0`，并自行用防火墙限制来源。
- 数据库存放在具名卷 `daily-report-data`（容器内 `/data/daily-report.db`），升级/重建容器不会丢数据。
- 容器以非 root、只读根文件系统、`cap_drop: ALL`、`no-new-privileges` 运行；基础镜像固定到具体版本与摘要。
- 升级：更新代码后 `docker compose up -d --build`。数据库表结构为幂等创建（`CREATE TABLE IF NOT EXISTS`）。
- 备份（在线、一致性备份）：

  ```bash
  docker compose exec app node -e "const {DatabaseSync,backup}=require('node:sqlite');backup(new DatabaseSync('/data/daily-report.db'),'/data/backup.db').then(()=>console.log('ok'))"
  docker compose cp app:/data/backup.db ./backup-$(date +%F).db
  ```

### 国内服务器 / 小内存服务器

**构建加速**（在 `.env` 中设置，均可留空）：

- `NPM_REGISTRY`：npm 源，如 `https://registry.npmmirror.com`，加速 `npm ci`。
- `NODE_IMAGE`：基础镜像地址，Docker Hub 访问不了时可指向镜像站，如 `docker.m.daocloud.io/library/node:24.21.0-bookworm-slim@sha256:…`。保留 `@sha256:` 摘要即可校验内容与固定版本一致。

**预构建部署**：服务器内存只有 1~2GB 时，`next build` 会占满内存并拖垮整台机器。此时在本机构建，服务器只构建“运行阶段”镜像：

```bash
# 本机（需要 Node >= 22.19）：构建并整理产物，生成 prebuilt/ 和 daily-report-prebuilt.tgz
npm ci && npm run pack:prebuilt

# 把 daily-report-prebuilt.tgz 上传到服务器的项目目录，然后：
cd /opt/DailyReport
rm -rf prebuilt && mkdir prebuilt
tar -xzf daily-report-prebuilt.tgz -C prebuilt

# .env 中设置  DOCKERFILE=Dockerfile.prebuilt
docker compose build app && docker compose up -d
```

说明：

- `pack:prebuilt` 会去掉 `.env`、本机绝对路径和非 Linux 的原生二进制，并展开指向本机路径的符号链接，打包后自检，有残留会直接报错。
- 产物不含原生模块（SQLite 用 Node 内置的 `node:sqlite`），因此 Windows/macOS 上构建的产物可以在 Linux 容器里运行；运行时仍使用镜像里的 Node 24。
- 升级时重复以上步骤：本机重新打包、上传、解压、`docker compose build app && docker compose up -d`。
- 使用 `Dockerfile.prebuilt` 时 compose 可能提示 `NPM_REGISTRY` 等构建参数未使用，可忽略。
- 不要把 `prebuilt/` 和压缩包提交到 git（已在 `.gitignore` 中）。

## 设置中心

页面右上角的「设置中心」（`/preferences`）集中管理所有可在页面里调整的选项，改动先落在草稿上，底部点「保存修改」后整体校验、立即生效（任何一项不合法则整次都不保存）：

| 分类 | 选项 |
|---|---|
| 通用 | 周起始日；提交日报时是否默认勾选大模型优化；优化后是否检查「原文没有的新数字」 |
| 提示词与模板 | 日报优化 / 周报 / 月报各有两项：**参考模板**（输出的小节标题与排版，用【】括起来的是写作说明）和**系统提示词**（模型必须遵守的规则）。模板随用户消息发给模型，系统提示词要求模型严格按模板输出，所以想换格式通常只改模板即可。周报、月报默认模板就是内置的四个小节，日报优化默认不套模板。两者都可随时「恢复默认」；与内置默认一致时不存副本，内置默认以后改进会自动跟随 |
| 调用参数 | 单次调用超时、单次汇总输入上限、三类任务的最大输出 tokens |
| 外观与安全 | 白天 / 夜晚主题；**访问保护**：直接在页面里启用、修改、关闭访问密码（见下） |

数值类选项的取值优先级：**页面设置 > 环境变量（仅超时与输入上限有）> 内置默认**，每项都会标明当前来源；清空输入框即回到后两者，所以原有靠环境变量配置的部署行为不变。模型、接口地址与密钥不在这里，仍在「大模型设置」页（`/settings`，要求启用访问保护才可编辑）。

### 在页面里设置访问密码

- **谁说了算**：环境变量 `APP_PASSWORD` 优先。已设置它时，页面只显示「由环境变量控制」，无权修改；没设置时，才可以在「设置中心 → 外观与安全」里管理密码。
- **存储**：只保存加盐的 scrypt 摘要，不存明文，任何接口都不会返回密码或摘要；同时生成一份随机的会话签名密钥。
- **启用**：未启用时直接设置（8~128 个字符），设置完成当前浏览器保持登录，其他浏览器需要输入密码。注意：未启用时本来就没有保护，任何人都可能抢先设置，请在启用前确认网络环境可信。
- **修改 / 关闭**：除已登录外还要再输入一次当前密码；错误次数与登录共用限流（10 分钟内 8 次）。修改密码会更换签名密钥，其他浏览器的登录立即全部失效。
- **「大模型设置」页**：只要启用了访问保护（环境变量或页面设置均可），该页就允许编辑。
- **忘记密码**：页面设置的密码无法找回，需手动清除数据库里的两条记录后重启即可恢复开放（`<DATA_DIR>` 默认 `./data`，容器内 `/data`）：

  ```bash
  node -e "const {DatabaseSync}=require('node:sqlite');new DatabaseSync('<DATA_DIR>/daily-report.db').exec(\"DELETE FROM settings WHERE key IN ('auth_password_hash','auth_session_secret')\")"
  ```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `APP_PASSWORD` | 空 | 设置后启用访问保护，且优先于设置中心里设置的密码 |
| `SESSION_SECRET` | 由密码派生 | 会话签名密钥，建议设为随机长串 |
| `COOKIE_SECURE` | `false` | HTTPS 访问时设为 `true` |
| `WEEK_START` | `1` | 周起始日默认值（0=周日…6=周六），设置中心里的页面设置优先 |
| `DATA_DIR` | `./data`（容器 `/data`） | SQLite 目录 |
| `PI_CODING_AGENT_DIR` | `~/.pi/agent`（容器 `/pi-config`） | 模型与密钥配置目录 |
| `LLM_PROVIDER` / `LLM_MODEL` | 空 | 覆盖默认模型 |
| `LLM_TIMEOUT_MS` | `120000` | 单次调用超时（1000~600000），设置中心里的页面设置优先 |
| `LLM_MAX_INPUT_CHARS` | `60000` | 单次汇总的输入上限，超出会明确报错而不是静默截断；设置中心里的页面设置优先 |
| `BIND_ADDR` / `APP_PORT` | `127.0.0.1` / `3000` | 宿主机监听地址与端口（仅 compose） |

## 错误提示一览

| 错误码 | 含义 | 处理 |
|---|---|---|
| `LLM_NO_MODEL` | 没有可用模型或配置文件有误 | 检查 `pi-config` 与 `LLM_*` 变量 |
| `LLM_AUTH` | 未配置或被拒绝的密钥 | 检查 `auth.json` / 环境变量 |
| `LLM_TIMEOUT` | 超时 | 重试，或调大 `LLM_TIMEOUT_MS` |
| `LLM_RATE_LIMITED` | 限流或额度不足 | 稍后重试 |
| `LLM_EMPTY` / `LLM_TRUNCATED` | 返回空内容 / 被截断 | 重试（截断的结果不会保存） |
| `LLM_UPSTREAM` | 其他上游失败 | 重试，查看服务端日志 |
| `NO_DAILY` / `NO_DATA` | 该周/月没有日报 | 先补充日报（此时不会调用模型） |
| `INPUT_TOO_LARGE` | 汇总输入过长 | 月报改用“周报”作为来源 |

接口只返回上述稳定错误码和中文提示；上游原始错误、内部地址仅写入服务端日志（已脱敏，不含日报内容与密钥）。

## 验证

```bash
npm run typecheck
npm test            # 单元与集成测试（faux provider + 本地假 OpenAI 服务，不需要密钥）
npm run build
npm run smoke       # 对构建产物做端到端冒烟：登录 → 记录日报 → 优化 → 周报 → 月报，含故障/重试/版本/跨月周
```

`npm test` 覆盖：日期与跨月周边界、覆盖/追加、优化与回退、周报/月报生成与版本、无日报不调用模型、并发保护、访问保护，以及走真实 pi-ai 调用链的 `models.json`/`auth.json`/环境变量解析和 401/429/500/空内容/截断/超时场景。

## 目录结构

```
src/app/api/…       接口（统一经 src/server/http.ts 的 route() 做鉴权、同源校验、错误转换、耗时日志）
src/server/         数据库、日报/周报/月报服务、会话
src/server/llm/     pi-ai 封装：配置加载、凭据存储、错误映射、提示词、事实校验
src/components/     日历、面板、设置中心与像素风组件
src/lib/prefs.ts    设置中心的共享定义（取值范围、状态类型）；后端见 src/server/prefs.ts
scripts/            fake-llm.mjs（假模型）、smoke.mjs（冒烟）、pack-prebuilt.mjs（预构建打包）
docs/DEPLOY.md      服务器部署文档
pi-config/          模型与密钥配置示例
```

## 已知限制

- 后台任务在服务进程内执行：服务重启或容器被停止会中断进行中的任务，重新启动后它们会被标记为“服务重启导致任务中断”，点重试即可。

- 单用户、单实例（进程内的并发互斥与登录限流不跨实例）。
- 周起始日改变后，已生成的周报仍按原起始日保存；日历按新起始日的周行匹配，不对齐的旧周报不会出现在周行按钮上。
- 优化稿的“不编造”由提示词约束并辅以数字核对提示，无法保证完全杜绝，请在采用前对照原文确认。
