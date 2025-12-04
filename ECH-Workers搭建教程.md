# ECH-Workers 完整搭建教程
## 使用 3X-UI 后端 + v2rayN 客户端

---

## 📋 目录

1. [准备工作](#准备工作)
2. [Cloudflare Worker 部署](#cloudflare-worker-部署)
3. [3X-UI 后端配置](#3x-ui-后端配置)
4. [v2rayN 客户端配置](#v2rayn-客户端配置)
5. [故障排查](#故障排查)
6. [配置检查清单](#配置检查清单)

---

## 一、准备工作

### 1.1 所需资源

- ✅ Cloudflare 账号（免费版即可）
- ✅ 一台 VPS（用于运行 3X-UI）
- ✅ 一个域名（可选，用于绑定 Worker）
- ✅ v2rayN 客户端（Windows）

### 1.2 环境变量准备

在开始前，准备好以下信息：
- **ADMIN_PASSWORD**: 管理后台密码（自定义）
- **SESSION_SECRET**: 会话加密密钥（建议使用随机字符串）

---

## 二、Cloudflare Worker 部署

### 2.1 创建 Worker

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 **Workers & Pages** → **Create application** → **Create Worker**
3. 输入 Worker 名称（例如：`ech-workers`）
4. 点击 **Deploy**

### 2.2 上传代码

#### 方法一：通过 GitHub 自动部署（推荐）

1. 将 `ECH-Workers-V3V4-Full.zip` 解压
2. 创建 GitHub 仓库，上传解压后的文件
3. 在 Cloudflare Dashboard 中：
   - 进入 **Workers & Pages** → 选择你的 Worker
   - 点击 **Settings** → **Integrations** → **GitHub**
   - 连接 GitHub 仓库，启用自动部署

#### 方法二：手动上传

1. 在 Worker 编辑器中，删除默认代码
2. 将 `index.js` 的内容复制粘贴进去
3. 点击 **Save and deploy**

### 2.3 配置环境变量

1. 进入 Worker **Settings** → **Variables**
2. 添加以下环境变量：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `ADMIN_PASSWORD` | 你的密码 | 管理后台登录密码 |
| `SESSION_SECRET` | 随机字符串 | 用于加密 Cookie（建议 32 位以上） |

**生成 SESSION_SECRET 的方法：**
```bash
# Linux/Mac
openssl rand -hex 32

# 或使用在线工具生成随机字符串
```

### 2.4 绑定自定义域名（可选）

1. 进入 Worker **Settings** → **Triggers**
2. 在 **Custom Domains** 中添加你的域名
3. 例如：`ech.yourdomain.com`

---

## 三、3X-UI 后端配置

### 3.1 安装 3X-UI

在 VPS 上执行：

```bash
# 下载并安装 3X-UI
bash <(curl -Ls https://raw.githubusercontent.com/MHSanaei/3x-ui/master/install.sh)

# 安装完成后，访问管理面板
# 默认地址：http://你的VPS_IP:2053
# 默认用户名：admin
# 默认密码：admin
```

### 3.2 创建 VLESS 入站

1. 登录 3X-UI 管理面板
2. 进入 **入站列表** → **添加入站**

#### 配置参数：

| 参数 | 值 | 说明 |
|------|-----|------|
| **备注** | `ECH-Workers后端` | 自定义名称 |
| **协议** | `VLESS` | 选择 VLESS |
| **端口** | `2082` | 建议使用 2082（或自定义，需与 Worker 配置一致） |
| **UUID** | 生成或自定义 | 记录此 UUID，后续在 Worker 中配置 |
| **传输协议** | `WebSocket` | 选择 WebSocket |
| **路径** | `/echws` | 建议使用 `/echws`（需与 Worker 配置一致） |
| **TLS** | ❌ **关闭** | **重要：后端不需要 TLS** |

#### 详细配置步骤：

1. **基础设置**
   - 备注：`ECH-Workers后端`
   - 协议：选择 `VLESS`
   - 端口：`2082`（或你自定义的端口）
   - UUID：点击生成，或使用自定义 UUID

2. **传输设置**
   - 传输协议：选择 `WebSocket`
   - 路径：`/echws`
   - Host：留空或填写你的 VPS 域名

3. **TLS 设置**
   - **TLS：关闭** ⚠️ **重要：必须关闭 TLS**

4. **其他设置**
   - 流控：留空
   - 加密：`none`
   - 其他保持默认

5. 点击 **添加** 完成创建

### 3.3 检查防火墙

确保 VPS 防火墙开放了后端端口：

```bash
# Ubuntu/Debian (ufw)
sudo ufw allow 2082/tcp

# CentOS/RHEL (firewalld)
sudo firewall-cmd --permanent --add-port=2082/tcp
sudo firewall-cmd --reload

# 或直接关闭防火墙（不推荐生产环境）
sudo ufw disable
```

### 3.4 验证后端服务

在 VPS 上测试：

```bash
# 检查端口是否监听
netstat -tlnp | grep 2082
# 或
ss -tlnp | grep 2082

# 检查 Xray 服务状态
systemctl status xray
```

---

## 四、Worker 管理面板配置

### 4.1 访问管理面板

1. 打开浏览器，访问你的 Worker 域名
   - 例如：`https://ech-workers.your-username.workers.dev`
   - 或自定义域名：`https://ech.yourdomain.com`

2. 首次访问会提示设置密码，输入 `ADMIN_PASSWORD` 环境变量中设置的密码

### 4.2 配置节点参数

在管理面板中填写以下信息：

| 参数 | 值 | 说明 |
|------|-----|------|
| **UUID** | 3X-UI 中创建的 UUID | 从 3X-UI 入站配置中复制 |
| **Worker 域名** | 你的 Worker 域名 | 例如：`ech.yourdomain.com` |
| **WS 路径** | `/echws` | 与 3X-UI 配置一致 |
| **后端 VPS 域名** | 你的 VPS IP 或域名 | 例如：`1.2.3.4` 或 `vps.yourdomain.com` |
| **后端端口** | `2082` | 与 3X-UI 配置一致 |

#### 详细步骤：

1. **基础参数配置**
   ```
   UUID: d50b4326-41b4-455b-899f-9452690286fe  (从 3X-UI 复制)
   Worker 域名: ech.yourdomain.com
   WS 路径: /echws
   后端 VPS 域名: 1.2.3.4  (你的 VPS IP)
   后端端口: 2082
   ```

2. **WebSocket 代理模式**
   - 选择 **方式 A（稳定型，推荐）**

3. **混淆设置**（可选）
   - Fake Host: 留空或填写 `cdn.jsdelivr.net`
   - SNI: 留空或填写 `www.cloudflare.com`
   - User-Agent: 留空

4. 点击 **💾 保存配置到 Cookie**

### 4.3 获取订阅链接

1. 在管理面板的 **订阅 & 导入** 区域
2. 复制 **v2rayN 订阅（Base64）** 链接
   - 例如：`https://ech.yourdomain.com/sub`

---

## 五、v2rayN 客户端配置

### 5.1 安装 v2rayN

1. 下载 v2rayN：
   - GitHub: https://github.com/2dust/v2rayN/releases
   - 下载最新版本的 `v2rayN-Core.zip`

2. 解压到任意目录（例如：`C:\v2rayN`）

3. 运行 `v2rayN.exe`

### 5.2 添加订阅

1. 打开 v2rayN
2. 点击 **订阅** → **订阅设置**
3. 点击 **添加**，填写：
   - **备注**：`ECH-Workers`
   - **地址（URL）**：粘贴从 Worker 管理面板复制的订阅链接
     - 例如：`https://ech.yourdomain.com/sub`
4. 点击 **确定**

### 5.3 更新订阅

1. 点击 **订阅** → **更新订阅（不通过代理）**
2. 等待更新完成
3. 节点列表会显示你的节点

### 5.4 选择节点并连接

1. 在 **服务器** 列表中选择你的节点
2. 右键点击节点 → **设为活动服务器**
3. 点击系统托盘中的 v2rayN 图标
4. 选择 **Http 代理** → **开启代理** 或 **开启自动配置系统代理**

### 5.5 验证连接

1. 打开浏览器访问：https://www.google.com
2. 或访问：https://ip.sb 查看当前 IP
3. 如果显示 Cloudflare IP，说明连接成功

---

## 六、故障排查

### 6.1 常见错误 "-1"

**原因：** Worker 无法连接到后端 VPS

**解决方法：**

1. **检查后端端口**
   ```bash
   # 在 VPS 上检查端口是否开放
   netstat -tlnp | grep 2082
   ```

2. **检查防火墙**
   ```bash
   # 确保防火墙允许 Cloudflare IP 访问
   sudo ufw allow from 0.0.0.0/0 to any port 2082
   ```

3. **检查 3X-UI 配置**
   - 确认端口与 Worker 配置一致
   - 确认路径与 Worker 配置一致
   - 确认 TLS 已关闭

4. **检查 Worker 配置**
   - 后端域名是否正确（IP 或域名）
   - 后端端口是否正确
   - WS 路径是否正确

### 6.2 无法访问管理面板

1. 检查环境变量是否设置
2. 检查 `ADMIN_PASSWORD` 是否正确
3. 清除浏览器 Cookie 后重试

### 6.3 订阅链接无法访问

1. 检查 Worker 是否正常部署
2. 检查 Worker 域名是否正确
3. 尝试直接访问：`https://你的域名/sub`

### 6.4 v2rayN 无法连接

1. **检查节点配置**
   - 右键节点 → **编辑服务器**
   - 确认 UUID、地址、端口、路径都正确

2. **检查系统代理**
   - 确认已开启系统代理
   - 检查代理端口（默认 10808）

3. **查看日志**
   - v2rayN → **查看日志**
   - 查看具体错误信息

---

## 七、配置检查清单

### ✅ Worker 配置检查

- [ ] Worker 已成功部署
- [ ] 环境变量 `ADMIN_PASSWORD` 已设置
- [ ] 环境变量 `SESSION_SECRET` 已设置
- [ ] 自定义域名已绑定（如使用）
- [ ] 管理面板可以正常访问
- [ ] UUID 与 3X-UI 配置一致
- [ ] 后端端口与 3X-UI 配置一致
- [ ] WS 路径与 3X-UI 配置一致

### ✅ 3X-UI 后端检查

- [ ] 3X-UI 已成功安装
- [ ] VLESS 入站已创建
- [ ] 端口已正确配置（默认 2082）
- [ ] 路径已正确配置（默认 /echws）
- [ ] TLS 已关闭
- [ ] UUID 已记录
- [ ] 防火墙已开放端口
- [ ] Xray 服务正在运行

### ✅ v2rayN 客户端检查

- [ ] v2rayN 已安装
- [ ] 订阅链接已添加
- [ ] 订阅已更新
- [ ] 节点已选择
- [ ] 系统代理已开启
- [ ] 可以正常访问外网

---

## 八、高级配置

### 8.1 多节点配置

在 Worker 管理面板的 **多节点列表** 中：
1. 点击 **➕ 添加节点**
2. 填写节点域名和备注
3. 保存配置
4. 订阅会自动包含所有节点

### 8.2 使用优选 IP

1. 在管理面板查看 **当前线路状态**
2. 根据建议的 IP 段，配置 DNS 解析
3. 将多个子域名指向不同 IP
4. 在 **多节点列表** 中添加这些域名

### 8.3 混淆设置（方式 B）

如果需要更强的伪装：
1. 选择 **方式 B（高级混淆）**
2. 填写 Fake Host、SNI、User-Agent
3. 保存配置

---

## 九、性能优化建议

1. **选择优质 VPS**
   - 推荐使用 CN2 GIA 或 BGP 线路的 VPS
   - 延迟低、带宽充足

2. **使用 Cloudflare 优选 IP**
   - 通过 DNS 解析到延迟最低的 IP
   - 使用测速工具选择最优 IP

3. **合理配置节点**
   - 不要添加过多节点
   - 选择延迟最低的节点使用

---

## 十、安全建议

1. **定期更换密码**
   - 定期更换 `ADMIN_PASSWORD`
   - 定期更换 `SESSION_SECRET`

2. **使用强密码**
   - 密码长度至少 16 位
   - 包含大小写字母、数字、特殊字符

3. **限制访问**
   - 使用 Cloudflare Access 限制管理面板访问
   - 或使用 IP 白名单

---

## 📞 技术支持

如遇到问题，请检查：
1. Worker 日志：Cloudflare Dashboard → Workers → Logs
2. 3X-UI 日志：管理面板 → 日志
3. v2rayN 日志：查看日志功能

---

## 🎉 完成！

按照以上步骤，你应该已经成功搭建了 ECH-Workers 代理服务。享受高速、稳定的代理体验吧！

---

**最后更新：** 2024年
**版本：** ECH-Workers V3V4 (No KV)

