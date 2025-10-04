#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stdin, stdout } from 'node:process';
import readline from 'node:readline/promises';

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_LANGUAGE = process.env.TMDB_LANGUAGE || 'zh-CN';
const TMDB_REGION = process.env.TMDB_REGION || 'CN';
const TMDB_SEARCH_MOVIE_URL = 'https://api.themoviedb.org/3/search/movie';
const TMDB_SEARCH_TV_URL = 'https://api.themoviedb.org/3/search/tv';

const LIBRARY_PATH = resolve(process.cwd(), 'data/library.json');

if (!TMDB_API_KEY) {
    console.error('Missing TMDB_API_KEY environment variable.');
    process.exit(1);
}

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

async function searchTmdb(query) {
    const movieUrl = new URL(TMDB_SEARCH_MOVIE_URL);
    movieUrl.searchParams.set('api_key', TMDB_API_KEY);
    movieUrl.searchParams.set('language', TMDB_LANGUAGE);
    movieUrl.searchParams.set('region', TMDB_REGION);
    movieUrl.searchParams.set('query', query);
    movieUrl.searchParams.set('include_adult', 'false');

    const tvUrl = new URL(TMDB_SEARCH_TV_URL);
    tvUrl.searchParams.set('api_key', TMDB_API_KEY);
    tvUrl.searchParams.set('language', TMDB_LANGUAGE);
    tvUrl.searchParams.set('query', query);
    tvUrl.searchParams.set('include_adult', 'false');

    const [movieResp, tvResp] = await Promise.all([fetch(movieUrl), fetch(tvUrl)]);

    if (!movieResp.ok) {
        throw new Error(`TMDB movie search failed with status ${movieResp.status}`);
    }
    if (!tvResp.ok) {
        throw new Error(`TMDB tv search failed with status ${tvResp.status}`);
    }

    const [movieData, tvData] = await Promise.all([movieResp.json(), tvResp.json()]);

    const movies = Array.isArray(movieData.results)
        ? movieData.results.map(item => ({ ...item, media_type: 'movie' }))
        : [];
    const tvShows = Array.isArray(tvData.results)
        ? tvData.results.map(item => ({ ...item, media_type: 'tv' }))
        : [];

    return [...movies, ...tvShows].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
}

function summariseResult(item) {
    const isMovie = item.media_type === 'movie';
    const title = isMovie
        ? (item.title || item.original_title || '未知标题')
        : (item.name || item.original_name || '未知标题');
    const yearSource = isMovie ? item.release_date : item.first_air_date;
    const year = yearSource ? yearSource.slice(0, 4) : '????';
    const overview = item.overview ? item.overview.slice(0, 60).replace(/\s+/g, ' ') : '';
    const label = isMovie ? '电影' : '剧集';
    return `[${label}] ${title} (${year}) - TMDB ID ${item.id}${overview ? `\n    ${overview}…` : ''}`;
}

async function chooseResult(results) {
    if (!results.length) {
        console.log('未找到匹配的条目，请尝试其他关键词。');
        return null;
    }

    const top = results.slice(0, 8);
    console.log('\n搜索结果：');
    top.forEach((item, index) => {
        console.log(`${index + 1}. ${summariseResult(item)}`);
    });
    console.log('0. 重新输入关键字');

    const choice = await prompt('请选择编号：', { required: true });
    const idx = Number(choice);

    if (Number.isNaN(idx) || idx < 0 || idx > top.length) {
        console.log('输入无效，请重新尝试。');
        return chooseResult(results);
    }

    if (idx === 0) {
        return null;
    }

    return top[idx - 1];
}

function normaliseStatus(input) {
    const map = {
        '1': 'watching',
        'watching': 'watching',
        '正在看': 'watching',
        '2': 'watched',
        'watched': 'watched',
        '已看过': 'watched',
        '已看完': 'watched',
        '3': 'wishlist',
        'wishlist': 'wishlist',
        '想看': 'wishlist',
        'planned': 'wishlist',
    };
    return map[input.trim().toLowerCase()] || null;
}

async function loadLibrary() {
    try {
        const raw = await readFile(LIBRARY_PATH, 'utf-8');
        const parsed = JSON.parse(raw);
        parsed.watching = Array.isArray(parsed.watching) ? parsed.watching : [];
        parsed.watched = Array.isArray(parsed.watched) ? parsed.watched : [];
        parsed.wishlist = Array.isArray(parsed.wishlist) ? parsed.wishlist : [];
        return parsed;
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

function mergeEntry(existing, incoming) {
    const merged = { ...incoming };

    if (existing) {
        if ((!merged.note || merged.note === null) && existing.note) {
            merged.note = existing.note;
        }
        if (typeof merged.rating !== 'number' && typeof existing.rating === 'number') {
            merged.rating = existing.rating;
        }
        if (!merged.mediaType && existing.mediaType) {
            merged.mediaType = existing.mediaType;
        }
        const existingDates = Array.isArray(existing.watchDates)
            ? existing.watchDates
            : existing.watchDate
                ? [existing.watchDate]
                : [];
        const incomingDates = Array.isArray(merged.watchDates)
            ? merged.watchDates
            : merged.watchDate
                ? [merged.watchDate]
                : [];
        const mergedDates = Array.from(new Set([...existingDates, ...incomingDates].filter(Boolean)))
            .sort((a, b) => b.localeCompare(a));
        if (mergedDates.length) {
            merged.watchDates = mergedDates;
            merged.watchDate = mergedDates[0];
        }
        if (!merged.status && existing.status) {
            merged.status = existing.status;
        }
    }

    delete merged.watchDate;
    return merged;
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
    Object.values(buckets).forEach(list => {
        const index = list.findIndex(item => String(item.id) === String(entry.id));
        if (index !== -1) {
            existingEntry = list[index];
            list.splice(index, 1);
        }
    });

    const mergedEntry = mergeEntry(existingEntry, entry);
    const target = buckets[mergedEntry.status || entry.status || 'watching'];
    target.unshift(mergedEntry);
}

async function main() {
    console.log('=== 添加影片到观影清单 ===');

    const titleInput = await prompt('影片名称（中文）：', { required: true });

    let results = await searchTmdb(titleInput);
    let chosen = await chooseResult(results);

    while (!chosen) {
        const retry = await prompt('请输入新的搜索关键词（或留空取消）：');
        if (!retry) {
            console.log('操作已取消。');
            return;
        }
        results = await searchTmdb(retry);
        chosen = await chooseResult(results);
    }

    const chosenTitle = chosen.media_type === 'tv'
        ? (chosen.name || chosen.original_name)
        : (chosen.title || chosen.original_title);
    console.log(`已选择：${chosenTitle} (TMDB ID ${chosen.id})`);

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
        if (existing && existing.watchDates?.length) {
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
        title: titleInput || chosenTitle,
        mediaType: chosen.media_type || 'movie',
        status,
        note: note || null,
        watchDates: watchDates.length ? watchDates : undefined,
    };

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
