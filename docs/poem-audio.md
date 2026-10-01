# 古诗自然朗读

35 首古诗的朗读文件已存放在 `public/audio/poems/`，随网站一起发布。
播放器使用 HTML Audio，按诗歌 ID 播放对应 MP3；打开页面时不调用外部语音服务，
也不依赖手机或电脑安装的系统中文声音。页面只显示一个朗读按钮，点击播放，再点暂停，再点从原位置继续；离开详情或切换诗歌时自动停止。
加载失败、浏览器禁止播放或加载超过 20 秒时，会回到空闲并通知页面显示提示，
不会悄悄切回可能读错多音字的系统朗读。页面的简短操作引导仍可使用系统语音。

## 声音与文本

- 声音为 Microsoft Edge Read Aloud 的 `zh-CN-XiaoxiaoNeural`，属于 **AI 合成自然语音**，不是真人录制。
- 合成速度为 `-22%`，依次读标题、朝代作者、所有诗句；每句使用句号留出停顿。
- MP3 为单声道 24 kHz、48 kbps。没有转用第三方商业朗诵录音，也没有模仿指定真人。
- `public/data/poem-audio.json` 记录来源、声音、合成输入、校音清单、时长、文件哈希及文本哈希。

## 多音字校正

Edge Read Aloud 目前不支持自定义 `phoneme` SSML。因此生成脚本按“原字 + 诗歌拼音”
匹配，在**仅供语音生成的输入**中采用同音替换，网页仍显示原诗与正确拼音。例如：

| 原字与语境 | 目标读音 | 合成输入中的同音字 |
| --- | --- | --- |
| 朝辞白帝 | zhāo | 招 |
| 一日还 | huán | 环 |
| 万重山 | chóng | 虫 |
| 一行白鹭 | háng | 航 |
| 查慎行 | zhā | 渣 |
| 草低见牛羊 | xiàn | 现 |
| 不应人 | yìng | 映 |

另外对挑、长、泊、笼、纶、冠、露、种、曲、乐、为、和、磨、蒙等易误读字记录校正。
例如《画》的“花还在”是 hái，不会被“还 huán”的规则误改。

《小儿垂钓》“怕得鱼惊不应人”中的“应”表示回应，数据中的拼音已从 yīng 修正为 yìng，
音频同步按第四声生成。字义和读音参照[教育部《重编国语辞典修订本》“应”](https://dict.revised.moe.edu.tw/dictView.jsp?ID=11199&la=0&powerMode=0)。

## 重新生成与检查

仅构建时需要 Python 3.9+、网络及以下依赖；部署运行不需要它们：

```sh
python3 -m pip install edge-tts==7.2.8 mutagen==1.47.0
python3 scripts/generate-poem-audio.py --dry-run
python3 scripts/generate-poem-audio.py
python3 scripts/generate-poem-audio.py --check
node scripts/test-speech.cjs
```

可以用 `--id poem-10 --force` 仅重做某首。脚本每完成一首就写入清单，失败可重跑；
已有且文本哈希一致的音频会保留。改变诗文、拼音、声音、语速或校音规则后，
`--check` 会检查旧录音是否仍与生成输入一致，必要时应重新生成。

自动检查覆盖全部文件的 MP3 元数据、时长、字节数、SHA-256、诗文/拼音输入一致性，以及
播放器的暂停继续、旧事件取消、加载超时、拒绝播放和失败不降级。自动检查不等同于专业老师的逐字听审；
同音替换也不等同于服务原生的音素控制。完整合成输入保存在清单中，便于后续针对听到的问题重做单首。

技术资料：[edge-tts 官方项目与自定义 SSML 限制](https://github.com/rany2/edge-tts#custom-ssml)、
[Microsoft SSML 发音控制文档](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-synthesis-markup-pronunciation)。
