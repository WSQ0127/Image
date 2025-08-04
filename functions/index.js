import { customAlphabet } from 'https://jspm.dev/nanoid@4.0.0';
const nanoid = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 7);

export async function onRequestPost(context) {
  const form = await context.request.formData();
  const file = form.get('file');
  if (!(file instanceof Blob)) return new Response('Bad Request', { status: 400 });
  const buf = await file.arrayBuffer();
  const ext = /\.(jpe?g|png|gif|webp)$/i.exec(file.name)?.[0] ?? '';
  let slug;
  do {
    slug = nanoid();
  } while (await context.env.SHORT.get(slug));
  // 你原本的上传逻辑改为返回 original（完整 `/file/...` URL）
  const original = await uploadImageSomehow(buf, file.name);
  await context.env.SHORT.put(slug, JSON.stringify({ url: original }));
  return new Response(JSON.stringify({
    original,
    short: `${new URL(context.request.url).origin}/${slug}${ext}`
  }), { headers: { 'content-Type': 'application/json' } });
}

export async function onRequestGet(context) {
  const m = context.request.url.match(/\/([A-Za-z0-9]{6,8})(\.[A-Za-z0-9]{3,4})?$/);
  if (m) {
    const slug = m[1];
    const rec = await context.env.SHORT.get(slug);
    if (rec) {
      const { url } = JSON.parse(rec);
      return Response.redirect(url, 302);
    }
  }
  // fallback to Pages 静态 /file/... 路径
  return context.next();
}
