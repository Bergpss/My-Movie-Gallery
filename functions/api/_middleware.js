// 所有 /api/* 请求先经过这里：跨域只放行本站来源，并对登录和 TMDB 代理接口按 IP 限流。
// 限流计数存在当前 Worker 实例的内存里，只能挡住单点的连续请求；更严格的防护可再配 Cloudflare 的限流规则。

const SITE_ORIGIN = 'https://movie.guoyibo.top';
const RATE_LIMITS = {
    '/api/auth': { max: 10, windowMs: 10 * 60 * 1000 },
    '/api/search': { max: 60, windowMs: 60 * 1000 },
    '/api/recommendations': { max: 20, windowMs: 60 * 1000 },
};
const hits = new Map();

export function resetRateLimits() {
    hits.clear();
}

function allowedOrigins(url, env) {
    const extra = String(env.ALLOWED_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean);
    // url.origin 覆盖 Cloudflare 预览域名和本地 wrangler 开发
    return new Set([SITE_ORIGIN, url.origin, ...extra]);
}

function retryAfterSeconds(key, { max, windowMs }, now) {
    const recent = (hits.get(key) || []).filter(time => now - time < windowMs);
    if (recent.length >= max) {
        hits.set(key, recent);
        return Math.ceil((recent[0] + windowMs - now) / 1000);
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) {
        for (const [otherKey, times] of hits) if (now - times.at(-1) >= windowMs) hits.delete(otherKey);
    }
    return 0;
}

function json(body, status, headers = {}) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export async function onRequest(context) {
    const { request, env, next } = context;
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if (origin && !allowedOrigins(url, env).has(origin)) {
        return json({ error: '不允许的请求来源' }, 403);
    }

    const cors = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400' },
        });
    }

    const limit = RATE_LIMITS[url.pathname];
    if (limit) {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const retryAfter = retryAfterSeconds(`${url.pathname}:${ip}`, limit, Date.now());
        if (retryAfter) return json({ error: '请求太频繁，请稍后再试' }, 429, { ...cors, 'Retry-After': String(retryAfter) });
    }

    // 各接口自己写的 Access-Control-Allow-Origin: * 在这里统一收紧
    const response = await next();
    const secured = new Response(response.body, response);
    secured.headers.delete('Access-Control-Allow-Origin');
    for (const [name, value] of Object.entries(cors)) secured.headers.set(name, value);
    return secured;
}
