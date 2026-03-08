# My Movie Gallery

[中文说明](./README.zh-CN.md)

My Movie Gallery is a static movie log site backed by a hand-maintained library file and a generated TMDB snapshot. The public site reads `data/movies.json`, while the source of truth remains `data/library.json`.

The project also includes:

- a browser-based admin page at `admin.html`
- Node.js CLI scripts for adding, importing, promoting, and dropping entries
- serverless API handlers in `functions/api/` for admin authentication and CRUD operations

## Project Structure

```text
.
├── index.html              # Public gallery
├── admin.html              # Admin interface
├── movies.js               # Public gallery logic
├── admin.js                # Admin interface logic
├── styles.css
├── admin.css
├── data/
│   ├── library.json        # Source of truth, edited by hand or scripts
│   └── movies.json         # Generated snapshot for the frontend
├── functions/api/          # auth/search/add/update/delete endpoints
├── scripts/                # CLI tools for maintaining the library
└── movie_posters/          # Placeholder and custom poster assets
```

## Data Flow

1. Maintain `data/library.json`.
2. Run `scripts/fetch_movies.js` with a TMDB API key.
3. The script fetches TMDB metadata for movie and TV entries, keeps web-video entries as local metadata, and writes `data/movies.json`.
4. `index.html` and `admin.html` read `data/movies.json` in the browser.

## Library Schema

`data/library.json` is grouped by status buckets:

```json
{
  "watching": [],
  "watched": [],
  "wishlist": [],
  "dropped": []
}
```

Common fields:

- `id`: TMDB ID for movies/TV, or a generated string ID for `web-video`
- `title`: display title
- `mediaType`: `movie`, `tv`, or `web-video`
- `status`: usually `watching`, `watched`, `wishlist`, or `dropped`
- `note`: optional note
- `rating`: optional rating from `0` to `10`
- `watchDates`: optional array of ISO dates
- `inCinema`: optional boolean

Movie / TV only:

- `wishlistReason`: optional text for wishlist entries

Web video only:

- `platform`
- `url`
- `coverUrl`
- `creator`
- `duration`

Notes:

- `data/movies.json` is generated. Do not edit it manually.
- `watchDate` may appear in generated data as a convenience field derived from `watchDates`.

## Requirements

- Node.js 18+ recommended
- TMDB API v3 key for scripts that fetch TMDB data

Optional environment variables:

- `TMDB_API_KEY`
- `TMDB_LANGUAGE` default: `zh-CN`
- `TMDB_REGION` default: `CN`

## Common Commands

Add a movie or TV entry interactively:

```bash
TMDB_API_KEY=your_key node scripts/add_movie.js
```

Add a web video entry:

```bash
node scripts/add_web_video.js
```

Promote entries from `watching` to `watched`:

```bash
node scripts/promote_movie.js
```

Move entries from `watching` to `dropped`:

```bash
node scripts/drop_movie.js
```

Import from Douban CSV or JSON:

```bash
TMDB_API_KEY=your_key node scripts/import_douban.js "data/豆伴(180354423).csv"
```

Export Douban data to `fromdouban.json` first:

```bash
TMDB_API_KEY=your_key node scripts/export_douban_json.js "data/豆伴(180354423).csv"
```

Import from an existing JSON export:

```bash
node scripts/import_from_json.js fromdouban.json
```

Regenerate the frontend snapshot:

```bash
TMDB_API_KEY=your_key node scripts/fetch_movies.js
```

Quick add and refresh:

```bash
./scripts/quick_add.sh
```

Validate generated JSON:

```bash
jq . data/movies.json
```

Serve locally:

```bash
python3 -m http.server 4173
```

Then open:

- `http://localhost:4173/index.html`
- `http://localhost:4173/admin.html`

## Public Gallery

The public page currently supports:

- sections for `watching`, `wishlist`, `watched`, and `dropped`
- filtering by `all`, `movie`, `tv`, and `web-video`
- TMDB poster / backdrop fallbacks
- wishlist reasons, notes, watch dates, ratings, and cinema badges
- external links to TMDB for movies and TV entries

## Admin Interface

`admin.html` is the browser UI for:

- logging in as admin
- searching TMDB
- adding entries
- manually adding entries by TMDB ID
- editing and deleting existing entries

It depends on the serverless endpoints in `functions/api/`:

- `auth.js`
- `search.js`
- `add.js`
- `update.js`
- `delete.js`

Required environment variables for admin APIs:

- `ADMIN_PASSWORD`
- `JWT_SECRET`
- `TMDB_API_KEY`
- `GITHUB_TOKEN`
- `GITHUB_OWNER`
- `GITHUB_REPO`

The CRUD endpoints update `data/library.json` through the GitHub Contents API, so the admin flow is intended for a deployed serverless environment rather than a plain local static server.

## Local Testing

Recommended manual checks:

1. Regenerate `data/movies.json`.
2. Run `jq . data/movies.json`.
3. Start `python3 -m http.server 4173`.
4. Verify `index.html` on desktop and mobile widths.
5. Verify status sections and filter buttons.
6. Open `admin.html` and verify UI behavior.

Admin limitations in local-only mode:

- login will not work without deployed `/api/auth`
- TMDB search will not work without deployed `/api/search`
- add, update, and delete require deployed serverless functions plus environment variables

## Deployment Notes

- The public site is static and can be hosted on GitHub Pages.
- The admin API layer requires a serverless platform compatible with `functions/api/`.
- Never commit TMDB or GitHub secrets.
- After changing `data/library.json`, regenerate `data/movies.json` before deploying the frontend.
