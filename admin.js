// 管理界面逻辑

const POSTER_BASE_URL = 'https://image.tmdb.org/t/p/w300';
const API_BASE = '/api';

// 状态
let authToken = localStorage.getItem('adminToken');
let existingMovieIds = new Set(); // 已添加的电影 ID 集合

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
async function showAdminSection() {
    loginSection.hidden = true;
    adminSection.hidden = false;
    // 加载已添加的电影列表
    await loadExistingMovies();
}

// 加载已添加的电影ID列表
async function loadExistingMovies() {
    try {
        const response = await fetch('/data/movies.json');
        if (response.ok) {
            const data = await response.json();
            existingMovieIds.clear();
            (data.items || []).forEach(movie => {
                if (movie.id) existingMovieIds.add(movie.id);
            });
            console.log(`已加载 ${existingMovieIds.size} 部电影记录`);
        }
    } catch (error) {
        console.warn('加载电影列表失败:', error);
    }
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
            document.querySelectorAll('.tab-content').forEach(c => {
                c.classList.remove('active');
                c.hidden = true;
            });
            btn.classList.add('active');
            const targetTab = document.getElementById(`${btn.dataset.tab}-tab`);
            targetTab.classList.add('active');
            targetTab.hidden = false;
            
            // 切换到"我的记录"Tab 时加载数据
            if (btn.dataset.tab === 'library') {
                loadLibraryMovies();
            }
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

    // 状态变化时更新表单字段可见性
    document.getElementById('add-status').addEventListener('change', (e) => {
        updateFormFieldsVisibility('add', e.target.value);
    });
    document.getElementById('edit-status').addEventListener('change', (e) => {
        updateFormFieldsVisibility('edit', e.target.value);
    });

    // 我的记录筛选按钮事件
    document.querySelectorAll('.library-filter .filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.library-filter .filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.status;
            renderLibraryMovies();
        });
    });
}

// 根据状态更新表单字段可见性
function updateFormFieldsVisibility(prefix, status) {
    const isWishlist = status === 'wishlist';
    const isWatching = status === 'watching';

    // 获取相关元素
    const ratingGroup = document.getElementById(`${prefix}-rating-group`);
    const watchInfoRow = document.getElementById(`${prefix}-watch-info-row`);
    const reasonGroup = document.getElementById(`${prefix}-reason-group`);
    const dateLabel = document.getElementById(`${prefix}-date-label`);

    // 评分字段：想看和正在看都隐藏
    if (ratingGroup) {
        ratingGroup.hidden = isWishlist || isWatching;
    }
    if (watchInfoRow) {
        watchInfoRow.hidden = isWishlist;
    }
    if (reasonGroup) {
        reasonGroup.hidden = !isWishlist;
    }
    // 日期标签：正在看显示"开始观看日期"，其他显示"观影日期"
    if (dateLabel) {
        dateLabel.textContent = isWatching ? '开始观看日期' : '观影日期';
    }
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
    searchResults.innerHTML = results.map(movie => {
        const isAdded = existingMovieIds.has(movie.id);
        return `
        <div class="result-item ${isAdded ? 'already-added' : ''}" data-movie='${JSON.stringify(movie).replace(/'/g, "&#39;")}' data-added="${isAdded}">
            ${isAdded ? '<span class="added-badge">✓ 已添加</span>' : ''}
            ${movie.posterPath
                ? `<img src="${POSTER_BASE_URL}${movie.posterPath}" alt="${movie.title}" loading="lazy">`
                : `<div class="no-poster">🎬</div>`
            }
            <div class="result-item-info">
                <h4>${movie.title}</h4>
                <p>${movie.releaseDate ? movie.releaseDate.slice(0, 4) : '未知'} · ${movie.mediaType === 'tv' ? '剧集' : '电影'}</p>
            </div>
        </div>
    `}).join('');

    // 绑定点击事件
    document.querySelectorAll('.result-item').forEach(item => {
        item.addEventListener('click', () => {
            const movie = JSON.parse(item.dataset.movie);
            const isAdded = item.dataset.added === 'true';
            if (isAdded) {
                showMessage(adminMessage, '该电影已在你的观影记录中', true);
                return;
            }
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

    // 重置状态为默认值并更新字段可见性
    document.getElementById('add-status').value = 'watched';
    updateFormFieldsVisibility('add', 'watched');

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

    const status = document.getElementById('add-status').value;
    const isWishlist = status === 'wishlist';
    const isWatching = status === 'watching';
    const noRating = isWishlist || isWatching;

    const movieData = {
        id: parseInt(document.getElementById('add-id').value),
        title: document.getElementById('add-title').value,
        mediaType: document.getElementById('add-type').value,
        status: status,
        rating: noRating ? undefined : (document.getElementById('add-rating').value ? parseFloat(document.getElementById('add-rating').value) : undefined),
        watchDate: isWishlist ? undefined : (document.getElementById('add-date').value || undefined),
        inCinema: isWishlist ? false : document.getElementById('add-cinema').checked,
        wishlistReason: isWishlist ? (document.getElementById('add-reason').value || undefined) : undefined,
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

// ==================== 我的记录功能 ====================

let allMovies = []; // 所有电影数据
let currentFilter = 'all'; // 当前筛选状态
const editModal = document.getElementById('edit-modal');
const editForm = document.getElementById('edit-form');
const libraryResults = document.getElementById('library-results');
const libraryLoading = document.getElementById('library-loading');
const libraryEmpty = document.getElementById('library-empty');

// 加载我的电影记录
async function loadLibraryMovies() {
    if (!libraryResults || !libraryLoading || !libraryEmpty) {
        console.error('Library DOM elements not found');
        return;
    }

    libraryResults.innerHTML = '';
    libraryLoading.hidden = false;
    libraryEmpty.hidden = true;

    try {
        const response = await fetch('/data/movies.json');
        if (response.ok) {
            const data = await response.json();
            allMovies = data.items || [];
            renderLibraryMovies();
        } else {
            console.error('加载电影列表失败:', response.status, response.statusText);
            libraryEmpty.textContent = '加载失败，请刷新页面重试';
            libraryEmpty.hidden = false;
        }
    } catch (error) {
        console.error('加载电影列表失败:', error);
        libraryEmpty.textContent = '加载失败，请检查网络连接';
        libraryEmpty.hidden = false;
    } finally {
        libraryLoading.hidden = true;
    }
}

// 渲染我的电影记录
function renderLibraryMovies() {
    const filtered = currentFilter === 'all'
        ? allMovies
        : allMovies.filter(m => m.status === currentFilter);

    if (filtered.length === 0) {
        libraryResults.innerHTML = '';
        libraryEmpty.hidden = false;
        return;
    }

    libraryEmpty.hidden = true;
    libraryResults.innerHTML = filtered.map(movie => {
        const posterPath = movie.tmdb?.poster_path || movie.tmdb?.backdrop_path;
        const statusLabels = {
            watching: '正在看',
            watched: '已看完',
            wishlist: '想看',
            dropped: '弃剧'
        };
        return `
        <div class="result-item library-item" data-movie='${JSON.stringify(movie).replace(/'/g, "&#39;")}'>
            ${posterPath
                ? `<img src="${POSTER_BASE_URL}${posterPath}" alt="${movie.title}" loading="lazy">`
                : `<div class="no-poster">🎬</div>`
            }
            <div class="result-item-info">
                <h4>${movie.tmdb?.title || movie.title}</h4>
                <p>${statusLabels[movie.status] || movie.status}${movie.rating ? ` · ${movie.rating}分` : ''}</p>
            </div>
        </div>
    `}).join('');

    // 绑定点击事件打开编辑弹窗
    document.querySelectorAll('.library-item').forEach(item => {
        item.addEventListener('click', () => {
            const movie = JSON.parse(item.dataset.movie);
            openEditModal(movie);
        });
    });
}

// 打开编辑弹窗
function openEditModal(movie) {
    const posterPath = movie.tmdb?.poster_path || movie.tmdb?.backdrop_path;
    document.getElementById('edit-modal-poster').src = posterPath
        ? `${POSTER_BASE_URL}${posterPath}`
        : '';
    document.getElementById('edit-modal-title').textContent = movie.tmdb?.title || movie.title;
    document.getElementById('edit-modal-meta').textContent =
        `${movie.tmdb?.release_date ? movie.tmdb.release_date.slice(0, 4) : '未知'} · ${movie.mediaType === 'tv' ? '剧集' : '电影'}`;

    document.getElementById('edit-id').value = movie.id;
    document.getElementById('edit-status').value = movie.status || 'watched';
    document.getElementById('edit-rating').value = movie.rating || '';
    document.getElementById('edit-date').value = movie.watchDate || movie.watchDates?.[0] || '';
    document.getElementById('edit-cinema').checked = movie.inCinema || false;
    document.getElementById('edit-reason').value = movie.wishlistReason || '';
    document.getElementById('edit-note').value = movie.note || '';

    // 根据状态更新字段可见性
    updateFormFieldsVisibility('edit', movie.status || 'watched');

    editModal.hidden = false;
}

// 关闭编辑弹窗
function closeEditModal() {
    editModal.hidden = true;
    editForm.reset();
}

// 编辑弹窗关闭按钮
document.getElementById('edit-modal-close').addEventListener('click', closeEditModal);
editModal.addEventListener('click', (e) => {
    if (e.target === editModal) closeEditModal();
});

// 保存修改
editForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const status = document.getElementById('edit-status').value;
    const isWishlist = status === 'wishlist';
    const isWatching = status === 'watching';
    const noRating = isWishlist || isWatching;

    const updateData = {
        id: document.getElementById('edit-id').value,
        status: status,
        rating: noRating ? null : (document.getElementById('edit-rating').value || null),
        note: document.getElementById('edit-note').value || null,
        inCinema: isWishlist ? false : document.getElementById('edit-cinema').checked,
        watchDate: isWishlist ? null : (document.getElementById('edit-date').value || null),
        wishlistReason: isWishlist ? (document.getElementById('edit-reason').value || null) : null,
    };

    try {
        const response = await fetch(`${API_BASE}/update`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify(updateData),
        });

        const data = await response.json();

        if (!response.ok) {
            if (response.status === 401) {
                handleTokenExpired();
                return;
            }
            showMessage(adminMessage, data.error || '更新失败', true);
            return;
        }

        closeEditModal();
        showMessage(adminMessage, '更新成功！', false);
        // 重新加载数据
        await loadExistingMovies();
        await loadLibraryMovies();
    } catch (error) {
        showMessage(adminMessage, '网络错误，请重试', true);
    }
});

// 删除电影
document.getElementById('delete-movie-btn').addEventListener('click', async () => {
    const id = document.getElementById('edit-id').value;
    const title = document.getElementById('edit-modal-title').textContent;

    if (!confirm(`确定要删除"${title}"吗？此操作不可恢复。`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/delete`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
            },
            body: JSON.stringify({ id }),
        });

        const data = await response.json();

        if (!response.ok) {
            if (response.status === 401) {
                handleTokenExpired();
                return;
            }
            showMessage(adminMessage, data.error || '删除失败', true);
            return;
        }

        closeEditModal();
        showMessage(adminMessage, '删除成功！', false);
        // 重新加载数据
        await loadExistingMovies();
        await loadLibraryMovies();
    } catch (error) {
        showMessage(adminMessage, '网络错误，请重试', true);
    }
});

// Token 过期处理
function handleTokenExpired() {
    localStorage.removeItem('adminToken');
    authToken = null;
    loginSection.hidden = false;
    adminSection.hidden = true;
    showMessage(loginError, '登录已过期，请重新登录', true);
    loginError.hidden = false;
}
