# 辰辰幼小衔接乐园（自托管 Docker）

古诗 / 数学 / 拼音 / 写字 / 间隔复习。进度保存在容器内 **SQLite**（Docker 卷持久化），同源 API，多设备访问同一地址即可共用进度。

仓库：https://github.com/pljhonglu/chenchen-learning

## 快速启动

```bash
git clone https://github.com/pljhonglu/chenchen-learning.git
cd chenchen-learning
docker compose up -d --build
```

浏览器打开：http://<NAS或本机IP>:8080/

健康检查：http://<IP>:8080/api/health

## 目录结构

```
├── Dockerfile / docker-compose.yml
├── server/main.py          # 静态资源 + /api/progress（SQLite）
└── public/                 # 前端（Docker 唯一静态根）
    ├── index.html / app.js / speech.js / styles.css
    ├── fonts/
    └── data/poems.json     # 古诗库（按需 fetch）
```

## 端口

| 用途 | 默认 | 修改方式 |
|------|------|----------|
| Web + API | `8080` | `docker-compose.yml` 中 `ports: ["18080:8080"]` |

## 数据卷（进度备份）

Compose 命名卷：`chenchen-learning-data` → 容器内 `/data/progress.db`

```bash
docker volume inspect chenchen-learning-data
```

### NAS：绑定主机目录

编辑 `docker-compose.yml`：

```yaml
    volumes:
      - /volume1/docker/chenchen-learning/data:/data
```

```bash
mkdir -p /volume1/docker/chenchen-learning/data
docker compose up -d --build
```

备份 / 恢复：拷贝或覆盖 `progress.db`（恢复前可先 `docker compose stop`）。

## API

- `GET /api/health`
- `GET /api/progress` → `{ found, payload, updatedAt }`
- `PUT /api/progress` body `{ payload, clientUpdatedAt }`（LWW）

## 常用命令

```bash
docker compose logs -f
docker compose restart
docker compose down          # 不删数据卷
docker compose down -v       # ⚠ 删除进度卷
```

## 本地无 Docker 调试

```bash
mkdir -p data
DATA_DIR=./data PUBLIC_DIR=./public PORT=8080 python3 server/main.py
```
