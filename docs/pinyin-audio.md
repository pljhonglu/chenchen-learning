# 拼音与例字音频

拼音大卡播放对应的声母呼读音或韵母音，不调用系统语音朗读英语字母，也不朗读例字来代替范音。下方三个例字分别播放带声调的汉字读音。

## 47 条拼音范音

`public/audio/pinyin/sound-*.mp3` 来自 [audio-cmn](https://github.com/hugolpz/audio-cmn) 的真人拼音音节录音，朗读者 Chen Wang 王琛；作者 Wang Chen, Lopez Hugo, Vion Nicolas，Copyright © 2013。全部原始录音 ID3 均明确标注 **CC BY-SA 3.0**。

- 23 个声母用教学呼读音，例如 `b → bo1`、`zh → zhi1`。
- 韵母使用零声母音节录音；`ui/iu/un → wei1/you1/wen1` 是展开形式的拼写，`ü/üe/ün → yu1/yue1/yun1`，没有把 ü 读成 u。
- 46 条音频只重命名，保持原始字节。`ong` 从 `dong1` 的 0.370 秒处截取元音及鼻音尾，加入 8 毫秒淡入和 120 毫秒前静音；未用 `weng` 替代。保留原始文件和精确剪辑记录。

全部 47 条已验证可解码、有声音、文件哈希与来源一致，并核对许可标签。`ong` 切点已通过波形/频谱与同一作者的 `gong1/hong1` 对照；这不是教师人工听审。

部署目录中随包提供 [完整署名、映射及改编说明](../public/audio/pinyin/SOUND-LICENSE.md)、[许可正文](../public/audio/pinyin/CC-BY-SA-3.0.txt)、[逐文件清单](../public/audio/pinyin/sound-manifest.json) 及原始 `dong1`。这些录音及剪辑继续按 CC BY-SA 3.0 分发。

重建范音需 Python 的 `mutagen` 和 FFmpeg：

```sh
python3 scripts/fetch-pinyin-sounds.py
node scripts/test-pinyin-sounds.cjs
```

## 例字读音

例字有 112 段不重复读音：68 段复用已有写字音频，44 段补充合成。补充音频使用“单字 + 句号”作为合成输入；仅用于汉字读音，不代替拼音范音。具体音频、来源及生成参数见例字音频清单和生成脚本。

```sh
python3 scripts/generate-pinyin-examples-audio.py --check
node scripts/test-pinyin-examples.cjs
```
