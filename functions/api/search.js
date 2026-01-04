export async function onRequestGet(context) {
    const { request, env } = context;

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    try {
        const url = new URL(request.url);
        const query = url.searchParams.get('q');
        const type = url.searchParams.get('type') || 'multi'; // multi, movie, tv

        if (!query) {
            return new Response(JSON.stringify({ error: '请输入搜索关键词' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }

        const tmdbApiKey = env.TMDB_API_KEY;
        if (!tmdbApiKey) {
            return new Response(JSON.stringify({ error: 'TMDB API 未配置' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }

        // 调用 TMDB 搜索 API
        const searchUrl = `https://api.themoviedb.org/3/search/${type}?api_key=${tmdbApiKey}&language=zh-CN&query=${encodeURIComponent(query)}&page=1`;

        const tmdbResponse = await fetch(searchUrl);
        const tmdbData = await tmdbResponse.json();

        if (!tmdbResponse.ok) {
            return new Response(JSON.stringify({ error: 'TMDB 搜索失败' }), {
                status: 500,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
        }

        // 格式化搜索结果
        const results = tmdbData.results.slice(0, 10).map(item => ({
            id: item.id,
            title: item.title || item.name,
            originalTitle: item.original_title || item.original_name,
            overview: item.overview,
            posterPath: item.poster_path,
            releaseDate: item.release_date || item.first_air_date,
            mediaType: item.media_type || (type === 'tv' ? 'tv' : 'movie'),
            voteAverage: item.vote_average,
        }));

        return new Response(JSON.stringify({ results }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
    } catch (error) {
        return new Response(JSON.stringify({ error: '搜索请求失败' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
    }
}

export async function onRequestOptions() {
    return new Response(null, {
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
    });
}
