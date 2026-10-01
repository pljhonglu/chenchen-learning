# 笔顺动画的中文报画音频

`public/audio/writing/` 包含 22 段随网站发布的 MP3：

- `stroke-01` 到 `stroke-20`：依次说“第一画”到“第二十画”。
- `guide-start`：我们一笔一笔看。
- `guide-done`：写好啦，轮到你试一试。

`public/data/writing-audio.json` 以这些 ID 为键，记录 `src`、`text`、
`synthesisText`、`strokeNumber`（报画音频）、声音、语速、时长、字节数、
采样率、码率、合成输入哈希和文件 SHA-256。播放时按汉字笔顺使用对应序号，
不需要把多段报画音频拼接成文件。

音频使用 **Microsoft Edge Read Aloud 的 AI 合成语音**，中文声音统一为
`zh-CN-XiaoxiaoNeural`，速度 `-8%`，与英语模块的中文引导一致。
标准来源标签为“自然语音（AI 合成）”，不是真人录制。

应用运行时只需读取同域静态 MP3，无需调用外部语音服务，也无需家长设备安装声音。
浏览器可能要求先点击播放按钮。页面切换、停止或重新播放时，播放器应取消前一次播报和动画；
音频播放失败应明确提示并允许重试，不能把未播放的音频当作完成。

## 重新生成与检查

仅生成时需要 Python、网络和以下依赖；部署运行不需要：

```sh
python3 -m pip install edge-tts==7.2.8 mutagen==1.47.0
python3 scripts/generate-writing-audio.py --dry-run
python3 scripts/generate-writing-audio.py
python3 scripts/generate-writing-audio.py --check
```

可以只重做一段：

```sh
python3 scripts/generate-writing-audio.py --id stroke-01 --force
python3 scripts/generate-writing-audio.py --id stroke-01 --check
```

`--dry-run` 只显示生成输入，不连接语音服务。`--check` 离线核对全部文本、声音、
路径及 MP3 元数据和哈希。每完成一段都会保存清单，中断后重跑会保留已验证有效的音频。
修改报画文本、声音或语速后，需要重新生成对应音频并完成检查。
文件检查能确认资源完整和版本对应，不能代替实际听审。

技术来源：[edge-tts 官方项目](https://github.com/rany2/edge-tts)。
