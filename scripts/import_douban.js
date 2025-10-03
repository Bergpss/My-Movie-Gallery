#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { stdin, stdout, argv, exit } from 'node:process';
import readline from 'node:readline/promises';

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_LANGUAGE = process.env.TMDB_LANGUAGE || 'zh-CN';
const TMDB_REGION = process.env.TMDB_REGION || 'CN';
const TMDB_SEARCH_URL = 'https://api.themoviedb.org/3/search/movie';

if (!TMDB_API_KEY) {
    console.error('Missing TMDB_API_KEY environment variable.');
    exit(1);
}

const LIBRARY_PATH = resolve(process.cwd(), 'data/library.json');
const INPUT_PATH = (() => {
    const argPath = argv[2];
    if (!argPath) {
        return resolve(process.cwd(), 'fromdouban.json');
    }
    return isAbsolute(argPath) ? argPath : resolve(process.cwd(), argPath);
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

async function searchMovie(query) {
    const url = new URL(TMDB_SEARCH_URL);
    url.searchParams.set('api_key', TMDB_API_KEY);
    url.searchParams.set('language', TMDB_LANGUAGE);
    url.searchParams.set('region', TMDB_REGION);
    url.searchParams.set('query', query);
    url.searchParams.set('include_adult', 'false');

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`TMDB search failed with status ${response.status}`);
    }

    const data = await response.json();
    return Array.isArray(data.results) ? data.results : [];
}

function summariseMovie(movie) {
    const title = movie.title || movie.original_title || '未知标题';
    const release = movie.release_date ? movie.release_date.slice(0, 4) : '????';
    const overview = movie.overview ? movie.overview.slice(0, 80).replace(/\s+/g, ' ') : '';
    return `${title} (${release}) - TMDB ID ${movie.id}${overview ? `\n    ${overview}…` : ''}`;
}

async function chooseMatch(initialQuery, itemIndex, total) {
    let query = initialQuery;
    while (true) {
        const results = await searchMovie(query);
        if (results.length === 0) {
            console.log(`未找到《${query}》，可重新输入关键词或跳过。`);
            const next = await prompt('输入新的搜索词（留空跳过）：');
            if (!next) {
                return null;
            }
            query = next;
            continue;
        }

        const top = results.slice(0, 5);
        console.log(`\n[${itemIndex}] ${initialQuery} —— 请选择匹配 (共 ${total} 条)`);
        top.forEach((movie, index) => {
            console.log(`${index + 1}. ${summariseMovie(movie)}`);
        });
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

function extractExistingDates(movie) {
    if (Array.isArray(movie.watchDates)) {
        return movie.watchDates;
    }
    if (movie.watchDate) {
        return [movie.watchDate];
    }
    return [];
}

function dedupeDates(existing = [], incoming = []) {
    return Array.from(new Set([...existing, ...incoming].filter(Boolean))).sort((a, b) => b.localeCompare(a));
}

function removeById(list, id) {
    return list.filter(item => String(item.id) !== String(id));
}

async function main() {
    console.log(`读取影片列表：${INPUT_PATH}`);
    const items = await loadJson(INPUT_PATH, []);
    if (!Array.isArray(items) || items.length === 0) {
        console.log('文件内容为空，操作结束。');
        return;
    }

    const library = await loadJson(LIBRARY_PATH, { watching: [], watched: [], wishlist: [] });
    library.watching = Array.isArray(library.watching) ? library.watching : [];
    library.watched = Array.isArray(library.watched) ? library.watched : [];
    library.wishlist = Array.isArray(library.wishlist) ? library.wishlist : [];

    const updates = [];

    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const title = item?.title?.trim();
        const watchDateInput = item?.watch_date || item?.watchDate;
        const watchDate = normaliseDate(watchDateInput);

        if (!title) {
            console.log(`\n[${index + 1}] 缺少标题，已跳过。`);
            continue;
        }

        const match = await chooseMatch(title, index + 1, items.length);
        if (!match) {
            console.log(`已跳过：${title}`);
            continue;
        }

        const existing = [...library.watching, ...library.watched, ...library.wishlist]
            .find(entry => String(entry.id) === String(match.id));
        const existingDates = existing ? extractExistingDates(existing) : [];
        const mergedDates = dedupeDates(existingDates, watchDate ? [watchDate] : []);

        updates.push({
            id: match.id,
            title,
            watchDates: mergedDates,
            watchDate: mergedDates[0] ?? watchDate ?? null,
            status: 'watched',
        });
    }

    if (!updates.length) {
        console.log('没有新增记录。');
        return;
    }

    let watched = [...library.watched];
    let watching = [...library.watching];
    let wishlist = [...library.wishlist];

    updates.forEach(entry => {
        watching = removeById(watching, entry.id);
        wishlist = removeById(wishlist, entry.id);
        const existingIndex = watched.findIndex(item => String(item.id) === String(entry.id));
        if (existingIndex !== -1) {
            const existing = watched[existingIndex];
            const mergedDates = dedupeDates(extractExistingDates(existing), entry.watchDates);
            watched[existingIndex] = {
                ...existing,
                watchDates: mergedDates,
                watchDate: mergedDates[0] ?? null,
                status: 'watched',
            };
        } else {
            watched.unshift({
                id: entry.id,
                title: entry.title,
                status: 'watched',
                watchDates: entry.watchDates,
                watchDate: entry.watchDates[0] ?? null,
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
