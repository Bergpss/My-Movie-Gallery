// Shared by the editor, gallery and API so saved dates have the same meaning.
export function validateWatchPeriod(start, end) {
    for (const value of [start, end]) {
        if (value == null || value === '') continue;
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
            || !Number.isFinite(Date.parse(value))
            || new Date(value).toISOString().slice(0, 10) !== value) {
            return '请输入有效的日期（YYYY-MM-DD）';
        }
    }
    if (end && !start) return '请先填写开始日期';
    if (start && end && end < start) return '结束日期不能早于开始日期';
    return null;
}

export function applyWatchPeriod(movie, update) {
    if (update.watchStartDate !== undefined || update.watchEndDate !== undefined) {
        const start = update.watchStartDate || null;
        const end = update.watchEndDate || null;
        const previous = movie.watchStartDate || movie.watchDate || movie.watchDates?.[0];
        const otherDates = (movie.watchDates || []).filter(date => date !== previous && date !== start);
        movie.watchStartDate = start;
        movie.watchEndDate = end;
        movie.watchDate = start;
        movie.watchDates = start ? [start, ...otherDates] : otherDates;
    } else if (update.watchDate) {
        movie.watchDates = Array.from(new Set([...(movie.watchDates || []), update.watchDate])).sort();
        movie.watchDate = movie.watchDates[0];
    }
    if (update.status === 'wishlist') {
        delete movie.watchStartDate;
        delete movie.watchEndDate;
        delete movie.watchDate;
        delete movie.watchDates;
    }
}

export function formatWatchPeriod(movie) {
    const start = movie.watchStartDate || movie.watchDate || movie.watchDates?.[0];
    if (!start || validateWatchPeriod(start, movie.watchEndDate)) return '';
    if (movie.watchEndDate && movie.watchEndDate !== start) return `${start} 至 ${movie.watchEndDate}`;
    if (!movie.watchEndDate && movie.status === 'watching') return `${start} 至今`;
    return start;
}
