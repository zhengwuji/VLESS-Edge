// ECH-Workers V3+V4: 静态前端 + Worker API + ECH 批量节点生成（无 KV）
// -----------------------------------------------------------------
// 特点：
// 1. 不依赖 KV / 数据库存储，所有配置通过 URL / 前端 localStorage 保存。
// 2. Worker 负责：
//    - 返回前端页面（纯静态 HTML/JS）
//    - 提供 /sub 接口，根据 cfg 参数生成订阅（支持 IP 落地 / 多域名 / 备注前缀）。
// 3. 前端页面负责：
//    - 输入 UUID / 域名列表 / IP 列表 / WS 路径 / 端口 / 备注前缀
//    - 本地生成节点列表，也可以生成 Worker 订阅链接。

/**
 * 工具函数：base64url 编解码
 */
function b64encode(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64decode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return decodeURIComponent(escape(atob(str)));
}

/**
 * 生成单个 VLESS+TLS+WS 节点 URL
 * addr: 实际连接的地址（可为 IP 或域名）
 * host: TLS SNI / Host 头（一般为 CDN 域名）
 */
function buildVlessNode({ uuid, addr, port, host, path, remark }) {
  const p = new URLSearchParams({
    encryption: "none",
    security: "tls",
    type: "ws",
    host,
    sni: host,
    path,
  });
  return `vless://${uuid}@${addr}:${port}?${p.toString()}#${encodeURIComponent(
    remark
  )}`;
}

/**
 * 根据配置 JSON 批量生成节点列表
 * cfg 结构示例：
 * {
 *   "uuid": "...",
 *   "port": 443,
 *   "wsPath": "/echws",
 *   "hosts": ["ech1.example.com", "ech2.example.com"],
 *   "ips": ["1.1.1.1", "1.0.0.1"], // 可为空
 *   "remarkPrefix": "ECH"
 * }
 */
function generateNodesFromConfig(cfg) {
  const nodes = [];
  const uuid = (cfg.uuid || "").trim();
  if (!uuid) return nodes;
  const port = cfg.port || 443;
  const wsPath = cfg.wsPath || "/echws";
  const hosts = Array.isArray(cfg.hosts) ? cfg.hosts : [];
  const ips = Array.isArray(cfg.ips) ? cfg.ips : [];
  const prefix = cfg.remarkPrefix || "ECH";

  for (const host of hosts) {
    const h = (host || "").trim();
    if (!h) continue;
    if (ips.length === 0) {
      // 只有域名：addr = host
      const remark = `${prefix}-${h}`;
      nodes.push(
        buildVlessNode({
          uuid,
          addr: h,
          port,
          host: h,
          path: wsPath,
          remark,
        })
      );
    } else {
      // 有 IP 列表：对每个 IP 生成一条，SNI/Host 仍为域名
      for (const ip of ips) {
        const ipAddr = (ip || "").trim();
        if (!ipAddr) continue;
        const remark = `${prefix}-${h}-${ipAddr}`;
        nodes.push(
          buildVlessNode({
            uuid,
            addr: ipAddr,
            port,
            host: h,
            path: wsPath,
            remark,
          })
        );
      }
    }
  }

  return nodes;
}

/**
 * 解析 /sub?cfg=xxx 的 cfg 参数
 */
function parseConfigFromRequest(url) {
  const cfgParam = url.searchParams.get("cfg");
  if (!cfgParam) return null;
  try {
    const jsonStr = b64decode(cfgParam);
    const cfg = JSON.parse(jsonStr);
    return cfg;
  } catch (e) {
    return null;
  }
}

/**
 * 主页 HTML：纯前端静态单页，使用 localStorage 保存配置
 */
function renderIndexHtml() {
  const html = String.raw;
  return html`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>ECH-Workers 工具面板 V3+V4（静态前端 + API + 批量 ECH 节点）</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
:root{
  color-scheme:dark;
  --bg:#020617;
  --card:#020617;
  --border:#1f2937;
  --accent:#38bdf8;
  --accent-soft:#0ea5e9;
  --text:#e5e7eb;
  --muted:#9ca3af;
}
*{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui;
  background:radial-gradient(circle at top,#0f172a 0,#020617 55%,#020617 100%);
  color:var(--text);
  min-height:100vh;
  padding:18px;
}
.container{
  max-width:980px;
  margin:0 auto;
}
.card{
  background:rgba(15,23,42,.96);
  border-radius:24px;
  border:1px solid rgba(55,65,81,.85);
  box-shadow:0 24px 80px rgba(15,23,42,.95);
  padding:20px 20px 18px;
  backdrop-filter:blur(22px);
}
h1{
  font-size:22px;
  font-weight:600;
  display:flex;
  align-items:center;
  gap:10px;
  margin-bottom:4px;
}
.badge{
  font-size:11px;
  padding:2px 8px;
  border-radius:999px;
  border:1px solid #4b5563;
  color:#9ca3af;
}
.subtitle{
  font-size:13px;
  color:#9ca3af;
  margin-bottom:14px;
}
.grid{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(210px,1fr));
  gap:12px;
}
.field{
  display:flex;
  flex-direction:column;
  gap:4px;
  font-size:13px;
}
label{
  color:#9ca3af;
  font-size:12px;
}
input,textarea{
  background:#020617;
  border-radius:12px;
  border:1px solid #374151;
  padding:8px 10px;
  font-size:13px;
  color:#e5e7eb;
  outline:none;
}
input:focus,textarea:focus{
  border-color:var(--accent);
}
textarea{
  min-height:90px;
  resize:vertical;
}
.row{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
  margin-top:14px;
  align-items:center;
}
.btn{
  border:none;
  border-radius:999px;
  padding:7px 14px;
  font-size:12px;
  display:inline-flex;
  align-items:center;
  gap:6px;
  cursor:pointer;
}
.btn.primary{
  background:linear-gradient(90deg,#0ea5e9,#3b82f6);
  color:white;
}
.btn.secondary{
  background:#020617;
  color:#e5e7eb;
  border:1px solid #374151;
}
small{
  font-size:11px;
  color:#6b7280;
}
pre.out{
  margin-top:10px;
  background:#020617;
  border-radius:12px;
  border:1px dashed #334155;
  padding:8px 10px;
  font-size:11px;
  white-space:pre-wrap;
  word-break:break-all;
  max-height:220px;
  overflow:auto;
}
code{
  font-family:ui-monospace,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;
  font-size:11px;
}
.section-title{
  margin-top:16px;
  margin-bottom:6px;
  font-size:14px;
  font-weight:500;
}
.tag{
  display:inline-flex;
  align-items:center;
  gap:4px;
  font-size:11px;
  padding:2px 8px;
  border-radius:999px;
  border:1px solid #334155;
  color:#9ca3af;
}
</style>
</head>
<body>
<div class="container">
  <div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;">
      <div>
        <h1>ECH-Workers 工具面板 V3+V4 <span class="badge">静态前端 + Worker API + 批量 ECH 节点</span></h1>
        <div class="subtitle">
          前端纯静态、配置保存在浏览器 localStorage；Worker 提供 /sub 接口，用于批量生成 VLESS+ECH 节点订阅。
        </div>
      </div>
      <div style="text-align:right;font-size:11px;color:#9ca3af;min-width:170px;">
        <div>前端完全无状态，无 KV 读写。</div>
        <div style="margin-top:4px;">可通过 <code>?cfg=</code> URL 参数分享配置。</div>
      </div>
    </div>

    <div class="grid">
      <div class="field">
        <label>UUID（必填）</label>
        <input id="uuid" placeholder="例如：d50b4326-41b4-455b-899f-9452690286fe" />
      </div>
      <div class="field">
        <label>端口（一般 443）</label>
        <input id="port" placeholder="443" />
      </div>
      <div class="field">
        <label>WS 路径（例如 /echws）</label>
        <input id="wsPath" placeholder="/echws" />
      </div>
      <div class="field">
        <label>备注前缀（用于节点名称）</label>
        <input id="remarkPrefix" placeholder="例如：ECH" />
      </div>
    </div>

    <div class="section-title">域名与 IP 列表</div>
    <div class="grid">
      <div class="field">
        <label>CDN / Worker 域名列表（每行一个）</label>
        <textarea id="hosts" placeholder="例如：
ech1.example.com
ech2.example.com"></textarea>
      </div>
      <div class="field">
        <label>落地 IP 列表（可选，每行一个）</label>
        <textarea id="ips" placeholder="例如：
1.1.1.1
1.0.0.1"></textarea>
        <small>若填写 IP，则节点会以 “IP 连接 + 域名 SNI” 的 ECH 模式生成。</small>
      </div>
    </div>

    <div class="row">
      <button class="btn primary" id="saveBtn">保存配置到浏览器</button>
      <button class="btn secondary" id="loadBtn">从浏览器加载配置</button>
      <button class="btn secondary" id="clearBtn">清空本地配置</button>
      <small>本地存储键名：<code>ech_workers_v3v4_cfg</code></small>
    </div>

    <div class="section-title">生成节点 / 订阅</div>
    <div class="row">
      <button class="btn primary" id="genNodesBtn">本地生成 VLESS 节点列表</button>
      <button class="btn secondary" id="genSubUrlBtn">生成 Worker 订阅链接（/sub?cfg=）</button>
      <small>订阅接口为当前域名下的 <code>/sub?cfg=...</code></small>
    </div>

    <pre class="out" id="output">// 在上方填好配置后，点击“本地生成 VLESS 节点列表”</pre>

    <div class="section-title">小提示</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">
      <span class="tag">1. 批量 ECH：一个域名 × 多个 IP → 多节点</span>
      <span class="tag">2. 多落地：多个域名 × 多个 IP 交叉生成</span>
      <span class="tag">3. 订阅链接可分享给其他客户端直接使用</span>
    </div>
  </div>
</div>
<script>
const STORAGE_KEY = "ech_workers_v3v4_cfg";

function readForm() {
  const uuid = document.getElementById("uuid").value.trim();
  const portStr = document.getElementById("port").value.trim();
  const port = portStr ? parseInt(portStr,10) : 443;
  const wsPath = document.getElementById("wsPath").value.trim() || "/echws";
  const remarkPrefix = document.getElementById("remarkPrefix").value.trim() || "ECH";
  const hostsRaw = document.getElementById("hosts").value;
  const ipsRaw = document.getElementById("ips").value;
  const hosts = hostsRaw.split(/[\r\n]+/).map(s=>s.trim()).filter(Boolean);
  const ips = ipsRaw.split(/[\r\n]+/).map(s=>s.trim()).filter(Boolean);
  return { uuid, port, wsPath, remarkPrefix, hosts, ips };
}

function writeForm(cfg) {
  document.getElementById("uuid").value = cfg.uuid || "";
  document.getElementById("port").value = cfg.port || "";
  document.getElementById("wsPath").value = cfg.wsPath || "";
  document.getElementById("remarkPrefix").value = cfg.remarkPrefix || "";
  document.getElementById("hosts").value = (cfg.hosts || []).join("\\n");
  document.getElementById("ips").value = (cfg.ips || []).join("\\n");
}

function saveToLocal() {
  const cfg = readForm();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  alert("已保存当前配置到浏览器本地。");
}

function loadFromLocal() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    alert("没有已保存的配置。");
    return;
  }
  try {
    const cfg = JSON.parse(raw);
    writeForm(cfg);
    alert("已从浏览器加载配置。");
  } catch(e) {
    console.error(e);
    alert("解析本地配置失败。");
  }
}

function clearLocal() {
  localStorage.removeItem(STORAGE_KEY);
  alert("已清空本地配置。");
}

function buildNodes(cfg) {
  const url = new URL(location.href);
  // 在前端重用 Worker 内的算法：写一份简单版
  function localBuildNode(uuid, addr, port, host, path, remark) {
    const params = new URLSearchParams({
      encryption: "none",
      security: "tls",
      type: "ws",
      host,
      sni: host,
      path,
    });
    return "vless://" + uuid + "@" + addr + ":" + port + "?" + params.toString() + "#" + encodeURIComponent(remark);
  }

  const { uuid, port, wsPath, remarkPrefix, hosts, ips } = cfg;
  const nodes = [];
  if (!uuid) return nodes;
  for (const h0 of hosts) {
    const h = (h0 || "").trim();
    if (!h) continue;
    if (!ips.length) {
      nodes.push(localBuildNode(uuid, h, port, h, wsPath, remarkPrefix + "-" + h));
    } else {
      for (const ip0 of ips) {
        const ip = (ip0 || "").trim();
        if (!ip) continue;
        nodes.push(localBuildNode(uuid, ip, port, h, wsPath, remarkPrefix + "-" + h + "-" + ip));
      }
    }
  }
  return nodes;
}

function genNodes() {
  const cfg = readForm();
  const nodes = buildNodes(cfg);
  if (!nodes.length) {
    document.getElementById("output").textContent = "// 请至少填写 UUID 和一个域名。";
    return;
  }
  document.getElementById("output").textContent = nodes.join("\\n");
}

function genSubUrl() {
  const cfg = readForm();
  const json = JSON.stringify(cfg);
  const b64 = b64encode(json);
  const base = location.origin.replace(/\/+$/,"");
  const url = base + "/sub?cfg=" + b64;
  navigator.clipboard.writeText(url).then(()=>{
    alert("已复制订阅链接：\\n" + url);
  },()=>{
    alert("订阅链接：\\n" + url);
  });
}

// 尝试从 URL 中的 cfg 参数加载配置（方便分享）
(function initFromUrl() {
  try {
    const url = new URL(location.href);
    const cfgParam = url.searchParams.get("cfg");
    if (!cfgParam) return;
    const jsonStr = b64decode(cfgParam);
    const cfg = JSON.parse(jsonStr);
    writeForm(cfg);
  } catch(e) {
    console.error("从 URL cfg 导入配置失败：", e);
  }
})();

document.getElementById("saveBtn").onclick = saveToLocal;
document.getElementById("loadBtn").onclick = loadFromLocal;
document.getElementById("clearBtn").onclick = clearLocal;
document.getElementById("genNodesBtn").onclick = genNodes;
document.getElementById("genSubUrlBtn").onclick = genSubUrl;

// 页面加载时尝试自动从 localStorage 恢复
(function autoLoad() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const cfg = JSON.parse(raw);
    writeForm(cfg);
  } catch(e) {}
})();
</script>
</body>
</html>`;
}

/**
 * Worker 主入口
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === "/" || pathname === "/index.html") {
      return new Response(renderIndexHtml(), {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (pathname === "/sub") {
      const cfg = parseConfigFromRequest(url);
      if (!cfg) {
        return new Response("INVALID CFG", { status: 400 });
      }
      const nodes = generateNodesFromConfig(cfg);
      if (!nodes.length) {
        return new Response("NO NODES", { status: 400 });
      }
      const body = nodes.join("\n") + "\n";
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
};
