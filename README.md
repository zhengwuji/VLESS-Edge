# VLESS Edge Worker 完整详细使用说明

## 📋 目录
1. [系统简介](#系统简介)
2. [前置准备](#前置准备)
3. [3x-ui 后端配置](#3x-ui-后端配置)
4. [Cloudflare Workers 部署](#cloudflare-workers-部署)
5. [域名和路由配置](#域名和路由配置)
6. [首次配置](#首次配置)
7. [功能详解](#功能详解)
8. [订阅使用](#订阅使用)
9. [安全功能](#安全功能)
10. [常见问题](#常见问题)

---

## 系统简介

这是一个基于 Cloudflare Workers 的 VLESS 代理系统，具有以下特点：

- ✅ **可视化管理面板**：通过 Web 界面配置节点
- ✅ **密码保护**：管理后台需要密码登录
- ✅ **防暴力破解**：自动锁定多次失败登录的 IP
- ✅ **多节点支持**：可配置多个前端节点
- ✅ **多种订阅格式**：支持 v2rayN、SingBox、Clash
- ✅ **HTTP RTT 自动优选**：根据客户端 IP 自动选择最快的 5 个 IP
- ✅ **内置测速工具**：可测试节点延迟和下载速度

---

## 前置准备

### 1. 所需资源

- **Cloudflare 账号**（免费版即可）
- **域名**（可选，可使用 Cloudflare Workers 免费域名）
- **VPS 服务器**（用于运行 3x-ui/Xray 后端）
- **3x-ui 面板**（用于管理 Xray 后端配置）

### 2. 域名准备

假设你的域名是 `xxxxxx.com`，你需要：

- **Worker 域名**：`ech1.xxxxxx.com`（用于前端访问）
- **后端域名**：`cc1.xxxxxx.com`（指向你的 VPS IP）

> 💡 **提示**：如果使用 Cloudflare Workers 免费域名，格式为 `your-worker-name.your-subdomain.workers.dev`

---

## 3x-ui 后端配置

### 步骤 1：安装 3x-ui

在你的 VPS 上安装 3x-ui 面板：

```bash
# 使用一键安装脚本
bash <(curl -Ls https://raw.githubusercontent.com/MHSanaei/3x-ui/master/install.sh)
```

安装完成后，访问 `http://你的VPS_IP:2053` 进行初始配置。

### 步骤 2：创建入站配置

1. 登录 3x-ui 面板
2. 进入 **入站列表** → **添加入站**
3. 配置如下：

#### 基础配置

- **备注**：`VLESS-WS`（可自定义）
- **协议**：选择 `VLESS`
- **监听 IP**：`0.0.0.0`（监听所有网卡）
- **端口**：`2082`（可自定义，但需要与 Worker 配置中的后端端口一致）
- **传输方式**：`WebSocket (ws)`

#### WebSocket 配置

- **路径**：`/echws`（可自定义，但需要与 Worker 配置中的 WS 路径一致）
- **Host**：留空或填写你的后端域名 `cc1.xxxxxx.com`

#### 用户配置

- **UUID**：点击 **生成** 按钮生成一个新的 UUID
  - 或者使用命令生成：`uuidgen`（Linux/Mac）或 `powershell -Command "[guid]::NewGuid()"`（Windows）
- **流控**：`none`（VLESS 协议）
- **加密方式**：`none`（VLESS 协议）

#### 完整配置示例

```
备注：VLESS-WS
协议：VLESS
监听IP：0.0.0.0
端口：2082
传输方式：WebSocket (ws)
WebSocket路径：/echws
UUID：12345678-1234-1234-1234-123456789abc（你的UUID）
流控：none
加密：none
```

### 步骤 3：配置防火墙

确保 VPS 防火墙允许后端端口（例如 2082）：

```bash
# Ubuntu/Debian (ufw)
sudo ufw allow 2082/tcp

# CentOS/RHEL (firewalld)
sudo firewall-cmd --permanent --add-port=2082/tcp
sudo firewall-cmd --reload

# 或者直接关闭防火墙（不推荐，仅用于测试）
sudo ufw disable
```

### 步骤 4：配置域名解析

将后端域名解析到你的 VPS IP：

1. 登录你的域名服务商（如 Cloudflare、阿里云等）
2. 添加 A 记录：
   - **主机记录**：`cc1`
   - **记录类型**：`A`
   - **记录值**：你的 VPS IP 地址（例如：`1.2.3.4`）
   - **TTL**：`自动` 或 `600`

3. 等待 DNS 生效（通常几分钟）

### 步骤 5：验证后端配置

测试后端是否正常工作：

```bash
# 在 VPS 上测试端口是否开放
netstat -tlnp | grep 2082

# 或者使用 curl 测试（如果配置了 HTTP 响应）
curl http://localhost:2082/echws
```

---

## Cloudflare Workers 部署

### 步骤 1：创建 KV Namespace

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** → **KV**
3. 点击 **Create a namespace**
4. 输入名称（例如：`VLESS_CONFIG`）
5. 点击 **Add**

### 步骤 2：创建 Worker

1. 在 **Workers & Pages** 中点击 **Create application**
2. 选择 **Create Worker**
3. 输入 Worker 名称（例如：`vless-proxy`）
4. 点击 **Deploy**

### 步骤 3：绑定 KV Namespace

1. 进入你创建的 Worker
2. 点击 **Settings** → **Variables**
3. 在 **KV Namespace Bindings** 部分点击 **Add binding**
4. **Variable name** 填写：`CONFIG_KV`（必须完全一致）
5. **KV namespace** 选择刚才创建的 `VLESS_CONFIG`
6. 点击 **Save**

### 步骤 4：上传代码

1. 在 Worker 编辑页面，删除默认代码
2. 将 `3.js` 文件中的全部代码复制粘贴进去
3. 点击 **Save and deploy**

### 步骤 5：配置自定义域名（推荐）

#### 方法 1：使用 Cloudflare 管理的域名

1. 在 Worker 页面点击 **Triggers** → **Custom Domains**
2. 点击 **Add Custom Domain**
3. 输入你的域名（例如：`ech1.xxxxxx.com`）
4. 系统会自动配置 DNS 记录
5. 等待 DNS 生效（通常几分钟）

#### 方法 2：手动配置 DNS

如果域名不在 Cloudflare 管理，需要手动添加 DNS 记录：

1. 登录你的域名服务商
2. 添加 CNAME 记录：
   - **主机记录**：`ech1`
   - **记录类型**：`CNAME`
   - **记录值**：`your-worker-name.your-subdomain.workers.dev`
   - **TTL**：`自动` 或 `600`

3. 等待 DNS 生效

---

## 域名和路由配置

### 完整域名配置示例

假设你的域名是 `xxxxxx.com`，VPS IP 是 `1.2.3.4`：

#### DNS 记录配置

| 主机记录 | 记录类型 | 记录值 | 说明 |
|---------|---------|-------|------|
| `ech1` | `CNAME` | `vless-proxy.your-subdomain.workers.dev` | Worker 前端域名 |
| `cc1` | `A` | `1.2.3.4` | 后端 VPS IP |

#### 路由配置说明

**Worker 路由**（自动配置）：
- `https://ech1.xxxxxx.com/` → 管理面板
- `https://ech1.xxxxxx.com/sub` → v2rayN 订阅
- `https://ech1.xxxxxx.com/speedtest` → 测速页面
- `https://ech1.xxxxxx.com/speed.bin` → 测速文件

**后端路由**（3x-ui 配置）：
- `http://cc1.xxxxxx.com:2082/echws` → Xray WebSocket 入站

### 多节点配置示例

如果需要配置多个前端节点：

| 主机记录 | 记录类型 | 记录值 | 说明 |
|---------|---------|-------|------|
| `ech1` | `CNAME` | `vless-proxy.your-subdomain.workers.dev` | 主节点 |
| `ech2` | `CNAME` | `vless-proxy.your-subdomain.workers.dev` | 节点2 |
| `ech3` | `CNAME` | `vless-proxy.your-subdomain.workers.dev` | 节点3 |
| `cc1` | `A` | `1.2.3.4` | 后端 VPS IP |

所有前端节点可以指向同一个 Worker，在管理面板中配置多节点列表即可。

---

## 首次配置

### 1. 访问管理后台

在浏览器中访问你的 Worker 域名：
- 如果使用自定义域名：`https://ech1.xxxxxx.com`
- 如果使用 Workers 域名：`https://vless-proxy.your-subdomain.workers.dev`

### 2. 设置管理员密码

首次访问会自动跳转到登录页面，此时：

1. 在密码输入框中设置你的管理员密码（例如：`MySecurePassword123!`）
2. （可选）勾选 **记住我 1 天**
3. 点击 **登录 / 保存密码**

> ⚠️ **重要**：请妥善保管密码，忘记密码需要删除 KV 中的 `ADMIN_PASSWORD` 键才能重置。

### 3. 配置基础参数

登录成功后，进入管理面板，填写以下必填项：

#### 基础参数配置

- **UUID（必填）**：
  - 从 3x-ui 面板中复制你创建的入站的 UUID
  - 示例：`12345678-1234-1234-1234-123456789abc`

- **Worker 域名（必填）**：
  - 填写你的 Worker 访问域名
  - 示例：`ech1.xxxxxx.com` 或 `vless-proxy.your-subdomain.workers.dev`

- **WS 路径（必填）**：
  - 必须与 3x-ui 中配置的 WebSocket 路径一致
  - 示例：`/echws`

- **后端 VPS 域名（必填）**：
  - 填写指向你 VPS 的域名
  - 示例：`cc1.xxxxxx.com`
  - 确保该域名已解析到你的 VPS IP

- **后端端口（必填）**：
  - 必须与 3x-ui 中配置的入站端口一致
  - 示例：`2082`

#### 完整配置示例

```
UUID：12345678-1234-1234-1234-123456789abc
Worker 域名：ech1.xxxxxx.com
WS 路径：/echws
后端 VPS 域名：cc1.xxxxxx.com
后端端口：2082
```

### 4. 保存配置

1. 检查所有必填项是否已填写
2. 点击 **💾 保存配置到 KV**
3. 看到 **✅ 已保存配置** 提示即表示成功

### 5. 验证配置

1. 在管理面板查看订阅链接
2. 复制订阅链接到 v2rayN 测试连接
3. 如果连接成功，说明配置正确

---

## 功能详解

### 1. 线路检测

管理面板会自动显示：

- **当前线路状态**：你的地理位置信息
- **入口节点**：Cloudflare 的 colo（机房代码）
- **线路评分**：A/B/C 三个等级
- **优化建议**：根据当前线路给出建议
- **推荐 IP 段**：适合中国大陆访问的 Cloudflare IP 段

> 💡 **提示**：
> - A 级：HKG（香港）、TPE（台北）、SIN（新加坡）等亚洲节点，适合中国大陆
> - B 级：LAX（洛杉矶）、SJC（圣何塞）等北美节点，延迟略高但可用
> - C 级：其他地区节点，建议更换 IP

### 2. IP 自动优选

系统会根据客户端 IP 自动选择最快的 5 个 Cloudflare IP：

- **订阅时自动优选**：每次 v2rayN 更新订阅时，系统会根据获取订阅的 IP 进行 HTTP RTT 测速
- **测速页面优选**：在测速页面可以手动测试，使用访问测速页面的 IP 进行测速
- **信息节点**：订阅列表第一条会显示用于优选的 IP 和国家信息

### 3. 速度测试工具

#### 访问测速页面

1. 在管理面板点击 **打开测速页面（新窗口）**
2. 或直接访问：`https://ech1.xxxxxx.com/speedtest`

> ⚠️ **注意**：测速页面需要登录才能访问

#### IP 优选测速

1. 点击 **开始 IP 优选测速**
2. 系统会使用当前访问 IP 测试 40+ 个 Cloudflare IP
3. 显示最快的 5 个 IP 及其 RTT 延迟

#### HTTP RTT 测速

1. 设置测试次数（1-20 次）
2. 点击 **开始 HTTP RTT 测速**
3. 系统会多次测试当前域名的延迟
4. 显示平均、最小、最大、中位数 RTT

#### 批量测速

1. 在文本框中输入多个 URL，每行一个
2. 可以在 URL 后添加 `?size=数字` 指定文件大小
3. 点击 **开始批量测速**
4. 系统会依次测试每个 URL 的延迟和速度

### 4. 订阅链接

系统提供多种订阅格式：

#### v2rayN 订阅（Base64）

- **订阅地址**：`https://ech1.xxxxxx.com/sub`
- **使用方式**：
  1. 复制订阅地址
  2. 打开 v2rayN
  3. 订阅 → 添加订阅
  4. 粘贴订阅地址
  5. 更新订阅

#### 订阅参数说明

订阅地址支持以下查询参数：

- `/sub` 或 `/sub?ip=dual`（默认）：域名节点 + 5 个优选 IP 节点
- `/sub?ip=best` 或 `/sub?ip=ip`：仅 5 个优选 IP 节点
- `/sub?ip=domain` 或 `/sub?ip=none`：仅域名节点

**示例**：
- `https://ech1.xxxxxx.com/sub` - 域名 + 优选 IP（默认）
- `https://ech1.xxxxxx.com/sub?ip=best` - 仅优选 IP
- `https://ech1.xxxxxx.com/sub?ip=domain` - 仅域名

#### 订阅节点说明

订阅列表包含以下节点：

1. **信息节点**（第一条，无作用）：
   - 格式：`[信息] IP: xxx.xxx.xxx.xxx 国家: XX Colo: XXX`
   - 显示用于优选的客户端 IP 和国家信息
   - 无法连接，仅用于显示信息

2. **域名节点**（标记"未优选"）：
   - `主节点-未优选`
   - `节点1-未优选`、`节点2-未优选` 等（如果配置了多节点）

3. **优选 IP 节点**（标记"优选"）：
   - `优选1`、`优选2`、`优选3`、`优选4`、`优选5`
   - 根据 HTTP RTT 测速选出的最快 5 个 IP

#### 其他订阅格式

- **SingBox JSON**：`https://ech1.xxxxxx.com/singbox`
- **Clash Meta YAML**：`https://ech1.xxxxxx.com/clash`
- **节点二维码**：`https://ech1.xxxxxx.com/qrcode`

> 💡 **提示**：订阅链接是公开的，无需登录即可访问，方便客户端自动更新。

---

## 订阅使用

### v2rayN 客户端

1. **添加订阅**：
   - 打开 v2rayN
   - 订阅 → 订阅设置
   - 添加订阅地址：`https://ech1.xxxxxx.com/sub`
   - 点击确定

2. **更新订阅**：
   - 订阅 → 更新订阅
   - 或右键订阅 → 更新订阅

3. **选择节点**：
   - 在服务器列表中选择节点
   - 推荐使用标记为"优选"的 IP 节点
   - 右键 → 设为活动服务器

4. **查看信息节点**：
   - 订阅列表第一条是信息节点
   - 显示用于优选的 IP 和国家信息
   - 无法连接，可以忽略或删除

### SingBox 客户端

1. 访问 `https://ech1.xxxxxx.com/singbox`
2. 复制返回的 JSON 内容
3. 在 SingBox 客户端中导入配置

### Clash 客户端

1. 访问 `https://ech1.xxxxxx.com/clash`
2. 复制返回的 YAML 内容
3. 在 Clash 客户端中导入配置

---

## 安全功能

### 1. 密码保护

- 所有管理功能都需要登录
- 密码存储在 Cloudflare KV 中
- 支持"记住我 1 天"功能

### 2. 防暴力破解

系统自动防护机制：

- **最大失败次数**：5 次
- **锁定时间**：15 分钟
- **锁定范围**：基于客户端 IP

**工作流程**：
1. 密码错误时，系统记录失败次数
2. 显示剩余尝试次数（例如："剩余尝试次数：3"）
3. 达到 5 次失败后，锁定该 IP 15 分钟
4. 锁定期间无法登录，显示剩余锁定时间
5. 登录成功后，自动清除失败记录

**注意事项**：
- 锁定是基于 IP 的，更换网络或使用 VPN 可以绕过
- 初次设置密码不受限制
- 锁定过期后自动解除

### 3. 退出登录

1. 在管理面板右上角点击 **退出登录**
2. 或直接访问：`https://ech1.xxxxxx.com/logout`
3. 退出后需要重新登录才能访问管理功能

### 4. 路径保护

**需要登录的路径**：
- `/` - 管理面板首页
- `/index` - 管理面板首页
- `/speedtest` - 测速页面
- `/api/get-config` - 获取配置 API
- `/api/set-config` - 保存配置 API
- `/api/reset-config` - 重置配置 API
- `/api/test-ips` - IP 优选测速 API

**公开路径（无需登录）**：
- `/sub` - v2rayN 订阅
- `/singbox` - SingBox 配置
- `/clash` - Clash 配置
- `/qrcode` - 节点二维码
- `/speed.bin` - 测速文件下载

---

## 常见问题

### Q1: 忘记管理员密码怎么办？

**方法 1：删除 KV 中的密码键**
1. 进入 Cloudflare Dashboard
2. Workers & Pages → KV
3. 找到你的 KV Namespace
4. 删除 `ADMIN_PASSWORD` 键
5. 重新访问登录页面，可以设置新密码

**方法 2：删除整个 KV Namespace 重新创建**
- 注意：这会删除所有配置，需要重新配置

### Q2: 如何重置配置？

1. 登录管理面板
2. 点击 **🗑️ 清空节点配置**
3. 确认后配置会被清空
4. 需要重新填写并保存

### Q3: 订阅链接无法更新？

- 检查 Worker 是否正常运行
- 检查配置是否已保存
- 检查 UUID、域名、端口等必填项是否填写正确
- 检查 3x-ui 中的入站配置是否与 Worker 配置一致
- 尝试在浏览器中直接访问订阅地址，查看返回内容

### Q4: 连接失败怎么办？

1. **检查后端 VPS**：
   - 确认 3x-ui 正在运行
   - 确认 Xray 服务正在运行：`systemctl status xray`
   - 确认 WS 入站端口与配置一致（例如：2082）
   - 确认后端域名解析正确
   - 测试端口是否开放：`netstat -tlnp | grep 2082`

2. **检查 Worker 配置**：
   - UUID 是否正确（必须与 3x-ui 中的 UUID 一致）
   - WS 路径是否与 3x-ui 配置一致（例如：`/echws`）
   - 后端域名和端口是否正确

3. **检查防火墙**：
   - 确认 VPS 防火墙允许后端端口
   - 确认 Cloudflare 没有阻止请求

4. **检查 3x-ui 配置**：
   - 确认入站协议是 VLESS
   - 确认传输方式是 WebSocket
   - 确认路径与 Worker 配置一致
   - 确认端口与 Worker 配置一致

### Q5: 如何更换 Worker 域名？

1. 在 Cloudflare Dashboard 中配置新的自定义域名
2. 更新管理面板中的 **Worker 域名** 字段
3. 保存配置
4. 使用新域名访问

### Q6: 如何添加更多节点？

1. 在 DNS 中添加新的 CNAME 记录指向 Worker
2. 在管理面板的 **多节点列表** 部分
3. 点击 **➕ 添加节点**
4. 填写节点域名和备注
5. 保存配置
6. 订阅会自动包含新节点

### Q7: 如何修改后端配置？

1. 在 3x-ui 中修改入站配置
2. 如果修改了端口或路径，需要在 Worker 管理面板中同步更新
3. 保存配置后，订阅会自动更新

### Q8: IP 被锁定了怎么办？

- 等待 15 分钟自动解除
- 更换网络环境（使用移动网络或 VPN）
- 联系管理员清除 KV 中的 `LOGIN_ATTEMPTS_你的IP` 键

### Q9: 如何查看当前线路信息？

1. 登录管理面板，自动显示在顶部
2. 或访问：`https://ech1.xxxxxx.com/api/geo`（返回 JSON 格式）

### Q10: 订阅中的信息节点是什么？

- 信息节点是订阅列表的第一条
- 显示用于优选的客户端 IP 和国家信息
- 格式：`[信息] IP: xxx.xxx.xxx.xxx 国家: XX Colo: XXX`
- 无法连接，仅用于显示信息，可以忽略或删除

### Q11: 为什么优选 IP 节点连接失败？

- 优选 IP 是基于 HTTP RTT 测速选出的，但实际代理连接可能受其他因素影响
- 如果优选 IP 连接失败，可以尝试使用域名节点
- 或者重新更新订阅，系统会重新测速和优选

### Q12: 如何测试后端连接？

在 VPS 上测试：

```bash
# 测试端口是否开放
netstat -tlnp | grep 2082

# 测试 WebSocket 路径（需要安装 websocat）
websocat ws://localhost:2082/echws

# 或者使用 curl 测试 HTTP 响应（如果配置了）
curl http://localhost:2082/echws
```

### Q13: 3x-ui 和 Worker 配置不一致怎么办？

确保以下配置完全一致：

| 配置项 | 3x-ui | Worker |
|-------|-------|--------|
| UUID | 入站的 UUID | 管理面板的 UUID |
| 端口 | 入站的端口（例如：2082） | 管理面板的后端端口 |
| WS 路径 | WebSocket 路径（例如：/echws） | 管理面板的 WS 路径 |

### Q14: 如何查看 Worker 日志？

1. 进入 Cloudflare Dashboard
2. Workers & Pages → 你的 Worker
3. 点击 **Logs** 标签
4. 可以查看实时日志和错误信息

### Q15: 如何优化连接速度？

1. **选择合适的前端节点**：
   - 使用测速工具测试不同子域名
   - 选择延迟最低的节点

2. **使用优选 IP**：
   - 在订阅中使用标记为"优选"的 IP 节点
   - 这些 IP 是根据你的网络环境自动选出的

3. **优化后端配置**：
   - 确保 VPS 网络稳定
   - 选择地理位置较近的 VPS

4. **使用多节点**：
   - 配置多个前端节点
   - 在不同网络环境下测试，选择最佳节点

---

## 配置检查清单

在开始使用前，请确认以下配置：

### 3x-ui 配置
- [ ] 已安装 3x-ui 并可以访问面板
- [ ] 已创建 VLESS 入站配置
- [ ] UUID 已生成并记录
- [ ] 端口已设置（例如：2082）
- [ ] WebSocket 路径已设置（例如：/echws）
- [ ] 防火墙已开放后端端口

### DNS 配置
- [ ] 后端域名 A 记录已添加（例如：cc1.xxxxxx.com → VPS IP）
- [ ] Worker 域名 CNAME 记录已添加（例如：ech1.xxxxxx.com → Worker）

### Cloudflare Workers 配置
- [ ] 已创建 KV Namespace
- [ ] KV 已绑定到 Worker（绑定名：CONFIG_KV）
- [ ] Worker 代码已上传
- [ ] 自定义域名已配置（可选）

### Worker 管理面板配置
- [ ] 管理员密码已设置
- [ ] UUID 已填写（与 3x-ui 一致）
- [ ] Worker 域名已填写
- [ ] WS 路径已填写（与 3x-ui 一致）
- [ ] 后端域名已填写
- [ ] 后端端口已填写（与 3x-ui 一致）
- [ ] 配置已保存

### 测试验证
- [ ] 可以访问管理面板
- [ ] 可以获取订阅链接
- [ ] v2rayN 可以成功连接
- [ ] 可以正常使用代理

---

## 更新日志

### 最新版本功能

- ✅ HTTP RTT 自动优选（根据客户端 IP 选择最快的 5 个 IP）
- ✅ 信息节点显示（显示用于优选的 IP 和国家）
- ✅ 自定义测速文件大小（0.1MB - 100MB）
- ✅ 退出登录功能
- ✅ 路径密码验证保护
- ✅ 防暴力破解机制（5 次失败锁定 15 分钟）
- ✅ 订阅链接保持公开，无需登录
- ✅ 测速页面需要登录保护

---

## 技术支持

如果遇到问题：

1. 检查 Cloudflare Workers 日志
2. 检查 KV 存储中的数据
3. 查看浏览器控制台错误信息
4. 确认所有配置项填写正确
5. 确认 3x-ui 和 Worker 配置一致

---

**祝使用愉快！** 🚀

