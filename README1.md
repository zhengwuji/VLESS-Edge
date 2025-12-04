# ECH-Workers GitHub 部署模板

本仓库用于 **Cloudflare Workers + ECH 代理面板** 的 GitHub 一键部署。

## 使用步骤简要

1. 在 GitHub 新建仓库（例如 `ech-worker`），把本项目所有文件上传上去：
   - `worker.js`
   - `wrangler.toml`
   - `README.md`

2. Cloudflare 后台：Workers & Pages → Workers → Create Worker → Continue with GitHub，选择这个仓库。

3. 创建完成后，在 Worker 设置里：
   - Settings → Variables → KV Namespace Bindings：
     - 绑定名：`CONFIG_KV`
     - 选择你创建的 KV 命名空间。
   - Triggers → Routes：添加 `ec.yourdomain.com/*` 这样的路由。

4. DNS 中保证：`ec.yourdomain.com` 为橙云（Proxied）。

5. 浏览器访问 `https://ec.yourdomain.com/` 进入面板，按提示填写 UUID、Worker 域名、WS 路径、后端域名和端口即可。
