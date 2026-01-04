// 删除电影 API - 通过 GitHub API 修改 library.json

// JWT 验证函数
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

export async function onRequestOptions() {
    return new Response(null, { headers: corsHeaders });
}

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
        const deleteData = await request.json();
        const { id } = deleteData;

        if (!id) {
            return new Response(JSON.stringify({ error: '缺少电影 ID' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }

        // 从 GitHub 获取当前 library.json
        const githubToken = env.GITHUB_TOKEN;
        const githubRepo = env.GITHUB_REPO;

        if (!githubToken || !githubRepo) {
            return new Response(JSON.stringify({ error: '服务器配置错误' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }

        const apiUrl = `https://api.github.com/repos/${githubRepo}/contents/data/library.json`;

        const getResponse = await fetch(apiUrl, {
            headers: {
                'Authorization': `token ${githubToken}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'My-Movie-Gallery-Admin',
            },
        });

        if (!getResponse.ok) {
            return new Response(JSON.stringify({ error: '无法获取文件' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }

        const fileData = await getResponse.json();
        // 正确解码 UTF-8 内容
        const decodedContent = decodeURIComponent(escape(atob(fileData.content.replace(/\n/g, ''))));
        const currentContent = JSON.parse(decodedContent);
        const sha = fileData.sha;

        // 在所有列表中查找并删除电影
        const lists = ['watching', 'watched', 'wishlist', 'dropped'];
        let found = false;
        let deletedTitle = '';

        for (const list of lists) {
            if (!currentContent[list]) continue;
            const index = currentContent[list].findIndex(m => String(m.id) === String(id));
            if (index !== -1) {
                found = true;
                deletedTitle = currentContent[list][index].title || '未知电影';
                currentContent[list].splice(index, 1);
                break;
            }
        }

        if (!found) {
            return new Response(JSON.stringify({ error: '未找到该电影' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }

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
                message: `🗑️ 删除电影: ${deletedTitle}`,
                content: btoa(unescape(encodeURIComponent(JSON.stringify(currentContent, null, 2)))),
                sha,
            }),
        });

        if (!updateResponse.ok) {
            const errorData = await updateResponse.json();
            return new Response(JSON.stringify({ error: '删除失败', details: errorData.message }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }

        return new Response(JSON.stringify({ success: true, message: '删除成功' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: '服务器错误', message: error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
    }
}
