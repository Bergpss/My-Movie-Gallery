#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stdin, stdout } from 'node:process';
import readline from 'node:readline/promises';

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_LANGUAGE = process.env.TMDB_LANGUAGE || 'zh-CN';
const TMDB_REGION = process.env.TMDB_REGION || 'CN';
const TMDB_SEARCH_URL = 'https://api.themoviedb.org/3/search/movie';

const LIBRARY_PATH = resolve(process.cwd(), 'data/library.json');

if (!TMDB_API_KEY) {
    console.error('Missing TMDB_API_KEY environment variable.');
    process.exit(1);
}

const rl = readline.createInterface({ input: stdin, output: stdout });

async function prompt(question, options = {}) {
    const answer = await rl.question(question);
    if (!answer && options.required) {
        console.log('不能为空，请重新输入。');
        return prompt(question, options);
    }
    return answer.trim();
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
    const overview = movie.overview ? movie.overview.slice(0, 60).replace(/\s+/g, ' ') : '';
    return `${title} (${release}) - TMDB ID ${movie.id}${overview ? `\n    ${overview}…` : ''}`;
}

async function chooseMovie(results) {
    if (results.length === 0) {
        console.log('未找到匹配的影片，请尝试其他关键词。');
        return null;
    }

    const top = results.slice(0, 5);
    console.log('\n搜索结果：');
    top.forEach((movie, index) => {
        console.log(`${index + 1}. ${summariseMovie(movie)}`);
    });
    console.log('0. 重新搜索');

    const choice = await prompt('请选择影片编号：', { required: true });
    const idx = Number(choice);

    if (Number.isNaN(idx) || idx < 0 || idx > top.length) {
        console.log('输入无效，请重新选择。');
        return chooseMovie(results);
    }

    if (idx === 0) {
        return null;
    }

    return top[idx - 1];
}

function normaliseStatus(input) {
    const map = {
        '1': 'watching',
        '正在看': 'watching',
        'watching': 'watching',
        '2': 'watched',
        '已看过': 'watched',
        '已看完': 'watched',
        'watched': 'watched',
        '3': 'wishlist',
        '想看': 'wishlist',
        'wishlist': 'wishlist',
        'planned': 'wishlist'
    };
    return map[input.trim()] || null;
}

async function loadLibrary() {
    try {
        const raw = await readFile(LIBRARY_PATH, 'utf-8');
        return JSON.parse(raw);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { watching: [], watched: [], wishlist: [] };
        }
        throw error;
    }
}

async function saveLibrary(library) {
    await writeFile(LIBRARY_PATH, `${JSON.stringify(library, null, 2)}\n`);
    console.log(`已更新 ${LIBRARY_PATH}`);
}

function normaliseDateInput(value) {
    if (!value) {
        return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const iso = new Date(trimmed);
    if (Number.isNaN(iso.getTime())) {
        return null;
    }

    return iso.toISOString().slice(0, 10);
}

function parseWatchDates(raw) {
    if (!raw) {
        return [];
    }

    const parts = raw
        .split(/[,，\s]+/)
        .map(normaliseDateInput)
        .filter(Boolean);

    return Array.from(new Set(parts)).sort((a, b) => b.localeCompare(a));
}

function flattenLists(library) {
    return [
        ...(Array.isArray(library.watching) ? library.watching : []),
        ...(Array.isArray(library.watched) ? library.watched : []),
        ...(Array.isArray(library.wishlist) ? library.wishlist : []),
    ];
}

function insertEntry(library, entry) {
    const buckets = {
        watching: library.watching,
        watched: library.watched,
        wishlist: library.wishlist,
    };

    if (!buckets[entry.status]) {
        buckets[entry.status] = library[entry.status] = [];
    }

    let existingEntry = null;
    const allLists = Object.values(buckets);
    for (const list of allLists) {
        const index = list.findIndex(item => String(item.id) === String(entry.id));
        if (index !== -1) {
            existingEntry = list[index];
            list.splice(index, 1);
        }
    }

    if (existingEntry) {
        if ((!entry.note || entry.note === null) && existingEntry.note) {
            entry.note = existingEntry.note;
        }

        if (typeof entry.rating !== 'number' && typeof existingEntry.rating === 'number') {
            entry.rating = existingEntry.rating;
        }

        const existingDates = Array.isArray(existingEntry.watchDates)
            ? existingEntry.watchDates
            : existingEntry.watchDate
                ? [existingEntry.watchDate]
                : [];
        const incomingDates = Array.isArray(entry.watchDates)
            ? entry.watchDates
            : entry.watchDate
                ? [entry.watchDate]
                : [];

        const mergedDates = Array.from(new Set([...existingDates, ...incomingDates].filter(Boolean)))
            .sort((a, b) => b.localeCompare(a));

        if (mergedDates.length > 0) {
            entry.watchDates = mergedDates;
        }

        if (!entry.status && existingEntry.status) {
            entry.status = existingEntry.status;
        }
    }

    delete entry.watchDate;

    const target = buckets[entry.status];
    target.unshift(entry);
}

async function main() {
    console.log('=== 添加影片到观影清单 ===');

    const titleInput = await prompt('影片名称（中文）：', { required: true });

    let results = await searchMovie(titleInput);
    let chosen = await chooseMovie(results);

    while (!chosen) {
        const retry = await prompt('请输入新的搜索关键词（或留空取消）：');
        if (!retry) {
            console.log('操作已取消。');
            return;
        }
        results = await searchMovie(retry);
        chosen = await chooseMovie(results);
    }

    console.log(`已选择：${chosen.title || chosen.original_title} (TMDB ID ${chosen.id})`);

    let status;
    while (!status) {
        const statusInput = await prompt('状态（1=正在看，2=已看过，3=想看）：', { required: true });
        status = normaliseStatus(statusInput);
        if (!status) {
            console.log('无法识别的状态，请输入 1/2/3 或 对应中文。');
        }
    }

    const library = await loadLibrary();

    const existing = flattenLists(library).find(item => String(item.id) === String(chosen.id));

    let watchDates = [];
    if (status === 'watched') {
        if (existing && existing.watchDates && existing.watchDates.length) {
            console.log(`当前已记录的观影日期：${existing.watchDates.join(', ')}`);
        }

        const dateInput = await prompt('观影日期（YYYY-MM-DD，可输入多个，使用逗号分隔，留空则不记录）：');
        watchDates = parseWatchDates(dateInput);
    }

    const note = await prompt('备注（可留空）：');
    const ratingInput = status === 'watched'
        ? await prompt('评分（0-10，可留空）：')
        : '';

    let rating = null;
    if (ratingInput) {
        const numeric = Number(ratingInput);
        if (!Number.isNaN(numeric) && numeric >= 0 && numeric <= 10) {
            rating = numeric;
        } else {
            console.log('评分无效，已忽略。');
        }
    }

    const entry = {
        id: chosen.id,
        title: titleInput || chosen.title || chosen.original_title,
        status,
        note: note || null,
    };

    if (watchDates.length > 0) {
        entry.watchDates = watchDates;
    }

    if (rating !== null) {
        entry.rating = rating;
    }

    insertEntry(library, entry);

    await saveLibrary(library);

    console.log('\n完成！下一步：');
    console.log('1. 运行 TMDB_API_KEY="..." node scripts/fetch_movies.js 生成最新数据');
    console.log('2. 部署或提交更新后的 data/ 目录');
}

main()
    .catch(error => {
        console.error('添加影片失败：', error.message);
        process.exitCode = 1;
    })
    .finally(() => rl.close());
