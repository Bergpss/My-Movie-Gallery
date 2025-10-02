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
    const container = document.getElementById('movie-container');
    container.innerHTML = '';

    const sorted = [...movies].sort((a, b) => {
        const dateA = formatWatchDate(
            a.rated_at
            || a.account_rating?.created_at
            || a.created_at
        );
        const dateB = formatWatchDate(
            b.rated_at
            || b.account_rating?.created_at
            || b.created_at
        );

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

    sorted.forEach(movie => {
        const imagePath = movie.poster_path
            ? `${POSTER_BASE_URL}${movie.poster_path}`
            : movie.backdrop_path
                ? `${POSTER_BASE_URL}${movie.backdrop_path}`
                : PLACEHOLDER_POSTER;

        const title = movie.title || movie.name || 'Untitled';
        const rating = typeof movie.rating === 'number' ? movie.rating.toFixed(1) : null;
        const watchedOn = formatWatchDate(
            movie.rated_at
            || movie.account_rating?.created_at
            || movie.created_at
        );

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
}

async function initGallery() {
    const movies = await fetchMoviesFromList();
    renderMovies(movies);
}

window.onload = initGallery;
