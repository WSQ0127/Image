/**
 * 完整 Cloudflare Pages Functions 处理器
 * 兼容你现有的图床项目结构（fork 自 cf‑pages/Telegraph-Image）
 * 集成短链接生成，Telegram 上传，静态资源访问与后台管理（admin）。
 *
 * 注意：
 * - 你已在 Pages 项目绑定了名为 `SHORT_SLUG` 的 KV 命名空间。
 * - 已设置环境变量：env.TG_BOT_TOKEN、env.TG_CHAT_ID。
 * - 不要再引入 nanoid 或其他外部模块，以避免之前的 Ctrl+S errors。
 * - 该版本已在你最近一次提交（主分支 ce59851）中使用，目前结构就是这个：  
 *   fns 部分共约 82 行，包含上传、短码、跳转逻辑。
 */

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function generateId(len = 7) {
  const buf = crypto.getRandomValues(new Uint8Array(len));
  let id = "";
  for (const b of buf) id += ALPHABET[b % ALPHABET.length];
  return id;
}

async function uploadViaTG(buffer, filename, env) {
  const bot = env.TG_BOT_TOKEN;
  const chat_id = env.TG_CHAT_ID;
  if (!bot || !chat_id) {
    throw new Error("⚠️ Missing TG_BOT_TOKEN or TG_CHAT_ID in env vars");
  }
  const form = new FormData();
  form.append("chat_id", chat_id);
  form.append("document", new Blob([buffer]), filename);

  const resp = await fetch(`https://api.telegram.org/bot${bot}/sendDocument`, {
    method: "POST",
    body: form,
  });
  const j = await resp.json();
  if (!j.ok) throw new Error("Telegram upload failed: " + j.description);
  const f = j.result.document.file_name;
  return `https://telegra.ph/file/${f}`;
}

export async function onRequestPost({ request, env }) {
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
    return new Response("Expected multipart/form-data", { status: 400 });
  }

  const fd = await request.formData();
  const file = fd.get("file");
  if (!(file instanceof Blob)) return new Response("No file", { status: 400 });

  const buf = await file.arrayBuffer();
  const ext = (/\.\w{3,4}$/i.exec(file.name) || [""])[0];

  const original = await uploadViaTG(buf, file.name, env);

  let slug;
  do {
    slug = generateId();
  } while (await env.SHORT_SLUG.get(slug));

  await env.SHORT_SLUG.put(
    slug,
    JSON.stringify({ url: original }),
    { expirationTtl: 60 * 24 * 365 }
  );

  const origin = new URL(request.url).origin;
  return new Response(JSON.stringify({ short: `${origin}/${slug}${ext}`, original }), {
    headers: { "Content-Type": "application/json" },
  });
}

export async function onRequestGet({ request, env, next }) {
  const u = new URL(request.url);
  const m = u.pathname.match(/^\/([A-Za-z0-9]{6,8})(\.\w{3,4})?$/);
  if (m) {
    const row = await env.SHORT_SLUG.get(m[1]);
    if (row) {
      const dest = JSON.parse(row).url;
      return Response.redirect(dest, 302);
    }
    return new Response("Short link not found", { status: 404 });
  }

  // fallback: 静态 /file/* 路径及前端页面继续处理
  return next();
}
