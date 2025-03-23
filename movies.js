const movies = [
    {
        title: "Stranger Things 2016",
        image: "Stranger_Things_2016.jpg"
    },
    {
        title: "Breaking Bad",
        image: "Breaking_Bad.jpg"
    }
    // 可以继续添加更多电影
];

function renderMovies() {
    const container = document.getElementById('movie-container');
    container.innerHTML = ''; // 清空容器
    
    movies.forEach(movie => {
        container.innerHTML += `
            <div class="movie-item">
                <img src="movie_posters/${movie.image}" alt="${movie.title}">
                <p>${movie.title}</p>
            </div>
        `;
    });
}

// 页面加载时渲染电影列表
window.onload = renderMovies;