const MOVIE_DATA_URL = 'data/movies.json';
const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w500';
const PLACEHOLDER_POSTER = 'movie_posters/placeholder.png';

function formatWatchDate(isoString) {
    if (!isoString) {
        return null;
    }

    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date.toISOString().split('T')[0];
}

function getWatchDateSource(movie) {
    return (
        movie.rated_at
        || movie.account_rating?.created_at
        || movie.created_at
        || null
    );
}

function sortMoviesByWatchDate(movies) {
    return [...movies].sort((a, b) => {
        const dateA = formatWatchDate(getWatchDateSource(a));
        const dateB = formatWatchDate(getWatchDateSource(b));

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

    const watchingMovies = movies.filter(movie => {
        const status = (movie.status || '').toLowerCase();
        return status === 'watching' || status === 'in-progress' || status === 'ongoing';
    });

    const watchedMovies = movies.filter(movie => !watchingMovies.includes(movie));

    const renderList = (container, emptyMessageEl, list) => {
        if (!container || !emptyMessageEl) {
            return;
        }

        const sorted = sortMoviesByWatchDate(list);

        if (sorted.length === 0) {
            emptyMessageEl.hidden = false;
            return;
        }

        emptyMessageEl.hidden = true;

        sorted.forEach(movie => {
            const imagePath = movie.poster_path
                ? `${POSTER_BASE_URL}${movie.poster_path}`
                : movie.backdrop_path
                    ? `${POSTER_BASE_URL}${movie.backdrop_path}`
                    : PLACEHOLDER_POSTER;

            const title = movie.title || movie.name || 'Untitled';
            const rating = typeof movie.rating === 'number' ? movie.rating.toFixed(1) : null;
            const watchedOn = formatWatchDate(getWatchDateSource(movie));

            container.innerHTML += `
                <div class="movie-item">
                    <div class="poster-wrapper">
                        <img src="${imagePath}" alt="${title}" loading="lazy">
                        ${rating ? `<span class="rating-badge">${rating}</span>` : ''}
                    </div>
                    <p>${title}</p>
                    ${watchedOn ? `<p class="watch-date">${watchedOn}</p>` : ''}
                </div>
            `;
        });
    };

    renderList(watchingContainer, watchingEmpty, watchingMovies);
    renderList(watchedContainer, watchedEmpty, watchedMovies);
}

async function initGallery() {
    const movies = await fetchMoviesFromList();
    renderMovies(movies);
}

window.onload = initGallery;
