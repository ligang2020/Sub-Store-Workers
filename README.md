# Sub-Store on Cloudflare Workers

将 [Sub-Store](https://github.com/sub-store-org/Sub-Store) 的后端适配为可部署到 **Cloudflare Workers** 的项目。原项目及其功能逻辑仍归原作者和贡献者所有；本仓库按照原项目的 **GPL-3.0** 许可证发布。

> 此仓库只部署后端。前端请使用官方页面：`https://sub-store.vercel.app?api=https://<你的-worker-域名>`。

## 架构

- Worker 将所有请求转发到名为 `default` 的单一 Durable Object。
- Durable Object 让原后端的同步数据访问保持串行安全，并以 Cloudflare Durable Object SQLite storage 持久化数据。
- 无需单独创建 KV、D1 或 R2 绑定；首次部署时 Wrangler 会创建 Durable Object 迁移。

## 一键部署（推荐）

### 1. Fork 或创建仓库

将本项目推送到你自己的 **公开或私有** GitHub 仓库。

### 2. 在 Cloudflare 创建 Worker

1. 在 Cloudflare Dashboard 中进入 **Workers & Pages**。
2. 创建一个 Worker，或在本地使用下面的 Wrangler 命令直接部署。
3. 记录部署后的 `*.workers.dev` 域名；也可绑定自己的域名。

### 3. 使用 Wrangler 部署

要求：Node.js 22+ 与 pnpm 11。

```bash
cd backend
corepack enable
pnpm install --frozen-lockfile
pnpm dlx wrangler@4.26.0 login
pnpm dlx wrangler@4.26.0 deploy
```

部署后，用浏览器访问：

```text
https://<你的-worker-域名>/
```

应返回后端环境信息。然后打开：

```text
https://sub-store.vercel.app?api=https://<你的-worker-域名>
```

## GitHub Actions 自动部署

仓库包含 `.github/workflows/deploy-workers.yml`。在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 添加：

- `CLOUDFLARE_API_TOKEN`：具有 Workers 编辑权限的 Cloudflare API Token。
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账户 ID。

推送到 `main` 分支时会自动运行 `wrangler deploy`。也可以手动触发 workflow。

## 配置 CORS

默认允许任意来源（`*`），便于官方前端使用。若只想允许自己的前端，在 `backend/wrangler.jsonc` 修改：

```jsonc
"vars": {
  "SUB_STORE_CORS_ALLOWED_ORIGINS": "https://sub-store.vercel.app,https://your-frontend.example"
}
```

修改后重新部署。不要在 `vars` 放令牌等私密信息；请使用 `wrangler secret put <NAME>`。

## 本地开发与验证

```bash
cd backend
pnpm dev:worker
# 另开终端：
curl http://localhost:8787/
```

运行原后端测试：

```bash
cd backend
pnpm test
```

## Workers 限制

此适配保留通常的订阅、集合、文件、备份与分享 API；数据存放在 Durable Object 中。但 Cloudflare Workers 不是完整 Node.js 服务器，以下 Node 专属能力不能使用或行为不同：

- 本地文件系统、前后端合并静态服务、`SUB_STORE_DATA_URL` 文件恢复。
- TCP/UDP/DoT DNS、代理链路和 Node 默认代理环境变量。
- Node cron 配置；请使用 Cloudflare Cron Triggers 配合专用 Worker 逻辑，而不是 Node 的 cron 环境变量。
- 依赖本地 MMDB 文件的地理信息能力。

此外，Worker 的出站请求受 Cloudflare 平台限制。请确认你的订阅源允许来自 Cloudflare 网络的访问。

## 升级上游

该项目基于 Sub-Store 上游源码。升级时建议以一个清晰的提交合并上游改动，并重新验证 Worker 构建及 API 行为。

## 安全提示

Sub-Store 数据可能包含订阅 URL、节点信息和 GitHub/GitLab 备份令牌。请：

- 使用仅自己可访问的 Worker 域名或 Cloudflare Access 保护管理端；
- 为 Gist/GitLab 使用最小权限令牌；
- 如不需要跨域访问，将 CORS 改为明确的前端域名；
- 定期从 `/api/storage` 导出备份。

## 致谢与许可证

- 上游项目：[sub-store-org/Sub-Store](https://github.com/sub-store-org/Sub-Store)
- 许可证：[GPL-3.0](LICENSE)
