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


assert.match(
    source,
    /syncWatchEndDateAndStatus/,
    'admin.js should use syncWatchEndDateAndStatus to keep edit status and end date aligned'
);

assert.match(
    source,
    /function syncEditWatchFields\(/,
    'admin.js should define syncEditWatchFields() for the edit form'
);

assert.match(
    source,
    /editEndDate\.addEventListener\('input',\s*\(\)\s*=>\s*\{\s*syncEditWatchFields\('endDate'\);/,
    'filling or changing the edit end date should immediately sync status'
);

assert.match(
    source,
    /editEndDate\.addEventListener\('change',\s*\(\)\s*=>\s*\{\s*syncEditWatchFields\('endDate'\);/,
    'clearing or confirming the edit end date should sync status'
);

assert.match(
    source,
    /getElementById\('edit-status'\)\.addEventListener\('change',\s*\(\)\s*=>\s*\{\s*syncEditWatchFields\('status'\);/,
    'changing the edit status should sync the end date'
);

const openEditModal = source.match(/async function openEditModal\([\s\S]*?^}/m)?.[0] ?? '';
assert.ok(
    openEditModal.includes("syncEditWatchFields('load')"),
    'opening the edit form should reconcile a filled end date with watched status'
);

const editSubmit = source.match(/editForm\.addEventListener\('submit',[\s\S]*?mustSeeInCinema:/)?.[0] ?? '';
assert.ok(
    editSubmit.includes("syncEditWatchFields('save')"),
    'saving the edit form should reconcile status and end date before submit'
);
assert.ok(
    editSubmit.includes('watchEndDate: isWishlist ? null : synced.watchEndDate'),
    'saved end date should come from the reconciled edit fields'
);

console.log('admin update UI regression checks passed');
