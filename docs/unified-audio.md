# 统一中英文女声

2026-10-13 起，英文单词、中文释义、汉字组词、笔顺提示、拼音例字和古诗统一使用
**Qwen3-TTS 的 Serena 女声**，取代原先混用的 Sonia、晓晓、Daniel 和婷婷。
这是 AI 合成声音。模型在 Apple Silicon Mac 上离线运行；NAS 只保存和播放 MP3，
无需模型、GPU、API 密钥或外部 TTS 服务。开源模型不收按次生成费用。

| 清单 | 段数 |
| --- | ---: |
| 英语单词、中文释义及引导 | 214 |
| 汉字与组词（含旧字兼容资源） | 731 |
| 笔顺序数及引导 | 22 |
| 拼音例字 | 112 |
| 古诗 | 36 |
| 合计 | 1,115 |

相同输入、语言和朗读方式共享录音，共 997 种读音输入。47 段声母、韵母教学范音保留，
不把拼音字母交给通用 TTS。它们的来源与许可继续见 [拼音音频说明](pinyin-audio.md)。

## 音色一致性试听（2026-10-14）

使用同一个 `Serena` 预设，只能证明生成时选了相同说话人，不能证明各段听感一致。
用户反馈当前发布音频仍有音色差异。自动识别与文件校验也不能验证这一点。
用户已选择 `after-normalized.wav` 固定参考试听版本，现采用 Base 模型和同一段
Serena 合成参考录音重建全部自然语言音频。自动识别曾将孤立的 `mouth` 识别为 `mouse`，
此类识别结果仍需结合人工听感判断，不能仅凭识别文本判定发音正确或错误。

`scripts/preview-consistent-voice.py` 用同一份参考音频和准确转写、固定种子、低随机性、
单条生成制作 12 段汉字/组词/英文连续试听；输出目录禁止位于 `public/` 内。
参考音频可以使用已获授权的录音或合成声音。本次使用 Serena 合成录音，不采集真人声音。
先校验发音内容，再比较连续试听的音色；未经试听确认，不因参数相同而宣称音色一致。

```sh
python scripts/preview-consistent-voice.py \
  --model-dir /absolute/path/to/Qwen3-TTS-12Hz-1.7B-Base-8bit \
  --reference-audio /absolute/path/to/reference.wav \
  --reference-text /absolute/path/to/reference.txt \
  --output-dir /absolute/path/to/voice-audition
```

## 固定参数与来源

- 模型：`mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit`。
- 模型版本：`e7dd0585652209fa0d7783659aad4e8a324de11c`。
- 说话人：`Serena`；中英文均使用 `scripts/assets/serena-reference.wav` 固定参考音频。
- 参考音频 SHA-256：`2793c83db0c7783e8e9a9eb85901eadd7ea191e1ae0ab3ff1b4ac8a993ca1b57`。
- 每条生成前重置种子 `20261014`，batch size 固定为 1。
- 生成：`mlx-audio==0.5.8`、`mlx==0.32.3`，temperature 0.3、top-k 20、top-p 0.8、repetition penalty 1.05。
- 编码与音量（v4）：先实测响度，再用线性增益校准至 -18 LUFS；96 kHz 过采样峰值限制在 -2 dB，输出 24 kHz 单声道、48 kbps MP3。
- 必须复测最终 MP3：响度在 -18 ±1 LUFS 内，真峰值不高于 -1 dBTP，否则拒绝发布。清单 `loudness` 保存实测值。
- 旧版仅设置 loudnorm 参数，没有验收成品，部分短录音仍明显偏低。音量迁移使用 `scripts/normalize-unified-audio.py --output-root /absolute/staged-public`，不调用 TTS；符合新标准的文件保持原字节。
- 每段清单保存模型版本、参数、文本、输入哈希、文件 SHA-256、时长、码率与来源。
- 《赋得古原草送别》的“侵”用同音“钦”作为合成输入，避免吞尾音；原文仍显示“侵”。
- 多音字沿用课程标注和原有 `characterSpeech`、诗歌同音校正，不修改展示的汉字或拼音。
- `avocado`、`hippo`、`pineapple`、`toe` 使用首字母大写的合成输入，减少短词吞音；展示内容不变。
- “弟”“指”分别用同音“地”“纸”生成；“习”“写”“牙”“蝶”“雪”“叶”和“人手”带语境生成后裁切。
- `mouth` 沿用试听的语境生成及末段裁切方法：先生成
  `Open your mouth. Mouth.`，发布文件只留下最后的 `Mouth`。
  `synthesisText` 如实保存完整输入，`spokenText` 保存最终点读内容，`synthesis.trim` 保存裁切规则。
  语境句不在页面展示或播放，英语学习仍只有单词与词义。

生成含随机采样，重跑不承诺音频逐字节相同；清单中的文件哈希用于核验实际发布版本。
模型与依赖下载到仓库外，不加入 Git 或 NAS 镜像。

官方资料：[Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS)、
[MLX Audio](https://github.com/Blaizzy/mlx-audio)、
[固定模型](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit/tree/e7dd0585652209fa0d7783659aad4e8a324de11c)。模型采用 Apache-2.0 许可。

## 重建与检查

准备 Python 3.11 虚拟环境、FFmpeg、LAME，并下载上述固定模型版本。

```sh
python -m pip install mlx-audio==0.5.8 mlx==0.32.3 mutagen==1.48.1
python scripts/generate-unified-audio.py \
  --model-dir /absolute/path/to/model \
  --cache-dir /absolute/path/to/recording-cache \
  --output-root /absolute/path/to/staged-public \
  --batch-size 1
python scripts/generate-unified-audio.py --check --output-root /absolute/path/to/staged-public
```

先生成到临时目录，完成内容回查、试听和文件检查后，将暂存目录的 `audio/` 和 `data/`
对应文件复制到 `public/`。脚本按输入哈希缓存已完成录音，中断重跑可以续接。
更改课程内容会自动生成不同的缓存键；不要直接改 MP3 而不更新清单。
可用 `--regenerate-id english/english-apple-word` 单独重做疑问片段，
重做仍保持相同参考音频与种子；改变配方必须更新来源记录并重新核验。

```sh
python scripts/generate-unified-audio.py --check
node scripts/test-unified-voice.cjs
python scripts/generate-english-audio.py --check
python scripts/generate-writing-vocabulary-audio.py --check
python scripts/generate-writing-audio.py --check
python scripts/generate-pinyin-examples-audio.py --check
python scripts/generate-poem-audio.py --check
```

旧脚本的 Edge/macOS 生成入口保留用于追溯；当前重建应使用统一生成脚本，
避免重新混入不同音色。各旧脚本的 `--check` 也支持统一模型的来源与完整性校验。
语音识别回查有助于筛出漏读和重复，不能替代人对音色、口音和声调的判断。
