// 管理界面逻辑

const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w300';
const API_BASE = '/api';

// 状态
let authToken = localStorage.getItem('adminToken');

// DOM 元素
const loginSection = document.getElementById('login-section');
const adminSection = document.getElementById('admin-section');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const searchForm = document.getElementById('search-form');
const searchResults = document.getElementById('search-results');
const searchLoading = document.getElementById('search-loading');
const searchEmpty = document.getElementById('search-empty');
const manualForm = document.getElementById('manual-form');
const addModal = document.getElementById('add-modal');
const addForm = document.getElementById('add-form');
const adminMessage = document.getElementById('admin-message');

// 初始化
function init() {
    if (authToken) {
        showAdminSection();
    }

    // 设置今天的日期为默认值
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('manual-date').value = today;
    document.getElementById('add-date').value = today;

    setupEventListeners();
}

// 显示管理区域
function showAdminSection() {
    loginSection.hidden = true;
    adminSection.hidden = false;
}

// 显示消息
function showMessage(element, message, isError = false) {
    element.textContent = message;
    element.className = isError ? 'message error' : 'message success';
    element.hidden = false;
    setTimeout(() => {
        element.hidden = true;
    }, 5000);
}

// 设置事件监听
function setupEventListeners() {
    // 登录表单
    loginForm.addEventListener('submit', handleLogin);

    // Tab 切换
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(`${btn.dataset.tab}-tab`).classList.add('active');
        });
    });

    // 搜索表单
    searchForm.addEventListener('submit', handleSearch);

    // 手动添加表单
    manualForm.addEventListener('submit', handleManualAdd);

    // 添加表单（弹窗中）
    addForm.addEventListener('submit', handleAddFromModal);

    // 弹窗关闭
    document.querySelector('.modal-close').addEventListener('click', closeModal);
    addModal.addEventListener('click', (e) => {
        if (e.target === addModal) closeModal();
    });
}

// 登录处理
async function handleLogin(e) {
    e.preventDefault();
    const password = document.getElementById('password').value;

    try {
        const response = await fetch(`${API_BASE}/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
        });

        const data = await response.json();

        if (!response.ok) {
            loginError.textContent = data.error || '登录失败';
            loginError.hidden = false;
            return;
        }

        authToken = data.token;
        localStorage.setItem('adminToken', authToken);
        loginError.hidden = true;
        showAdminSection();
    } catch (error) {
        loginError.textContent = '网络错误，请重试';
        loginError.hidden = false;
    }
}

// 搜索处理
async function handleSearch(e) {
    e.preventDefault();
    const query = document.getElementById('search-query').value;
    const type = document.getElementById('search-type').value;

    searchResults.innerHTML = '';
    searchLoading.hidden = false;
    searchEmpty.hidden = true;

    try {
        const response = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}&type=${type}`);
        const data = await response.json();

        searchLoading.hidden = true;

        if (!response.ok) {
            showMessage(adminMessage, data.error || '搜索失败', true);
            return;
        }

        if (!data.results || data.results.length === 0) {
            searchEmpty.hidden = false;
            return;
        }

        renderSearchResults(data.results);
    } catch (error) {
        searchLoading.hidden = true;
        showMessage(adminMessage, '网络错误，请重试', true);
    }
}

// 渲染搜索结果
function renderSearchResults(results) {
    searchResults.innerHTML = results.map(movie => `
        <div class="result-item" data-movie='${JSON.stringify(movie).replace(/'/g, "&#39;")}'>
            ${movie.posterPath
            ? `<img src="${POSTER_BASE_URL}${movie.posterPath}" alt="${movie.title}" loading="lazy">`
            : `<div class="no-poster">🎬</div>`
        }
            <div class="result-item-info">
                <h4>${movie.title}</h4>
                <p>${movie.releaseDate ? movie.releaseDate.slice(0, 4) : '未知'} · ${movie.mediaType === 'tv' ? '剧集' : '电影'}</p>
            </div>
        </div>
    `).join('');

    // 绑定点击事件
    document.querySelectorAll('.result-item').forEach(item => {
        item.addEventListener('click', () => {
            const movie = JSON.parse(item.dataset.movie);
            openAddModal(movie);
        });
    });
}

// 打开添加弹窗
function openAddModal(movie) {
    document.getElementById('modal-poster').src = movie.posterPath
        ? `${POSTER_BASE_URL}${movie.posterPath}`
        : '';
    document.getElementById('modal-title').textContent = movie.title;
    document.getElementById('modal-meta').textContent =
        `${movie.releaseDate ? movie.releaseDate.slice(0, 4) : '未知'} · ${movie.mediaType === 'tv' ? '剧集' : '电影'}${movie.voteAverage ? ` · TMDB ${movie.voteAverage.toFixed(1)}` : ''}`;

    document.getElementById('add-id').value = movie.id;
    document.getElementById('add-title').value = movie.title;
    document.getElementById('add-type').value = movie.mediaType || 'movie';

    addModal.hidden = false;
}

// 关闭弹窗
function closeModal() {
    addModal.hidden = true;
    // 重置表单
    addForm.reset();
    document.getElementById('add-date').value = new Date().toISOString().split('T')[0];
}

// 从弹窗添加电影
async function handleAddFromModal(e) {
    e.preventDefault();

    const movieData = {
        id: parseInt(document.getElementById('add-id').value),
        title: document.getElementById('add-title').value,
        mediaType: document.getElementById('add-type').value,
        status: document.getElementById('add-status').value,
        rating: document.getElementById('add-rating').value ? parseFloat(document.getElementById('add-rating').value) : undefined,
        watchDate: document.getElementById('add-date').value || undefined,
        inCinema: document.getElementById('add-cinema').checked,
        note: document.getElementById('add-note').value || undefined,
    };

    await addMovie(movieData);
}

// 手动添加电影
async function handleManualAdd(e) {
    e.preventDefault();

    const movieData = {
        id: parseInt(document.getElementById('manual-id').value),
        title: document.getElementById('manual-title').value,
        mediaType: document.getElementById('manual-type').value,
        status: document.getElementById('manual-status').value,
        rating: document.getElementById('manual-rating').value ? parseFloat(document.getElementById('manual-rating').value) : undefined,
        watchDate: document.getElementById('manual-date').value || undefined,
        inCinema: document.getElementById('manual-cinema').checked,
        note: document.getElementById('manual-note').value || undefined,
    };

    await addMovie(movieData);
}

// 添加电影 API 调用
async function addMovie(movieData) {
    try {
        const response = await fetch(`${API_BASE}/add`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify(movieData),
        });

        const data = await response.json();

        if (!response.ok) {
            if (response.status === 401) {
                // Token 过期，需要重新登录
                localStorage.removeItem('adminToken');
                authToken = null;
                loginSection.hidden = false;
                adminSection.hidden = true;
                showMessage(loginError, '登录已过期，请重新登录', true);
                loginError.hidden = false;
                return;
            }
            showMessage(adminMessage, data.error || '添加失败', true);
            return;
        }

        closeModal();
        showMessage(adminMessage, data.message || '添加成功！', false);

        // 清空手动表单
        manualForm.reset();
        document.getElementById('manual-date').value = new Date().toISOString().split('T')[0];
    } catch (error) {
        showMessage(adminMessage, '网络错误，请重试', true);
    }
}

// 启动
init();
