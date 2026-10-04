# 小树成长系统 · 生成素材与动画

使用内置 `image_gen` 生成原创位图，保存到 `public/images/garden/`。素材沿用项目的暖色绘本风格：奶油纸纹、水粉与水彩、鼠尾草绿、柔和杏色。树、背景、小兔和礼物分层，页面文字与交互由 HTML 呈现，不烘焙到图片中。

## 文件与来源

| 文件 | 尺寸 | 用途 |
| --- | --- | --- |
| `meadow.png` | 1536 × 1024 | 草地背景，无树、角色或文字 |
| `tree-stages-v2.png` | 1254 × 1254，透明 | 4 × 4 的 16 阶段树木图集 |
| `companions.png` | 2172 × 724，透明 | 横向三格：小兔、浇水壶、闭合礼物盒 |

页面使用树图集 v2；初版仅留在生成工具的原始输出目录，不随应用重复分发。内置生成工具的原始文件分别为：

- 草地：`exec-44e68c7a-25a3-470d-bb7e-040be4c462e0.png`
- 树初版：`exec-5bcdf18d-1d0c-4c54-9c97-af63bb4cd12d.png`
- 树 v2：`exec-e2f9f979-100d-4208-b733-40f4db6c5875.png`
- 伙伴：`exec-1fcdbda7-938d-488f-a3d2-b6a90791f5ea.png`

原始输出目录：`~/.codex/generated_images/01a0feba-517f-7d30-ab0b-74c508ce4ea1/`。应用仅引用工作区内的副本。

## 生成提示词

### 草地

Use case: illustration-story. Original wide landscape 3:2 background for an interactive tree and rabbit. Warm premium picture-book matte gouache and watercolor, cream paper texture, sage, pale olive, ivory, dusty peach. Central 65% quiet open meadow and ivory sky; soft earth oval planting place near x58%, y76%. Low hedges and hills, cream daisies and clover in bottom corners, a curved stepping-stone path from lower left fading into lawn. Outer edges fade toward cream. Gentle daylight, restrained colors. No central or large tree, rabbit, characters, gift, text, labels, UI, buildings, sun icon, watermark, vector or plastic 3D.

### 树的 16 个阶段

Use case: illustration-story. Production square transparent PNG sprite atlas for a premium kindergarten garden. Exactly 4 columns and 4 rows, 16 equal cells without grid lines or labels. The same broadleaf fruit tree progresses through all stages, centered in each cell with a consistent root baseline and complete silhouettes. Matte gouache watercolor, paper grain inside painted forms, sage and jade leaves, brown trunk, apricot fruit, pink flowers. No vector or plastic 3D. Only a tiny root mound, no other ground or scenery. Stages in reading order: tiny two-leaf seedling; four leaves; taller sapling; first side branch; fuller crown; pink buds; pink flowers; green fruit; ripe orange fruit; butterfly visitor; small blue-gray songbird; nest; mature tree with new leaves; mature buds; mature flowers; mature ripe fruit. First seedling about32% cell height, mature tree up to80%, consistent front view. No text, numbers, UI, checkerboard, backdrop, houses, pots or gifts.

### 树图集 v2 布局修正

Use case: precise-object-edit. Correct this 4 by 4 transparent tree sprite atlas for production cropping. Preserve exactly the same 16 tree designs, stage order, hand-painted gouache watercolor style, colors, trunk shapes, flowers, fruits and guests. Fix only layout and scale to make it crop-safe. Output one square canvas with 16 equal squares and a true transparent background. Each tree must be wholly contained within its own cell, centered horizontally, root base at84% cell height. Keep at least12% transparent margin on left, right, top and bottom. Scale mature trees down to maximum76% cell width and72% cell height. Generous transparent gutters between every row and column, no overlap. Clean transparent antialiased painted edges, no stray pigment outside silhouettes. No grid lines, numbers, text, backdrop or added external shadow. Prioritize equal-cell alignment and safe padding. All16 complete trees visible.

生成图的实际行边界仍非严格等分，因此 `garden.js` 的 `treeStyle()` 使用经过目视校核的行范围进行 CSS 定位，避免第三行串格及成年树冠裁切。未通过程序重绘素材。

### 小兔、水壶与礼物

Use case: illustration-story. Production-quality transparent PNG sprite strip for a premium kindergarten picture-book learning garden. Exactly three equal square cells in one wide horizontal3:1 canvas, no borders, consistent padding. Left: adorable ivory-white rabbit with soft pink inner ears, sage-green linen gardening overalls, warm brown tiny eyes, quiet delight, whole body and ears visible, simple natural pose without tools. Middle: charming sage-green watering can with long spout, round handle and tiny warm brass details, side view slightly toward right, no water stream. Right: a single closed cream-and-soft-apricot gift box tied with muted terracotta ribbon and bow; contents invisible. Matching hand-painted children's picture-book gouache watercolor, tactile paper grain only inside shapes, softly irregular brush edges, restrained palette and subtle depth. True transparent background and gutters. Objects centered with baseline near86% and maximum75% height; padded edges. No text, symbols, numbers, ground, checkerboard, borders, backdrop, vector outlines, plastic 3D or watermark. The rabbit is a decorative companion, not a narrator.

## 动画约束

- 首次进入：背景显现、树轻摇、小兔轻微呼吸，有限次数，约6.5秒内结束。
- 浇水成功：水壶倾斜、水滴落下、小树回应、小兔跳动，约2.6秒内结束。
- 里程碑：树长大、柔光和闭合礼物盒出现；当天仅该里程碑记录一次，不展示具体奖品。
- 整组完成：一次水滴出现动画，不自动开始下一组。
- 离开页面清理计时器；达到每日浇水上限停止场景动作。开启 `prefers-reduced-motion` 时关闭非必要动画。

## 视觉验收

在390px手机、820px平板、桌面浏览器检查过场景与日历：无水平溢出；16阶段保留完整树冠，成年树不覆盖标题；图集背景透明；日期上的水滴收入和实际浇水分开展示。
