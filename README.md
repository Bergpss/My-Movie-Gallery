# My Movie Gallery

A static gallery that displays movies sourced from a TMDB list. The TMDB API key is no longer exposed in the frontend; instead, list data is fetched offline and stored as a static JSON file that GitHub Pages can host.

## Updating the Movie Data

1. Retrieve a TMDB API key and keep it private. Do **not** commit it to the repository.
2. From the project root, run the fetch script with the necessary environment variables. For example:
   ```bash
   TMDB_API_KEY="<your api key>" \
   TMDB_LIST_ID="8520430" \
   TMDB_LANGUAGE="zh-CN" \
   node scripts/fetch_movies.js
   ```
   `TMDB_LIST_ID` and `TMDB_LANGUAGE` are optional; they default to the values shown above.
3. The script writes the latest data to `data/movies.json`. Commit the updated JSON so GitHub Pages can serve it.

The frontend reads `data/movies.json` at runtime, so no TMDB credentials are sent to visitors.

## Development Notes

- `movies.js` loads from `data/movies.json`. Make sure that file exists (the repository includes an empty placeholder).
- If you change the TMDB list or language, rerun the fetch script and redeploy.
- When deploying to GitHub Pages as a project site, ensure the build output keeps the `data/` directory alongside `index.html`.
