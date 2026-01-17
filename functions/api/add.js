// 添加电影 API - 通过 GitHub API 修改 library.json

// 从 auth.js 导入 JWT 验证函数
async function verifyJWT(token, secret) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        const [headerB64, payloadB64, signatureB64] = parts;
        const data = `${headerB64}.${payloadB64}`;

        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
        );

        const signatureArray = Uint8Array.from(atob(signatureB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        const valid = await crypto.subtle.verify('HMAC', key, signatureArray, encoder.encode(data));

        if (!valid) return null;

        const payload = JSON.parse(atob(payloadB64));
        if (payload.exp && Date.now() >= payload.exp) return null;

        return payload;
    } catch {
        return null;
    }
}

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        // 验证 Token
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return new Response(JSON.stringify({ error: '未授权' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }

        const token = authHeader.slice(7);
        const jwtSecret = env.JWT_SECRET || 'default-secret-change-me';
        const payload = await verifyJWT(token, jwtSecret);

        if (!payload || payload.role !== 'admin') {
            return new Response(JSON.stringify({ error: 'Token 无效或已过期' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }

        // 获取请求数据
        const movieData = await request.json();
        const { id, title, mediaType, status, rating, note, inCinema, watchDate, wishlistReason } = movieData;

        if (!id || !title) {
            return new Response(JSON.stringify({ error: '缺少必要参数' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }

        // 从 GitHub 获取当前 library.json
        const githubToken = env.GITHUB_TOKEN;
        const githubOwner = env.GITHUB_OWNER;
        const githubRepo = env.GITHUB_REPO;

        if (!githubToken || !githubOwner || !githubRepo) {
            return new Response(JSON.stringify({ error: 'GitHub 配置缺失' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }

        const filePath = 'data/library.json';
        const apiUrl = `https://api.github.com/repos/${githubOwner}/${githubRepo}/contents/${filePath}`;

        // 获取文件内容
        const getResponse = await fetch(apiUrl, {
            headers: {
                'Authorization': `token ${githubToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'My-Movie-Gallery-Admin',
            },
        });

        if (!getResponse.ok) {
            const errorText = await getResponse.text();
            return new Response(JSON.stringify({ error: `获取文件失败: ${errorText}` }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }

        const fileData = await getResponse.json();
        // 正确解码 UTF-8 内容（GitHub API 返回的是 Base64 编码的 UTF-8）
        const decodedContent = decodeURIComponent(escape(atob(fileData.content.replace(/\n/g, ''))));
        const currentContent = JSON.parse(decodedContent);
        const sha = fileData.sha;

        // 构造新电影记录
        const newMovie = {
            id,
            title,
            mediaType: mediaType || 'movie',
        };

        // 根据状态设置不同字段
        const movieStatus = status || 'watched';

        if (movieStatus === 'watching') {
            newMovie.status = 'watching';
        } else if (movieStatus === 'wishlist') {
            newMovie.status = 'wishlist';
            if (wishlistReason) {
                newMovie.wishlistReason = wishlistReason;
            }
        } else {
            // watched
            if (watchDate) {
                newMovie.watchDates = [watchDate];
            } else {
                const today = new Date().toISOString().split('T')[0];
                newMovie.watchDates = [today];
            }
        }

        if (typeof rating === 'number' && rating >= 0 && rating <= 10) {
            newMovie.rating = rating;
        }

        if (note) {
            newMovie.note = note;
        }

        if (inCinema) {
            newMovie.inCinema = true;
        }

        // 检查是否已存在
        const targetList = movieStatus === 'watching' ? 'watching' : movieStatus === 'wishlist' ? 'wishlist' : 'watched';

        // 确保目标列表存在
        if (!currentContent[targetList]) {
            currentContent[targetList] = [];
        }

        // 检查是否已存在（在任何列表中）
        const existsInWatching = currentContent.watching?.some(m => m.id === id);
        const existsInWatched = currentContent.watched?.some(m => m.id === id);
        const existsInWishlist = currentContent.wishlist?.some(m => m.id === id);

        if (existsInWatching || existsInWatched || existsInWishlist) {
            return new Response(JSON.stringify({ error: '该电影已存在于观影记录中' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }

        // 添加到对应列表
        currentContent[targetList].unshift(newMovie);

        // 提交到 GitHub
        const updateResponse = await fetch(apiUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${githubToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'My-Movie-Gallery-Admin',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: `🎬 添加电影: ${title}`,
                content: btoa(unescape(encodeURIComponent(JSON.stringify(currentContent, null, 2)))),
                sha,
            }),
        });

        if (!updateResponse.ok) {
            const errorText = await updateResponse.text();
            return new Response(JSON.stringify({ error: `提交失败: ${errorText}` }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }

        return new Response(JSON.stringify({
            success: true,
            message: `已添加「${title}」到${targetList === 'watching' ? '正在看' : targetList === 'wishlist' ? '想看' : '已看完'}`
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: `请求处理失败: ${error.message}` }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
    }
}

export async function onRequestOptions() {
    return new Response(null, {
        headers: corsHeaders,
    });
}
