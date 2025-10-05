#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, isAbsolute, dirname } from 'node:path';
import { argv, exit } from 'node:process';

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const DOUBAN_IMDB_REGEX = /https?:\/\/www\.imdb\.com\/title\/(tt\d+)/i;
const USER_AGENT = 'Mozilla/5.0 (compatible; MyMovieGallery-Douban/1.0)';

if (!TMDB_API_KEY) {
    console.error('Missing TMDB_API_KEY environment variable.');
    exit(1);
}

const args = argv.slice(2);
let inputArg = null;
let outputArg = null;
let limit = null;

args.forEach(arg => {
    if (arg.startsWith('--output=')) {
        outputArg = arg.replace('--output=', '').trim();
    } else if (arg.startsWith('--limit=')) {
        const value = Number(arg.replace('--limit=', ''));
        if (!Number.isNaN(value) && value > 0) {
            limit = value;
        }
    } else if (!inputArg) {
        inputArg = arg;
    }
});

const INPUT_PATH = (() => {
    const defaultPath = 'data/豆伴(180354423).csv';
    const target = inputArg || defaultPath;
    return isAbsolute(target) ? target : resolve(process.cwd(), target);
})();

const OUTPUT_PATH = (() => {
    const defaultPath = 'fromdouban.json';
    const target = outputArg || defaultPath;
    return isAbsolute(target) ? target : resolve(process.cwd(), target);
})();

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
        if (!values.length) continue;
        const record = {};
        headers.forEach((header, index) => {
            record[header.trim()] = values[index] ?? '';
        });
        const title = (record['标题'] || record['title'] || '').trim();
        const watchDateRaw = (record['创建时间'] || record['watch_date'] || record['watchDate'] || '').trim();
        const watchDate = watchDateRaw ? watchDateRaw.split(' ')[0] : '';
        const imdb = (record['IMDb'] || record['IMDb链接'] || record['imdb_id'] || record['imdb'] || '').trim();
        const doubanUrl = (record['链接'] || record['douban_link'] || record['url'] || '').trim();
        const note = (record['评论'] || record['note'] || '').trim();
        const rating = (record['我的评分'] || record['rating'] || '').trim();
        records.push({
            title,
            watch_date: watchDate,
            imdb_id: imdb,
            douban_url: doubanUrl,
            note,
            my_rating: rating,
        });
    }
    return records;
}

async function loadEntries(path) {
    let raw;
    try {
        raw = await readFile(path, 'utf-8');
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.error(`File not found: ${path}`);
            return [];
        }
        throw error;
    }
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (path.toLowerCase().endsWith('.csv')) {
        return parseCsv(trimmed);
    }
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
            const parsed = JSON.parse(trimmed);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
            console.warn('JSON parse failed, attempting CSV parsing instead.');
            return parseCsv(trimmed);
        }
    }
    return parseCsv(trimmed);
}

const imdbCache = new Map();
const failCache = new Set();

async function fetchImdbFromDouban(url) {
    if (!url || failCache.has(url)) {
        return null;
    }
    if (imdbCache.has(url)) {
        return imdbCache.get(url);
    }
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': USER_AGENT,
            },
        });
        if (!response.ok) {
            console.warn(`豆瓣页面请求失败 (${response.status}): ${url}`);
            failCache.add(url);
            return null;
        }
        const html = await response.text();
        const match = html.match(DOUBAN_IMDB_REGEX);
        if (match) {
            const imdbId = match[1];
            imdbCache.set(url, imdbId);
            await new Promise(resolve => setTimeout(resolve, 400));
            return imdbId;
        }
        failCache.add(url);
        await new Promise(resolve => setTimeout(resolve, 200));
        return null;
    } catch (error) {
        console.warn(`抓取豆瓣页面出错：${url} - ${error.message}`);
        failCache.add(url);
        return null;
    }
}

async function main() {
    console.log(`读取影片列表：${INPUT_PATH}`);
    const entries = await loadEntries(INPUT_PATH);
    if (!entries.length) {
        console.log('未读取到任何数据。');
        return;
    }

    const results = [];
    for (let index = 0; index < entries.length; index += 1) {
        if (limit && results.length >= limit) {
            break;
        }
        const item = entries[index];
        const title = (item.title || '').trim();
        if (!title) {
            console.log(`\n[${index + 1}] 缺少标题，已跳过。`);
            continue;
        }

        let imdbId = item.imdb_id?.trim();
        if (!imdbId && item.douban_url) {
            console.log(`\n[${index + 1}] ${title} —— 正在尝试从豆瓣页面获取 IMDb ...`);
            imdbId = await fetchImdbFromDouban(item.douban_url);
            if (imdbId) {
                console.log(`找到 IMDb: ${imdbId}`);
            } else {
                console.log('未找到 IMDb ID。');
            }
        }

        results.push({
            title,
            watch_date: item.watch_date || '',
            imdb_id: imdbId || null,
            douban_url: item.douban_url || null,
            note: item.note || null,
            my_rating: item.my_rating || null,
        });
    }

    const outputDir = dirname(OUTPUT_PATH);
    await mkdir(outputDir, { recursive: true });
    await writeFile(OUTPUT_PATH, `${JSON.stringify(results, null, 2)}\n`);

    console.log(`已写入 ${results.length} 条记录到 ${OUTPUT_PATH}`);
}

main()
    .catch(error => {
        console.error('转换失败：', error.message);
        process.exitCode = 1;
    });
