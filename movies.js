const MOVIE_DATA_URL = 'data/movies.json';
const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w500';
const PLACEHOLDER_POSTER = 'movie_posters/placeholder.png';

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

    movies.forEach(movie => {
        const backdropPath = movie.backdrop_path
            ? `${POSTER_BASE_URL}${movie.backdrop_path}`
            : PLACEHOLDER_POSTER;

        const title = movie.media_type === 'movie' ? movie.title : movie.name;

        container.innerHTML += `
            <div class="movie-item">
                <img src="${backdropPath}" alt="${title}" loading="lazy">
                <p>${title}</p>
            </div>
        `;
    });
}

async function initGallery() {
    const movies = await fetchMoviesFromList();
    renderMovies(movies);
}

window.onload = initGallery;
