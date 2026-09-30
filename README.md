## 在线访问

https://pljhonglu.github.io/chenchen-learning/

# 辰辰的幼小衔接学习乐园

给 5 岁大班孩子「辰辰」用的本地网页：古诗（带拼音）、10 以内加减与分解组合、拼音认读骨架、汉字描红骨架，以及按间隔重复的「今日复习」。

## 如何打开

**方式一（推荐）**：用浏览器直接打开

1. 进入本目录 `chenchen-learning`
2. 双击 `index.html`，或用 Chrome / Edge / Safari 打开该文件

**方式二**：本地静态服务器（部分浏览器对 `file://` 限制较少时更稳）

```bash
cd chenchen-learning
python3 -m http.server 8080
```

然后访问 <http://localhost:8080>

手机/平板：把整个文件夹拷到设备，用浏览器打开 `index.html`；或同一局域网用电脑起服务后访问。

## 文件说明

| 文件 | 作用 |
|------|------|
| `index.html` | 页面入口 |
| `styles.css` | 样式（白底、楷体、水彩点缀） |
| `poems.js` | 35 首古诗全文 + 逐字拼音 |
| `app.js` | 导航、复习队列、数学/拼音/写字逻辑 |
| `fonts/LXGWWenKai-Subset.woff2` | 楷体风格网页字体（子集） |
| `README.md` | 本说明 |

进度保存在浏览器 `localStorage`（键名 `chenchen-learning-v1`），换浏览器或清缓存会丢失。

## 功能怎么用

### 今日复习

- 首页列出**今天该回顾**的内容（古诗、数学等）。
- 进入项目后点 **记得 / 模糊 / 忘了**，按简化间隔更新下次时间：
  - 记得 → 间隔加长：1 → 2 → 4 → 7 → 15 → 30 天
  - 模糊 → 间隔退一档
  - 忘了 → 回到 1 天
- 新学内容需先点 **已学会，进入复习**，才会进入队列（加入当天即可能出现在今日列表，或从次日开始，取决于你何时点「记得」等）。

### 古诗馆

- 35 首幼小衔接常见古诗，每字上方拼音（ruby 布局），贴近打印字帖风格。
- 可搜索题目/作者/诗句；按「全部 / 未学 / 已学 / 待复习」筛选。
- 详情页底部可加入复习并打卡。

### 数学

- **10 以内加减法**：随机出题，四选一。
- **分解组合**：如「5 可以分成 ？ 和 2」。
- 可点「加入复习队列」，之后会出现在今日复习。

### 拼音 / 写字

- 拼音：声母、韵母点选认读（骨架）。
- 写字：田字格 + 常用字笔顺说明（骨架，便于对照纸上描红）。

## 说明与约定

- 《绝句》采用幼小衔接/小学常见的**杜甫**「两个黄鹂鸣翠柳」（非杜牧「银烛秋光」）。
- 《饮湖上初晴后雨》题目已规范；作者「袁枚」「登鹳雀楼」已按通用写法。
- 《古朗月行》为节选「小时不识月」四句；《悯农》分其一、其二。
- 拼音按诗意/教材常见读音校对（如 朝 zhāo、还 huán、见 xiàn、为 wèi、一行 yì háng 等）。`山行`「斜」、`风`「斜」取现代读音 xié；若教材注古音 xiá，可自行改 `poems.js`。

## 清除进度

浏览器开发者工具 → Application / 存储 → Local Storage → 删除 `chenchen-learning-v1`，或控制台执行：

```js
localStorage.removeItem('chenchen-learning-v1')
```


## 云同步（Cloudflare D1）

跨设备复习进度：首页「☁️ 云同步」生成或输入 6–8 位同步码，点「保存并同步」。

- Worker：`cloudflare/`（D1 库名 `chenchen-learning-progress`）
- API：`GET|PUT /api/progress`，前端 `API_BASE` 在 `app.js`
- 本地仍用 `localStorage` 键 `chenchen-learning-v1`；有同步码时会自动拉取合并并在打卡后上传

部署 Worker：

```bash
cd cloudflare && npm i && npx wrangler login
npx wrangler d1 execute chenchen-learning-progress --remote --file=./schema.sql
npx wrangler deploy
```
