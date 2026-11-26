# 拼音范音来源与许可

本目录的 `sound-*.mp3` 是拼音音节库中的真人录音，另有一条韵母剪辑；不是用英语字母或示例汉字做文字转语音。

## 原始录音

- 作品：`zh_syllabs`，项目 [audio-cmn](https://github.com/hugolpz/audio-cmn)
- 朗读者：Chen Wang 王琛
- 作者：Wang Chen, Lopez Hugo, Vion Nicolas
- 原始版权：Copyright© 2013 Wang Chen, Lopez Hugo, Vion Nicolas
- 许可：[Creative Commons Attribution-ShareAlike 3.0 Unported / CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
- 固定版本：`ff9ed3d0c631195bd2c06f39450f3264c7124040`
- 来源目录：`64k/syllabs/cmn-{音节与声调}.mp3`

每个原始 MP3 的 ID3 内含以下声明；`sound-manifest.json` 为每条文件逐项保留来源、哈希、时长和这些标签，未修改的 46 条文件保留完整原始 MP3 字节。

```text
SWAC_SPEAK_NAME = Chen Wang 王琛
SWAC_COLL_AUTHORS = Wang Chen, Lopez Hugo, Vion Nicolas
SWAC_COLL_LICENSE = CC-BY-SA-3.0
SWAC_COLL_COPYRIGHT = Copyright© 2013 Wang Chen, Lopez Hugo, Vion Nicolas
SWAC_COLL_DESC = Project to record all zh syllabs.
```

原项目说明原文保存在 `sources/audio-cmn-README.md`，许可正文保存在 `CC-BY-SA-3.0.txt`。许可正文取自 [Creative Commons 官方源码库](https://github.com/creativecommons/cc-legal-tools-data/blob/main/legacy/legalcode/by-sa_3.0.txt)。这些录音及本项目对录音的改编继续按 CC BY-SA 3.0 分发；它们不适用项目代码的其他许可。署名不表示原作者认可本应用。

## 教学映射

23 个声母使用呼读音录音：`b→bo1`、`p→po1`、`m→mo1`、`f→fo1`、`d→de1`、`t→te1`、`n→ne1`、`l→le1`、`g→ge1`、`k→ke1`、`h→he1`、`j→ji1`、`q→qi1`、`x→xi1`、`zh→zhi1`、`ch→chi1`、`sh→shi1`、`r→ri1`、`z→zi1`、`c→ci1`、`s→si1`、`y→yi1`、`w→wu1`。这是声母教学中的呼读音，不是把单个英语字母读成字母名称，也不应描述为去除元音后的纯辅音。

韵母使用第一声的零声母音节录音。其中：

| 韵母 | 原始录音中的正字法 |
| --- | --- |
| i、u、ü | yi1、wu1、yu1 |
| ui、iu | wei1、you1 |
| ie、üe | ye1、yue1 |
| in、un、ün、ing | yin1、wen1、yun1、ying1 |

这些 y / w 是零声母音节的拼写形式。`ui`、`iu`、`un` 在没有前置声母时使用展开形式 `uei`、`iou`、`uen`，相应拼写为 `wei`、`you`、`wen`。`ong` 未用 `weng` 替代。

## ong 的剪辑记录

原库没有孤立 `ong1`，本项目从同一作者的 `cmn-dong1.mp3` 中截取元音和鼻音韵尾，去掉 `d` 的起始爆破及释放。原文件完整保存在 `sources/cmn-dong1.mp3`。

- 以 FFmpeg 解码后的 48 kHz 单声道时间轴为准，从 **0.370 秒**开始保留至文件末尾。
- 添加 8 毫秒淡入以避免截点跳变，再添加 120 毫秒前置静音。
- 不改变音高或语速，以 64 kbps MP3 保存。
- 新文件保留原始作者和许可标签，附加 `CHENCHEN_ADAPTATION` 标签。此剪辑由 chenchen-learning 项目制作并按相同的 CC BY-SA 3.0 许可提供。

波形和频谱对照了同一作者的 `dong1`、`gong1`、`hong1`。`dong1` 中起始爆破及释放约在 0.339–0.355 秒，0.370 秒处已有规则的元音谐波；裁剪舍去辅音及其向元音过渡的短段，保留后续元音和鼻音。该检查确认信号切分位置、文件有效性与素材来源，**不等同于普通话教师的人工听审**。

## 重建与检查

```sh
python3 -m pip install mutagen
# 另需安装 FFmpeg，或设置 FFMPEG=/绝对路径/ffmpeg
python3 scripts/fetch-pinyin-sounds.py
node scripts/test-pinyin-sounds.cjs
```

脚本固定原始录音版本并核对嵌入的录音许可。`sound-manifest.json` 记录全部 47 个按钮和对应来源，例字音频在另外的清单中管理，不适用本说明。
