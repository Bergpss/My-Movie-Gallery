// 观影年鉴的纯数据计算，输入是 gallery-data.js 的 normalizeMovie 结果
const TMDB_SIZE = /\/t\/p\/w\d+\//;

export function posterAt(url, size) {
    return typeof url === 'string' && url.includes('image.tmdb.org') ? url.replace(TMDB_SIZE, `/t/p/${size}/`) : url;
}

export function watchedByYear(movies) {
    const years = new Map();
    movies
        .filter(movie => movie.category === 'watched' && movie.watchSortDate)
        .sort((a, b) => b.watchSortDate.localeCompare(a.watchSortDate))
        .forEach(movie => {
            const year = movie.watchSortDate.slice(0, 4);
            years.set(year, [...(years.get(year) || []), movie]);
        });
    return new Map([...years].sort(([a], [b]) => a.localeCompare(b)));
}

export function yearSummary(list) {
    const rated = list.filter(movie => movie.personalRating != null);
    const genres = new Map();
    list.forEach(movie => {
        const genre = movie.tmdb?.genres?.[0]?.name;
        if (genre) genres.set(genre, (genres.get(genre) || 0) + 1);
    });
    const favorite = [...rated].sort((a, b) => b.personalRating - a.personalRating || b.watchSortDate.localeCompare(a.watchSortDate))[0] || null;
    return {
        count: list.length,
        hours: Math.round(list.reduce((sum, movie) => sum + (movie.tmdb?.runtime || 0), 0) / 60),
        averageRating: rated.length ? rated.reduce((sum, movie) => sum + movie.personalRating, 0) / rated.length : null,
        cinemaCount: list.filter(movie => movie.inCinema).length,
        topGenre: [...genres].sort((a, b) => b[1] - a[1])[0]?.[0] || null,
        favorite,
        topRated: [...rated].sort((a, b) => b.personalRating - a.personalRating || b.watchSortDate.localeCompare(a.watchSortDate)).slice(0, 6),
        genres: [...genres].sort((a, b) => b[1] - a[1]),
    };
}

export function calendarDays(list) {
    const days = new Map();
    list.forEach(movie => {
        const key = movie.watchSortDate.slice(5);
        days.set(key, [...(days.get(key) || []), movie]);
    });
    return days;
}
