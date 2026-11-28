# 拼音与例字音频

拼音大卡播放对应的声母呼读音、韵母音或整体认读音节。声母和韵母各配三个例字，整体认读音节各配一个例字。点击例字播放带声调的汉字读音。

## 63 条拼音范音

`public/audio/pinyin/sound-*.mp3` 来自 [audio-cmn](https://github.com/hugolpz/audio-cmn) 的真人拼音音节录音，朗读者 Chen Wang 王琛；作者 Wang Chen, Lopez Hugo, Vion Nicolas，Copyright © 2013。全部原始录音 ID3 均明确标注 **CC BY-SA 3.0**。

- 23 个声母用教学呼读音，例如 `b → bo1`、`zh → zhi1`。
- 韵母使用零声母音节录音；`ui/iu/un → wei1/you1/wen1` 是展开形式的拼写，`ü/üe/ün → yu1/yue1/yun1`，没有把 ü 读成 u。
- 16 个整体认读音节使用完整的第一声录音，例如 `zhi → zhi1`、`yuan → yuan1`。
- 62 条音频只重命名，保持原始字节。`ong` 从 `dong1` 的 0.370 秒处截取元音及鼻音尾，加入 8 毫秒淡入和 120 毫秒前静音。保留原始文件和精确剪辑记录。

范音测试检查文件哈希、MP3 帧和录音许可标签。`ong` 切点已通过波形和频谱与同一作者的 `gong1/hong1` 对照。

部署目录中随包提供 [完整署名、映射及改编说明](../public/audio/pinyin/SOUND-LICENSE.md)、[许可正文](../public/audio/pinyin/CC-BY-SA-3.0.txt)、[逐文件清单](../public/audio/pinyin/sound-manifest.json) 及原始 `dong1`。这些录音及剪辑继续按 CC BY-SA 3.0 分发。

重建范音需 Python 的 `mutagen` 和 FFmpeg：

```sh
python3 scripts/fetch-pinyin-sounds.py
node scripts/test-pinyin-sounds.cjs
```

## 例字读音

例字有 122 段不重复读音，统一为 Qwen3-TTS Base 固定 Serena 参考女声。与写字字音匹配的片段共用录音。补充例字使用“单字 + 句号”作为合成输入。具体模型、参数和重建步骤见[统一音频说明](unified-audio.md)。

```sh
python3 scripts/generate-pinyin-examples-audio.py --check
node scripts/test-pinyin-examples.cjs
```
