## 在线访问

**GitHub Pages（推荐）**：https://pljhonglu.github.io/chenchen-learning/

> 首次需要在仓库启用 Pages（约 10 秒）：
> 1. 打开 https://github.com/pljhonglu/chenchen-learning/settings/pages
> 2. Build and deployment → Source 选 **Deploy from a branch**
> 3. Branch 选 **main**，文件夹选 **/ (root)**，Save
> 4. 等 1～2 分钟后刷新上面的 Pages 链接
>
> 或 Source 选 **GitHub Actions**（仓库已带 `pages.yml`），再在 Actions 里 Re-run 最新工作流。

**临时 CDN（无需开 Pages，现已可用）**：
https://cdn.jsdelivr.net/gh/pljhonglu/chenchen-learning@main/index.html

# 辰辰的幼小衔接学习乐园

给 5 岁大班孩子「辰辰」用的本地网页：古诗（带拼音）、10 以内加减与分解组合、拼音认读骨架、汉字描红骨架，以及按间隔重复的「今日复习」。

仓库：https://github.com/pljhonglu/chenchen-learning （**public**）

## 如何打开（本地）

**方式一（推荐）**：双击 `index.html`，或用 Chrome / Edge / Safari 打开。

**方式二**：

```bash
cd chenchen-learning
python3 -m http.server 8080
```

访问 http://localhost:8080

## 仓库内文件

| 路径 | 作用 |
|------|------|
| `index.html` | 入口（加载 gzip 资源包） |
| `assets/*.b64` | 样式/脚本的 gzip+base64 资源 |
| `styles.css` | 样式占位（完整样式在 assets 包内） |
| `README.md` | 本说明 |
| `.github/workflows/pages.yml` | Pages 部署工作流 |
| `.nojekyll` | 禁用 Jekyll |

进度保存在浏览器 `localStorage`（键名 `chenchen-learning-v1`）。

## 复习功能

- 记得 → 间隔加长：1 → 2 → 4 → 7 → 15 → 30 天
- 模糊 → 间隔退一档
- 忘了 → 回到 1 天
