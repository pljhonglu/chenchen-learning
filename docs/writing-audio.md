# 笔顺动画的中文报画音频

`public/audio/writing/` 包含 22 段随网站发布的 MP3：

- `stroke-01` 到 `stroke-20`：依次说“第一画”到“第二十画”。
- `guide-start`：我们一笔一笔看。
- `guide-done`：写好啦，轮到你试一试。

`public/data/writing-audio.json` 以这些 ID 为键，记录 `src`、`text`、
`synthesisText`、`strokeNumber`（报画音频）、声音、语速、时长、字节数、
采样率、码率、合成输入哈希和文件 SHA-256。播放时按汉字笔顺使用对应序号，
不需要把多段报画音频拼接成文件。

音频统一使用 **Qwen3-TTS 的 Serena 女声**，与英语单词、中文释义及汉字组词使用同一说话人。
标准来源标签为“自然女声（AI 合成）”，不是真人录制。

应用运行时只需读取同域静态 MP3，无需调用外部语音服务，也无需家长设备安装声音。
浏览器可能要求先点击播放按钮。页面切换、停止或重新播放时，播放器应取消前一次播报和动画；
音频播放失败应明确提示并允许重试，不能把未播放的音频当作完成。

## 重新生成与检查

按[统一音频说明](unified-audio.md)生成到临时目录、核验后发布。现有专用脚本继续支持离线检查：

```sh
python3 scripts/generate-writing-audio.py --check
```

检查包括文本、来源参数、路径、MP3 元数据与哈希；不替代实际听审。

## 汉字与组词点读

`public/writing-vocabulary.js` 是汉字、带声调拼音与每字三组常用词的单一来源，
包含 150 个当前字和 47 个仅供旧学习组、自定义课堂字兼容的旧字。
`scripts/generate-writing-vocabulary-audio.py` 读取其中的 JSON 数组，不执行 JavaScript，
将字音和去重后的词语分别生成到 `public/audio/writing-vocabulary/`。
当前 150 个汉字各有三组词，共 450 处词语展示；词语去重后为 409 个，
加上 150 段字音，共 559 段点读音频。连同旧字兼容资源共 731 段；
默认字库与新的自动学习计划仍只有 150 字，旧字的历史记录和已保存草稿继续可用。
相同词语在不同汉字下共用一段音频；若词库给同一个词标注不同拼音，脚本会报错，
需要先确认其读音后再生成。

- 字音 ID：`char-` 加汉字 Unicode 码点的小写十六进制，如“一”为 `char-4e00`。
- 词音 ID：`word-` 加逐字码点并用 `-` 连接，如“一个”为 `word-4e00-4e2a`。
- 文件名为 `{ID}.mp3`。清单位于 `public/data/writing-vocabulary-audio.json`，
  除音频哈希和版本信息外，还保留词库原文、带声调拼音和实际合成输入。
- 多音字可以在词库设置 `characterSpeech`，用包含目标读音的简短词句作为合成输入；
  清单保留该字段与 `synthesisText`，界面显示的汉字与拼音仍来自原条目。
  未设置时直接合成该汉字。词语按整个词合成，不逐字拼接音频。
- 731 段字词录音全部采用 Serena，使用与笔顺提示、英文和中文释义相同的模型及音量处理。
  原来的晓晓、婷婷混合录音已统一替换；模型与来源记录见[统一音频说明](unified-audio.md)。

```sh
python3 scripts/generate-writing-vocabulary-audio.py --check
```

`ChenchenWritingAudio.create()` 返回 `playStroke(index, signal)`、
`playReading(id, signal)`、`stop()` 和 `destroy()`。字、词与报画共用一个 Audio 元素，
新的播放会取消前一段；切换页面或停止时可直接中止。`playReading` 仅接受字音或词音 ID，
直接映射站内路径，在点击回调内同步调用 `play()`，无需等待清单下载。
播放 Promise 只在音频播完后完成，取消为 `AbortError`，加载或播放超过 20 秒为
`TimeoutError`，浏览器禁止播放时保留 `NotAllowedError`。
