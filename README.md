# My Movie Gallery

A static gallery that showcases the movies you've personally rated on TMDB. The browser only consumes a pre-generated JSON snapshot, so your API key and session never leave the server or build environment.

## Updating the Rated Movies Snapshot

1. Create or reuse the following TMDB credentials (keep them secret):
   - **Recommended** `TMDB_V4_ACCESS_TOKEN`: the long "API Read Access Token (v4 auth)" from TMDB settings. When provided, the script resolves your account ID (or you can set it manually via `TMDB_ACCOUNT_ID`) and captures the rating timestamps.
   - Optional overrides: `TMDB_LANGUAGE` (defaults to `zh-CN`) and `TMDB_SORT_BY` (defaults to `created_at.desc`).
   - Fallback (only needed if you skip the v4 token):
     - `TMDB_API_KEY`: your v3 API key.
     - `TMDB_SESSION_ID`: a user session with permission to read your rated movies.
     - `TMDB_ACCOUNT_ID`: the numeric TMDB account identifier. v3 responses do **not** include rating timestamps.
2. Run the fetch script from the project root:
   ```bash
   TMDB_V4_ACCESS_TOKEN="<v4 token>" \
   TMDB_ACCOUNT_ID="<account id>" # optional override if auto lookup fails
   node scripts/fetch_movies.js
   ```
   If you prefer the v3 flow instead:
   ```bash
   TMDB_API_KEY="<api key>" \
   TMDB_SESSION_ID="<session id>" \
   TMDB_ACCOUNT_ID="<account id>" \
   node scripts/fetch_movies.js
   ```
   The script automatically walks every result page returned by `/account/{account_id}/movie/rated` (v4) or `/account/{account_id}/rated/movies` (v3). When using v4, account metadata is fetched automatically and stored in `data/movies.json`.
3. Commit the refreshed `data/movies.json` so GitHub Pages (or any static host) can serve the updated snapshot.

The frontend reads `data/movies.json` at runtime, so no TMDB credentials are exposed to visitors.

## Development Notes

- `movies.js` expects rated-movie payloads (including the `rating` field) and decorates the poster with your score plus the rating timestamp (shown as the watch date beneath the title when available).
- Running the fetch script without valid credentials will exit with an error; this is by design to avoid publishing incomplete data.
- When deploying to GitHub Pages as a project site, ensure the `data/` directory sits beside `index.html` so the JSON loads correctly.
