# Sub-Store on Cloudflare Workers

将 [Sub-Store](https://github.com/sub-store-org/Sub-Store) 的后端和官方开源前端一起适配为可部署到 **Cloudflare Workers** 的项目。原项目及其功能逻辑仍归原作者和贡献者所有；本仓库按照原项目的 **GPL-3.0** 许可证发布。

> Worker 使用同一域名提供管理前端和 API，并内置仅“用户名 + 密码”的登录保护；**没有图片验证码**。

## 架构

- Worker 使用 Cloudflare Assets 提供已打包、随 `backend/assets/` 一同提交的官方 Sub-Store 管理前端，并将 `/api/*` 请求转发到名为 `default` 的单一 Durable Object。
- 登录网关只需要用户名和密码；登录 Cookie 为 `HttpOnly`、`Secure`（HTTPS）且有效期为 7 天。
- Durable Object 让原后端的同步数据访问保持串行安全，并以 Cloudflare Durable Object SQLite storage 持久化数据。
- 无需单独创建 KV、D1 或 R2 绑定；首次部署时 Wrangler 会创建 Durable Object 迁移。

## 一键部署（推荐）

点击下面的 Cloudflare 按钮，即可将本项目部署到你的 Cloudflare Workers：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fligang2020%2FSub-Store-Workers%2Ftree%2Fmain%2Fbackend)

### 部署后首次设置登录密码

部署完成后，在 Cloudflare Dashboard 中打开对应 Worker：**Settings → Variables and Secrets**。

1. 新建一个 **Encrypted secret**：

   ```text
   SUB_STORE_ADMIN_PASSWORD
   ```

   值设为你自己的长密码。该变量是必填项，未设置时页面会显示初始化提示，不会出现验证码。

2. 可选：新建普通变量 `SUB_STORE_ADMIN_USERNAME`。未设置时用户名为：

   ```text
   admin
   ```

3. 保存后，访问 Worker 的 `*.workers.dev` 地址或绑定的自定义域名，使用上面的用户名和密码登录。

### 使用 Wrangler 手动部署

要求：Node.js 22+ 与 pnpm 11。

```bash
# 构建同域管理前端
cd frontend
corepack enable
pnpm install --frozen-lockfile
pnpm build

# 将前端构建产物同步到独立的 Worker 部署目录
cd ../backend
pnpm sync:assets
pnpm install --frozen-lockfile
pnpm dlx wrangler@4.26.0 login
pnpm dlx wrangler@4.26.0 deploy
```

然后在 Cloudflare Dashboard 为 Worker 添加 `SUB_STORE_ADMIN_PASSWORD` Secret。开发环境可将 `backend/.dev.vars.example` 复制为 `backend/.dev.vars` 后填写本地密码。

## GitHub Actions 自动部署

仓库包含 `.github/workflows/deploy-workers.yml`。在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 添加：

- `CLOUDFLARE_API_TOKEN`：具有 Workers 编辑权限的 Cloudflare API Token。
- `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账户 ID。

此外，请在 Cloudflare Worker 的 **Variables and Secrets** 中设置 `SUB_STORE_ADMIN_PASSWORD`（不要将该密码作为 GitHub Actions Secret 或写入仓库）。

推送到 `main` 分支时会自动运行 `wrangler deploy`。也可以手动触发 workflow。

## 配置 CORS

管理前端与 API 同域部署，默认 CORS 为任意来源（`*`）。如果还要让其它前端域名访问 API，可在 `backend/wrangler.jsonc` 修改：

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

- 必须设置强且唯一的 `SUB_STORE_ADMIN_PASSWORD` Secret；不要使用截图中常见的 `admin/admin` 默认密码；
- 如需额外保护，使用 Cloudflare Access 或仅自己可访问的自定义域名；
- 为 Gist/GitLab 使用最小权限令牌；
- 如不需要跨域访问，将 CORS 改为明确的前端域名；
- 定期从 `/api/storage` 导出备份。

## 致谢与许可证

- 上游项目：[sub-store-org/Sub-Store](https://github.com/sub-store-org/Sub-Store)
- 许可证：[GPL-3.0](LICENSE)
