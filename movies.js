const MOVIE_DATA_URL = 'data/movies.json';
const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w500';
const PLACEHOLDER_POSTER = 'movie_posters/placeholder.png';

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

        const sorted = sortMoviesByReleaseDate(list);

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
            const releaseDate = formatDate(getReleaseDate(movie));
            const note = movie.note ? `<p class="watch-note">${movie.note}</p>` : '';

            container.innerHTML += `
                <div class="movie-item">
                    <div class="poster-wrapper">
                        <img src="${imagePath}" alt="${title}" loading="lazy">
                        ${rating ? `<span class="rating-badge">${rating}</span>` : ''}
                    </div>
                    <p>${title}</p>
                    ${releaseDate ? `<p class="release-date">${releaseDate}</p>` : ''}
                    ${note}
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
