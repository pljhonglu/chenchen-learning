# 当前绘本环境素材

2026-10-04，使用内置 `image_gen` 工具生成两张原创插画。环境负责纸感和笔触，树木、花果、浇水与成长访客继续由 SVG + GSAP 控制。没有把整幅画面烘焙成动画视频，也不需要运行时图像生成请求。

## 保存的文件

| 用途 | 网页素材 | 尺寸 | 文件大小 | 原始生成图 |
| --- | --- | --- | --- | --- |
| 远山、草地、花丛背景 | [meadow-painted.webp](../public/images/garden/meadow-painted.webp) | 1604 × 980 | 141,158 字节 | [meadow-painted-source.png](../public/images/garden/meadow-painted-source.png) |
| 透明云朵，复用为两朵远近云 | [cloud-painted.webp](../public/images/garden/cloud-painted.webp) | 720 × 240 | 17,438 字节 | [cloud-painted-source.png](../public/images/garden/cloud-painted-source.png) |

两张原始 PNG 原样保存；网页版本仅做 WebP 编码和云朵等比缩小，没有重新绘制或拼贴。原始云朵为 2172 × 724 RGBA，透明通道保留。页面只请求 WebP，原图留供后续修改。

工具原始输出：

- 背景：`/Users/bytedance/.codex/generated_images/01a1066a-0e1e-74b0-bfa0-3eba3c8af059/exec-2ac53f5f-33b7-45a5-a769-675029a59b39.png`
- 云朵：`/Users/bytedance/.codex/generated_images/01a1066a-0e1e-74b0-bfa0-3eba3c8af059/exec-715b15c0-3f0c-4191-9320-d476d0dc18ef.png`

## 完整生成提示词

### 背景（不透明）

```text
Use case: illustration-story. Asset type: painted scenery background for an existing children's learning garden UI, not a UI mockup. Create an original wide landscape illustration, approximately 18:11 landscape composition. Warm quiet children's picture-book gouache with delicate watercolor edges, subtle cream paper grain, sage green, pale olive, soft ivory, restrained peach and butter yellow. An open sunlit meadow with softly layered distant hills and a few faraway shrubs at the outer sides. Upper 60 percent mostly airy warm ivory sky, no sharp sun disk. Lower 40 percent soft grassy meadow with understated brush marks. A few small cream daisies, tiny peach flowers, clover and rounded pebbles frame the lower sides around x20% and x80%, y85%; keep them low. Crucial: central vertical space x30%–70%, y18%–84% is calm, low contrast, unobstructed because a separately animated tree will be composited there. Ground at center x50%, y79% must be level continuous grass for that tree's roots, not a raised island, not a hole. Leave the upper-left quarter very light and quiet for interface headings. Edge-to-edge painted background, no border. Keep shapes simplified enough to harmonize with a soft illustrated vector tree; handmade brush texture but not photorealistic or over-detailed. No tree in the center, no standalone foreground tree anywhere, no people, no rabbits, no animals, no watering can, no pots, no sign, no labels, no text, no watermark, no floating island, no interface, no thick outlined vector shapes. Do not paint prominent clouds: separate cloud sprites will be animated.
```

### 云朵（透明）

```text
Use case: illustration-story. Asset type: one transparent cloud sprite for a children's picture-book garden. Paint one isolated low, wide, softly billowing cloud, approximately 3:1 silhouette, with two gently rounded uneven peaks and a flatter wispy base. Matte gouache and delicate watercolor on cream paper, warm ivory white with very subtle pale sage-gray shading underneath and barely visible peach reflected light. Soft handmade brush edges, a few quiet pigment variations, simplified child-friendly illustration, not photorealistic, not a vector icon, not glossy 3D. The silhouette must be cleanly isolated on a genuinely transparent background; all space around the cloud remains transparent. Make the cloud fill most of the width with generous small margins and no clipping. No sky, sun, ground, extra clouds, text, stars, face, border, shadow cast outside the cloud, or watermark.
```

## 接入方式

背景居中铺满花园容器；云朵与 SVG 植物同坐标，由现有环境时钟移动。每日照顾完成、离屏、页面隐藏和减少动态效果时统一暂停；图片加载独立于保存和成长流程。实际实现与检查说明见 [混合绘本小花园](garden-svg-scene.md)。
