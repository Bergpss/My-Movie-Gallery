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
        return JSON.parse(raw);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { watching: [], watched: [], wishlist: [] };
        }
        throw error;
    }
}

async function saveLibrary(data) {
    await writeFile(LIBRARY_PATH, `${JSON.stringify(data, null, 2)}\n`);
}

function generateId(platform, title) {
    const timestamp = Date.now();
    const sanitizedTitle = title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '-').substring(0, 20);
    return `${platform}-${sanitizedTitle}-${timestamp}`;
}

const PLATFORMS = {
    '1': { name: 'bilibili', label: 'B站' },
    '2': { name: 'youtube', label: 'YouTube' },
    '3': { name: 'iqiyi', label: '爱奇艺' },
    '4': { name: 'tencent', label: '腾讯视频' },
    '5': { name: 'youku', label: '优酷' },
    '6': { name: 'other', label: '其他' },
};

async function main() {
    console.log('=== 添加网络视频 ===\n');

    const title = await prompt('视频标题：', { required: true });

    console.log('\n选择平台：');
    Object.entries(PLATFORMS).forEach(([key, { label }]) => {
        console.log(`  ${key}. ${label}`);
    });
    const platformChoice = await prompt('请选择（1-6）：', { required: true });
    const platformInfo = PLATFORMS[platformChoice];

    if (!platformInfo) {
        console.error('无效的平台选择！');
        process.exit(1);
    }

    const url = await prompt('视频链接：', { required: true });
    const coverUrl = await prompt('封面图片链接：');
    const creator = await prompt('创作者/UP主：');
    const duration = await prompt('视频时长（如 01:23:45）：');

    console.log('\n状态：');
    console.log('  1. 正在看 (watching)');
    console.log('  2. 已看完 (watched)');
    console.log('  3. 想看 (wishlist)');
    const statusChoice = await prompt('请选择（1-3，默认1）：') || '1';

    const statusMap = {
        '1': 'watching',
        '2': 'watched',
        '3': 'wishlist',
    };
    const status = statusMap[statusChoice] || 'watching';

    let watchDate = null;
    let rating = null;
    if (status === 'watched') {
        watchDate = await prompt('观看日期（YYYY-MM-DD）：');
        const ratingInput = await prompt('评分（0-10）：');
        rating = ratingInput ? Number.parseFloat(ratingInput) : null;
    }

    const note = await prompt('备注：');

    const id = generateId(platformInfo.name, title);

    const entry = {
        id,
        title,
        mediaType: 'web-video',
        platform: platformInfo.name,
        url,
        coverUrl: coverUrl || null,
        creator: creator || null,
        duration: duration || null,
        status,
        note: note || null,
    };

    if (status === 'watched' && watchDate) {
        entry.watchDates = [watchDate];
        entry.watchDate = watchDate;
    }
    if (rating !== null) {
        entry.rating = rating;
    }

    const library = await loadLibrary();
    const listKey = status === 'watched' ? 'watched' : status === 'wishlist' ? 'wishlist' : 'watching';

    if (!Array.isArray(library[listKey])) {
        library[listKey] = [];
    }

    library[listKey].unshift(entry);

    await saveLibrary(library);

    console.log('\n✓ 已添加网络视频：');
    console.log(`  ID: ${entry.id}`);
    console.log(`  标题: ${entry.title}`);
    console.log(`  平台: ${platformInfo.label}`);
    console.log(`  状态: ${status}`);
    console.log('\n请运行以下命令生成 movies.json:');
    console.log('  node scripts/fetch_movies.js');

    rl.close();
}

main().catch(error => {
    console.error('错误：', error.message);
    process.exitCode = 1;
    rl.close();
});
