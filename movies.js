const MOVIE_DATA_URL = 'data/movies.json';
const RECOMMENDATION_API_URL = '/api/recommendations';
const RECOMMENDATION_REQUEST_TIMEOUT_MS = 30000;
const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w500';
const PLACEHOLDER_POSTER = 'movie_posters/placeholder.png';

let allMovies = [];
let currentFilter = 'all';
let recommendationMovies = [];
let recommendationStatusText = '基于已看记录计算中';

function formatDate(isoString) {
    if (!isoString) {
        return null;
    }

    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toISOString().split('T')[0];
}

function getReleaseDate(movie) {
    return movie.tmdb?.release_date || null;
}

function getWatchDate(movie) {
    if (Array.isArray(movie.watchDates) && movie.watchDates.length) {
        return movie.watchDates[0];
    }
    return movie.watchDate || null;
}

function sortMoviesByReleaseDate(movies) {
    return [...movies].sort((a, b) => {
        const dateA = formatDate(getReleaseDate(a));
        const dateB = formatDate(getReleaseDate(b));

        if (dateA && dateB) {
            if (dateA > dateB) return -1;
            if (dateA < dateB) return 1;
        } else if (dateA) {
            return -1;
        } else if (dateB) {
            return 1;
        }

        const ratingA = typeof a.rating === 'number' ? a.rating : -Infinity;
        const ratingB = typeof b.rating === 'number' ? b.rating : -Infinity;

        if (ratingA > ratingB) return -1;
        if (ratingA < ratingB) return 1;

        return String(a.title || a.name || '').localeCompare(String(b.title || b.name || ''));
    });
}

function sortMoviesByWatchDate(movies) {
    return [...movies].sort((a, b) => {
        const dateA = formatDate(getWatchDate(a));
        const dateB = formatDate(getWatchDate(b));

        if (dateA && dateB) {
            if (dateA > dateB) return -1;
            if (dateA < dateB) return 1;
        } else if (dateA) {
            return -1;
        } else if (dateB) {
            return 1;
        }

        return (a.title || '').localeCompare(b.title || '');
    });
}

async function fetchMoviesFromList() {
    try {
        const response = await fetch(MOVIE_DATA_URL);

        if (!response.ok) {
            throw new Error(`Failed to load movie data: ${response.status}`);
        }

        const data = await response.json();
        return data.items || [];
    } catch (error) {
        console.error('Error fetching movies:', error);
        return [];
    }
}

function showLoadingSkeletons() {
    const containers = [
        document.getElementById('recommendation-container'),
        document.getElementById('watching-container'),
        document.getElementById('wishlist-container'),
        document.getElementById('movie-container'),
        document.getElementById('dropped-container')
    ];

    const skeletonCount = [4, 2, 3, 8, 2]; // Different counts for each section

    containers.forEach((container, index) => {
        if (!container) return;
        container.innerHTML = '';
        for (let i = 0; i < skeletonCount[index]; i++) {
            container.innerHTML += `
                <div class="movie-item skeleton-item">
                    <div class="skeleton-poster"></div>
                    <div class="skeleton-title"></div>
                    <div class="skeleton-date"></div>
                </div>
            `;
        }
    });
}

function filterMoviesByType(movies, filterType) {
    if (filterType === 'all') {
        return movies;
    }
    return movies.filter(movie => {
        const mediaType = movie.mediaType || 'movie';
        return mediaType === filterType;
    });
}

function getPlatformIcon(platform) {
    const icons = {
        'bilibili': 'B',
        'youtube': 'Y',
        'iqiyi': '爱',
        'tencent': '腾',
        'youku': '优',
        'other': '▶',
    };
    return icons[platform] || '▶';
}

function getPlatformColor(platform) {
    const colors = {
        'bilibili': '#00a1d6',
        'youtube': '#ff0000',
        'iqiyi': '#00be06',
        'tencent': '#ff6428',
        'youku': '#00a4ff',
        'other': '#666',
    };
    return colors[platform] || '#666';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getRecommendationEngine() {
    return window.MovieRecommendationEngine || null;
}

function getRecommendationSourceLabel(source) {
    if (source === 'tmdb') {
        return 'TMDB';
    }
    return '推荐';
}

function createRecommendationCardHtml(movie) {
    const posterPath = movie.tmdb?.poster_path || movie.tmdb?.backdrop_path || null;
    const imagePath = posterPath ? `${POSTER_BASE_URL}${posterPath}` : PLACEHOLDER_POSTER;
    const title = movie.tmdb?.title || movie.tmdb?.original_title || movie.title || 'Untitled';
    const ratingValue = typeof movie.tmdb?.vote_average === 'number'
        ? movie.tmdb.vote_average
        : typeof movie.rating === 'number'
            ? movie.rating
            : null;
    const rating = typeof ratingValue === 'number' ? ratingValue.toFixed(1) : null;
    const releaseDate = formatDate(getReleaseDate(movie));
    const genres = Array.isArray(movie.tmdb?.genres)
        ? movie.tmdb.genres.map(genre => genre.name).filter(Boolean).slice(0, 2)
        : [];
    const targetUrl = movie.id ? `https://www.themoviedb.org/movie/${movie.id}` : '#';
    const sourceLabel = getRecommendationSourceLabel(movie.recommendationSource);

    const metaRows = [
        releaseDate ? { label: '上映', value: releaseDate } : null,
        genres.length > 0 ? { label: '类型', value: genres.join('、') } : null,
    ].filter(Boolean);

    const metaHtml = metaRows.map(row => `
        <div class="meta-row">
            <span class="meta-label">${escapeHtml(row.label)}</span>
            <span class="meta-value">${escapeHtml(row.value)}</span>
        </div>
    `).join('');

    const reason = movie.recommendationReason
        ? `<p class="recommendation-reason">${escapeHtml(movie.recommendationReason)}</p>`
        : '';

    return `
        <div class="movie-item">
            <a class="poster-wrapper" href="${escapeHtml(targetUrl)}" target="_blank" rel="noopener noreferrer">
                <img src="${escapeHtml(imagePath)}" alt="${escapeHtml(title)}" loading="lazy">
                <div class="badge-row">
                    ${rating ? `<span class="rating-badge">${escapeHtml(rating)}</span>` : ''}
                    <span class="recommendation-source">${escapeHtml(sourceLabel)}</span>
                </div>
            </a>
            <div class="movie-info">
                <h3 class="movie-title">${escapeHtml(title)}</h3>
                <div class="movie-meta">
                    ${metaHtml}
                </div>
                ${reason ? `<div class="movie-note-container">${reason}</div>` : ''}
            </div>
        </div>
    `;
}

function renderRecommendations() {
    const recommendationContainer = document.getElementById('recommendation-container');
    const recommendationEmpty = document.querySelector('#recommendation-section .empty-message');
    const recommendationStatus = document.getElementById('recommendation-status');

    if (!recommendationContainer || !recommendationEmpty || !recommendationStatus) {
        return;
    }

    recommendationContainer.innerHTML = '';
    recommendationStatus.textContent = recommendationStatusText;

    if (currentFilter !== 'all' && currentFilter !== 'movie') {
        recommendationEmpty.hidden = false;
        recommendationEmpty.textContent = '当前筛选只展示电影推荐';
        recommendationStatus.textContent = '切回全部或电影可查看推荐';
        return;
    }

    recommendationEmpty.textContent = '暂无可推荐的未看电影';

    if (recommendationMovies.length === 0) {
        recommendationEmpty.hidden = false;
        return;
    }

    recommendationEmpty.hidden = true;
    recommendationContainer.innerHTML = recommendationMovies
        .slice(0, 8)
        .map(movie => createRecommendationCardHtml(movie))
        .join('');
}

async function loadRecommendations() {
    const engine = getRecommendationEngine();

    if (!engine || !allMovies.length) {
        recommendationMovies = [];
        recommendationStatusText = '推荐引擎未加载';
        renderRecommendations();
        return;
    }

    const profile = engine.buildTasteProfile(allMovies);
    recommendationMovies = [];
    recommendationStatusText = '正在从 TMDB 查找库外电影';
    renderRecommendations();

    const requestController = new AbortController();
    const timeoutId = window.setTimeout(
        () => requestController.abort(),
        RECOMMENDATION_REQUEST_TIMEOUT_MS,
    );

    try {
        const response = await fetch(RECOMMENDATION_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                profile,
                limit: 40,
            }),
            signal: requestController.signal,
        });

        if (!response.ok) {
            throw new Error(`Recommendation API failed: ${response.status}`);
        }

        const data = await response.json();
        const remoteRecommendations = engine.rankExternalRecommendations(data.results || [], profile, {
            genreMap: data.genreMap || {},
            limit: 8,
        });

        recommendationMovies = remoteRecommendations;
        recommendationStatusText = remoteRecommendations.length > 0
            ? '来自 TMDB，已排除库里已有电影'
            : 'TMDB 暂无新的匹配电影';
        renderRecommendations();
    } catch (error) {
        console.info('在线推荐暂不可用:', error);
        recommendationMovies = [];
        recommendationStatusText = '在线推荐暂不可用';
        renderRecommendations();
    } finally {
        window.clearTimeout(timeoutId);
    }
}

function renderMovies(movies) {
    const watchingContainer = document.getElementById('watching-container');
    const watchingEmpty = document.querySelector('#watching-section .empty-message');
    const wishlistContainer = document.getElementById('wishlist-container');
    const wishlistEmpty = document.querySelector('#wishlist-section .empty-message');
    const watchedContainer = document.getElementById('movie-container');
    const watchedEmpty = document.querySelector('#watched-section .empty-message');
    const droppedContainer = document.getElementById('dropped-container');
    const droppedEmpty = document.querySelector('#dropped-section .empty-message');

    [watchingContainer, wishlistContainer, watchedContainer, droppedContainer].forEach(container => {
        if (container) {
            container.innerHTML = '';
        }
    });

    const filteredMovies = filterMoviesByType(movies, currentFilter);

    const watchingMovies = filteredMovies.filter(movie => {
        const status = (movie.status || '').toLowerCase();
        return status === 'watching' || status === 'in-progress' || status === 'ongoing';
    });

    const wishlistMovies = filteredMovies.filter(movie => {
        const status = (movie.status || '').toLowerCase();
        return status === 'wishlist' || status === 'planned';
    });

    const droppedMovies = filteredMovies.filter(movie => {
        const status = (movie.status || '').toLowerCase();
        return status === 'dropped';
    });

    const watchedMovies = filteredMovies.filter(movie => {
        return !watchingMovies.includes(movie) && !wishlistMovies.includes(movie) && !droppedMovies.includes(movie);
    });

    const renderList = (container, emptyMessageEl, list, sortMode) => {
        if (!container || !emptyMessageEl) {
            return;
        }

        const sorted = sortMode === 'watch'
            ? sortMoviesByWatchDate(list)
            : sortMoviesByReleaseDate(list);

        if (sorted.length === 0) {
            emptyMessageEl.hidden = false;
            return;
        }

        emptyMessageEl.hidden = true;

        sorted.forEach(movie => {
            const isWebVideo = movie.mediaType === 'web-video';

            let imagePath, title, rating, cinemaBadge, targetUrl;
            let platformBadge = '';
            
            // Metadata rows collection
            let metaRows = [];

            if (isWebVideo) {
                // Web video rendering
                // Use a solid color placeholder if no cover URL
                imagePath = movie.coverUrl || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="225"%3E%3Crect width="400" height="225" fill="%2300a1d6"/%3E%3Ctext x="50%25" y="50%25" font-size="48" fill="white" text-anchor="middle" dy=".3em"%3E▶%3C/text%3E%3C/svg%3E';
                title = movie.title || 'Untitled';
                const ratingValue = typeof movie.rating === 'number' ? movie.rating : null;
                rating = typeof ratingValue === 'number' ? ratingValue.toFixed(1) : null;
                cinemaBadge = '';
                targetUrl = movie.url || '#';

                if (movie.platform) {
                    const icon = getPlatformIcon(movie.platform);
                    const color = getPlatformColor(movie.platform);
                    platformBadge = `<span class="platform-badge" style="background-color: ${color}" title="${movie.platform}">${icon}</span>`;
                }

                if (movie.creator) {
                    metaRows.push({ label: 'UP主', value: movie.creator });
                }

                if (movie.duration) {
                    metaRows.push({ label: '时长', value: movie.duration });
                }
            } else {
                // Movie/TV rendering
                const posterPath = movie.tmdb?.poster_path || movie.tmdb?.backdrop_path || null;
                imagePath = posterPath ? `${POSTER_BASE_URL}${posterPath}` : PLACEHOLDER_POSTER;
                title = movie.tmdb?.title || movie.tmdb?.original_title || movie.title || 'Untitled';
                const ratingValue = typeof movie.rating === 'number'
                    ? movie.rating
                    : typeof movie.tmdb?.vote_average === 'number'
                        ? movie.tmdb.vote_average
                        : null;
                rating = typeof ratingValue === 'number' ? ratingValue.toFixed(1) : null;
                cinemaBadge = movie.inCinema ? '<span class="cinema-badge" title="影院观影">🎦</span>' : '';
                const mediaType = movie.mediaType === 'tv' ? 'tv' : 'movie';
                targetUrl = movie.id ? `https://www.themoviedb.org/${mediaType}/${movie.id}` : '#';
                
                const releaseDate = formatDate(getReleaseDate(movie));
                if (releaseDate) {
                    metaRows.push({ label: '上映', value: releaseDate });
                }

                // Director information
                const directors = movie.tmdb?.directors;
                if (Array.isArray(directors) && directors.length > 0) {
                    metaRows.push({ label: '导演', value: directors.join('、') });
                }
            }

            const formattedWatchDates = (Array.isArray(movie.watchDates)
                ? movie.watchDates
                : movie.watchDate
                    ? [movie.watchDate]
                    : [])
                .map(date => formatDate(date))
                .filter(Boolean);
            const [primaryWatchDate, ...extraWatchDates] = formattedWatchDates;
            
            if (primaryWatchDate) {
                metaRows.push({ label: '观影', value: primaryWatchDate });
            }
            if (extraWatchDates.length > 0) {
                metaRows.push({ label: '重温', value: extraWatchDates.join('、') });
            }

            const metaHtml = metaRows.map(row => `
                <div class="meta-row">
                    <span class="meta-label">${row.label}</span>
                    <span class="meta-value">${row.value}</span>
                </div>
            `).join('');

            const note = movie.note ? `<p class="watch-note">${movie.note}</p>` : '';
            const wishlistReason = movie.wishlistReason ? `<p class="wishlist-reason">💡 ${movie.wishlistReason}</p>` : '';
            
            // Only show note container if there is content
            const noteContainerHtml = (note || wishlistReason) 
                ? `<div class="movie-note-container">${wishlistReason}${note}</div>` 
                : '';

            container.innerHTML += `
                <div class="movie-item">
                    <a class="poster-wrapper" href="${targetUrl}" target="_blank" rel="noopener noreferrer">
                        <img src="${imagePath}" alt="${title}" loading="lazy">
                        <div class="badge-row">
                            ${rating ? `<span class="rating-badge">${rating}</span>` : ''}
                            ${cinemaBadge}
                            ${platformBadge}
                        </div>
                    </a>
                    <div class="movie-info">
                        <h3 class="movie-title">${title}</h3>
                        <div class="movie-meta">
                            ${metaHtml}
                        </div>
                        ${noteContainerHtml}
                    </div>
                </div>
            `;
        });
    };

    renderList(watchingContainer, watchingEmpty, watchingMovies, 'release');
    renderList(wishlistContainer, wishlistEmpty, wishlistMovies, 'release');
    renderList(watchedContainer, watchedEmpty, watchedMovies, 'watch');
    renderList(droppedContainer, droppedEmpty, droppedMovies, 'release');
    renderRecommendations();
}

function setupFilterButtons() {
    const filterButtons = document.querySelectorAll('.filter-btn');

    filterButtons.forEach(button => {
        button.addEventListener('click', () => {
            filterButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            currentFilter = button.getAttribute('data-filter');
            renderMovies(allMovies);
        });
    });
}

async function initGallery() {
    showLoadingSkeletons();
    allMovies = await fetchMoviesFromList();
    renderMovies(allMovies);
    setupFilterButtons();
    loadRecommendations();
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initGallery, { once: true });
} else {
    initGallery();
}
