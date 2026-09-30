# 辰辰幼小衔接乐园（自托管 Docker）

古诗 / 数学 / 拼音 / 写字 / 间隔复习。进度写入容器内 **SQLite**（卷持久化），**不再依赖** Cloudflare Workers、D1、云同步码或 GitHub Pages。

仓库：https://github.com/pljhonglu/chenchen-learning

## 快速启动

```bash
git clone https://github.com/pljhonglu/chenchen-learning.git
cd chenchen-learning
docker compose up -d --build
```

浏览器打开：http://\<NAS或本机IP\>:8080/

健康检查：http://\<IP\>:8080/api/health

## 端口

| 用途 | 默认 | 修改方式 |
|------|------|----------|
| Web + API | `8080` | `docker-compose.yml` 中 `ports: ["18080:8080"]` |

## 数据卷（进度备份）

Compose 命名卷：`chenchen-learning-data` → 容器内 `/data/progress.db`

查看卷实际路径（Docker）：

```bash
docker volume inspect chenchen-learning-data
# 看 Mountpoint，例如 /var/lib/docker/volumes/chenchen-learning-data/_data
```

### NAS 建议：绑定主机目录（更好备份）

编辑 `docker-compose.yml`，把 volumes 改成：

```yaml
    volumes:
      - /volume1/docker/chenchen-learning/data:/data
```

然后：

```bash
mkdir -p /volume1/docker/chenchen-learning/data
docker compose up -d --build
```

备份：直接拷贝 `progress.db`（服务可不停，或先 `docker compose stop` 再拷）。

恢复：停容器 → 覆盖 `progress.db` → 再 `docker compose up -d`。

## API

- `GET /api/health`
- `GET /api/progress` → `{ found, payload, updatedAt }`
- `PUT /api/progress` body `{ payload, clientUpdatedAt }`（LWW）

前端同源调用，无需同步码。

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

## 已下线（云端）

- Worker `chenchen-learning-api`（已删除）
- D1 `chenchen-learning-progress`（已删除）
- GitHub Pages `/chenchen-learning/` 应用镜像（改为说明页）
- 相关 Actions：`deploy-chenchen`、`deploy-worker`、云同步 apply 等
