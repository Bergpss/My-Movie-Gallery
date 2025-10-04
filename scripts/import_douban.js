#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { stdin, stdout, argv, exit } from 'node:process';
import readline from 'node:readline/promises';

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_LANGUAGE = process.env.TMDB_LANGUAGE || 'zh-CN';
const TMDB_REGION = process.env.TMDB_REGION || 'CN';
const TMDB_SEARCH_MOVIE_URL = 'https://api.themoviedb.org/3/search/movie';
const TMDB_SEARCH_TV_URL = 'https://api.themoviedb.org/3/search/tv';
const TMDB_FIND_URL = 'https://api.themoviedb.org/3/find';

if (!TMDB_API_KEY) {
    console.error('Missing TMDB_API_KEY environment variable.');
    exit(1);
}

const LIBRARY_PATH = resolve(process.cwd(), 'data/library.json');

const args = argv.slice(2);
let inputArg = null;
let limit = null;

args.forEach(arg => {
    if (arg.startsWith('--limit=')) {
        const value = Number(arg.split('=')[1]);
        if (!Number.isNaN(value) && value > 0) {
            limit = value;
        }
    } else if (!inputArg) {
        inputArg = arg;
    }
});

const INPUT_PATH = (() => {
    const arg = inputArg;
    if (!arg) return resolve(process.cwd(), 'fromdouban.json');
    return isAbsolute(arg) ? arg : resolve(process.cwd(), arg);
})();

const rl = readline.createInterface({ input: stdin, output: stdout });

async function prompt(question, { required = false } = {}) {
    const answer = await rl.question(question);
    const trimmed = answer.trim();
    if (required && !trimmed) {
        console.log('不能为空，请重新输入。');
        return prompt(question, { required });
    }
    return trimmed;
}

async function loadJson(path, fallback = null) {
    try {
        const raw = await readFile(path, 'utf-8');
        return JSON.parse(raw);
    } catch (error) {
        if (fallback !== null && error.code === 'ENOENT') {
            return fallback;
        }
        throw error;
    }
}

async function searchMovies(query) {
    const url = new URL(TMDB_SEARCH_MOVIE_URL);
    url.searchParams.set('api_key', TMDB_API_KEY);
    url.searchParams.set('language', TMDB_LANGUAGE);
    url.searchParams.set('region', TMDB_REGION);
    url.searchParams.set('query', query);
    url.searchParams.set('include_adult', 'false');

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`TMDB movie search failed with status ${response.status}`);
    }
    const data = await response.json();
    return Array.isArray(data.results)
        ? data.results.map(item => ({ ...item, media_type: 'movie' }))
        : [];
}

async function searchTv(query) {
    const url = new URL(TMDB_SEARCH_TV_URL);
    url.searchParams.set('api_key', TMDB_API_KEY);
    url.searchParams.set('language', TMDB_LANGUAGE);
    url.searchParams.set('query', query);
    url.searchParams.set('include_adult', 'false');

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`TMDB tv search failed with status ${response.status}`);
    }
    const data = await response.json();
    return Array.isArray(data.results)
        ? data.results.map(item => ({ ...item, media_type: 'tv' }))
        : [];
}

async function searchAll(query) {
    const [movies, tvShows] = await Promise.all([
        searchMovies(query),
        searchTv(query),
    ]);
    return [...movies, ...tvShows].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
}

function summarise(item) {
    const isMovie = item.media_type === 'movie';
    const title = isMovie
        ? (item.title || item.original_title || '未知标题')
        : (item.name || item.original_name || '未知标题');
    const dateSource = isMovie ? item.release_date : item.first_air_date;
    const year = dateSource ? dateSource.slice(0, 4) : '????';
    const overview = item.overview ? item.overview.slice(0, 80).replace(/\s+/g, ' ') : '';
    const label = isMovie ? '电影' : '剧集';
    return `[${label}] ${title} (${year}) - TMDB ID ${item.id}${overview ? `\n    ${overview}…` : ''}`;
}

async function findByImdb(imdbId) {
    if (!imdbId) return null;
    const trimmed = imdbId.trim();
    if (!trimmed) return null;

    const url = new URL(`${TMDB_FIND_URL}/${encodeURIComponent(trimmed)}`);
    url.searchParams.set('api_key', TMDB_API_KEY);
    url.searchParams.set('language', TMDB_LANGUAGE);
    url.searchParams.set('external_source', 'imdb_id');

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`TMDB find failed for ${imdbId} with status ${response.status}`);
    }
    const data = await response.json();

    if (Array.isArray(data.movie_results) && data.movie_results.length) {
        const result = data.movie_results[0];
        return { ...result, media_type: 'movie' };
    }
    if (Array.isArray(data.tv_results) && data.tv_results.length) {
        const result = data.tv_results[0];
        return { ...result, media_type: 'tv' };
    }
    return null;
}

async function chooseMatch(initialQuery, itemIndex, total) {
    let query = initialQuery;
    while (true) {
        const results = await searchAll(query);
        if (!results.length) {
            console.log(`未找到《${query}》，可重新输入关键词或跳过。`);
            const next = await prompt('输入新的搜索词（留空跳过）：');
            if (!next) {
                return null;
            }
            query = next;
            continue;
        }

        const top = results.slice(0, 6);
        console.log(`\n[${itemIndex}] ${initialQuery} —— 请选择匹配 (共 ${total} 条)`);
        top.forEach((item, index) => {
            console.log(`${index + 1}. ${summarise(item)}`);
        });
        if (top.length === 1) {
            console.log('仅有一个候选，已自动选择。');
            return top[0];
        }

        console.log('0. 重新搜索   s. 跳过该影片');
        const choice = await prompt('选择编号：', { required: true });
        if (choice.toLowerCase() === 's') {
            return null;
        }
        if (choice === '0') {
            query = await prompt('新的搜索关键词：', { required: true });
            continue;
        }

        const idx = Number(choice);
        if (!Number.isNaN(idx) && idx >= 1 && idx <= top.length) {
            return top[idx - 1];
        }

        console.log('输入无效，请重试。');
    }
}

function normaliseDate(value) {
    if (!value) {
        return null;
    }
    const iso = new Date(value);
    if (Number.isNaN(iso.getTime())) {
        return null;
    }
    return iso.toISOString().slice(0, 10);
}

function extractDates(entry) {
    if (Array.isArray(entry?.watchDates)) {
        return entry.watchDates;
    }
    if (entry?.watchDate) {
        return [entry.watchDate];
    }
    return [];
}

function mergeDates(existing = [], incoming = []) {
    return Array.from(new Set([...existing, ...incoming].filter(Boolean))).sort((a, b) => b.localeCompare(a));
}

function removeById(list, id) {
    return list.filter(item => String(item.id) !== String(id));
}

async function saveLibrary(library) {
    await writeFile(LIBRARY_PATH, `${JSON.stringify(library, null, 2)}\n`);
    console.log(`\n已更新 ${LIBRARY_PATH}`);
}

async function main() {
    console.log(`读取影片列表：${INPUT_PATH}`);
    const items = await loadJson(INPUT_PATH, []);
    if (!Array.isArray(items) || !items.length) {
        console.log('文件内容为空，操作结束。');
        return;
    }

    const library = await loadJson(LIBRARY_PATH, { watching: [], watched: [], wishlist: [] });
    library.watching = Array.isArray(library.watching) ? library.watching : [];
    library.watched = Array.isArray(library.watched) ? library.watched : [];
    library.wishlist = Array.isArray(library.wishlist) ? library.wishlist : [];

    const updates = [];

    for (let index = 0; index < items.length; index += 1) {
        if (limit && updates.length >= limit) {
            break;
        }
        const item = items[index];
        const title = item?.title?.trim();
        const watchDate = normaliseDate(item?.watch_date || item?.watchDate);
        const imdbId = item?.imdb_id || item?.imdbId || item?.imdb;

        if (!title && !imdbId) {
            console.log(`\n[${index + 1}] 缺少标题或 IMDb ID，已跳过。`);
            continue;
        }

        let match = null;
        if (imdbId) {
            match = await findByImdb(imdbId);
            if (match) {
                console.log(`\n[${index + 1}] 通过 IMDb ${imdbId} 找到：${summarise(match)}`);
            } else {
                console.log(`\n[${index + 1}] 未找到 IMDb ${imdbId}，改用标题搜索。`);
            }
        }

        if (!match) {
            const query = title || imdbId;
            match = await chooseMatch(query, index + 1, items.length);
        }

        if (!match) {
            console.log(`已跳过：${title || imdbId}`);
            continue;
        }

        const mediaType = match.media_type || 'movie';
        const existing = [...library.watching, ...library.watched, ...library.wishlist]
            .find(entry => String(entry.id) === String(match.id));
        const mergedDates = mergeDates(extractDates(existing), watchDate ? [watchDate] : []);

        updates.push({
            id: match.id,
            title: title || (mediaType === 'tv'
                ? (match.name || match.original_name)
                : (match.title || match.original_title)),
            mediaType,
            watchDates: mergedDates,
            status: 'watched',
        });
    }

    if (!updates.length) {
        console.log('没有新增记录。');
        return;
    }

    let watching = [...library.watching];
    let wishlist = [...library.wishlist];
    const watched = [...library.watched];

    updates.forEach(entry => {
        watching = removeById(watching, entry.id);
        wishlist = removeById(wishlist, entry.id);

        const idx = watched.findIndex(item => String(item.id) === String(entry.id));
        if (idx !== -1) {
            const existing = watched[idx];
            const mergedDates = mergeDates(extractDates(existing), entry.watchDates);
            watched[idx] = {
                ...existing,
                mediaType: entry.mediaType || existing.mediaType || 'movie',
                watchDates: mergedDates,
                watchDate: mergedDates[0] || null,
                status: 'watched',
            };
        } else {
            const mergedDates = entry.watchDates;
            watched.unshift({
                id: entry.id,
                title: entry.title,
                mediaType: entry.mediaType || 'movie',
                status: 'watched',
                watchDates: mergedDates,
                watchDate: mergedDates[0] || null,
                note: null,
            });
        }
    });

    const updatedLibrary = {
        watching,
        watched,
        wishlist,
    };

    await saveLibrary(updatedLibrary);

    console.log(`已成功导入 ${updates.length} 条记录。`);
    console.log('请运行 `TMDB_API_KEY="..." node scripts/fetch_movies.js` 以刷新数据。');
}

main()
    .catch(error => {
        console.error('导入失败：', error.message);
        process.exitCode = 1;
    })
    .finally(() => rl.close());
