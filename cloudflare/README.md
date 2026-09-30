# chenchen-learning-api (Cloudflare Worker + D1)

跨设备进度同步 API。

## 命令

```bash
cd cloudflare
npm install
npx wrangler login          # 浏览器 OAuth
npx wrangler d1 create chenchen-learning-progress
# 把输出的 database_id 写入 wrangler.toml
npx wrangler d1 execute chenchen-learning-progress --remote --file=./schema.sql
npx wrangler deploy
```

Deploy 后 Worker URL 形如：`https://chenchen-learning-api.<subdomain>.workers.dev`

前端 `app.js` 里 `API_BASE` 指向该 URL（无尾斜杠）。
