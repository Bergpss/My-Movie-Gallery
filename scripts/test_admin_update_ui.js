import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const source = await readFile(new URL('../admin.js', import.meta.url), 'utf8');

assert.match(
    source,
    /function applyLocalMovieUpdate\(/,
    'admin.js should define applyLocalMovieUpdate() for immediate library UI updates'
);

const updateSuccessBlock = source.match(/closeEditModal\(\);\s*showMessage\(adminMessage, '更新成功！', false\);[\s\S]*?}\s*catch \(error\)/)?.[0] ?? '';

assert.ok(
    updateSuccessBlock.includes('applyLocalMovieUpdate(updateData);'),
    'successful edits should update allMovies locally before rendering the records list'
);

assert.ok(
    !updateSuccessBlock.includes('await loadLibraryMovies();'),
    'successful edits should not immediately reload stale generated /data/movies.json'
);

console.log('admin update UI regression checks passed');
