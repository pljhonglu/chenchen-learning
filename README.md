# 辰辰的学习乐园

给幼儿园大班、约 5 岁孩子的课后记忆练习。内置 35 首古诗均为课堂已学内容，直接安排复习；家长可以继续录入新学的内容。孩子用绘本插图、自然语音和短任务复习古诗、数学、拼音与汉字。

服务端使用 **Go + SQLite**，前端为无需构建的 HTML/CSS/JavaScript。支持手机、平板和电脑；访问同一台服务器可以同步学习进度。

## 使用方式

1. 内置古诗自动纳入复习，无需逐首点击“学过”。升级保留已有的复习阶段与日期，尚无记录的古诗从今天巩固开始。在「家长」中可以录入新古诗、汉字和其他课堂内容，也可以删除或恢复古诗复习。
2. 孩子点「开始复习」，系统只安排今天到期的内容，每轮最多 3 项。没有到期内容时提示休息。
3. 每首内置古诗有一张简洁绘本插图和看图提示，可以听读、看拼音、遮住汉字看图背诵；数学使用大号选项练习；拼音可以认读，汉字可以对照田字格描写。
4. 新录入的内容当天先巩固；「记住了」按 1、2、4、7、15、30 天间隔逐步安排。记不牢的内容次日再练；同一天重复评价不会连续跳级。这是固定间隔的记忆复习规则，会根据孩子的反馈调整。

课堂内容和复习进度只保存在服务端 SQLite，不写入浏览器本地存储。页面重新打开时从服务端读取；只有保存成功才完成本次练习，断网或保存失败时会提示重试。

35 首内置古诗使用预生成的普通话自然语音 MP3（AI 合成，并非真人录制），随应用分发，不再由设备系统临时读诗。音频支持暂停、继续、停止；特定多音字在生成输入中做校正，页面保持原诗文字。播放时无需语音服务密钥或外部 TTS 连接；音频不可用时提示重试，不自动切回系统读诗。新增自定义古诗暂未配音，由家长陪读；普通操作提示仍使用设备语音。详见 [音频说明](docs/poem-audio.md)。

插图使用内置 imagegen 逐首生成，重点保留诗中的人物、动物或景物，避免复杂场面。文件位于 `public/images/poems/`；[插图提示词](docs/poem-image-prompts.md)记录每首场景。手指描写不评判笔顺，对照纸笔练习仍然适用。

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
node scripts/test-poem-media.cjs
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
- `PUT` 为旧客户端保留兼容，`clientUpdatedAt` 使用毫秒时间戳，按较新版本保存。
- `PATCH /api/progress`：新界面使用原子操作更新单条内容和进度；请求 `{ operations: [{ op, collection, key, value }] }`，返回 `{ ok, payload, updatedAt }`。`op` 为 `create`、`set`、`merge` 或 `delete`；集合为 `items`、`customPoems`、`customCharacters`、`activity`、`hiddenCourses`。
- 每个 PATCH 在 SQLite 事务中整体应用，服务端生成更新时间。`merge` 只允许更新仍存在的条目，已被其他设备删除时返回 409，避免旧页面把课程重新保存回来。
- 家长新增课程使用 `create`：已有记录保持原样，避免另一台设备重复添加时覆盖复习进度。`set` 用于写入完整内容或带固定 ID 的练习活动，`delete` 不带 `value`。
- `/data/progress.db` 是唯一持久化来源；原来已上传服务器的记录可以直接继续使用，旧浏览器缓存不再读取。

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
