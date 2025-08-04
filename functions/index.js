/**
 * functions/index.js
 *
 * Cloudflare Pages Function：短链 + 管理旧 Telegrph‑Image 功能兼容
 *
 * 环境变量（请在 Pages 项目 Settings → 环境变量处配置）：
 *   - TG_Bot_Token        Telegram Bot Token (获取自 @BotFather)
 *   - TG_Chat_ID          目标 Channel 的 Chat_ID（Bot 必须为管理员）
 * 可选参考：管理 KV 命名空间 img_url（用于图床管理页面）
 *
 * 请务必在 Dashboard 的 Bindings → KV 命名空间绑定中添加一个名为 `SHORT_SLUG` 的 KV 命名绑定
 */

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// 随机 7 位字符短码生成函数（62 进制）
function generateId(len = 7) {
  const buf = crypto.getRandomValues(new Uint8Array(len));
  let id = "";
  for (const b of buf) id += ALPHABET[b % ALPHABET.length];
  return id;
}

// Telegram 上传函数（直接调用 bot API 上传照片到 Channel）
async function uploadViaTG(buffer, filename, env) {
  const bot = env.TG_Bot_Token;
  const chat_id = env.TG_Chat_ID;
  if (!bot || !chat_id) {
    throw new Error(
      "⚠️ Missing TG_Bot_Token or TG_Chat_ID in environment variables"
    );
  }
  const form = new FormData();
  form.append("chat_id", chat_id);
  form.append("document", new Blob([buffer]), filename);

  const res = await fetch(
    `https://api.telegram.org/bot${bot}/sendDocument`,
    {
      method: "POST",
      body: form,
    }
  );
  const j = await res.json();
  if (!j.ok) throw new Error("Telegram upload failed: " + j.description);
  // Telegram channel message后会产生文件名，如 abc123.webp
  const file_name = j.result.document.file_name;
  return `https://telegra.ph/file/${file_name}`;
}

/**
 * POST 上传接口：接收 multipart/form-data，上传图片 → 存短码 KV → 返回 short + original
 * 推荐用 AJAX 发送 formData，字段名为 "file"
 */
export async function onRequestPost({ request, env }) {
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
    return new Response("Expected multipart/form-data", { status: 400 });
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return new Response("Missing file upload", { status: 400 });
  }

  const buffer = await file.arrayBuffer();
  // 判断扩展名（jpg/png/webp 等）
  const ext = (/\.(jpe?g|png|gif|webp)$/i.exec(file.name) || [])[0] || "";

  // 1. 上传到 Telegram Channel，获取原始图床链接
  const original = await uploadViaTG(buffer, file.name, env);

  // 2. 生成不重复短码，并存入 KV（变量名 SHORT_SLUG）
  let slug;
  do {
    slug = generateId();
  } while (await env.SHORT_SLUG.get(slug));

  await env.SHORT_SLUG.put(
    slug,
    JSON.stringify({ url:
