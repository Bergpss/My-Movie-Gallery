# My Movie Gallery

静态站点，用本地维护的观影记录列表去 TMDB 拉取详情，最终生成 `data/movies.json` 给前端使用。无需数据库，也不会把 TMDB 凭据暴露给访客。

## 数据结构

- `data/library.json` 是唯一需要手动维护的文件。
  ```json
  {
    "watching": [
      { "id": 933260, "title": "某种物质", "status": "watching", "note": "…" }
    ],
    "watched": [
      { "id": 137, "title": "土拨鼠之日", "watchDates": ["2025-09-30"], "rating": 8 }
    ]
  }
  ```
  - `id` 是 TMDB 电影 ID（推荐：先查询一次 TMDB，确认后写入）。
  - `title` 只是方便识别，脚本生成时会用 TMDB 的官方标题兜底。
  - `watchDates`（可选）记录多次观影日期，按字符串数组存储（例如 `"watchDates": ["2024-10-01", "2025-01-12"]`）。
  - `status`（可选）默认分为 `watching` / `watched` / `wishlist`，前端据此显示“两大板块”（“正在看”含想看内容）。
  - `rating`、`note`（可选）会直接渲染在页面上。

- `data/movies.json` 由脚本自动生成，包含 TMDB 详情（海报、导演、上映日期等），不需要手动编辑。

## 生成流程

1. 准备 TMDB API Key（v3），保存在环境变量 `TMDB_API_KEY` 中。可选：
   - `TMDB_LANGUAGE`（默认 `zh-CN`）
   - `TMDB_REGION`
2. 通过脚本维护清单：
   ```bash
   TMDB_API_KEY="<你的 API Key>" \
   node scripts/add_movie.js
   ```
   脚本会引导你输入中文片名、状态（正在看/已看过/想看）、备注等信息，并自动调用 TMDB 搜索获取 ID，随后写入 `data/library.json`。
   - 若你愿意，也可以直接手动编辑 `data/library.json`。
   - 已经在“正在看”中的影片想要快速标记为“已看过”时，可运行：
     ```bash
     node scripts/promote_movie.js
     ```
     选择条目并输入观影日期/评分即可自动移入 `watched` 列表并追加日期。
   - 批量导入（例如来自豆瓣）的观影记录，可运行：
     ```bash
     TMDB_API_KEY="<你的 API Key>" \
     node scripts/import_douban.js fromdouban.json
     ```
     支持字段：`title`（中文片名）、`watch_date`，可选 `imdb_id`（若提供则优先使用 TMDB find 接口自动匹配）。脚本会逐条显示结果供确认（或自动选择唯一结果），并将记录写入 `watched` 列表，自动合并观影日期。
3. 运行生成脚本：
   ```bash
   TMDB_API_KEY="<你的 API Key>" \
   node scripts/fetch_movies.js
   ```
4. 脚本会读取 `library.json`，逐个访问 TMDB `/movie/{id}` 接口，生成新的 `data/movies.json`。
5. 将 `data/movies.json`（以及更新后的 `library.json`）纳入版本控制并部署到 GitHub Pages。

## 自定义字段

- 更改 `watchDates`、`note`、`rating` 等信息后重新运行脚本，生成的页面会即时反映。配合 `scripts/promote_movie.js` 可快速把“正在看”条目转移至“已看过”。
- 若想把影片移到“正在看”，把它放入 `watching` 数组或把 `status` 改为 `watching`。
- 删除条目即从 `library.json` 移除对应对象，再跑一次脚本。
- 页面展示为“上映日期 + 观影日期列表”。上映日期来自 TMDB 的 `release_date`；观影日期来自 `watchDates`，若为空则不显示。

## 部署提示

- 站点是纯静态输出，GitHub Pages 只需要 `index.html`、`movies.js`、`styles.css` 和自动生成的 `data/movies.json`。
- 记得不要把 `TMDB_API_KEY` 写进仓库；只需在本地或 CI 环境变量中配置后运行脚本即可。
