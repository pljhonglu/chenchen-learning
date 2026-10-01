# 英语内容与随应用发布的朗读音频

`public/data/english.json` 收录 87 个学习项：老师已教的 39 项，以及家庭生活拓展的 48 项。
这里的“课堂已学”只表示出现在老师的作业中，不代表孩子已经掌握。
词组 `pencil case` 按一个学习项计算；字母、拼写和未提供具体歌词的律动未混入这个词库。
每项均包含中文意思、完整英文范句和句子中文翻译。范句逐项准备，未统一机械套用冠词。
例如 `This is an apple.`、`This is cheese.`、`These are scissors.`。

## 家长不会读英语也能陪学

每个学习项有三段独立音频，共 261 段：

- `{词条 ID}-word`：英文单词，例如 `english-cat-word` 对应 `cat`。
- `{词条 ID}-sentence`：完整英文范句，保留自然语流。
- `{词条 ID}-meaning`：中文词义加范句翻译，方便家长和孩子理解。

另有 15 段中文游戏引导、提示与反馈，共计 276 段 MP3。
文件位于 `public/audio/english/`，随网站一起发布；文件映射与元数据位于
`public/data/english-audio.json`。应用播放同域静态音频，不需要家长设备安装英语声音，
不调用外部语音服务，也不把孩子的声音上传给合成服务。

播放失败时应提示重新播放；不能把失败当作已经听完，也不能静默切回系统英语朗读。
浏览器的自动播放限制可能要求先点击“开始”或播放按钮。程序的听音选图可以客观记录结果，
跟读完成只记录练习参与，不等同于自动评定发音准确。

## 声音来源

- 所有 MP3 均为 **Microsoft Edge Read Aloud 的 AI 合成语音**，不是真人录制。
- 英语统一使用英式声音 `en-GB-SoniaNeural`，速度 `-12%`，与词库中的 `mum` 保持一致。
- 中文统一使用 `zh-CN-XiaoxiaoNeural`，速度 `-8%`。
- 使用完整句子生成句子音频，未把单词片段拼接成句子。
- 清单保留 `src`、`text`、`synthesisText`、`language`、声音、语速、合成输入哈希、
  文件 SHA-256、时长、字节数、采样率和码率，便于定位并重新生成单段内容。
- 音频的标准来源标签是“自然语音（AI 合成）”，不得展示为“老师真人范读”。

## 课堂内容中的待核对项

- `pear`：水果列表第一次是 `pea`，第二次是 `pear`；此处按第二次的“梨”整理。
- `beans`：老师中文写“豌豆”，豌豆通常是 `peas`；此处按英文 `beans` 配豆子图。
- `chicken`：本词出现在食物组，因此按“鸡肉”配图；也有“鸡”的含义。
- `grape`：单数词和范句搭配一颗葡萄，避免图片数量与语音冲突。
- `grandma`、`grandpa`、`brother`、`sister` 的中文亲属称呼需要结合家庭实际理解。

以上说明也保存在相应词条的 `note` 中，方便家长查看。

## 重新生成与离线检查

仅生成音频时需要 Python、网络和依赖；部署运行不需要：

```sh
python3 -m pip install edge-tts==7.2.8 mutagen==1.47.0
python3 scripts/generate-english-audio.py --dry-run
python3 scripts/generate-english-audio.py
python3 scripts/generate-english-audio.py --check
```

可以仅生成或检查单段：

```sh
python3 scripts/generate-english-audio.py --id english-cat-word --force
python3 scripts/generate-english-audio.py --id english-cat-word --check
```

`--check` 无需网络，逐条核对文本、声音、语速、MP3 路径、时长、文件大小、采样率、
码率和文件哈希。生成期间每完成一段便保存清单，意外中断后重跑会保留已经验证有效的音频。
改动英文、中文意思、翻译、引导词、声音或速度后，应重新生成相关音频，并完成全量检查。

这类自动检查能确认资源完整及文本与录音版本匹配，不能替代教师逐条听审。
若发现个别词的发音或语调需要调整，应修改对应条目并重新生成该段；不向家长提供看似精确的发音分数。

技术来源：[edge-tts 官方项目](https://github.com/rany2/edge-tts)。
