// Cloudflare Worker: รับคำขอที่โดเมนของกอง (เช่น rmic.example.go.th) แล้วส่งต่อไป Cloud Run
// ข้อดี: ใช้โดเมนของกองได้ทุก region, ได้ WAF/DDoS/Rate limiting ของ Cloudflare, cache ไฟล์ static ที่ edge
// ตั้งค่า ORIGIN (URL ของ Cloud Run) ใน wrangler.toml และ secret ORIGIN_SHARED_SECRET ด้วย `wrangler secret put`
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = new URL(env.ORIGIN);
    const target = new URL(url.pathname + url.search, origin);

    const headers = new Headers(request.headers);
    headers.set('X-Forwarded-Host', url.host);
    headers.set('X-Forwarded-Proto', 'https');
    if (env.ORIGIN_SHARED_SECRET) headers.set('X-Origin-Secret', env.ORIGIN_SHARED_SECRET);
    const init = { method: request.method, headers, body: request.body, redirect: 'manual' };

    // ไฟล์ static (css/js/รูป) cache ที่ edge 1 ชั่วโมง · API ไม่ cache
    const isStatic = request.method === 'GET' && /^\/(css|js|img|vendor)\//.test(url.pathname);
    const res = await fetch(target, isStatic ? { ...init, cf: { cacheTtl: 3600, cacheEverything: true } } : init);

    const out = new Response(res.body, res);
    out.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    out.headers.set('X-Frame-Options', 'DENY');
    return out;
  },
};
