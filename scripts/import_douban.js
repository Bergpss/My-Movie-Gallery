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
const DOUBAN_IMDB_REGEX = /https?:\/\/www\.imdb\.com\/title\/(tt\d+)/i;

const imdbCache = new Map();
const doubanFailCache = new Set();

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

function parseCsvLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    if (current.length || line.endsWith(',')) {
        values.push(current.trim());
    }
    return values;
}

function parseCsv(raw) {
    const lines = raw.split(/\r?\n/).filter(line => line.trim().length);
    if (!lines.length) {
        return [];
    }
    const headers = parseCsvLine(lines[0]);
    const records = [];
    for (let i = 1; i < lines.length; i += 1) {
        const values = parseCsvLine(lines[i]);
        if (!values.length) {
            continue;
        }
        const record = {};
        headers.forEach((header, index) => {
            record[header] = values[index] ?? '';
        });
        const title = (record['标题'] || record['title'] || '').trim();
        const watchDateRaw = (record['创建时间'] || record['watch_date'] || record['watchDate'] || '').trim();
        const watchDate = watchDateRaw ? watchDateRaw.split(' ')[0] : '';
        const imdb = (record['IMDb'] || record['IMDb链接'] || record['imdb_id'] || record['imdb'] || '').trim();
        const link = (record['链接'] || record['douban_link'] || record['url'] || '').trim();
        const rating = (record['我的评分'] || record['rating'] || '').trim();
        records.push({
            title,
            watch_date: watchDate,
            imdb_id: imdb,
            douban_url: link,
            my_rating: rating,
            __raw: record,
        });
    }
    return records;
}

async function loadEntries(path) {
    try {
        const raw = await readFile(path, 'utf-8');
        const trimmed = raw.trim();
        if (!trimmed) {
            return [];
        }
        if (path.toLowerCase().endsWith('.csv')) {
            return parseCsv(trimmed);
        }
        if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
            try {
                const parsed = JSON.parse(trimmed);
                return Array.isArray(parsed) ? parsed : [];
            } catch (error) {
                console.warn('JSON 解析失败，尝试按 CSV 解析。');
                return parseCsv(trimmed);
            }
        }
        return parseCsv(trimmed);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.warn(`未找到输入文件：${path}`);
            return [];
        }
        throw error;
    }
}

async function loadLibraryData(path, fallback) {
    try {
        const raw = await readFile(path, 'utf-8');
        const parsed = JSON.parse(raw);
        parsed.watching = Array.isArray(parsed.watching) ? parsed.watching : [];
        parsed.watched = Array.isArray(parsed.watched) ? parsed.watched : [];
        parsed.wishlist = Array.isArray(parsed.wishlist) ? parsed.wishlist : [];
        return parsed;
    } catch (error) {
        if (fallback && error.code === 'ENOENT') {
            return JSON.parse(JSON.stringify(fallback));
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

function primaryWatchDate(entry) {
    if (!entry) return null;
    if (entry.watchDate) return entry.watchDate;
    if (Array.isArray(entry.watchDates) && entry.watchDates.length) {
        return entry.watchDates[0];
    }
    return null;
}

function sortByWatchDateDesc(list) {
    return [...list].sort((a, b) => {
        const dateA = primaryWatchDate(a);
        const dateB = primaryWatchDate(b);
        if (dateA && dateB) {
            if (dateA > dateB) return -1;
            if (dateA < dateB) return 1;
        } else if (dateA) {
            return -1;
        } else if (dateB) {
            return 1;
        }
        return (a.title || '').localeCompare(b.title || '');
    });
}

async function saveLibrary(library) {
    await writeFile(LIBRARY_PATH, `${JSON.stringify(library, null, 2)}\n`);
    console.log(`\n已更新 ${LIBRARY_PATH}`);
}

async function fetchImdbFromDouban(url) {
    if (!url || doubanFailCache.has(url)) {
        return null;
    }

    if (imdbCache.has(url)) {
        return imdbCache.get(url);
    }

    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; MyMovieGallery/1.0)'
            }
        });

        if (!response.ok) {
            console.warn(`请求豆瓣页面失败 (${response.status})：${url}`);
            doubanFailCache.add(url);
            return null;
        }

        const html = await response.text();
        const match = html.match(DOUBAN_IMDB_REGEX);
        if (match) {
            const imdbId = match[1];
            imdbCache.set(url, imdbId);
            // 简单限速，避免请求过快
            await new Promise(resolve => setTimeout(resolve, 400));
            return imdbId;
        }

        doubanFailCache.add(url);
        await new Promise(resolve => setTimeout(resolve, 200));
        return null;
    } catch (error) {
        console.warn(`抓取豆瓣页面出错：${url} - ${error.message}`);
        doubanFailCache.add(url);
        return null;
    }
}

async function main() {
    console.log(`读取影片列表：${INPUT_PATH}`);
    const items = await loadEntries(INPUT_PATH);
    if (!Array.isArray(items) || !items.length) {
        console.log('文件内容为空，操作结束。');
        return;
    }

    const library = await loadLibraryData(LIBRARY_PATH, { watching: [], watched: [], wishlist: [] });

    const updates = [];

    for (let index = 0; index < items.length; index += 1) {
        if (limit && updates.length >= limit) {
            break;
        }
        const item = items[index];
        const title = item?.title?.trim();
        const watchDate = normaliseDate(item?.watch_date || item?.watchDate);
        let imdbId = item?.imdb_id || item?.imdbId || item?.imdb;
        const doubanUrl = item?.douban_url || item?.douban || item?.douban_link;

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
        } else if (doubanUrl) {
            const scrapedImdb = await fetchImdbFromDouban(doubanUrl);
            if (scrapedImdb) {
                imdbId = scrapedImdb;
                match = await findByImdb(imdbId);
                if (match) {
                    console.log(`\n[${index + 1}] 通过豆瓣页面找到 IMDb ${imdbId}：${summarise(match)}`);
                } else {
                    console.log(`\n[${index + 1}] IMDb ${imdbId} 未匹配到 TMDB 记录，继续尝试标题搜索。`);
                }
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
        watched: sortByWatchDateDesc(watched),
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
