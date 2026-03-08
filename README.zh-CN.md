# My Movie Gallery

[English README](./README.md)

My Movie Gallery 是一个静态观影记录站点。项目用 `data/library.json` 作为源数据，再通过 TMDB 拉取电影和剧集详情，最终生成前端读取的 `data/movies.json`。

当前仓库还包含：

- 浏览器管理后台 `admin.html`
- 一组用于维护观影记录的 Node.js CLI 脚本
- 位于 `functions/api/` 的管理后台 serverless API

## 项目结构

```text
.
├── index.html              # 前台观影页
├── admin.html              # 管理后台
├── movies.js               # 前台页面逻辑
├── admin.js                # 后台页面逻辑
├── styles.css
├── admin.css
├── data/
│   ├── library.json        # 源数据，手动或通过脚本维护
│   └── movies.json         # 生成文件，供前端直接读取
├── functions/api/          # auth/search/add/update/delete 接口
├── scripts/                # CLI 维护脚本
└── movie_posters/          # 占位图和自定义海报资源
```

## 数据流

1. 维护 `data/library.json`。
2. 使用 TMDB API Key 运行 `scripts/fetch_movies.js`。
3. 脚本为电影和剧集补充 TMDB 信息，为网络视频保留本地字段，然后输出 `data/movies.json`。
4. `index.html` 和 `admin.html` 在浏览器里读取 `data/movies.json`。

## 数据结构

`data/library.json` 以状态分组：

```json
{
  "watching": [],
  "watched": [],
  "wishlist": [],
  "dropped": []
}
```

通用字段：

- `id`：电影/剧集使用 TMDB ID，`web-video` 使用脚本生成的字符串 ID
- `title`：标题
- `mediaType`：`movie`、`tv` 或 `web-video`
- `status`：通常为 `watching`、`watched`、`wishlist`、`dropped`
- `note`：备注，可选
- `rating`：评分，可选，范围 `0-10`
- `watchDates`：观影日期数组，可选，使用 ISO 日期格式
- `inCinema`：是否影院观看，可选

电影 / 剧集附加字段：

- `wishlistReason`：想看原因，可选

网络视频附加字段：

- `platform`
- `url`
- `coverUrl`
- `creator`
- `duration`

说明：

- `data/movies.json` 是生成文件，不要手动修改。
- 生成数据里可能包含 `watchDate`，它是从 `watchDates` 派生出来的便捷字段。

## 环境要求

- 建议使用 Node.js 18+
- 涉及 TMDB 拉取的脚本需要 TMDB API v3 Key

可选环境变量：

- `TMDB_API_KEY`
- `TMDB_LANGUAGE`，默认 `zh-CN`
- `TMDB_REGION`，默认 `CN`

## 常用命令

交互式添加电影或剧集：

```bash
TMDB_API_KEY=your_key node scripts/add_movie.js
```

添加网络视频：

```bash
node scripts/add_web_video.js
```

把 `watching` 条目标记为 `watched`：

```bash
node scripts/promote_movie.js
```

把 `watching` 条目标记为 `dropped`：

```bash
node scripts/drop_movie.js
```

从豆瓣 CSV 或 JSON 导入：

```bash
TMDB_API_KEY=your_key node scripts/import_douban.js "data/豆伴(180354423).csv"
```

先把豆瓣数据导出成 `fromdouban.json`：

```bash
TMDB_API_KEY=your_key node scripts/export_douban_json.js "data/豆伴(180354423).csv"
```

从已有 JSON 导入：

```bash
node scripts/import_from_json.js fromdouban.json
```

重新生成前端数据快照：

```bash
TMDB_API_KEY=your_key node scripts/fetch_movies.js
```

快速添加并刷新数据：

```bash
./scripts/quick_add.sh
```

校验生成的 JSON：

```bash
jq . data/movies.json
```

本地启动静态服务：

```bash
python3 -m http.server 4173
```

然后访问：

- `http://localhost:4173/index.html`
- `http://localhost:4173/admin.html`

## 前台页面

当前前台支持：

- `正在看`、`想看`、`已看完`、`弃剧` 四个分区
- `全部 / 电影 / 剧集 / 网络视频` 筛选
- TMDB 海报和背景图兜底
- 展示想看理由、备注、观影日期、评分和影院标记
- 电影和剧集可跳转到 TMDB 详情页

## 管理后台

`admin.html` 提供以下能力：

- 管理员登录
- 搜索 TMDB
- 添加条目
- 按 TMDB ID 手动添加
- 编辑和删除现有记录

它依赖 `functions/api/` 下的接口：

- `auth.js`
- `search.js`
- `add.js`
- `update.js`
- `delete.js`

后台 API 需要的环境变量：

- `ADMIN_PASSWORD`
- `JWT_SECRET`
- `TMDB_API_KEY`
- `GITHUB_TOKEN`
- `GITHUB_OWNER`
- `GITHUB_REPO`

增删改接口会通过 GitHub Contents API 修改 `data/library.json`，所以管理后台完整功能更适合部署在支持 serverless 的环境里，而不是只用本地静态服务器直接打开。

## 本地测试

建议的手动验证流程：

1. 先重新生成 `data/movies.json`。
2. 执行 `jq . data/movies.json` 检查 JSON。
3. 启动 `python3 -m http.server 4173`。
4. 检查 `index.html` 在桌面和移动宽度下的展示。
5. 检查各状态分区和筛选按钮。
6. 打开 `admin.html` 检查 UI 交互。

仅本地静态模式下的后台限制：

- 没有部署 `/api/auth` 时无法登录
- 没有部署 `/api/search` 时无法搜索 TMDB
- 添加、更新、删除都依赖已部署的 serverless API 和环境变量

## 部署说明

- 前台页面本身是静态站点，可以部署到 GitHub Pages。
- 管理后台 API 需要部署到兼容 `functions/api/` 的 serverless 平台。
- 不要把 TMDB 或 GitHub 的密钥提交到仓库。
- 每次修改 `data/library.json` 后，前台部署前都要重新生成 `data/movies.json`。
