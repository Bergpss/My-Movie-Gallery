const TMDB_API_KEY = 'b4dead5f272af393f355a31fd8361ba5'; // Replace with your actual API key
const LIST_ID = '8520430'; // Replace with your list ID
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w500';
const LANGUAGE = "zh-CN"

async function fetchMoviesFromList() {
    try {
        const response = await fetch(
            `${TMDB_BASE_URL}/list/${LIST_ID}?language=${LANGUAGE}&api_key=${TMDB_API_KEY}`
        );
        const data = await response.json();
        return data.items;
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
            : 'movie_posters/placeholder.png'; // Add a placeholder image for movies without posters
        
        const title = movie.media_type == "movie" ? movie.title : movie.name

        container.innerHTML += `
            <div class="movie-item">
                <img src="${backdropPath}" alt="${title}" loading="lazy">
                <p>${title}</p>
            </div>
        `;
    });
}

// Initialize the gallery
async function initGallery() {
    const movies = await fetchMoviesFromList();
    renderMovies(movies);
}

window.onload = initGallery;