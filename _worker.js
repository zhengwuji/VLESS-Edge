// ===============================================================
// VLESS Edge Worker with Admin UI + Password + KV Config
// Binding: CONFIG_KV  (Cloudflare KV Namespace)
// ===============================================================

const CONFIG_KEY = "vless_config";
const PASS_KEY = "admin_pass";

// --------- Utils ---------

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function htmlResponse(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      ...headers,
    },
  });
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function redirect(url) {
  return new Response(null, {
    status: 302,
    headers: { Location: url },
  });
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  header.split(";").forEach(pair => {
    const index = pair.indexOf("=");
    if (index < 0) return;
    const key = pair.slice(0, index).trim();
    const val = pair.slice(index + 1).trim();
    cookies[key] = decodeURIComponent(val);
  });
  return cookies;
}

// --------- KV Config helpers ---------

async function getConfig(env) {
  const raw = await env.CONFIG_KV.get(CONFIG_KEY);
  if (!raw) {
    // default empty config
    return {
      uuid: "",
      workerHost: "",
      wsPath: "/echws",
      backendHost: "",
      backendPort: "2082",
    };
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    return {
      uuid: "",
      workerHost: "",
      wsPath: "/echws",
      backendHost: "",
      backendPort: "2082",
    };
  }
}

async function setConfig(env, cfg) {
  await env.CONFIG_KV.put(CONFIG_KEY, JSON.stringify(cfg));
}

async function getPassHash(env) {
  return await env.CONFIG_KV.get(PASS_KEY);
}

async function setPassHash(env, hash) {
  await env.CONFIG_KV.put(PASS_KEY, hash);
}

// --------- Auth helpers ---------

async function isAuthed(request, env) {
  const cookie = request.headers.get("Cookie") || "";
  const cookies = parseCookies(cookie);
  const token = cookies["vless_admin"];
  if (!token) return false;
  const passHash = await getPassHash(env);
  if (!passHash) return false;
  // token = sha256(passHash + "token_salt")
  const expect = await sha256(passHash + "token_salt");
  return token === expect;
}

async function makeAuthCookie(env) {
  const passHash = await getPassHash(env);
  if (!passHash) return "";
  const token = await sha256(passHash + "token_salt");
  const cookie = `vless_admin=${encodeURIComponent(
    token
  )}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  return cookie;
}

// --------- HTML pages ---------

function renderLoginPage(hasPass, error = "") {
  const title = hasPass ? "登录面板" : "初始化密码";
  const btnText = hasPass ? "登录" : "设置密码";
  const tip = hasPass
    ? "请输入面板密码。"
    : "首次使用，请设置面板密码（请务必牢记）。";
  return htmlResponse(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>${title} - VLESS Edge</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0f172a;color:#e5e7eb;margin:0;padding:0;display:flex;align-items:center;justify-content:center;height:100vh;}
.card{background:#020617;border-radius:16px;padding:32px;box-shadow:0 25px 50px -12px rgba(0,0,0,.7);width:360px;max-width:90%;}
h1{margin:0 0 16px;font-size:22px;}
p{margin:4px 0 16px;font-size:13px;color:#9ca3af;}
input[type=password]{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #1f2937;background:#020617;color:#e5e7eb;box-sizing:border-box;font-size:14px;}
button{width:100%;margin-top:18px;padding:10px 0;border:none;border-radius:999px;background:linear-gradient(135deg,#22c55e,#0ea5e9);color:#fff;font-weight:600;font-size:15px;cursor:pointer;}
.error{color:#f97316;font-size:13px;margin-bottom:8px;}
</style>
</head>
<body>
<div class="card">
<h1>${title}</h1>
<p>${tip}</p>
${
  error
    ? `<div class="error">${error.replace(/</g, "&lt;")}</div>`
    : ""
}
<form method="post">
  <input type="password" name="password" placeholder="密码" required />
  <button type="submit">${btnText}</button>
</form>
</div>
</body>
</html>`);
}

function renderAdminPage(config, cf) {
  const ip = (cf && cf.ip) || "Unknown";
  const colo = (cf && cf.colo) || "Unknown";
  const asn = (cf && cf.asn) || "";
  const loc = (cf && cf.city && cf.country)
    ? `${cf.city} / ${cf.country}`
    : "";
  return htmlResponse(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>VLESS Edge 节点管理系统</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
*{box-sizing:border-box;}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#020617;color:#e5e7eb;margin:0;}
header{padding:16px 20px;border-bottom:1px solid #1f2937;display:flex;align-items:center;gap:10px;}
header h1{margin:0;font-size:20px;}
main{max-width:900px;margin:0 auto;padding:16px;}
.card{background:#020617;border:1px solid #1f2937;border-radius:16px;padding:16px 18px;margin-bottom:16px;}
.card h2{margin:0 0 12px;font-size:16px;}
.field{margin-bottom:10px;}
.field label{display:block;font-size:13px;margin-bottom:4px;color:#9ca3af;}
.field input{width:100%;padding:8px 10px;border-radius:10px;border:1px solid #1f2937;background:#020617;color:#e5e7eb;font-size:14px;}
.badge{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:12px;background:#0f172a;color:#a5b4fc;border:1px solid #1d4ed8;margin-right:6px;}
.small{font-size:12px;color:#9ca3af;}
button{border:none;border-radius:999px;padding:8px 16px;background:linear-gradient(135deg,#22c55e,#0ea5e9);color:#fff;font-size:14px;font-weight:600;cursor:pointer;}
code{font-family:ui-monospace,Menlo,Monaco,Consolas,"Liberation Mono","Courier New",monospace;font-size:13px;background:#020617;padding:2px 6px;border-radius:6px;}
pre{background:#020617;border-radius:10px;padding:10px;overflow:auto;font-size:12px;border:1px solid #1f2937;}
</style>
</head>
<body>
<header>
  <span style="font-size:22px">🛠️</span>
  <div>
    <h1>VLESS Edge 节点管理系统</h1>
    <div class="small">通过本面板，你可以可视化配置 Cloudflare Worker 反代 VLESS 节点，并一键生成 v2rayN / SingBox / Clash 订阅。</div>
  </div>
</header>
<main>
  <section class="card">
    <h2>当前线路状态 / 入口节点</h2>
    <div class="small">
      <div>你的公网 IP：<code>${ip}</code></div>
      <div>当前 CF 节点：${colo} ${asn ? "(ASN " + asn + ")" : ""}</div>
      ${loc ? `<div>大致位置：${loc}</div>` : ""}
    </div>
  </section>

  <section class="card">
    <h2>基础参数配置</h2>
    <form id="cfgForm">
      <div class="field">
        <label>UUID（必填）</label>
        <input name="uuid" value="${config.uuid || ""}" placeholder="d50b4326-......" required />
      </div>
      <div class="field">
        <label>Worker 域名（必填）</label>
        <input name="workerHost" value="${config.workerHost || ""}" placeholder="例如：ec.firegod.eu.org" required />
      </div>
      <div class="field">
        <label>WS 路径（必填）</label>
        <input name="wsPath" value="${config.wsPath || "/echws"}" placeholder="/echws" required />
      </div>
      <div class="field">
        <label>后端 VPS 域名（必填）</label>
        <input name="backendHost" value="${config.backendHost || ""}" placeholder="例如：cc1.firegod.eu.org" required />
      </div>
      <div class="field">
        <label>后端端口（必填）</label>
        <input name="backendPort" value="${
          config.backendPort || "2082"
        }" placeholder="例如：2082" required />
      </div>
      <button type="submit">保存配置</button>
      <span id="saveMsg" class="small"></span>
    </form>
  </section>

  <section class="card">
    <h2>订阅 / 节点信息</h2>
    <p class="small">
      v2rayN 订阅地址：
      <code>https://${config.workerHost || "[worker-host]"}/sub</code>
    </p>
    <p class="small">
      单节点（VLESS+TLS+WS）示例将在配置保存后通过订阅自动生成。
    </p>
  </section>
</main>
<script>
const form = document.getElementById('cfgForm');
const msgEl = document.getElementById('saveMsg');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msgEl.textContent = '保存中...';
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(data),
    });
    if (res.ok) {
      msgEl.textContent = '已保存 ✅';
    } else {
      const t = await res.text();
      msgEl.textContent = '保存失败：' + t;
    }
  } catch (err) {
    msgEl.textContent = '请求失败：' + err.message;
  }
});
</script>
</body>
</html>`);
}

// --------- VLESS over WS proxy ---------

async function handleVlessWs(request, env, config) {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("Expected WebSocket", { status: 400 });
  }

  const backendUrl = `ws://${config.backendHost}:${config.backendPort}${
    config.wsPath || "/echws"
  }`;

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);

  // 将客户端 WS 转发到后端 WS
  const requestHeaders = new Headers(request.headers);
  // 调整 Host 为后端域名
  requestHeaders.set("Host", config.backendHost);

  fetch(backendUrl, {
    method: "GET",
    headers: requestHeaders,
    webSocket: server,
  }).then(
    backendResp => {
      // 这里只需要后台建立 WS 即可
    },
    err => {
      console.error("backend ws error", err);
      client.close(1011, "backend error");
    }
  );

  return new Response(null, {
    status: 101,
    webSocket: client,
  });
}

// --------- Subscription ---------

function buildVlessLink(cfg) {
  const host = cfg.workerHost;
  const wsPath = cfg.wsPath || "/echws";
  const uuid = cfg.uuid;
  if (!host || !uuid) return "";
  const params = new URLSearchParams({
    encryption: "none",
    security: "tls",
    type: "ws",
    sni: host,
    host,
    path: wsPath,
  });
  return `vless://${uuid}@${host}:443?${params.toString()}#VLESS-EDGE`;
}

function encodeBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

async function handleSub(env) {
  const cfg = await getConfig(env);
  const link = buildVlessLink(cfg);
  if (!link) {
    return new Response("CONFIG INCOMPLETE", { status: 400 });
  }
  const body = link + "\n";
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

// --------- Main fetch handler ---------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Panel & API
    if (pathname === "/login") {
      const passHash = await getPassHash(env);
      if (request.method === "GET") {
        return renderLoginPage(!!passHash);
      }
      if (request.method === "POST") {
        const form = await request.formData();
        const pwd = form.get("password") || "";
        if (!pwd) {
          return renderLoginPage(!!passHash, "密码不能为空");
        }
        if (!passHash) {
          // init
          const newHash = await sha256(pwd);
          await setPassHash(env, newHash);
        } else {
          const hash = await sha256(pwd);
          if (hash !== passHash) {
            return renderLoginPage(true, "密码错误");
          }
        }
        const cookie = await makeAuthCookie(env);
        return htmlResponse(
          `<meta http-equiv="refresh" content="0;url=/" />`,
          200,
          { "Set-Cookie": cookie }
        );
      }
      return new Response("Method Not Allowed", { status: 405 });
    }

    if (pathname === "/api/config") {
      const authed = await isAuthed(request, env);
      if (!authed) return new Response("Unauthorized", { status: 401 });

      if (request.method === "GET") {
        const cfg = await getConfig(env);
        return jsonResponse(cfg);
      }
      if (request.method === "POST") {
        const body = await request.text();
        let data = {};
        try {
          data = JSON.parse(body || "{}");
        } catch (e) {
          return new Response("Bad JSON", { status: 400 });
        }
        const cfg = await getConfig(env);
        cfg.uuid = (data.uuid || "").trim();
        cfg.workerHost = (data.workerHost || "").trim();
        cfg.wsPath = (data.wsPath || "/echws").trim();
        cfg.backendHost = (data.backendHost || "").trim();
        cfg.backendPort = (data.backendPort || "").trim() || "2082";
        await setConfig(env, cfg);
        return jsonResponse({ ok: true });
      }
      return new Response("Method Not Allowed", { status: 405 });
    }

    if (pathname === "/sub") {
      return handleSub(env);
    }

    // WebSocket proxy path, default /echws
    const cfg = await getConfig(env);
    const wsPath = cfg.wsPath || "/echws";
    if (pathname === wsPath) {
      return handleVlessWs(request, env, cfg);
    }

    // Admin panel root
    if (pathname === "/" || pathname === "") {
      const authed = await isAuthed(request, env);
      if (!authed) {
        return redirect("/login");
      }
      const cf = request.cf || null;
      return renderAdminPage(cfg, cf);
    }

    // 其它路径简单返回 404
    return new Response("Not Found", { status: 404 });
  },
};
