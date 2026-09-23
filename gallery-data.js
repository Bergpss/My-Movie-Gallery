const POSTER_BASE = 'https://image.tmdb.org/t/p/w500';
export const PLACEHOLDER = 'movie_posters/placeholder.png';

function safeUrl(value) {
    try {
        const url = new URL(value);
        return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
    } catch {
        return '';
    }
}

function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        && Number.isFinite(Date.parse(value))
        && new Date(value).toISOString().slice(0, 10) === value;
}

export function normalizeMovie(movie, index = 0) {
    let category = String(movie.status || 'watched').toLowerCase();
    if (['in-progress', 'ongoing'].includes(category)) category = 'watching';
    if (category === 'planned') category = 'wishlist';
    if (!['watched', 'watching', 'wishlist', 'recap', 'dropped', 'discover'].includes(category)) category = 'watched';
    const mediaType = movie.mediaType || 'movie';
    const path = movie.tmdb?.poster_path || movie.tmdb?.backdrop_path;
    const dates = [movie.watchEndDate, movie.watchStartDate, movie.watchDate, ...(Array.isArray(movie.watchDates) ? movie.watchDates : [])].filter(validDate).sort();
    const rating = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10 ? value : null;
    return {
        ...movie,
        category,
        mediaType,
        key: `${mediaType}-${movie.id ?? index}`,
        title: movie.tmdb?.title || movie.title || movie.tmdb?.original_title || '未命名影片',
        poster: mediaType === 'web-video' ? safeUrl(movie.coverUrl) || PLACEHOLDER
            : typeof path === 'string' && /^\/[\w./-]+$/.test(path) ? `${POSTER_BASE}${path}` : PLACEHOLDER,
        externalUrl: mediaType === 'web-video' ? safeUrl(movie.url)
            : /^\d+$/.test(String(movie.id)) ? `https://www.themoviedb.org/${mediaType === 'tv' ? 'tv' : 'movie'}/${movie.id}` : '',
        personalRating: rating(movie.rating),
        tmdbRating: rating(movie.tmdb?.vote_average),
        watchSortDate: dates.at(-1) || '',
    };
}

export function selectMovies(movies, { status = 'watched', type = 'all', query = '', sort = 'watched' } = {}) {
    const search = query.trim().toLocaleLowerCase();
    return movies.filter(movie => movie.category === status && (type === 'all' || movie.mediaType === type)
        && (!search || [movie.title, movie.tmdb?.original_title, movie.note, movie.creator].some(value => String(value || '').toLocaleLowerCase().includes(search))))
        .sort((a, b) => {
            if (sort === 'rating') return (b.personalRating ?? -1) - (a.personalRating ?? -1) || b.watchSortDate.localeCompare(a.watchSortDate);
            if (sort === 'title') return a.title.localeCompare(b.title, 'zh-CN');
            return b.watchSortDate.localeCompare(a.watchSortDate) || a.title.localeCompare(b.title, 'zh-CN');
        });
}

export function getGalleryPage(movies, page, pageSize) {
    const size = Math.max(1, Math.floor(pageSize) || 1);
    const pages = Math.ceil(movies.length / size);
    const current = Math.min(Math.max(0, Math.floor(page) || 0), Math.max(0, pages - 1));
    return { items: movies.slice(current * size, (current + 1) * size), page: current, pages, total: movies.length };
}
