# 辰辰的学习乐园

给幼儿园大班、约 5 岁孩子的课后记忆练习。家长选择课堂上学过的内容，孩子用大按钮、语音提示和短任务复习古诗、数学、拼音与汉字。

服务端使用 **Go + SQLite**，前端为无需构建的 HTML/CSS/JavaScript。支持手机、平板和电脑；访问同一台服务器可以同步学习进度。

## 使用方式

1. 在「家长」中选择孩子课上已经学过的课程。
2. 孩子点「开始复习」，每轮最多 3 项，完成后休息一下。
3. 古诗可以听读、看拼音、遮住汉字回忆；数学使用大号选项练习；拼音可以认读，汉字可以对照田字格描写。
4. 根据「记住了 / 再练练」等反馈安排后续复习。不会的内容会更早再次出现，鼓励尝试，不设置排行榜和倒计时。

语音使用设备自带的中文语音引擎，需要点击按钮播放；设备不支持时会显示文字提示，家长可以陪读。手指描写不评判笔顺，对照纸笔练习仍然适用。

## Docker 快速启动

GitHub Actions 构建 `linux/amd64` 和 `linux/arm64`，镜像为：

```text
ghcr.io/pljhonglu/chenchen-learning:latest
```

```bash
docker run -d --name chenchen-learning \
  -p 8080:8080 \
  -v chenchen-learning-data:/data \
  --restart unless-stopped \
  ghcr.io/pljhonglu/chenchen-learning:latest
```

浏览器打开 `http://服务器IP:8080/`，健康检查为 `/api/health`。

或从源码构建：

```bash
git clone https://github.com/pljhonglu/chenchen-learning.git
cd chenchen-learning
docker compose up -d --build
```

## 从 Python 版本升级

Go 版本沿用 `/data/progress.db`、`progress` 表和原有 API，原来的学习记录无需转换。升级前先停止旧容器并备份数据卷，替换镜像时挂载原来的 `chenchen-learning-data` 卷。不要运行 `docker compose down -v`，这个命令会删除数据卷。

使用上述 `docker run` 方式的部署可以这样更新：

```bash
docker pull ghcr.io/pljhonglu/chenchen-learning:latest
docker stop chenchen-learning
# 此时可备份 chenchen-learning-data 卷。
docker rm chenchen-learning
docker run -d --name chenchen-learning \
  -p 8080:8080 \
  -v chenchen-learning-data:/data \
  --restart unless-stopped \
  ghcr.io/pljhonglu/chenchen-learning:latest
```

镜像以 UID/GID `10001` 运行。使用 NAS 主机目录绑定 `/data` 时，该目录需要允许 UID `10001` 读写；原先已可用的数据目录可继续使用。复制数据库备份时应先停止容器，避免遗漏未写回数据库的事务。

## 本地开发

需要 Go 1.27 或更新版本；前端回归测试另需 Node.js，无需安装 npm 依赖：

```bash
go test -race ./...
node scripts/test-progress.cjs
node scripts/test-speech.cjs
DATA_DIR=./data PUBLIC_DIR=./public HOST=127.0.0.1 PORT=8080 go run ./server
```

| 环境变量 | 默认值（容器） | 用途 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | 监听地址 |
| `PORT` | `8080` | HTTP 端口 |
| `DATA_DIR` | `/data` | SQLite 数据目录 |
| `PUBLIC_DIR` | `/app/public` | 静态资源目录 |

## API 与持久化

- `GET /api/health`：服务健康状态。
- `GET /api/progress`：`{ found, payload, updatedAt }`。
- `PUT /api/progress`：请求 `{ payload: { items: {} }, clientUpdatedAt }`；返回 `{ ok, merged, kept, payload, updatedAt }`。
- `clientUpdatedAt` 使用毫秒时间戳，服务端按较新的版本保存；已有的 SQLite 数据和浏览器 `chenchen-learning-v1` 缓存保持兼容。
- 离线时进度先保存在浏览器，再次联网后同步。家长区可以查看同步状态并手动重试。

这是家庭使用的共享进度服务，没有账户隔离。建议用于家庭局域网；需要远程访问时，使用带登录的反向代理或家庭 VPN。

## 构建验证

每次 main 提交和 PR 都检查 Go 服务端、浏览器脚本和同步/复习/语音回归测试；Docker 镜像发布前，会启动临时容器验证健康接口、静态课程文件和重启后的 SQLite 持久化。`main` 更新后自动发布 `latest`，同时发布对应提交的 `sha-*` 标签。

```bash
docker build -t chenchen-learning:test .
bash scripts/smoke-container.sh chenchen-learning:test
```

## 目录

```text
server/                    Go HTTP 服务与兼容性测试
go.mod / go.sum            Go 依赖
public/                    儿童界面、课程数据与语音
scripts/smoke-container.sh  容器持久化检查
Dockerfile                 多阶段、非 root 镜像
.github/workflows/          自动检查与多架构发布
```
