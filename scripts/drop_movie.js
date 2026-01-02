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
        parsed.dropped = Array.isArray(parsed.dropped) ? parsed.dropped : [];
        return parsed;
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { watching: [], watched: [], wishlist: [], dropped: [] };
        }
        throw error;
    }
}

async function saveLibrary(library) {
    await writeFile(LIBRARY_PATH, `${JSON.stringify(library, null, 2)}\n`);
    console.log(`\n已更新 ${LIBRARY_PATH}`);
}

function displayWatching(list) {
    console.log('\n当前正在看的影片：');
    list.forEach((movie, index) => {
        const note = movie.note ? ` | 备注：${movie.note}` : '';
        console.log(`${index + 1}. ${movie.title || '(未命名)'}${note}`);
    });
}

function removeById(list, id) {
    return list.filter(item => String(item.id) !== String(id));
}

async function main() {
    const library = await loadLibrary();
    const watching = library.watching;

    if (!watching.length) {
        console.log('没有"正在看"的记录。');
        return;
    }

    displayWatching(watching);
    const choice = await prompt('\n输入要标记为"弃剧"的编号（支持逗号分隔，0 取消）：', { required: true });

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

    const reason = await prompt('弃剧原因（可留空）：');

    const updatedDropped = [...library.dropped];
    let updatedWatching = [...library.watching];

    for (const index of indexes) {
        const movie = watching[index - 1];
        if (!movie) continue;

        const newEntry = {
            ...movie,
            status: 'dropped',
            droppedDate: new Date().toISOString().slice(0, 10),
        };

        if (reason) {
            newEntry.note = reason;
        }

        updatedWatching = removeById(updatedWatching, movie.id);
        const filteredDropped = removeById(updatedDropped, movie.id);
        updatedDropped.length = 0;
        updatedDropped.push({ ...newEntry });
        updatedDropped.push(...filteredDropped);

        console.log(`✓ 已将《${movie.title}》标记为弃剧`);
    }

    library.watching = updatedWatching;
    library.dropped = updatedDropped;

    await saveLibrary(library);

    console.log('请运行 `TMDB_API_KEY="..." node scripts/fetch_movies.js` 以刷新数据。');
}

main()
    .catch(error => {
        console.error('操作失败：', error.message);
        process.exitCode = 1;
    })
    .finally(() => rl.close());
