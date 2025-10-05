#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stdin, stdout } from 'node:process';
import readline from 'node:readline/promises';

const LIBRARY_PATH = resolve(process.cwd(), 'data/library.json');

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
    console.log(`\n已更新 ${LIBRARY_PATH}`);
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

function dedupeDates(existing = [], incoming = []) {
    return Array.from(new Set([...existing, ...incoming].filter(Boolean))).sort((a, b) => b.localeCompare(a));
}

function displayWatching(list) {
    console.log('\n当前正在看的影片：');
    list.forEach((movie, index) => {
        const dates = Array.isArray(movie.watchDates) ? movie.watchDates : movie.watchDate ? [movie.watchDate] : [];
        const note = movie.note ? ` | 备注：${movie.note}` : '';
        console.log(`${index + 1}. ${movie.title || '(未命名)'}${dates.length ? ` | 已记录观影：${dates.join(', ')}` : ''}${note}`);
    });
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

async function main() {
    const library = await loadLibrary();
    const watching = library.watching;

    if (!watching.length) {
        console.log('没有“正在看”的记录。');
        return;
    }

    displayWatching(watching);
    const choice = await prompt('\n输入要标记为“已看过”的编号（支持逗号分隔，0 取消）：', { required: true });

    if (choice === '0') {
        console.log('已取消。');
        return;
    }

    const indexes = choice
        .split(/[,，\s]+/)
        .map(Number)
        .filter(n => Number.isInteger(n) && n > 0 && n <= watching.length);

    if (!indexes.length) {
        console.log('未选择任何有效编号，操作结束。');
        return;
    }

    const today = new Date().toISOString().slice(0, 10);
    let defaultDate = await prompt(`观影日期（默认 ${today}，可留空使用默认）：`);
    defaultDate = normaliseDate(defaultDate || today);
    if (!defaultDate) {
        console.log('日期格式无效，已使用今天。');
        defaultDate = today;
    }

    const applySameRating = await prompt('是否要统一填写评分？(y/N)：');
    let sharedRating = null;
    if (/^y(es)?$/i.test(applySameRating)) {
        const ratingInput = await prompt('评分（0-10，可留空）：');
        if (ratingInput) {
            const numeric = Number(ratingInput);
            if (!Number.isNaN(numeric) && numeric >= 0 && numeric <= 10) {
                sharedRating = numeric;
            } else {
                console.log('评分超出有效范围，已忽略。');
            }
        }
    }

    const updatedWatched = [...library.watched];
    let updatedWatching = [...library.watching];

    for (const index of indexes) {
        const movie = watching[index - 1];
        if (!movie) continue;

        const existingDates = extractExistingDates(movie);
        const dates = dedupeDates(existingDates, [defaultDate]);

        const newEntry = {
            ...movie,
            status: 'watched',
            watchDates: dates,
            watchDate: dates[0] ?? null,
        };

        if (sharedRating !== null) {
            newEntry.rating = sharedRating;
        }

        updatedWatching = removeById(updatedWatching, movie.id);
        const filteredWatched = removeById(updatedWatched, movie.id);
        updatedWatched.length = 0;
        updatedWatched.push({ ...newEntry });
        updatedWatched.push(...filteredWatched);
    }

    library.watching = updatedWatching;
    library.watched = sortByWatchDateDesc(updatedWatched);

    await saveLibrary(library);

    console.log('请运行 `TMDB_API_KEY="..." node scripts/fetch_movies.js` 以刷新数据。');
}

main()
    .catch(error => {
        console.error('操作失败：', error.message);
        process.exitCode = 1;
    })
    .finally(() => rl.close());
