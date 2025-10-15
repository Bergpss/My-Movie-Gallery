const MOVIE_DATA_URL = 'data/movies.json';
const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w500';
const PLACEHOLDER_POSTER = 'movie_posters/placeholder.png';

let allMovies = [];
let currentFilter = 'all';

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
        const response = await fetch(MOVIE_DATA_URL, { cache: 'no-store' });

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

function filterMoviesByType(movies, filterType) {
    if (filterType === 'all') {
        return movies;
    }
    return movies.filter(movie => {
        const mediaType = movie.mediaType || 'movie';
        return mediaType === filterType;
    });
}

function renderMovies(movies) {
    const watchingContainer = document.getElementById('watching-container');
    const watchingEmpty = document.querySelector('#watching-section .empty-message');
    const watchedContainer = document.getElementById('movie-container');
    const watchedEmpty = document.querySelector('#watched-section .empty-message');

    [watchingContainer, watchedContainer].forEach(container => {
        if (container) {
            container.innerHTML = '';
        }
    });

    const filteredMovies = filterMoviesByType(movies, currentFilter);

    const watchingMovies = filteredMovies.filter(movie => {
        const status = (movie.status || '').toLowerCase();
        return status === 'watching' || status === 'in-progress' || status === 'ongoing' || status === 'wishlist' || status === 'planned';
    });

    const watchedMovies = filteredMovies.filter(movie => !watchingMovies.includes(movie));

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
            const posterPath = movie.tmdb?.poster_path || movie.tmdb?.backdrop_path || null;
            const imagePath = posterPath
                ? `${POSTER_BASE_URL}${posterPath}`
                : PLACEHOLDER_POSTER;

            const title = movie.title || movie.tmdb?.title || movie.tmdb?.original_title || 'Untitled';
            const ratingValue = typeof movie.rating === 'number'
                ? movie.rating
                : typeof movie.tmdb?.vote_average === 'number'
                    ? movie.tmdb.vote_average
                    : null;
            const rating = typeof ratingValue === 'number' ? ratingValue.toFixed(1) : null;
            const cinemaBadge = movie.inCinema ? '<span class="cinema-badge" title="影院观影">🎦</span>' : '';
            const mediaType = movie.mediaType === 'tv' ? 'tv' : 'movie';
            const tmdbUrl = movie.id
                ? `https://www.themoviedb.org/${mediaType}/${movie.id}`
                : '#';
            const releaseDate = formatDate(getReleaseDate(movie));
            const formattedWatchDates = (Array.isArray(movie.watchDates)
                ? movie.watchDates
                : movie.watchDate
                    ? [movie.watchDate]
                : [])
                .map(date => formatDate(date))
                .filter(Boolean);
            const [primaryWatchDate, ...extraWatchDates] = formattedWatchDates;
            const note = movie.note ? `<p class="watch-note">${movie.note}</p>` : '';
            const watchDatesMarkup = extraWatchDates.length
                ? `<p class="watch-dates">再看：${extraWatchDates.join('、')}</p>`
                : '';

            container.innerHTML += `
                <div class="movie-item">
                    <a class="poster-wrapper" href="${tmdbUrl}" target="_blank" rel="noopener noreferrer">
                        <img src="${imagePath}" alt="${title}" loading="lazy">
                        <div class="badge-row">
                            ${rating ? `<span class="rating-badge">${rating}</span>` : ''}
                            ${cinemaBadge}
                        </div>
                    </a>
                    <p>${title}</p>
                    ${releaseDate ? `<p class="release-date">上映：${releaseDate}</p>` : ''}
                    ${primaryWatchDate ? `<p class="watch-date">观影：${primaryWatchDate}</p>` : ''}
                    ${watchDatesMarkup}
                    ${note}
                </div>
            `;
        });
    };

    renderList(watchingContainer, watchingEmpty, watchingMovies, 'release');
    renderList(watchedContainer, watchedEmpty, watchedMovies, 'watch');
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
    allMovies = await fetchMoviesFromList();
    renderMovies(allMovies);
    setupFilterButtons();
}

window.onload = initGallery;
