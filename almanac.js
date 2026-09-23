import { normalizeMovie, selectMovies, PLACEHOLDER } from './gallery-data.js';
import { calendarDays, posterAt, watchedByYear, yearSummary } from './almanac-data.js';
import { formatWatchPeriod } from './watch-dates.js';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);
const labels = { watched: '看过', watching: '正在看', wishlist: '想看', discover: '发现', recap: '看过解说', dropped: '弃剧' };
const typeLabels = { movie: '电影', tv: '剧集', 'web-video': '网络视频' };
const state = { status: 'watched', type: 'all', query: '', year: null };
let movies = [];
let years = new Map();
let recommendations = [];
let dataLoading = true;
let dataError = false;
let recommendationState = 'idle';
let recommendationMessage = '';
let lastFocus = null;

const typeLabel = movie => typeLabels[movie.mediaType] || '电影';
const genreNames = movie => (movie.tmdb?.genres || []).map(genre => genre.name).filter(Boolean);
const findMovie = key => [...movies, ...recommendations].find(movie => movie.key === key);

function render() {
    const almanac = state.status === 'watched' && !state.query && years.size > 0;
    $('almanac').hidden = dataLoading || !almanac;
    $('list-view').hidden = dataLoading || almanac;
    document.querySelectorAll('[data-status]').forEach(button => {
        if (button.dataset.status === state.status) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
    });
    $('feedback').textContent = dataLoading ? '正在翻开你的观影年鉴…'
        : state.status === 'discover' ? recommendationMessage : '';
    const watchedCount = movies.filter(movie => movie.category === 'watched').length;
    $('collection-count').textContent = dataLoading ? '' : `共收藏 ${movies.length} 部 · 看过 ${watchedCount} 部`;
    if (dataLoading) return;
    if (almanac) renderAlmanac();
    else renderList();
}

function renderNow() {
    const watching = selectMovies(movies, { status: 'watching' });
    $('now-section').hidden = watching.length === 0;
    $('now-count').textContent = `${watching.length} 部`;
    $('now').dataset.count = String(Math.min(watching.length, 3));
    $('now').innerHTML = watching.map(movie => `<button data-key="${esc(movie.key)}" aria-label="查看《${esc(movie.title)}》">
        <img loading="lazy" alt="" src="${esc(movie.tmdb?.backdrop_path ? `https://image.tmdb.org/t/p/w780${movie.tmdb.backdrop_path}` : movie.poster)}">
        <p>${esc(movie.title)}<span>${typeLabel(movie)}${genreNames(movie)[0] ? ' · ' + esc(genreNames(movie)[0]) : ''}</span></p>
    </button>`).join('');
}

function renderAlmanac() {
    renderNow();
    if (!years.has(state.year)) state.year = [...years.keys()].at(-1);
    const year = state.year;
    const list = years.get(year);
    const summary = yearSummary(list);
    const max = Math.max(...[...years.values()].map(items => items.length));

    $('year').textContent = year;
    $('year-bars').innerHTML = [...years].map(([y, items]) => `<button data-year="${y}" aria-pressed="${y === year}" aria-label="${y} 年，${items.length} 部">
        <span class="n">${items.length}</span><span class="bar" style="height:${(items.length / max) * 100}%"></span><span class="y">’${y.slice(2)}</span></button>`).join('');

    $('summary').innerHTML = `这一年，看了<em>${summary.count}</em>部片，在银幕前度过<em>${summary.hours}</em>小时。`
        + (summary.averageRating != null ? `平均给出<em>${summary.averageRating.toFixed(1)}</em>分，` : '')
        + (summary.cinemaCount ? `其中<em>${summary.cinemaCount}</em>次走进影院。` : '全部在家里看完。')
        + (summary.topGenre ? `看得最多的是<b>${esc(summary.topGenre)}</b>片` : '')
        + (summary.favorite ? `，最难忘的也许是<b>《${esc(summary.favorite.title)}》</b>。` : '。');

    renderCalendar(year, list);
    showDay(list[0]?.watchSortDate, list);

    const total = summary.genres.reduce((sum, [, count]) => sum + count, 0);
    $('genres').innerHTML = summary.genres.slice(0, 7).map(([genre, count]) =>
        `<span style="flex:${count}" title="${esc(genre)} ${count} 部">${esc(genre)} ${Math.round(count / total * 100)}%</span>`).join('');
    $('genres').closest('section').hidden = summary.genres.length === 0;

    $('best').innerHTML = summary.topRated.map((movie, index) => `<button data-key="${esc(movie.key)}" aria-label="查看《${esc(movie.title)}》">
        <img loading="lazy" alt="" src="${esc(posterAt(movie.poster, 'w342'))}">
        <span class="cap"><span class="rk">${index + 1}</span><span class="tt">${esc(movie.title)}</span><span class="sc">${movie.personalRating} / 10</span></span>
    </button>`).join('');
    $('best').closest('section').hidden = summary.topRated.length === 0;
}

function renderCalendar(year, list) {
    const days = calendarDays(list);
    let html = '<span></span>' + Array.from({ length: 31 }, (_, i) => `<span class="dnum">${i === 0 || (i + 1) % 5 === 0 ? i + 1 : ''}</span>`).join('');
    for (let month = 1; month <= 12; month++) {
        const mm = String(month).padStart(2, '0');
        const monthDays = new Date(+year, month, 0).getDate();
        html += `<span class="m">${mm}月</span>`;
        for (let day = 1; day <= 31; day++) {
            const key = `${mm}-${String(day).padStart(2, '0')}`;
            const films = days.get(key);
            if (day > monthDays) html += '<span class="c x"></span>';
            else if (!films) html += '<span class="c"></span>';
            // 同一天看了多部：海报在格子里并排切开，最多显示 3 张
            else html += `<span class="c"${films.length > 1 ? ` data-count="${films.length}"` : ''}><button data-day="${year}-${key}" aria-pressed="false" title="${esc(films.map(film => film.title).join(' / '))}" aria-label="${month}月${day}日：${esc(films.map(film => film.title).join('、'))}">
                ${films.slice(0, 3).map(film => `<img loading="lazy" alt="" src="${esc(posterAt(film.poster, 'w92'))}">`).join('')}</button></span>`;
        }
    }
    $('cal').innerHTML = html;
}

function focusFilm(movie) {
    const meta = [movie.tmdb?.original_title !== movie.title && movie.tmdb?.original_title, movie.tmdb?.release_date?.slice(0, 4),
        movie.tmdb?.directors?.join('、'), movie.tmdb?.runtime && `${movie.tmdb.runtime} min`,
        movie.personalRating != null && `我的评分 ${movie.personalRating}`].filter(Boolean).join(' · ');
    return `<article class="focus-film"><img alt="" src="${esc(posterAt(movie.poster, 'w342'))}">
        <div>${movie.inCinema ? '<p class="label">影院</p>' : ''}<h3>${esc(movie.title)}</h3><p class="meta">${esc(meta)}</p>
        ${movie.note ? `<blockquote>${esc(movie.note)}</blockquote>` : ''}
        <button class="focus-more" data-key="${esc(movie.key)}">查看完整记录 →</button></div></article>`;
}

// 按天展示：列出这一天看的每一部
function showDay(date, list) {
    const films = list.filter(movie => movie.watchSortDate === date);
    if (!films.length) { $('focus').replaceChildren(); return; }
    $('focus').dataset.count = String(films.length);
    $('focus').innerHTML = `<p class="label focus-date">${esc(date.replaceAll('-', '.'))}${films.length > 1 ? ` · ${films.length} 部` : ''}</p>`
        + films.map(focusFilm).join('');
    document.querySelectorAll('#cal button[data-day]').forEach(button =>
        button.setAttribute('aria-pressed', String(button.dataset.day === date)));
}

function renderList() {
    const source = state.status === 'discover' ? recommendations : movies;
    const selected = selectMovies(source, state);
    const discovering = state.status === 'discover';
    const waiting = discovering && recommendationState === 'loading';
    $('list-eyebrow').textContent = state.query ? `搜索「${state.query}」` : 'BERG 的收藏';
    $('list-title').textContent = labels[state.status];
    $('list-subtitle').textContent = selected.length ? `共 ${selected.length} 部` : '';
    const empty = !waiting && selected.length === 0;
    $('empty-state').hidden = !empty;
    $('empty-title').textContent = dataError ? '观影记录暂时无法加载' : state.query ? '没有找到这部影片'
        : discovering ? '暂时没有新的推荐' : '这里还没有影片';
    $('empty-description').textContent = dataError ? '请检查网络连接后重试。'
        : state.query ? '试试其他片名，或清空搜索。'
            : discovering ? recommendationMessage
                : state.type !== 'all' ? '切换影片类型，看看其他收藏。' : '';
    $('retry').hidden = !dataError && !(discovering && recommendationState === 'error');
    $('grid').innerHTML = waiting || empty ? '' : selected.map(movie => `<button class="poster-card" data-key="${esc(movie.key)}" aria-label="查看《${esc(movie.title)}》">
        <img loading="lazy" decoding="async" alt="" src="${esc(posterAt(movie.poster, 'w342'))}">
        ${movie.mustSeeInCinema && movie.category === 'wishlist' ? '<span class="must-see-badge">必须去影院</span>' : ''}
        <h2>${esc(movie.title)}</h2>
        <span class="card-meta"><span>${esc(movie.watchSortDate || movie.tmdb?.release_date?.slice(0, 4) || typeLabel(movie))}</span>
        <span class="card-rating">${movie.personalRating != null ? `我的 ${movie.personalRating.toFixed(1)}` : movie.tmdbRating != null ? `TMDB ${movie.tmdbRating.toFixed(1)}` : ''}</span></span>
    </button>`).join('');
}

function openMovie(movie) {
    if (!movie) return;
    lastFocus = document.activeElement;
    $('detail-title').textContent = movie.title;
    $('detail-status').textContent = `${labels[movie.category]} / ${typeLabel(movie)}`;
    $('detail-original').textContent = movie.tmdb?.original_title === movie.title ? '' : movie.tmdb?.original_title || '';
    $('detail-poster').src = movie.poster;
    $('detail-poster').alt = `${movie.title}海报`;
    $('detail-ratings').replaceChildren();
    [['我的评分', movie.personalRating], ['TMDB', movie.tmdbRating]].forEach(([label, value]) => {
        if (value == null && label === 'TMDB') return;
        if (label === '我的评分' && movie.category === 'discover') return;
        const element = document.createElement('span');
        element.textContent = label;
        const score = document.createElement('strong');
        score.textContent = value == null ? '未评分' : `${value.toFixed(1)} / 10`;
        element.append(score);
        $('detail-ratings').append(element);
    });
    const period = formatWatchPeriod({ ...movie, status: movie.category });
    const firstDate = movie.watchStartDate || movie.watchDate || movie.watchDates?.[0];
    const rewatch = (Array.isArray(movie.watchDates) ? movie.watchDates : []).filter(date => date !== firstDate);
    const rows = [
        ['观影', period], ['重温', rewatch.join('、')], ['地点', movie.inCinema ? '影院观影' : ''],
        ['影院', movie.mustSeeInCinema && movie.category === 'wishlist' ? '必须去影院看' : ''],
        ['上映', movie.tmdb?.release_date], ['导演', movie.tmdb?.directors?.join('、')],
        ['类型', genreNames(movie).join(' / ')],
        ['时长', movie.duration || (movie.tmdb?.runtime ? `${movie.tmdb.runtime} 分钟` : '')],
        ['平台', movie.platform], ['作者', movie.creator],
    ];
    $('detail-meta').replaceChildren();
    rows.forEach(([label, value]) => {
        if (!value) return;
        const term = document.createElement('dt');
        term.textContent = label;
        const description = document.createElement('dd');
        description.textContent = value;
        $('detail-meta').append(term, description);
    });
    [['note', movie.note], ['reason', movie.recommendationReason || movie.wishlistReason], ['overview', movie.tmdb?.overview]].forEach(([id, value]) => {
        $(`detail-${id}-section`).hidden = !value;
        $(`detail-${id}`).textContent = value || '';
    });
    $('detail-reason-heading').textContent = movie.category === 'discover' ? '推荐理由' : '想看理由';
    $('detail-link').hidden = !movie.externalUrl;
    $('detail-link').href = movie.externalUrl || '#';
    $('detail-link').textContent = movie.mediaType === 'web-video' ? '打开原视频 ↗' : '在 TMDB 查看 ↗';
    // 防剧透：每次打开都先遮住简介
    setOverviewRevealed(false);
    $('movie-dialog').showModal();
    $('movie-dialog').scrollTop = 0;
    $('close-dialog').focus();
}

function setOverviewRevealed(revealed) {
    $('detail-spoiler').classList.toggle('revealed', revealed);
    $('detail-overview').inert = !revealed;
    $('detail-overview').setAttribute('aria-hidden', String(!revealed));
    $('reveal-overview').hidden = revealed;
}

async function loadData() {
    dataLoading = true;
    dataError = false;
    render();
    try {
        const response = await fetch('data/movies.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.items)) throw new Error('Invalid movie collection');
        movies = data.items.map(normalizeMovie);
    } catch (error) {
        console.warn('观影记录加载失败', error);
        movies = [];
        dataError = true;
    } finally {
        years = watchedByYear(movies);
        dataLoading = false;
        render();
    }
    if (state.status === 'discover' && !dataError) loadRecommendations();
}

async function loadRecommendations() {
    if (recommendationState === 'loading' || recommendationState === 'ready' || dataLoading || dataError) return;
    recommendationState = 'loading';
    recommendationMessage = '正在寻找库外的好电影…';
    render();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
        const engine = window.MovieRecommendationEngine;
        if (!engine) throw new Error('Recommendation engine unavailable');
        const profile = engine.buildTasteProfile(movies);
        const response = await fetch('/api/recommendations', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile, limit: 40 }), signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        recommendations = engine.rankExternalRecommendations(data.results || [], profile, { genreMap: data.genreMap || {}, limit: 8 })
            .map((movie, index) => normalizeMovie({ ...movie, status: 'discover', rating: null }, index));
        recommendationState = 'ready';
        recommendationMessage = recommendations.length ? '来自 TMDB，已排除库里已有电影' : 'TMDB 暂无新的匹配电影';
    } catch (error) {
        console.info('在线推荐暂不可用', error);
        recommendationState = 'error';
        recommendationMessage = '在线推荐暂不可用，请稍后重试。';
    } finally {
        clearTimeout(timeout);
        render();
    }
}

document.querySelectorAll('[data-status]').forEach(button => button.addEventListener('click', () => {
    state.status = button.dataset.status;
    state.query = '';
    $('search').value = '';
    render();
    window.scrollTo({ top: 0 });
    if (state.status === 'discover') loadRecommendations();
}));
document.querySelectorAll('[data-type]').forEach(button => button.addEventListener('click', () => {
    state.type = button.dataset.type;
    document.querySelectorAll('[data-type]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    render();
}));
let searchTimeout;
$('search').addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => { state.query = $('search').value.trim(); render(); }, 180);
});
$('year-bars').addEventListener('click', event => {
    const button = event.target.closest('button[data-year]');
    if (button) { state.year = button.dataset.year; render(); }
});
document.addEventListener('click', event => {
    const day = event.target.closest('[data-day]');
    if (day) return showDay(day.dataset.day, years.get(state.year) || []);
    const card = event.target.closest('[data-key]');
    if (card) openMovie(findMovie(card.dataset.key));
});
// 海报加载失败时换成占位图
document.addEventListener('error', event => {
    const image = event.target;
    if (image instanceof HTMLImageElement && !image.src.endsWith(PLACEHOLDER)) image.src = PLACEHOLDER;
}, true);
$('retry').addEventListener('click', () => dataError ? loadData() : loadRecommendations());
$('reveal-overview').addEventListener('click', () => {
    setOverviewRevealed(true);
    $('detail-overview').focus();
});
$('close-dialog').addEventListener('click', () => $('movie-dialog').close());
$('movie-dialog').addEventListener('click', event => {
    if (event.target !== $('movie-dialog')) return;
    const rect = $('movie-dialog').getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('movie-dialog').close();
});
$('movie-dialog').addEventListener('close', () => { if (lastFocus?.isConnected) lastFocus.focus(); });
loadData();
