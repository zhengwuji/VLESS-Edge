// ===============================================================
// ECH-Workers V3+V4（纯前端配置版，无 KV ）
// ---------------------------------------------------------------
// - 不使用 KV，所有配置都通过：
//     1）浏览器 localStorage（前端记忆）
//     2）URL 参数 cfg（Base64URL 的 JSON 配置）
// - 后台密码登录：纯 Cookie，会话 cookie: ech_admin=1
// - 订阅接口：/sub?cfg=xxx   → v2rayN Base64 订阅
// - 其他接口：/singbox?cfg=xxx, /clash?cfg=xxx, /qrcode?cfg=xxx
// - Worker 只负责：
//     1）提供后台管理页面（前端生成 cfg）
//     2）根据 cfg 生成订阅 / 配置
//     3）固定后端的 VLESS WS 反代（不依赖 KV）
// ===============================================================

// ================== 需要你手动修改的参数 ======================

// 后台登录密码（你自己改一个复杂点的）
const ADMIN_PASSWORD = "ech-admin-123";

// WS 反代后端（Xray / sing-box 等运行在你的 VPS 上）
const BACKEND_HOST = "cc1.firegod.eu.org"; // 后端 VPS 域名 / IP
const BACKEND_PORT = 2082;                 // 后端 WS 端口（明文）
const BACKEND_WS_PATH = "/echws";          // 后端 WS 路径（和面板里保持一致）

// ===============================================================
// 工具函数：Cookie / Base64URL
// ===============================================================
const SESSION_COOKIE_NAME = "ech_admin";

function parseCookies(header) {
  const out = {};
  (header || "").split(";").forEach((part) => {
    const [k, v] = part.split("=").map((s) => s && s.trim());
    if (k && v) out[k] = v;
  });
  return out;
}

function isAuthed(request) {
  const cookies = parseCookies(request.headers.get("Cookie") || "");
  return cookies[SESSION_COOKIE_NAME] === "1";
}

function setSessionCookie() {
  const h = new Headers();
  h.set(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=1; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=86400`
  );
  return h;
}

// Base64URL <-> 字符串
function b64urlEncode(str) {
  const b64 = btoa(str);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return atob(str);
}

function readCfgFromQuery(url) {
  const token = url.searchParams.get("cfg");
  if (!token) return null;
  try {
    const json = b64urlDecode(token);
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

// ===============================================================
// Cloudflare Worker 入口
// ===============================================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method.toUpperCase();

    // ---- 登录相关 ----
    if (pathname === "/login" && method === "GET") {
      return new Response(renderLoginPage(""), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (pathname === "/login" && method === "POST") {
      return handleLogin(request);
    }

    // ---- 后台面板（需要登录）----
    if (pathname === "/" || pathname === "/index") {
      if (!isAuthed(request)) {
        const res = new Response(renderLoginPage("请先登录"), {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
        return res;
      }
      // 把 URL 里的 cfg 传给前端（方便导入现有订阅配置）
      const cfgToken = url.searchParams.get("cfg") || "";
      return new Response(renderAdminUI(cfgToken), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    // ---- Geo 信息 / 测速 ----
    if (pathname === "/api/geo") {
      const info = {
        ip: request.headers.get("CF-Connecting-IP") || "",
        country: (request.cf && request.cf.country) || "",
        region: (request.cf && request.cf.region) || "",
        city: (request.cf && request.cf.city) || "",
        asn: (request.cf && request.cf.asn) || "",
        colo: (request.cf && request.cf.colo) || "",
      };

      const colo = (info.colo || "").toUpperCase();
      let score = "C";
      let comment = "线路一般，可以考虑更换 Cloudflare IP 或区域。";
      let ipSuggestions = [];

      if (["HKG", "TPE", "NRT", "KIX", "ICN", "SIN"].includes(colo)) {
        score = "A";
        comment =
          "入口在亚洲就近节点（HKG/TPE/NRT/SIN…），非常适合国内访问，可在同网段内优选更稳 IP。";
        ipSuggestions = [
          "188.114.96.0/20",
          "104.16.0.0/13",
          "172.64.0.0/13",
        ];
      } else if (
        ["LAX", "SJC", "SEA", "ORD", "DFW", "IAD", "JFK"].includes(colo)
      ) {
        score = "B";
        comment =
          "入口在北美节点，延迟略高但可用。可以尝试更换 IP 让流量落到 HKG/TPE 等亚洲节点。";
        ipSuggestions = [
          "188.114.96.0/20",
          "141.101.64.0/18",
          "104.24.0.0/14",
        ];
      } else {
        score = "C";
        comment =
          "可能落在较远或冷门节点，建议优选 IP，观察 colo 是否能切到 HKG/TPE/SIN 等。";
        ipSuggestions = [
          "188.114.96.0/20",
          "104.16.0.0/13",
          "172.64.0.0/13",
          "141.101.64.0/18",
        ];
      }

      return new Response(
        JSON.stringify(
          {
            ...info,
            score,
            comment,
            ipSuggestions,
          },
          null,
          2
        ),
        { headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }

    if (pathname === "/speedtest") {
      return new Response(renderSpeedtestPage(), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (pathname === "/speed.bin") {
      const size = 1024 * 1024;
      const chunk = "0".repeat(1024);
      let data = "";
      for (let i = 0; i < size / 1024; i++) data += chunk;
      return new Response(data, {
        headers: {
          "content-type": "application/octet-stream",
          "cache-control": "no-store",
        },
      });
    }

    // ---- 订阅 / 配置接口（全部依赖 cfg 参数）----
    if (pathname === "/sub") {
      const cfg = readCfgFromQuery(url);
      if (!cfg) return new Response("INVALID CFG", { status: 400 });
      const v2sub = generateV2raySubFromCfg(cfg);
      const b64 = btoa(v2sub);
      return new Response(b64, {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (pathname === "/singbox") {
      const cfg = readCfgFromQuery(url);
      if (!cfg) return new Response("INVALID CFG", { status: 400 });
      const json = generateSingboxFromCfg(cfg);
      return new Response(JSON.stringify(json, null, 2), {
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    }

    if (pathname === "/clash") {
      const cfg = readCfgFromQuery(url);
      if (!cfg) return new Response("INVALID CFG", { status: 400 });
      const yaml = generateClashFromCfg(cfg);
      return new Response(yaml, {
        headers: { "content-type": "text/yaml; charset=utf-8" },
      });
    }

    if (pathname === "/qrcode") {
      const cfg = readCfgFromQuery(url);
      if (!cfg) return new Response("INVALID CFG", { status: 400 });
      const png = await generateQRCodeFromCfg(cfg);
      return new Response(png, { headers: { "content-type": "image/png" } });
    }

    // ---- WebSocket 反代到后端 ----
    const upgrade = request.headers.get("Upgrade") || "";
    if (upgrade.toLowerCase() === "websocket") {
      return handleWSProxy(request);
    }

    return new Response("Not Found", { status: 404 });
  },
};

// ===============================================================
// 登录页面 / 登录处理
// ===============================================================
function renderLoginPage(msg) {
  const safe = msg ? String(msg) : "";
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <title>ECH-Workers 后台登录</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <script src="https://cdn.tailwindcss.com"><\/script>
</head>
<body class="min-h-screen flex items-center justify-center bg-slate-100">
  <div class="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 border border-slate-200">
    <h1 class="text-2xl font-bold mb-4 flex items-center">
      <span class="mr-2">🔐</span> ECH-Workers 管理登录
    </h1>
    <p class="text-sm text-slate-500 mb-4">
      本版本不使用 KV，所有配置都在浏览器本地保存，并通过 <code>?cfg=</code> 订阅参数传递给 Worker。
    </p>
    ${safe ? `<div class="mb-4 text-sm text-red-600 font-semibold">${safe}</div>` : ""}
    <form method="POST" action="/login" class="space-y-4">
      <div>
        <label class="block text-sm font-medium mb-1">后台密码</label>
        <input name="password" type="password" class="w-full border rounded-lg px-3 py-2" placeholder="请输入后台密码" />
      </div>
      <button type="submit" class="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">
        登录
      </button>
    </form>
    <p class="mt-6 text-xs text-slate-500">
      如需修改密码，请直接在 Worker 代码顶部修改 <code>ADMIN_PASSWORD</code> 常量并重新部署。
    </p>
  </div>
</body>
</html>`;
}

async function handleLogin(request) {
  const form = await request.formData();
  const password = (form.get("password") || "").toString();
  if (!password) {
    return new Response(renderLoginPage("密码不能为空"), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  if (password !== ADMIN_PASSWORD) {
    return new Response(renderLoginPage("密码错误"), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  const headers = setSessionCookie();
  headers.set("Location", "/");
  return new Response(null, { status: 302, headers });
}

// ===============================================================
// 后台面板（前端静态 + localStorage + cfg 生成）
// ===============================================================
function renderAdminUI(cfgToken) {
  const safeToken = cfgToken ? String(cfgToken) : "";
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <title>ECH-Workers 工具面板 V3+V4（无 KV）</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <script src="https://cdn.tailwindcss.com"><\/script>
  <style>
    body { background:#0f172a; }
    .card { background:#020617;border-radius:18px;padding:20px;border:1px solid rgba(148,163,184,.35);box-shadow:0 18px 45px rgba(15,23,42,.9); }
    .input { width:100%;padding:8px 10px;border-radius:10px;background:#020617;border:1px solid rgba(148,163,184,.4);color:#e5e7eb;font-size:13px; }
    .input::placeholder { color:rgba(148,163,184,.7); }
    .label { font-size:13px;font-weight:600;color:#e5e7eb;margin-bottom:4px;display:block; }
    .btn { padding:8px 16px;border-radius:9999px;font-size:13px;font-weight:600;background:#2563eb;color:white; }
    .btn-ghost { padding:8px 16px;border-radius:9999px;font-size:13px;font-weight:600;background:rgba(148,163,184,.2);color:#e5e7eb; }
    .pill { font-size:11px;border-radius:9999px;padding:4px 9px;background:rgba(148,163,184,.18);color:#e5e7eb; }
    textarea.input { min-height:80px;resize:vertical; }
    code { font-size:12px; }
  </style>
</head>
<body class="text-slate-100">
  <div class="max-w-5xl mx-auto px-4 py-8 space-y-6">
    <header class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold tracking-tight">ECH-Workers 工具面板 V3+V4</h1>
        <p class="text-xs text-slate-400 mt-1">前端纯静态配置 · 无 KV 读写 · 通过 <code>?cfg=</code> 参数把配置传给 Worker。</p>
      </div>
      <div class="flex items-center space-x-2 text-xs text-slate-400">
        <span class="pill">无 KV</span>
        <span class="pill">支持 /sub 订阅</span>
        <span class="pill">v2rayN / Singbox / Clash</span>
      </div>
    </header>

    <!-- 线路信息 -->
    <section class="card space-y-2">
      <div class="flex items-center justify-between">
        <h2 class="font-semibold text-sm">当前入口线路 / 节点探测</h2>
        <button id="btnGeo" class="btn-ghost text-xs">刷新线路探测</button>
      </div>
      <p id="geoLocation" class="text-xs text-slate-300">正在获取地理位置...</p>
      <p id="geoColo" class="text-xs text-slate-300">正在检测 Cloudflare 入口机房...</p>
      <p id="geoScore" class="text-xs text-emerald-400"></p>
      <p id="geoComment" class="text-xs text-slate-400"></p>
      <p class="text-[11px] text-slate-500">建议优选 IP 段（需要你自己测速筛选）：</p>
      <p id="geoIps" class="text-[11px] text-slate-400 break-words"></p>
    </section>

    <!-- 基础配置 -->
    <section class="card grid md:grid-cols-2 gap-5">
      <div class="space-y-3">
        <h2 class="font-semibold text-sm mb-1">基础参数</h2>
        <div>
          <label class="label">UUID（必填）</label>
          <input id="uuid" class="input" placeholder="d50b4326-xxxx-xxxx-xxxx-9452690286fe" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="label">端口（一般 443）</label>
            <input id="port" class="input" value="443" />
          </div>
          <div>
            <label class="label">WS 路径</label>
            <input id="wsPath" class="input" value="/echws" />
          </div>
        </div>
        <div>
          <label class="label">备注前缀（用于节点名称）</label>
          <input id="remark" class="input" value="ECH" />
        </div>
      </div>

      <div class="space-y-3">
        <h2 class="font-semibold text-sm mb-1">前端域名 & 落地 IP</h2>
        <div>
          <label class="label">CDN / Worker 域名列表（每行一个）</label>
          <textarea id="domains" class="input" placeholder="ec.firegod.eu.org&#10;ech2.example.com"></textarea>
        </div>
        <div>
          <label class="label">落地 IP 列表（可选，每行一个）</label>
          <textarea id="ips" class="input" placeholder="1.1.1.1&#10;8.8.8.8"></textarea>
        </div>
      </div>
    </section>

    <!-- 操作按钮 -->
    <section class="card space-y-3">
      <div class="flex flex-wrap gap-2">
        <button id="btnSaveLocal" class="btn">💾 保存到浏览器 localStorage</button>
        <button id="btnLoadLocal" class="btn-ghost">📥 从浏览器加载配置</button>
        <button id="btnClearLocal" class="btn-ghost">🗑️ 清空浏览器本地配置</button>
      </div>
      <p class="text-[11px] text-slate-500">
        注意：配置不会保存在服务器，只存在你的浏览器本地。你可以把生成的 <code>?cfg=</code> 订阅链接复制下来长期使用。
      </p>
      <p id="msg" class="text-xs text-emerald-400"></p>
    </section>

    <!-- 订阅 & 导入 -->
    <section class="card space-y-3">
      <div class="flex items-center justify-between">
        <h2 class="font-semibold text-sm">订阅 & 客户端导入</h2>
        <button id="btnGenCfg" class="btn">⚙️ 生成 cfg / 订阅链接</button>
      </div>
      <div class="space-y-2 text-xs">
        <p>当前配置对应的 <code>cfg</code> 参数：</p>
        <textarea id="cfgToken" class="input" readonly></textarea>
        <p>v2rayN 订阅地址：</p>
        <textarea id="subUrl" class="input" readonly></textarea>
        <p class="text-[11px] text-slate-500">
          把上面的订阅链接复制到 v2rayN → 订阅 → 添加订阅，即可自动导入节点。<br />
          也可直接访问：<code>/singbox?cfg=...</code> / <code>/clash?cfg=...</code> / <code>/qrcode?cfg=...</code>。
        </p>
      </div>
    </section>

    <!-- 测速工具入口 -->
    <section class="card space-y-2">
      <h2 class="font-semibold text-sm">Cloudflare Worker 线路测速</h2>
      <p class="text-xs text-slate-400">
        使用内置测速工具，可以测试当前 Worker 域名的延迟和下载速度，也可以对多个自定义 URL 进行批量测速。
      </p>
      <a href="/speedtest" target="_blank" class="btn-ghost text-xs">打开测速工具</a>
    </section>
  </div>

  <script>
    const STORAGE_KEY = "ech_workers_v3v4_cfg";
    const INIT_CFG_TOKEN = "${safeToken}";

    function showMsg(text, color) {
      const el = document.getElementById("msg");
      el.textContent = text || "";
      el.style.color = color || "#4ade80";
      if (text) setTimeout(() => { el.textContent = ""; }, 4000);
    }

    function readFormCfg() {
      const uuid = document.getElementById("uuid").value.trim();
      const port = document.getElementById("port").value.trim() || "443";
      const wsPath = document.getElementById("wsPath").value.trim() || "/echws";
      const remark = document.getElementById("remark").value.trim() || "ECH";
      const domains = (document.getElementById("domains").value || "")
        .split(/\\r?\\n/).map(s => s.trim()).filter(Boolean);
      const ips = (document.getElementById("ips").value || "")
        .split(/\\r?\\n/).map(s => s.trim()).filter(Boolean);
      return { uuid, port, wsPath, remark, domains, ips };
    }

    function fillFormCfg(cfg) {
      if (!cfg) return;
      document.getElementById("uuid").value = cfg.uuid || "";
      document.getElementById("port").value = cfg.port || "443";
      document.getElementById("wsPath").value = cfg.wsPath || "/echws";
      document.getElementById("remark").value = cfg.remark || "ECH";
      document.getElementById("domains").value = (cfg.domains || []).join("\\n");
      document.getElementById("ips").value = (cfg.ips || []).join("\\n");
    }

    function b64urlEncode(str) {
      return btoa(str).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/g, "");
    }
    function b64urlDecode(str) {
      str = str.replace(/-/g, "+").replace(/_/g, "/");
      while (str.length % 4) str += "=";
      return atob(str);
    }

    function saveLocal() {
      const cfg = readFormCfg();
      if (!cfg.uuid) return showMsg("UUID 不能为空", "red");
      if (!cfg.domains || !cfg.domains.length) return showMsg("至少填一个域名", "red");
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
      showMsg("✅ 已保存到浏览器 localStorage");
    }
    function loadLocal() {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return showMsg("本地没有已保存的配置", "red");
      try {
        const cfg = JSON.parse(raw);
        fillFormCfg(cfg);
        showMsg("✅ 已从浏览器加载配置");
      } catch(e) {
        showMsg("本地配置解析失败", "red");
      }
    }
    function clearLocal() {
      localStorage.removeItem(STORAGE_KEY);
      showMsg("已清空本地配置");
    }

    function genCfgToken() {
      const cfg = readFormCfg();
      if (!cfg.uuid) return showMsg("UUID 不能为空", "red");
      if (!cfg.domains || !cfg.domains.length) return showMsg("至少填一个域名", "red");
      const token = b64urlEncode(JSON.stringify(cfg));
      document.getElementById("cfgToken").value = token;
      try {
        const base = window.location.origin;
        document.getElementById("subUrl").value = base + "/sub?cfg=" + token;
      } catch(e) {}
      showMsg("✅ 已生成 cfg / 订阅链接");
    }

    // 初始化：优先使用 URL 上的 cfg，其次 localStorage
    (function init() {
      if (INIT_CFG_TOKEN) {
        try {
          const json = b64urlDecode(INIT_CFG_TOKEN);
          const cfg = JSON.parse(json);
          fillFormCfg(cfg);
          document.getElementById("cfgToken").value = INIT_CFG_TOKEN;
          const base = window.location.origin;
          document.getElementById("subUrl").value = base + "/sub?cfg=" + INIT_CFG_TOKEN;
        } catch(e) {}
      } else {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          try { fillFormCfg(JSON.parse(raw)); } catch(e){}
        }
      }
    })();

    document.getElementById("btnSaveLocal").onclick = saveLocal;
    document.getElementById("btnLoadLocal").onclick = loadLocal;
    document.getElementById("btnClearLocal").onclick = clearLocal;
    document.getElementById("btnGenCfg").onclick = genCfgToken;

    async function loadGeo() {
      try {
        const res = await fetch("/api/geo?ts=" + Math.random(), {cache:"no-store"});
        const geo = await res.json();
        document.getElementById("geoLocation").textContent =
          "你的大致位置：" + (geo.country || "-") + " / " +
          (geo.region || "-") + " / " + (geo.city || "-") +
          "（ASN " + (geo.asn || "-") + "）";
        document.getElementById("geoColo").textContent =
          "当前入口机房（colo）：" + (geo.colo || "-");
        document.getElementById("geoScore").textContent =
          "线路评分：" + (geo.score || "-");
        document.getElementById("geoComment").textContent = geo.comment || "";
        if (geo.ipSuggestions && geo.ipSuggestions.length) {
          document.getElementById("geoIps").textContent = geo.ipSuggestions.join(", ");
        }
      } catch(e) {
        document.getElementById("geoLocation").textContent = "无法获取 Geo 信息（可能是网络问题）。";
      }
    }
    document.getElementById("btnGeo").onclick = loadGeo;
    loadGeo();
  <\/script>
</body>
</html>`;
}

// ===============================================================
// 根据 cfg 生成节点列表 & 各类订阅格式
// cfg 结构：{ uuid, port, wsPath, remark, domains:[], ips:[] }
// ===============================================================
function buildNodesFromCfg(cfg) {
  const uuid = cfg.uuid;
  const port = parseInt(cfg.port || "443", 10) || 443;
  const wsPath = cfg.wsPath || "/echws";
  const remark = cfg.remark || "ECH";
  const domains = Array.isArray(cfg.domains) ? cfg.domains : [];
  const ips = Array.isArray(cfg.ips) ? cfg.ips : [];

  if (!uuid || !domains.length) {
    throw new Error("invalid cfg");
  }

  const nodes = [];

  // 域名节点
  domains.forEach((host, idx) => {
    if (!host) return;
    const name = `${remark}-${idx + 1}`;
    nodes.push({
      name,
      server: host,
      port,
      uuid,
      hostHeader: host,
      sni: host,
      wsPath,
    });
  });

  // IP 备胎节点：使用第一个域名作为 SNI/Host
  const mainHost = domains[0];
  ips.forEach((ip, idx) => {
    if (!ip || !mainHost) return;
    const name = `${remark}-IP${idx + 1}`;
    nodes.push({
      name,
      server: ip,
      port,
      uuid,
      hostHeader: mainHost,
      sni: mainHost,
      wsPath,
    });
  });

  return nodes;
}

function generateV2raySubFromCfg(cfg) {
  const nodes = buildNodesFromCfg(cfg);
  const lines = nodes.map((n) => {
    const params = new URLSearchParams({
      encryption: "none",
      security: "tls",
      type: "ws",
      path: n.wsPath,
      host: n.hostHeader,
      sni: n.sni,
    });
    return `vless://${n.uuid}@${n.server}:${n.port}?${params.toString()}#${encodeURIComponent(
      n.name
    )}`;
  });
  return lines.join("\n");
}

function generateSingboxFromCfg(cfg) {
  const nodes = buildNodesFromCfg(cfg);
  const outbounds = nodes.map((n) => ({
    type: "vless",
    tag: n.name,
    server: n.server,
    server_port: n.port,
    uuid: n.uuid,
    tls: {
      enabled: true,
      server_name: n.sni,
    },
    transport: {
      type: "ws",
      path: n.wsPath,
      headers: {
        Host: n.hostHeader,
      },
    },
  }));
  return { outbounds };
}

function generateClashFromCfg(cfg) {
  const nodes = buildNodesFromCfg(cfg);
  let yaml = "proxies:\n";
  nodes.forEach((n) => {
    yaml += `  - name: "${n.name}"
    type: vless
    server: ${n.server}
    port: ${n.port}
    uuid: ${n.uuid}
    tls: true
    servername: ${n.sni}
    network: ws
    ws-opts:
      path: ${n.wsPath}
      headers:
        Host: ${n.hostHeader}
`;
  });
  return yaml;
}

async function generateQRCodeFromCfg(cfg) {
  const nodes = buildNodesFromCfg(cfg);
  const first = nodes[0];
  const params = new URLSearchParams({
    encryption: "none",
    security: "tls",
    type: "ws",
    path: first.wsPath,
    host: first.hostHeader,
    sni: first.sni,
  });
  const vlessUrl = `vless://${first.uuid}@${first.server}:${first.port}?${params.toString()}#${encodeURIComponent(
    first.name
  )}`;
  const api =
    "https://chart.googleapis.com/chart?cht=qr&chs=400x400&chl=" +
    encodeURIComponent(vlessUrl);
  const resp = await fetch(api);
  return resp.arrayBuffer();
}

// ===============================================================
// WebSocket 反代（固定后端，无 KV）
// ===============================================================
async function handleWSProxy(request) {
  const backendUrl = `http://${BACKEND_HOST}:${BACKEND_PORT}${BACKEND_WS_PATH}`;
  const headers = new Headers(request.headers);
  headers.set("Host", BACKEND_HOST);

  const backendReq = new Request(backendUrl, {
    method: request.method,
    headers,
    body: request.body,
  });

  let resp;
  try {
    resp = await fetch(backendReq);
  } catch (e) {
    return new Response("Backend connection failed", { status: 502 });
  }

  if (resp.status !== 101) {
    return new Response("WebSocket upgrade failed", { status: 502 });
  }
  return resp;
}

// ===============================================================
// 速度测试页面（与原来 565.js 类似，已简化）
// ===============================================================
function renderSpeedtestPage() {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <title>Cloudflare Worker 速度测试工具</title>
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <script src="https://cdn.tailwindcss.com"><\/script>
</head>
<body class="min-h-screen bg-slate-100 p-4">
  <div class="max-w-4xl mx-auto space-y-6">
    <div class="bg-white rounded-2xl shadow p-6">
      <h1 class="text-2xl font-bold mb-2">⚡ Cloudflare Worker 线路测速</h1>
      <p class="text-sm text-slate-600 mb-4">
        本页面用于测试当前 Worker 域名的延迟与下载速度，并提供简单的“批量 URL 下载测速”功能，方便你对比不同 CF IP / 域名表现。
      </p>
      <a href="/" class="text-blue-600 text-sm underline">← 返回管理面板</a>
    </div>

    <div class="bg-white rounded-2xl shadow p-6">
      <h2 class="text-xl font-semibold mb-3">一、当前 Worker 域名测速</h2>
      <p class="text-sm text-slate-600 mb-2">
        将对当前域名执行多次延迟测试（请求 /api/geo），并下载 1MB 测试文件 <code>/speed.bin</code>。
      </p>
      <button id="btnPing" class="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold mb-3">
        开始单节点测速
      </button>
      <pre id="pingResult" class="bg-slate-950 text-slate-100 text-xs rounded-lg p-3 overflow-x-auto h-48"></pre>
    </div>

    <div class="bg-white rounded-2xl shadow p-6">
      <h2 class="text-xl font-semibold mb-3">二、自定义 URL 批量测速</h2>
      <p class="text-sm text-slate-600 mb-2">
        在下方输入要测试的 URL（每行一个），用于对比不同优选 IP / 域名的下载速度。
      </p>
      <textarea id="urlList" class="w-full h-32 border rounded-lg p-2 text-xs mb-3" placeholder="例如：&#10;https://ech1.yourdomain.com/speed.bin&#10;https://ech2.yourdomain.com/speed.bin"></textarea>
      <button id="btnBatch" class="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold mb-3">
        开始批量测速
      </button>
      <pre id="batchResult" class="bg-slate-950 text-slate-100 text-xs rounded-lg p-3 overflow-x-auto h-64"></pre>
    </div>
  </div>

  <script>
    async function runSingleTest() {
      const out = [];
      const logEl = document.getElementById("pingResult");
      logEl.textContent = "开始延迟测试...\\n";

      const times = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        try {
          await fetch("/api/geo?ts=" + Math.random(), {cache:"no-store"});
          const t1 = performance.now();
          const ms = Math.round(t1 - t0);
          times.push(ms);
          out.push("第 " + (i+1) + " 次延迟：" + ms + " ms");
        } catch(e) {
          out.push("第 " + (i+1) + " 次延迟测试失败：" + e);
        }
        logEl.textContent = out.join("\\n");
      }

      if (times.length) {
        const sum = times.reduce((a,b)=>a+b,0);
        const avg = Math.round(sum / times.length);
        const min = Math.min(...times);
        const max = Math.max(...times);
        out.push("");
        out.push("延迟统计：");
        out.push("  次数：" + times.length);
        out.push("  平均：" + avg + " ms");
        out.push("  最小：" + min + " ms");
        out.push("  最大：" + max + " ms");
      }

      out.push("");
      out.push("开始下载测速 /speed.bin (约 1MB)...");
      logEl.textContent = out.join("\\n");

      try {
        const t0 = performance.now();
        const resp = await fetch("/speed.bin?ts=" + Math.random(), {cache:"no-store"});
        const buf = await resp.arrayBuffer();
        const t1 = performance.now();
        const ms = t1 - t0;
        const size = buf.byteLength;
        const speedMbps = (size * 8 / 1024 / 1024) / (ms / 1000);
        out.push("下载用时：" + Math.round(ms) + " ms");
        out.push("下载大小：" + size + " 字节");
        out.push("估算下行速度：" + speedMbps.toFixed(2) + " Mbps");
      } catch(e) {
        out.push("下载测速失败：" + e);
      }
      logEl.textContent = out.join("\\n");
    }

    async function runBatchTest() {
      const txt = document.getElementById("urlList").value || "";
      const lines = txt.split(/\\r?\\n/).map(l => l.trim()).filter(Boolean);
      const out = [];
      const logEl = document.getElementById("batchResult");
      if (!lines.length) {
        logEl.textContent = "请先在上方文本框中填入要测试的 URL，每行一个。";
        return;
      }
      out.push("共 " + lines.length + " 个 URL，将依次进行下载测速...");
      logEl.textContent = out.join("\\n");

      for (let i = 0; i < lines.length; i++) {
        const url = lines[i];
        out.push("");
        out.push("[" + (i+1) + "/" + lines.length + "] 测试：" + url);
        logEl.textContent = out.join("\\n");
        try {
          const t0 = performance.now();
          const resp = await fetch(url, {cache:"no-store"});
          const buf = await resp.arrayBuffer();
          const t1 = performance.now();
          const ms = t1 - t0;
          const size = buf.byteLength;
          const speedMbps = (size * 8 / 1024 / 1024) / (ms / 1000);
          out.push("  用时：" + Math.round(ms) + " ms");
          out.push("  大小：" + size + " 字节");
          out.push("  估算速度：" + speedMbps.toFixed(2) + " Mbps");
        } catch(e) {
          out.push("  测试失败：" + e);
        }
        logEl.textContent = out.join("\\n");
      }

      out.push("");
      out.push("批量测速完成，可对比不同 URL 的时延与 Mbps 评估哪条线路更优。");
      logEl.textContent = out.join("\\n");
    }

    document.getElementById("btnPing").onclick = runSingleTest;
    document.getElementById("btnBatch").onclick = runBatchTest;
  <\/script>
</body>
</html>`;
}
