// ===============================================================
// VLESS Edge Worker with Admin UI + Password Login + KV Storage
// ---------------------------------------------------------------
// - Admin UI (Tailwind) at "/"
// - Login page with password + "show password" + "remember me 1 day"
// - Password stored in KV (key: ADMIN_PASSWORD)
// - Session token stored in KV (key: ADMIN_SESSION) + cookie "vless_admin"
// - Config stored in KV (key: CONFIG_JSON)
// - Subscription endpoints: /sub, /singbox, /clash, /qrcode
// - WebSocket VLESS proxy with mode A (stable) and B (obfuscated)
// ---------------------------------------------------------------
// IMPORTANT:
// 1. Create a KV Namespace in Cloudflare (e.g. "VLESS_CONFIG").
// 2. Bind it to this Worker with binding name: CONFIG_KV
// ===============================================================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // --- Auth-related routing ---
    if (pathname === "/login" && request.method === "GET") {
      const hasPw = !!(await env.CONFIG_KV.get("ADMIN_PASSWORD"));
      return new Response(renderLoginPage("", !hasPw), {
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }

    if (pathname === "/login" && request.method === "POST") {
      return handleLogin(request, env);
    }

    // --- 退出登录 ---
    if (pathname === "/logout") {
      // 清除 KV 中的 session
      await env.CONFIG_KV.delete("ADMIN_SESSION");
      // 清除 Cookie
      const headers = new Headers();
      headers.set("Set-Cookie", "vless_admin=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0");
      headers.set("Location", "/login");
      return new Response(null, {
        status: 302,
        headers
      });
    }

    // --- Admin UI, protected ---
    if (pathname === "/" || pathname === "/index") {
      const authed = await isAuthenticated(request, env);
      const hasPw = !!(await env.CONFIG_KV.get("ADMIN_PASSWORD"));
      if (!authed) {
        return new Response(renderLoginPage("", !hasPw), {
          headers: { "content-type": "text/html; charset=utf-8" }
        });
      }
      return new Response(renderAdminUI(), {
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }

    // --- Protected JSON APIs (config) ---
    if (pathname === "/api/get-config") {
      if (!(await isAuthenticated(request, env))) {
        return new Response("Unauthorized", { status: 401 });
      }
      const data = await env.CONFIG_KV.get("CONFIG_JSON");
      return new Response(data || "{}", {
        headers: { "content-type": "application/json" }
      });
    }

    if (pathname === "/api/set-config") {
      if (!(await isAuthenticated(request, env))) {
        return new Response("Unauthorized", { status: 401 });
      }
      const body = await request.text();
      await env.CONFIG_KV.put("CONFIG_JSON", body);
      return new Response("OK");
    }

    if (pathname === "/api/reset-config") {
      if (!(await isAuthenticated(request, env))) {
        return new Response("Unauthorized", { status: 401 });
      }
      await env.CONFIG_KV.delete("CONFIG_JSON");
      return new Response("RESET_OK");
    }
    // --- Geo info API (线路探测 + 节点评分 + 优选建议) ---
    if (pathname === "/api/geo") {
      const info = {
        ip: request.headers.get("CF-Connecting-IP") || "",
        country: request.cf && request.cf.country || "",
        region: request.cf && request.cf.region || "",
        city: request.cf && request.cf.city || "",
        asn: request.cf && request.cf.asn || "",
        colo: request.cf && request.cf.colo || ""
      };

      const colo = (info.colo || "").toUpperCase();
      let score = "C";
      let comment = "线路一般，可以考虑更换 Cloudflare IP 或区域。";
      let ipSuggestions = [];

      if (["HKG","TPE","NRT","KIX","ICN","SIN"].includes(colo)) {
        score = "A";
        comment = "非常适合中国大陆访问（亚洲节点，就近接入）。建议保留当前 IP，但可在同段内优选更稳节点。";
        ipSuggestions = [
          "188.114.96.0/20 （常见优选，适合港/台/新）",
          "104.16.0.0/13",
          "172.64.0.0/13"
        ];
      } else if (["LAX","SJC","SEA","ORD","DFW","IAD","JFK"].includes(colo)) {
        score = "B";
        comment = "落在北美节点，延迟略高但可用。建议改用更易落香港/台湾的新 IP。";
        ipSuggestions = [
          "188.114.96.0/20 （尝试改绑到该段，再测试是否转向 HKG/TPE）",
          "141.101.64.0/18",
          "104.24.0.0/14"
        ];
      } else {
        score = "C";
        comment = "可能落在较远或冷门节点，建议优选 IP，观察 colo 是否切到 HKG/TPE/NRT/SIN。";
        ipSuggestions = [
          "188.114.96.0/20",
          "104.16.0.0/13",
          "172.64.0.0/13",
          "141.101.64.0/18"
        ];
      }

      return new Response(JSON.stringify({
        ...info,
        score,
        comment,
        ipSuggestions
      }, null, 2), {
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    // --- IP优选测速API（使用访问测速页面的IP进行测速） ---
    if (pathname === "/api/test-ips") {
      const authed = await isAuthenticated(request, env);
      if (!authed) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { 
          status: 401,
          headers: { "content-type": "application/json" }
        });
      }
      
      // 使用访问测速页面的IP和colo进行测速
      const colo = (request.cf && request.cf.colo || "").toUpperCase();
      const clientIP = request.headers.get("CF-Connecting-IP") || "";
      const country = request.cf && request.cf.country || "";
      
      // 获取所有候选IP
      const candidateIPs = getAllCandidateIPs(colo);
      
      // 并发测试所有IP的HTTP RTT
      const testedIPs = await testIPsRTT(candidateIPs, 15);
      
      // 选择最快的5个IP
      const top5IPs = testedIPs.slice(0, 5);
      
      return new Response(JSON.stringify({
        clientIP: clientIP,
        colo: colo,
        country: country,
        tested: testedIPs.length,
        top5: top5IPs.map(r => ({ ip: r.ip, rtt: r.rtt }))
      }), {
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    // --- 速度测试页面（前端测速工具，需要登录） ---
    if (pathname === "/speedtest") {
      const authed = await isAuthenticated(request, env);
      if (!authed) {
        const hasPw = !!(await env.CONFIG_KV.get("ADMIN_PASSWORD"));
        return new Response(renderLoginPage("请先登录以访问测速页面", !hasPw), {
          headers: { "content-type": "text/html; charset=utf-8" }
        });
      }
      return new Response(renderSpeedtestPage(), {
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }

    // --- 下载测试文件（可自定义大小） ---
    if (pathname === "/speed.bin") {
      // 支持通过查询参数自定义文件大小，例如 ?size=2 表示2MB，?size=0.5 表示0.5MB
      const sizeParam = url.searchParams.get("size");
      let sizeMB = 1; // 默认1MB
      if (sizeParam) {
        const parsed = parseFloat(sizeParam);
        if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
          sizeMB = parsed; // 限制最大100MB
        }
      }
      const size = Math.floor(sizeMB * 1024 * 1024); // 转换为字节
      const chunk = "0".repeat(1024);
      let data = "";
      for (let i = 0; i < size / 1024; i++) {
        data += chunk;
      }
      return new Response(data, {
        headers: {
          "content-type": "application/octet-stream",
          "cache-control": "no-store",
          "content-length": size.toString()
        }
      });
    }



        // --- Public API: subscriptions (not protected,方便客户端直接订阅) ---
    if (pathname === "/sub") {
      const cfg = await loadConfig(env);

      // 订阅 IP 模式：
      // ?ip=domain  → 域名 + 自动优选IP节点（默认，根据HTTP RTT测速）
      // ?ip=dual    → 域名 + 自动优选IP节点（根据HTTP RTT测速）
      // ?ip=ip/best/colo → 仅自动优选IP节点（根据HTTP RTT测速）
      // ?ip=none    → 只用域名，不包含IP节点
      const ipParam = url.searchParams.get("ip") || "dual";
      const colo = (request.cf && request.cf.colo || "").toUpperCase();
      const country = request.cf && request.cf.country || "";
      // 获取客户端IP（用于显示在信息节点中）
      const clientIP = request.headers.get("CF-Connecting-IP") || 
                       request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || 
                       "未知";
      
      let ipOption = { mode: "domain", ips: [], preferredIPs: [] };
      
      // 默认和dual模式：域名 + 自动优选IP节点
      // ip/best/colo模式：仅自动优选IP节点
      if (ipParam === "dual" || ipParam === "ip" || ipParam === "best" || ipParam === "colo" || ipParam === "") {
        // 获取所有候选IP
        const candidateIPs = getAllCandidateIPs(colo);
        
        // 并发测试所有IP的HTTP RTT（限制并发数避免超时）
        const testedIPs = await testIPsRTT(candidateIPs, 15);
        
        // 选择最快的5个IP作为优选IP
        let preferredIPs = testedIPs.slice(0, 5).map(r => r.ip);
        
        // 如果测速失败或结果不足5个，使用默认推荐的IP补充
        if (preferredIPs.length < 5) {
          const defaultIPs = pickIpListByColo(colo);
          for (const ip of defaultIPs) {
            if (preferredIPs.length >= 5) break;
            if (!preferredIPs.includes(ip)) {
              preferredIPs.push(ip);
            }
          }
        }
        
        if (ipParam === "ip" || ipParam === "best" || ipParam === "colo") {
          ipOption = { mode: "ip", ips: preferredIPs, preferredIPs: preferredIPs };
        } else {
          // 默认和dual模式：域名 + 优选IP
          ipOption = { mode: "dual", ips: preferredIPs, preferredIPs: preferredIPs };
        }
      }

      const str = generateV2raySub(cfg, ipOption, colo, country, clientIP);
      const b64 = typeof btoa === "function"
        ? btoa(str)
        : Buffer.from(str, "utf-8").toString("base64");
      return new Response(b64, {
        headers: { "content-type": "text/plain; charset=utf-8" }
      });
    }



    if (pathname === "/singbox") {
      const cfg = await loadConfig(env);
      const json = generateSingbox(cfg);
      return new Response(JSON.stringify(json, null, 2), {
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }

    if (pathname === "/clash") {
      const cfg = await loadConfig(env);
      const yaml = generateClash(cfg);
      return new Response(yaml, {
        headers: { "content-type": "text/yaml; charset=utf-8" }
      });
    }

    if (pathname === "/qrcode") {
      const cfg = await loadConfig(env);
      const png = await generateQRCode(cfg);
      return new Response(png, {
        headers: { "content-type": "image/png" }
      });
    }

    // --- WebSocket for VLESS proxy (no auth, for clients) ---
    const upgrade = request.headers.get("Upgrade") || "";
    if (upgrade.toLowerCase() === "websocket") {
      const cfg = await loadConfig(env);
      return handleWS(request, cfg);
    }

    return new Response("Not Found", { status: 404 });
  }
};

// ===============================================================
// Auth helpers: password & session
// ===============================================================

// 防暴力破解配置
const MAX_LOGIN_ATTEMPTS = 5; // 最大失败次数
const LOCKOUT_DURATION = 15 * 60 * 1000; // 锁定时间：15分钟（毫秒）

// 获取客户端IP
function getClientIP(request) {
  return request.headers.get("CF-Connecting-IP") || 
         request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || 
         "unknown";
}

// 检查IP是否被锁定（只检查锁定状态）
async function isIPLocked(ip, env) {
  const key = `LOGIN_LOCKED_${ip}`;
  const data = await env.CONFIG_KV.get(key);
  if (!data) return { locked: false };
  
  try {
    const info = JSON.parse(data);
    const now = Date.now();
    const lockUntil = info.lockUntil || 0;
    
    // 如果还在锁定期内
    if (lockUntil > now) {
      const remainingSeconds = Math.ceil((lockUntil - now) / 1000);
      return { 
        locked: true, 
        remainingSeconds
      };
    }
    
    // 锁定已过期，删除记录
    await env.CONFIG_KV.delete(key);
    return { locked: false };
  } catch (e) {
    return { locked: false };
  }
}

// 记录登录失败（使用时间窗口计数，减少KV写入）
async function recordLoginFailure(ip, env) {
  const key = `LOGIN_ATTEMPTS_${ip}`;
  const data = await env.CONFIG_KV.get(key);
  
  const now = Date.now();
  const windowStart = now - (LOCKOUT_DURATION / 3); // 5分钟时间窗口
  
  let info = { attempts: [], windowStart: now };
  if (data) {
    try {
      info = JSON.parse(data);
      // 清理过期的失败记录（5分钟前的）
      info.attempts = (info.attempts || []).filter(t => t > windowStart);
    } catch (e) {
      info = { attempts: [], windowStart: now };
    }
  }
  
  // 添加当前失败时间
  info.attempts.push(now);
  const attemptCount = info.attempts.length;
  
  // 只在达到锁定阈值时才写入KV（第5次失败）
  if (attemptCount >= MAX_LOGIN_ATTEMPTS) {
    // 写入锁定信息
    const lockKey = `LOGIN_LOCKED_${ip}`;
    const lockUntil = now + LOCKOUT_DURATION;
    await env.CONFIG_KV.put(lockKey, JSON.stringify({ lockUntil: lockUntil, lockedAt: now }), { 
      expirationTtl: LOCKOUT_DURATION / 1000 
    });
    // 删除计数记录
    await env.CONFIG_KV.delete(key);
  } else {
    // 前几次失败：只在第1次和第3次时写入KV（减少写入频率）
    // 或者只在第1次时写入，后续通过时间窗口判断
    if (attemptCount === 1 || attemptCount === 3) {
      await env.CONFIG_KV.put(key, JSON.stringify(info), { 
        expirationTtl: LOCKOUT_DURATION / 1000 
      });
    }
  }
  
  return attemptCount;
}

// 清除登录失败记录（登录成功时调用）
async function clearLoginAttempts(ip, env) {
  const lockKey = `LOGIN_LOCKED_${ip}`;
  const attemptKey = `LOGIN_ATTEMPTS_${ip}`;
  await env.CONFIG_KV.delete(lockKey);
  await env.CONFIG_KV.delete(attemptKey);
}

async function isAuthenticated(request, env) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookies = parseCookies(cookieHeader);
  const token = cookies["vless_admin"];
  if (!token) return false;
  const saved = await env.CONFIG_KV.get("ADMIN_SESSION");
  if (!saved) return false;
  return token === saved;
}

function parseCookies(header) {
  const out = {};
  header.split(";").forEach(part => {
    const [k, v] = part.split("=").map(s => s && s.trim());
    if (k && v) out[k] = v;
  });
  return out;
}

async function handleLogin(request, env) {
  const formData = await request.formData();
  const password = (formData.get("password") || "").toString();
  const remember = formData.get("remember") === "on";
  const clientIP = getClientIP(request);

  // 检查IP是否被锁定（仅在已有密码时检查，初次设置密码不限制）
  const existing = await env.CONFIG_KV.get("ADMIN_PASSWORD");
  if (existing) {
    const lockStatus = await isIPLocked(clientIP, env);
    if (lockStatus.locked) {
      const minutes = Math.ceil(lockStatus.remainingSeconds / 60);
      return new Response(renderLoginPage(
        `登录失败次数过多，IP已被锁定。请等待 ${minutes} 分钟后再试。`, 
        false
      ), {
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }
  }

  if (!password) {
    const hasPw = !!(await env.CONFIG_KV.get("ADMIN_PASSWORD"));
    return new Response(renderLoginPage("密码不能为空", !hasPw), {
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  }

  // 初次设置密码
  if (!existing) {
    await env.CONFIG_KV.put("ADMIN_PASSWORD", password);
    // 清除可能存在的失败记录
    await clearLoginAttempts(clientIP, env);
  } else {
    // 验证密码
    if (existing !== password) {
      // 检查是否已锁定
      const lockStatus = await isIPLocked(clientIP, env);
      
      if (lockStatus.locked) {
        // 已锁定
        const minutes = Math.ceil(lockStatus.remainingSeconds / 60);
        return new Response(renderLoginPage(
          `登录失败次数过多，IP已被锁定。请等待 ${minutes} 分钟后再试。`, 
          false
        ), {
          headers: { "content-type": "text/html; charset=utf-8" }
        });
      }
      
      // 记录登录失败（只在必要时写入KV）
      const attempts = await recordLoginFailure(clientIP, env);
      const remaining = MAX_LOGIN_ATTEMPTS - attempts;
      
      let errorMsg = "密码错误，请重试。";
      if (remaining > 0) {
        errorMsg += ` 剩余尝试次数：${remaining}`;
      } else {
        const minutes = Math.ceil(LOCKOUT_DURATION / 60000);
        errorMsg = `密码错误次数过多，IP已被锁定 ${minutes} 分钟。`;
      }
      
      return new Response(renderLoginPage(errorMsg, false), {
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }
    
    // 密码正确，清除失败记录（如果存在）
    await clearLoginAttempts(clientIP, env);
  }

  // 生成 session token 存入 KV
  const token = crypto.randomUUID();
  await env.CONFIG_KV.put("ADMIN_SESSION", token);

  // 设置 Cookie，记住 1 天（如勾选）
  let cookie = `vless_admin=${token}; Path=/; HttpOnly; SameSite=Lax; Secure`;
  if (remember) {
    cookie += "; Max-Age=86400";
  }

  const headers = new Headers();
  headers.set("Set-Cookie", cookie);
  headers.set("Location", "/");

  return new Response(null, {
    status: 302,
    headers
  });
}

// ===============================================================
// Login Page (风格 C, 卡片 + 显示密码 + 记住我 1 天)
// ===============================================================

function renderLoginPage(message, needInit) {
  const safeMsg = message ? String(message) : "";
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <title>VLESS 后台登录</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <script src="https://cdn.tailwindcss.com"><\/script>
</head>
<body class="min-h-screen bg-slate-100 flex items-center justify-center">
  <div class="w-full max-w-md">
    <div class="bg-white shadow-xl rounded-2xl p-8 border border-slate-200">
      <h1 class="text-2xl font-bold mb-4 flex items-center">
        <span class="mr-2">🔐</span> VLESS 管理后台登录
      </h1>
      <p class="text-sm text-slate-500 mb-4">
        ${needInit
          ? "检测到你还没有设置后台密码，请先设置一个新的管理员密码。以后登录都将使用该密码。"
          : "请输入后台密码进入管理面板。"}
      </p>

      ${safeMsg ? `<div class="mb-4 text-red-600 text-sm font-semibold">${safeMsg}</div>` : ""}

      <form method="POST" action="/login" class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-1">后台密码</label>
          <div class="flex items-center border border-slate-300 rounded-lg overflow-hidden bg-slate-50">
            <input id="password" name="password" type="password"
                   class="flex-1 px-3 py-2 bg-transparent outline-none"
                   placeholder="请输入后台密码" />
            <button type="button" id="togglePwd"
                    class="px-3 text-xs text-slate-600 hover:text-slate-900">
              显示
            </button>
          </div>
        </div>

        <div class="flex items-center justify-between text-sm">
          <label class="inline-flex items-center">
            <input type="checkbox" name="remember" class="mr-2" />
            记住我 1 天
          </label>
        </div>

        <button type="submit"
                class="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">
          登录 / 保存密码
        </button>
      </form>

      <div class="mt-6 text-xs text-slate-500 space-y-1">
        <p class="font-semibold">使用说明：</p>
        <p>1. 在 Cloudflare Dashboard → Workers 和 KV → 创建一个 KV Namespace（例如：VLESS_CONFIG）。</p>
        <p>2. 在当前 Worker 的 Settings → Variables → KV Namespace Bindings 中绑定该 KV，绑定名设为：<code>CONFIG_KV</code>。</p>
        <p>3. 首次打开本页面时，将提示你设置后台密码。设置完成后，今后访问本后台需要输入该密码。</p>
        <p>4. 登录成功后，将进入节点管理面板，在那里可以配置 UUID、后端域名、端口、WS 路径、多节点等。</p>
      </div>
    </div>
  </div>

  <script>
    const pwdInput = document.getElementById("password");
    const toggleBtn = document.getElementById("togglePwd");
    if (toggleBtn && pwdInput) {
      toggleBtn.addEventListener("click", function (e) {
        e.preventDefault();
        if (pwdInput.type === "password") {
          pwdInput.type = "text";
          toggleBtn.textContent = "隐藏";
        } else {
          pwdInput.type = "password";
          toggleBtn.textContent = "显示";
        }
      });
    }
  <\/script>
</body>
</html>`;
}

// ===============================================================
// Admin UI 页面（已登录后才可访问）
// ===============================================================

function renderAdminUI() {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <title>VLESS Edge 节点管理面板</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <script src="https://cdn.tailwindcss.com"><\/script>
  <style>
    body { background: #f8fafc; }
    .card { background:white;border-radius:16px;padding:20px;box-shadow:0 4px 10px rgba(0,0,0,0.06); }
    .input { width:100%;padding:10px;border-radius:8px;background:#f1f5f9;margin-bottom:10px; }
    .label { font-weight:600;margin-bottom:4px;display:block;color:#334155; }
    .btn { padding:8px 16px;border-radius:8px;font-weight:600;color:white;background:#2563eb; }
    .btn2 { padding:8px 16px;border-radius:8px;font-weight:600;background:#e2e8f0; }
    .btn-danger { padding:8px 16px;border-radius:8px;font-weight:600;background:#dc2626;color:white; }
  </style>
</head>
<body class="p-6">
  <div class="flex justify-between items-center mb-6">
    <div>
      <h1 class="text-3xl font-bold mb-2">🚀 VLESS Edge 节点管理系统</h1>
      <p class="text-gray-600">通过本面板，你可以可视化配置 Cloudflare Worker 反代的 VLESS 节点，并一键生成 v2rayN / SingBox / Clash 订阅。</p>
    </div>
    <a href="/logout" class="btn-danger">退出登录</a>
  </div>

  <!-- 线路检测 / Geo 信息 -->
  <div class="card mb-6">
    <h2 class="text-xl font-semibold mb-3">当前线路状态 / 入口节点</h2>
    <p id="geoLocation" class="text-sm text-slate-700 mb-1">正在检测你的地理位置...</p>
    <p id="geoColo" class="text-sm text-slate-700 mb-1">正在检测 Cloudflare 入口机房...</p>
    <p id="geoScore" class="text-sm font-semibold mb-1">评分：-</p>
    <p id="geoComment" class="text-xs text-slate-500 mb-2"></p>
    <p class="text-xs text-slate-500">建议优选 IP 段（需要你手动去测速筛选最优）：</p>
    <p id="geoIps" class="text-xs text-slate-600 break-words"></p>
  </div>

  <!-- 基础参数配置 -->
  <div class="card mb-6">
    <h2 class="text-xl font-semibold mb-4">基础参数配置</h2>
    <label class="label">UUID（必填）</label>
    <input id="uuid" class="input" placeholder="请输入 VLESS UUID">
    <label class="label">Worker 域名（必填）</label>
    <input id="workerHost" class="input" placeholder="例如：ech1.xxxxxx.com">
    <label class="label">WS 路径（必填）</label>
    <input id="wsPath" class="input" value="/echws">
    <label class="label">后端 VPS 域名（必填）</label>
    <input id="backendHost" class="input" placeholder="例如：cc1.xxxxxx.com">
    <label class="label">后端端口（必填）</label>
    <input id="backendPort" class="input" value="2082">
    <p class="text-xs text-slate-500">后端端口为 Xray WS 入站端口（无需 TLS）。本 Worker 将通过 ws:// 后端转发客户端流量。</p>
  </div>

  <!-- WebSocket 模式 -->
  <div class="card mb-6">
    <h2 class="text-xl font-semibold mb-4">WebSocket 代理模式</h2>
    <p class="text-sm text-slate-600 mb-2">
      使用稳定型模式，只转发 WebSocket 数据，不主动修改请求头，兼容性最高。
    </p>
  </div>

  <!-- 多节点 -->
  <div class="card mb-6">
    <h2 class="text-xl font-semibold mb-4 flex justify-between">
      多节点列表（可选）
      <button id="addNode" class="btn2">➕ 添加节点</button>
    </h2>
    <div id="nodes"></div>
    <p class="text-xs text-slate-500 mt-2">你可以在这里添加多个前端节点域名，例如：ech1.xxxxxx.com、ech2.xxxxxx.com。</p>
  </div>

  <!-- 保存 & 重置 -->
  <div class="card mb-6">
    <button id="save" class="btn">💾 保存配置到 KV</button>
    <button id="resetCfg" class="btn-danger ml-3">🗑️ 清空节点配置</button>
    <span id="msg" class="ml-3 font-semibold"></span>
  </div>


  <!-- 线路测速工具 -->
  <div class="card mb-6">
    <h2 class="text-xl font-semibold mb-4">Cloudflare Worker 线路测速</h2>
    <p class="text-sm text-slate-600 mb-3">
      使用内置测速工具，可以一键测试当前 Worker 域名的真实延迟和下载速度，并对比不同 CF 优选 IP / 不同子域名的表现。
    </p>
    <div class="space-x-2">
      <a href="/speedtest" target="_blank" class="btn2">打开测速页面（新窗口）</a>
      <a href="/api/geo" target="_blank" class="btn2">查看当前线路 JSON 信息</a>
    </div>
    <p class="text-xs text-slate-500 mt-2">
      建议先在这里跑一遍测速，确认入口机房（colo）是否为 HKG/TPE/SIN 等亚洲节点，再配合订阅里的“优选IP节点”进行真实体验对比。
    </p>
  </div>
  <!-- 订阅区 -->
  <div class="card mb-6">
    <h2 class="text-xl font-semibold mb-4">订阅 & 导入</h2>
    <div class="space-y-2 text-sm">
      <p>v2rayN 订阅（Base64）：</p>
      <p><code id="subUrl"></code></p>
      <p class="text-xs text-slate-500">复制上述链接到 v2rayN → 订阅 → 添加订阅，即可自动导入节点。</p>
    </div>
    <div class="mt-3 space-x-2">
      <a href="/sub" target="_blank" class="btn2">打开 v2rayN 订阅内容</a>
      <a href="/singbox" target="_blank" class="btn2">查看 SingBox JSON</a>
      <a href="/clash" target="_blank" class="btn2">查看 Clash Meta YAML</a>
      <a href="/qrcode" target="_blank" class="btn2">查看节点二维码</a>
    </div>
  </div>

  <script>
    async function loadConfig() {
      var cfg = {};
      try {
        cfg = await fetch("/api/get-config").then(function(r){return r.json()});
      } catch(e) { cfg = {}; }

      document.getElementById("uuid").value = cfg.uuid || "";
      document.getElementById("workerHost").value = cfg.workerHost || "";
      document.getElementById("wsPath").value = cfg.wsPath || "/echws";
      document.getElementById("backendHost").value = cfg.backendHost || "";
      document.getElementById("backendPort").value = cfg.backendPort || "2082";

      if (cfg.nodes && Array.isArray(cfg.nodes)) {
        cfg.nodes.forEach(function(n){ addNodeUI(n); });
      }

      try {
        var loc = window.location;
        var base = loc.origin;
        document.getElementById("subUrl").textContent = base + "/sub";
      } catch(e) {}

      // 额外：加载 Geo 信息
      try {
        var geoRes = await fetch("/api/geo");
        var geo = await geoRes.json();
        var locText = "你的大致位置：" + (geo.country || "-") + " / " + (geo.region || "-") + " / " + (geo.city || "-")
          + " （ASN " + (geo.asn || "-") + "）";
        document.getElementById("geoLocation").textContent = locText;
        document.getElementById("geoColo").textContent = "当前 Worker 落地机房（colo）：" + (geo.colo || "-");
        document.getElementById("geoScore").textContent = "线路评分：" + (geo.score || "-");
        document.getElementById("geoComment").textContent = geo.comment || "";
        if (geo.ipSuggestions && geo.ipSuggestions.length) {
          document.getElementById("geoIps").textContent = geo.ipSuggestions.join(", ");
        }
      } catch(e) {
        document.getElementById("geoLocation").textContent = "无法获取 Geo 信息（可能是浏览器或网络限制）。";
      }
    }

    function addNodeUI(d) {
      d = d || {};
      var div = document.createElement("div");
      div.className = "p-3 border rounded-lg mb-3";
      var html = ""
        + '<label class="label">节点域名</label>'
        + '<input class="input node-host" placeholder="例如：ech2.xxxxxx.com" value="' + (d.host || "") + '">'
        + '<label class="label">备注（可选）</label>'
        + '<input class="input node-name" placeholder="例如：新加坡节点" value="' + (d.name || "") + '">'
        + '<button class="btn2 remove mt-2">删除节点</button>';
      div.innerHTML = html;
      div.querySelector(".remove").onclick = function(){ div.remove(); };
      document.getElementById("nodes").appendChild(div);
    }

    document.getElementById("addNode").onclick = function(){ addNodeUI(); };

    document.getElementById("save").onclick = async function () {
      var uuidEl = document.getElementById("uuid");
      var workerHostEl = document.getElementById("workerHost");
      var backendHostEl = document.getElementById("backendHost");
      var backendPortEl = document.getElementById("backendPort");
      var wsPathEl = document.getElementById("wsPath");

      if (!uuidEl.value) return showMsg("❌ UUID 不能为空", true);
      if (!workerHostEl.value) return showMsg("❌ Worker 域名不能为空", true);
      if (!backendHostEl.value) return showMsg("❌ 后端域名不能为空", true);
      if (!backendPortEl.value) return showMsg("❌ 后端端口不能为空", true);

      var nodesDivs = document.querySelectorAll("#nodes > div");
      var nodesData = [];
      nodesDivs.forEach(function(d){
        nodesData.push({
          host: d.querySelector(".node-host").value,
          name: d.querySelector(".node-name").value
        });
      });

      var cfg = {
        uuid: uuidEl.value,
        workerHost: workerHostEl.value,
        wsPath: wsPathEl.value,
        backendHost: backendHostEl.value,
        backendPort: backendPortEl.value,
        mode: "A",
        nodes: nodesData
      };

      await fetch("/api/set-config", {
        method: "POST",
        body: JSON.stringify(cfg)
      });

      showMsg("✅ 已保存配置");
    };

    document.getElementById("resetCfg").onclick = async function () {
      if (!confirm("确定要清空节点配置？此操作不可恢复。")) return;
      await fetch("/api/reset-config");
      location.reload();
    };

    function showMsg(text, isError) {
      var m = document.getElementById("msg");
      m.textContent = text;
      m.style.color = isError ? "red" : "green";
      setTimeout(function(){ m.textContent = ""; }, 3000);
    }

    loadConfig();
  <\/script>
</body>
</html>`;
}


// ===============================================================
// Config Loader
// ===============================================================
async function loadConfig(env) {
  const raw = await env.CONFIG_KV.get("CONFIG_JSON");
  if (!raw) {
    return {
      uuid: "",
      workerHost: "",
      wsPath: "/echws",
      backendHost: "",
      backendPort: "2082",
      mode: "A",
      nodes: []
    };
  }
  return JSON.parse(raw);
}

// ===============================================================
// VLESS URL builder
// ===============================================================
// 随机生成 User-Agent 函数
function generateRandomUserAgent() {
  const osList = [
    { name: "Windows NT 10.0", version: "10.0" },
    { name: "Windows NT 11.0", version: "11.0" },
    { name: "Macintosh; Intel Mac OS X 10_15_7", version: "10_15_7" },
    { name: "X11; Linux x86_64", version: "" }
  ];
  
  const browserList = [
    { name: "Chrome", versions: ["120", "121", "122", "123", "124", "125", "126", "127", "128", "129"] },
    { name: "Edg", versions: ["120", "121", "122", "123", "124", "125"] },
    { name: "Firefox", versions: ["121", "122", "123", "124", "125"] },
    { name: "Safari", versions: ["17.0", "17.1", "17.2", "17.3"] }
  ];
  
  const os = osList[Math.floor(Math.random() * osList.length)];
  const browser = browserList[Math.floor(Math.random() * browserList.length)];
  const browserVersion = browser.versions[Math.floor(Math.random() * browser.versions.length)];
  
  let ua = "";
  if (os.name.includes("Windows")) {
    ua = `Mozilla/5.0 (${os.name}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browserVersion} Safari/537.36`;
    if (browser.name === "Edg") {
      ua = `Mozilla/5.0 (${os.name}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browserVersion} Safari/537.36 Edg/${browserVersion}`;
    }
  } else if (os.name.includes("Mac")) {
    ua = `Mozilla/5.0 (${os.name}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browserVersion} Safari/537.36`;
    if (browser.name === "Safari") {
      ua = `Mozilla/5.0 (${os.name}) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/${browserVersion} Safari/605.1.15`;
    }
  } else {
    ua = `Mozilla/5.0 (${os.name}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browserVersion} Safari/537.36`;
    if (browser.name === "Firefox") {
      ua = `Mozilla/5.0 (${os.name}; rv:${browserVersion}) Gecko/20100101 Firefox/${browserVersion}`;
    }
  }
  
  return ua;
}

function buildVlessUrl(cfg, hostOverride = null, name = "Node") {
  const host = hostOverride || cfg.workerHost;
  const params = new URLSearchParams({
    encryption: "none",
    security: "tls",
    type: "ws",
    path: cfg.wsPath,
    host: cfg.workerHost,
    sni: cfg.workerHost
  });
  return `vless://${cfg.uuid}@${host}:443?${params.toString()}#${encodeURIComponent(name)}`;
}

// ===============================================================
// v2rayN Subscription text
// ===============================================================
function generateV2raySub(cfg, ipOption, colo = "", country = "", clientIP = "") {
  const list = [];
  ipOption = ipOption || { mode: "domain", ips: [], preferredIPs: [] };
  const mode = ipOption.mode || "domain";
  const ips = Array.isArray(ipOption.ips) ? ipOption.ips : (ipOption.ip ? [ipOption.ip] : []);
  const preferredIPs = Array.isArray(ipOption.preferredIPs) ? ipOption.preferredIPs : [];

  const ipOnly = (mode === "ip");

  // 0）信息节点（显示客户端IP和国家，无作用，仅用于显示信息）
  // 使用无效端口0，确保无法连接，仅作为信息展示
  if (clientIP && clientIP !== "未知") {
    const infoName = `[信息] IP: ${clientIP} 国家: ${country || "未知"} Colo: ${colo || "未知"}`;
    // 构建一个无效的VLESS链接（端口为0，无法连接）
    const infoParams = new URLSearchParams({
      encryption: "none",
      security: "tls",
      type: "ws",
      path: "/invalid",
      host: cfg.workerHost || "invalid.example.com",
      sni: cfg.workerHost || "invalid.example.com"
    });
    const infoUrl = `vless://${cfg.uuid || "00000000-0000-0000-0000-000000000000"}@0.0.0.0:0?${infoParams.toString()}#${encodeURIComponent(infoName)}`;
    list.push(infoUrl);
  }

  // 1）域名节点（非 ip-only 模式才添加）
  if (!ipOnly) {
    // 主节点标记为"未优选"
    list.push(buildVlessUrl(cfg, null, "主节点-未优选"));
    if (cfg.nodes && Array.isArray(cfg.nodes)) {
      cfg.nodes.forEach(function(n) {
        if (!n.host) return;
        // 其他域名节点也标记为"未优选"
        const nodeName = (n.name || n.host) + "-未优选";
        list.push(buildVlessUrl(cfg, n.host, nodeName));
      });
    }
  }

  // 2）IP 节点（根据HTTP RTT测速优选的最快5个）
  if ((mode === "dual" || mode === "ip") && ips.length) {
    ips.forEach(function(ip, idx) {
      if (!ip) return;
      // 标记为"优选"，因为这是通过HTTP RTT测速选出的最快IP
      const name = "优选" + (ips.length > 1 ? (idx + 1) : "");
      list.push(buildVlessUrl(cfg, ip, name));
    });
  }

  return list.join("\n");
}



// 扩展的 Cloudflare IP 候选列表（包含更多IP段，用于测速优选）
function getAllCandidateIPs(colo) {
  colo = (colo || "").toUpperCase();
  
  // 通用IP池（包含多个Cloudflare IP段）
  const allIPs = [
    // 188.114.x.x 段（常见优选）
    "188.114.96.3", "188.114.97.3", "188.114.98.3", "188.114.99.3",
    "188.114.100.3", "188.114.101.3", "188.114.102.3", "188.114.103.3",
    // 104.16.x.x 段
    "104.16.1.3", "104.16.2.3", "104.16.3.3", "104.16.4.3",
    "104.17.1.3", "104.17.2.3", "104.17.3.3", "104.17.4.3",
    "104.18.1.3", "104.18.2.3", "104.18.3.3", "104.18.4.3",
    // 172.64.x.x 段
    "172.64.1.3", "172.64.2.3", "172.64.3.3", "172.64.4.3",
    "172.65.1.3", "172.65.2.3", "172.65.3.3", "172.65.4.3",
    // 141.101.x.x 段
    "141.101.64.3", "141.101.65.3", "141.101.66.3", "141.101.67.3",
    // 104.24.x.x 段
    "104.24.1.3", "104.24.2.3", "104.24.3.3", "104.24.4.3",
    "104.25.1.3", "104.25.2.3", "104.25.3.3", "104.25.4.3",
    // 162.158.x.x 段
    "162.158.0.3", "162.158.1.3", "162.158.2.3", "162.158.3.3",
    // 108.162.x.x 段
    "108.162.192.3", "108.162.193.3", "108.162.194.3", "108.162.195.3"
  ];
  
  return allIPs;
}

// 根据 Cloudflare colo 返回一个推荐 IP 列表（用于快速选择，不测速时使用）
function pickIpListByColo(colo) {
  colo = (colo || "").toUpperCase();
  // A 类：亚洲常见优选（HKG / TPE / SIN / ICN）
  if (colo === "HKG" || colo === "TPE" || colo === "SIN" || colo === "ICN") {
    return [
      "188.114.97.3",
      "188.114.96.3",
      "104.16.1.3",
      "172.64.1.3",
      "104.17.1.3"
    ];
  }
  // 日本 / 关西等
  if (colo === "NRT" || colo === "KIX") {
    return [
      "104.16.1.3",
      "104.17.1.3",
      "188.114.96.3",
      "172.64.1.3",
      "188.114.97.3"
    ];
  }
  // 北美常见入口
  if (colo === "LAX" || colo === "SJC" || colo === "SEA" || colo === "ORD" || colo === "DFW" || colo === "IAD" || colo === "JFK") {
    return [
      "188.114.96.3",
      "188.114.97.3",
      "141.101.64.3",
      "104.16.1.3",
      "172.64.1.3"
    ];
  }
  // 其他未知地区，返回一个相对通用的组合
  return [
    "188.114.96.3",
    "188.114.97.3",
    "104.16.1.3",
    "172.64.1.3",
    "104.17.1.3"
  ];
}

// HTTP RTT 测速函数（模拟真实浏览网站，使用HEAD请求测试延迟）
async function testIPRTT(ip, timeout = 2000) {
  const startTime = Date.now();
  try {
    // 使用HEAD请求到IP的443端口，模拟HTTPS连接
    // 设置Host头为任意域名，因为Cloudflare会根据SNI路由
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    // 使用随机生成的 User-Agent，更真实地模拟浏览器
    const randomUA = generateRandomUserAgent();
    
    // 尝试连接到IP，使用一个简单的路径
    const testUrl = `https://${ip}/cdn-cgi/trace`;
    const response = await fetch(testUrl, {
      method: 'HEAD',
      headers: {
        'Host': 'www.cloudflare.com',
        'User-Agent': randomUA
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    const rtt = Date.now() - startTime;
    
    // 返回RTT和是否成功（状态码200-499都算成功，因为至少能连接）
    return { ip, rtt, success: response.status >= 200 && response.status < 500 };
  } catch (error) {
    const rtt = Date.now() - startTime;
    // 超时或失败，返回一个很大的RTT值
    return { ip, rtt: timeout + 2000, success: false };
  }
}

// 并发测试多个IP的HTTP RTT，返回排序后的结果
async function testIPsRTT(ips, maxConcurrent = 10) {
  const results = [];
  const chunks = [];
  
  // 将IP列表分块，每块最多maxConcurrent个
  for (let i = 0; i < ips.length; i += maxConcurrent) {
    chunks.push(ips.slice(i, i + maxConcurrent));
  }
  
  // 逐块并发测试
  for (const chunk of chunks) {
    const promises = chunk.map(ip => testIPRTT(ip));
    const chunkResults = await Promise.all(promises);
    results.push(...chunkResults);
  }
  
  // 按RTT排序，只返回成功的IP
  return results
    .filter(r => r.success)
    .sort((a, b) => a.rtt - b.rtt);
}

// 单 IP 版本：保留给可能需要的地方使用（取列表第一个）
function pickIpByColo(colo) {
  const list = pickIpListByColo(colo);
  return list && list.length ? list[0] : "188.114.96.3";
}


function renderSpeedtestPage() {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <title>Cloudflare Worker 速度测试工具</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <script src="https://cdn.tailwindcss.com"><\/script>
</head>
<body class="min-h-screen bg-slate-100 p-4">
  <div class="max-w-4xl mx-auto space-y-6">
    <div class="bg-white rounded-2xl shadow p-6">
      <h1 class="text-2xl font-bold mb-2">⚡ Cloudflare Worker 线路测速</h1>
      <p class="text-sm text-slate-600 mb-4">
        本页面用于测试当前 Worker 域名的实际访问延迟与下载速度，并提供一个简单的“自定义 URL 批量测速”工具，方便你对比不同 CF 优选 IP 或不同域名的表现。
      </p>
      <a href="/" class="text-blue-600 text-sm underline">← 返回管理面板</a>
    </div>

    <!-- IP优选测速 -->
    <div class="bg-white rounded-2xl shadow p-6">
      <h2 class="text-xl font-semibold mb-4">一、IP 优选测速（根据当前访问IP自动优选）</h2>
      <p class="text-sm text-slate-600 mb-2">
        使用当前访问测速页面的IP进行HTTP RTT测速，自动从40+个Cloudflare IP中选出最快的5个。这模拟了真实浏览网站的感受。
      </p>
      <button id="btnIPSelect" class="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold mb-3">
        开始 IP 优选测速
      </button>
      <pre id="ipSelectResult" class="bg-slate-950 text-slate-100 text-xs rounded-lg p-3 overflow-x-auto h-64"></pre>
    </div>

    <!-- 单节点测速 -->
    <div class="bg-white rounded-2xl shadow p-6">
      <h2 class="text-xl font-semibold mb-4">二、当前域名 HTTP RTT 测速</h2>
      <p class="text-sm text-slate-600 mb-2">
        使用 HTTP HEAD 请求测试当前域名的延迟（RTT），模拟真实浏览网站的感受。将执行多次测试并统计结果。
      </p>
      <div class="mb-3 flex items-center gap-2">
        <label class="text-sm font-medium">测试次数：</label>
        <input type="number" id="testCount" value="5" min="1" max="20" step="1" class="px-3 py-1 border rounded-lg w-20">
        <button id="btnRTT" class="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold">
          开始 HTTP RTT 测速
        </button>
      </div>
      <pre id="rttResult" class="bg-slate-950 text-slate-100 text-xs rounded-lg p-3 overflow-x-auto h-48"></pre>
    </div>

    <!-- 批量测速 -->
    <div class="bg-white rounded-2xl shadow p-6">
      <h2 class="text-xl font-semibold mb-4">三、自定义 URL 批量测速（配合优选 IP 使用）</h2>
      <p class="text-sm text-slate-600 mb-2">
        在下方输入要测试的 URL（每行一个）。可用于：
      </p>
      <ul class="list-disc ml-6 text-sm text-slate-600 mb-3">
        <li>给多个不同子域名分别绑定不同 CF IP，然后依次测速。</li>
        <li>或在本机 hosts 中，将同一域名指向不同 CF IP，填入对应 URL 进行对比。</li>
      </ul>
      <textarea id="urlList" class="w-full h-32 border rounded-lg p-2 text-sm mb-3" placeholder="例如：&#10;https://ech1.xxxxxx.com/speed.bin?size=1&#10;https://ech2.xxxxxx.com/speed.bin?size=2"></textarea>
      <p class="text-xs text-slate-500 mb-3">
        提示：可以在 URL 后添加 ?size=数字 来指定测试文件大小（MB），例如：/speed.bin?size=2 表示下载2MB文件。
      </p>
      <button id="btnBatch" class="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold mb-3">
        开始批量测速
      </button>
      <pre id="batchResult" class="bg-slate-950 text-slate-100 text-xs rounded-lg p-3 overflow-x-auto h-52"></pre>
    </div>
  </div>

  <script>
    // HTTP RTT 测速函数（模拟真实浏览网站）
    async function testHTTPRTT(url, timeout) {
      var startTime = performance.now();
      try {
        var controller = new AbortController();
        var timeoutId = setTimeout(function() { controller.abort(); }, timeout || 3000);
        
        var response = await fetch(url, {
          method: 'HEAD',
          cache: 'no-store',
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        var rtt = Math.round(performance.now() - startTime);
        return { success: true, rtt: rtt, status: response.status };
      } catch(e) {
        var rtt = Math.round(performance.now() - startTime);
        return { success: false, rtt: rtt, error: e.message };
      }
    }

    async function runRTTTest() {
      var out = [];
      var logEl = document.getElementById("rttResult");
      logEl.textContent = "开始 HTTP RTT 测速...\\n";

      var testCount = parseInt(document.getElementById("testCount").value) || 5;
      if (testCount < 1) testCount = 1;
      if (testCount > 20) testCount = 20;

      var baseUrl = window.location.origin;
      var times = [];
      var successCount = 0;

      out.push("测试目标：" + baseUrl);
      out.push("测试方法：HTTP HEAD 请求（模拟真实浏览网站）");
      out.push("测试次数：" + testCount);
      out.push("");
      logEl.textContent = out.join("\\n");

      for (var i = 0; i < testCount; i++) {
        out.push("第 " + (i+1) + "/" + testCount + " 次测试...");
        logEl.textContent = out.join("\\n");

        var result = await testHTTPRTT(baseUrl + "/api/geo?ts=" + Date.now(), 5000);
        
        if (result.success) {
          times.push(result.rtt);
          successCount++;
          out.push("  ✓ 成功 - RTT: " + result.rtt + " ms (HTTP " + result.status + ")");
        } else {
          out.push("  ✗ 失败 - " + (result.error || "超时或网络错误"));
        }
        logEl.textContent = out.join("\\n");
      }

      out.push("");
      if (times.length > 0) {
        var sum = times.reduce(function(a,b){return a+b;},0);
        var avg = Math.round(sum / times.length);
        var min = Math.min.apply(null, times);
        var max = Math.max.apply(null, times);
        
        // 计算中位数
        var sorted = times.slice().sort(function(a,b){return a-b;});
        var median = sorted.length % 2 === 0
          ? Math.round((sorted[sorted.length/2-1] + sorted[sorted.length/2]) / 2)
          : sorted[Math.floor(sorted.length/2)];

        out.push("=== HTTP RTT 测速结果 ===");
        out.push("成功次数：" + successCount + " / " + testCount);
        out.push("平均 RTT：" + avg + " ms");
        out.push("最小 RTT：" + min + " ms");
        out.push("最大 RTT：" + max + " ms");
        out.push("中位数 RTT：" + median + " ms");
        out.push("");
        out.push("说明：RTT (Round-Trip Time) 表示往返延迟，");
        out.push("这是模拟真实浏览网站时的延迟感受。");
      } else {
        out.push("所有测试均失败，请检查网络连接。");
      }

      logEl.textContent = out.join("\\n");
    }

    async function runBatchTest() {
      var txt = document.getElementById("urlList").value || "";
      var lines = txt.split(/\\r?\\n/).map(function(l){return l.trim();}).filter(function(l){return l;});
      var out = [];
      var logEl = document.getElementById("batchResult");
      if (!lines.length) {
        logEl.textContent = "请先在上方文本框中填入要测试的 URL，每行一个。";
        return;
      }
      out.push("共 " + lines.length + " 个 URL，将依次进行测试（只做一次下载测速）...");
      logEl.textContent = out.join("\\n");

      for (var i = 0; i < lines.length; i++) {
        var url = lines[i];
        out.push("");
        out.push("[" + (i+1) + "/" + lines.length + "] 测试：" + url);
        logEl.textContent = out.join("\\n");
        try {
          var t0 = performance.now();
          var resp = await fetch(url, { cache: "no-store" });
          var buf = await resp.arrayBuffer();
          var t1 = performance.now();
          var ms = t1 - t0;
          var sizeBytes = buf.byteLength;
          var speedMbps = (sizeBytes * 8 / 1024 / 1024) / (ms / 1000);
          out.push("  用时：" + Math.round(ms) + " ms");
          out.push("  大小：" + sizeBytes + " 字节");
          out.push("  估算速度：" + speedMbps.toFixed(2) + " Mbps");
        } catch(e) {
          out.push("  测试失败：" + e);
        }
        logEl.textContent = out.join("\\n");
      }

      out.push("");
      out.push("批量测速完成。可对比各 URL 的时延与 Mbps 评估哪条 CF 线路更优。");
      logEl.textContent = out.join("\\n");
    }

    document.getElementById("btnIPSelect").onclick = function(){ runIPSelectTest(); };
    document.getElementById("btnRTT").onclick = function(){ runRTTTest(); };
    document.getElementById("btnBatch").onclick = function(){ runBatchTest(); };
  <\/script>
</body>
</html>`;
}

// ===============================================================
// SingBox JSON
// ===============================================================
function generateSingbox(cfg) {
  const outbounds = [];

  outbounds.push({
    type: "vless",
    tag: "主节点",
    server: cfg.workerHost,
    server_port: 443,
    uuid: cfg.uuid,
    tls: {
      enabled: true,
      server_name: cfg.workerHost
    },
    transport: {
      type: "ws",
      path: cfg.wsPath,
      headers: {
        Host: cfg.workerHost
      }
    }
  });

  if (cfg.nodes && Array.isArray(cfg.nodes)) {
    cfg.nodes.forEach(n => {
      if (!n.host) return;
      outbounds.push({
        type: "vless",
        tag: n.name || n.host,
        server: n.host,
        server_port: 443,
        uuid: cfg.uuid,
        tls: {
          enabled: true,
          server_name: n.host
        },
        transport: {
          type: "ws",
          path: cfg.wsPath,
          headers: {
            Host: n.host
          }
        }
      });
    });
  }

  return { outbounds };
}

// ===============================================================
// Clash Meta YAML
// ===============================================================
function generateClash(cfg) {
  const proxies = [];

  function addNode(name, host) {
    proxies.push({
      name,
      type: "vless",
      server: host,
      port: 443,
      uuid: cfg.uuid,
      tls: true,
      servername: cfg.sni || host,
      network: "ws",
      ws_opts: {
        path: cfg.wsPath,
        headers: {
          Host: cfg.fakeHost || host
        }
      }
    });
  }

  addNode("主节点", cfg.workerHost);
  if (cfg.nodes && Array.isArray(cfg.nodes)) {
    cfg.nodes.forEach(n => {
      if (!n.host) return;
      addNode(n.name || n.host, n.host);
    });
  }

  let yaml = "proxies:\n";
  proxies.forEach(p => {
    yaml += `  - name: "${p.name}"
    type: vless
    server: ${p.server}
    port: 443
    uuid: ${p.uuid}
    tls: true
    servername: ${p.servername}
    network: ws
    ws-opts:
      path: ${p.ws_opts.path}
      headers:
        Host: ${p.ws_opts.headers.Host}
`;
  });

  return yaml;
}

// ===============================================================
// QR Code (Google Chart API)
// ===============================================================
async function generateQRCode(cfg) {
  const vlessUrl = buildVlessUrl(cfg, null, "主节点");
  const api =
    "https://chart.googleapis.com/chart?cht=qr&chs=400x400&chl=" +
    encodeURIComponent(vlessUrl);

  const resp = await fetch(api);
  return resp.arrayBuffer();
}

// ===============================================================
// WebSocket Proxy (Mode A: Stable)
// ===============================================================
async function handleWS(request, cfg) {
  const backendUrl = `http://${cfg.backendHost}:${cfg.backendPort}${cfg.wsPath}`;
  const headers = new Headers(request.headers);
  headers.set("Host", cfg.backendHost);

  const backendReq = new Request(backendUrl, {
    method: request.method,
    headers,
    body: request.body
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
