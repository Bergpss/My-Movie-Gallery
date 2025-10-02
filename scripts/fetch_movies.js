#!/usr/bin/env node
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const LIST_ID = process.env.TMDB_LIST_ID || '8520430';
const LANGUAGE = process.env.TMDB_LANGUAGE || 'zh-CN';
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

async function main() {
    if (!TMDB_API_KEY) {
        console.error('Missing TMDB_API_KEY environment variable');
        process.exitCode = 1;
        return;
    }

    const outputPath = resolve(process.cwd(), 'data/movies.json');
    const url = `${TMDB_BASE_URL}/list/${LIST_ID}?language=${LANGUAGE}&api_key=${TMDB_API_KEY}`;

    console.log(`Fetching list ${LIST_ID} from TMDB...`);
    const response = await fetch(url);

    if (!response.ok) {
        console.error(`TMDB request failed with status ${response.status}`);
        process.exitCode = 1;
        return;
    }

    const data = await response.json();
    const payload = {
        generatedAt: new Date().toISOString(),
        source: {
            listId: LIST_ID,
            language: LANGUAGE,
        },
        items: data.items ?? [],
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(payload, null, 2));
    console.log(`Wrote ${payload.items.length} items to ${outputPath}`);
}

main().catch((error) => {
    console.error('Failed to fetch movies:', error);
    process.exitCode = 1;
});
