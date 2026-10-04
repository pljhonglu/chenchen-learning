# 小树成长系统 · 历史生成素材

> 当前首页采用生成环境图片与 SVG 生长植物的混合方案，见 [实现说明](garden-svg-scene.md) 和 [当前素材及提示词](garden-painted-assets.md)。以下保存此前兔子与树木位图方案的素材来源与制作过程，已不代表当前页面的实现。

使用内置 `image_gen` 生成原创位图，保存到 `public/images/garden/`。素材沿用项目的暖色绘本风格：奶油纸纹、水粉与水彩、鼠尾草绿、柔和杏色。树、背景、小兔和礼物分层，页面文字与交互由 HTML 呈现，不烘焙到图片中。

## 文件与来源

| 文件 | 尺寸 | 用途 |
| --- | --- | --- |
| `meadow.png` | 1536 × 1024 | 草地背景，无树、角色或文字 |
| `tree-stages-v2.png` | 1254 × 1254，透明 | 4 × 4 的 16 阶段树木图集 |
| `companions.png` | 2172 × 724，透明 | 横向三格：小兔、浇水壶、闭合礼物盒 |
| `rabbit-parts.png` | 1254 × 1254，透明 | 历史方案：睁眼/闭眼头部、身体、双耳、双臂、水壶、礼物部件 |
| `tree-parts.png` | 1448 × 1086，透明 | 历史方案：树干、叶簇、叶对、幼苗茎、花苞、花、青果、熟果、蝴蝶、小鸟、鸟窝、嫩叶 |
| `watering-can-top-handle.png` | 1254 × 1254，透明 | 带上提把的小水壶，双爪共同握持 |

此前首页由 `garden-scene.js` 组合两张 parts 图集和独立的上提把水壶，按统一坐标系独立控制部件。SVG viewBox 使用目视校核的裁切矩形，源 PNG 像素和透明通道保持原样。兔子部件按原图中的肩膀、耳根、手掌、壶把等实际挂点等比放置；头部素材自带的约 10° 倾斜在静止姿态中校正。两只前爪共同握住上提把，肩部固定在身体上，各自用保持比例的变换跟随把手。上身与手臂一起前倾 6°，壶在手腕处另倾 22°；脚保持着地，出水点跟随完整变换。前三阶段使用连续 SVG 幼苗茎和侧枝，叶柄接在茎上，不复用成年木质枝干。礼物卡片复用新小兔图集第九格；旧树图集 v2 用作模块未加载时的静态后备，旧伙伴图集继续用于日历标题。初版树图仅留在生成工具原始目录。旧素材原始文件分别为：

- 草地：`exec-44e68c7a-25a3-470d-bb7e-040be4c462e0.png`
- 树初版：`exec-5bcdf18d-1d0c-4c54-9c97-af63bb4cd12d.png`
- 树 v2：`exec-e2f9f979-100d-4208-b733-40f4db6c5875.png`
- 伙伴：`exec-1fcdbda7-938d-488f-a3d2-b6a90791f5ea.png`

原始输出目录：`~/.codex/generated_images/01a0feba-517f-7d30-ab0b-74c508ce4ea1/`。应用仅引用工作区内的副本。

2026-10-04 新部件使用内置 `image_gen`（非 CLI）生成，`transparent_background=true`，分别以旧伙伴图和旧树图作画风参考。原始输出目录为 `~/.codex/generated_images/01a1066a-0e1e-74b0-bfa0-3eba3c8af059/`：

- 小兔：`exec-546c0165-ce8b-4173-9877-9c3a6878881f.png` → `public/images/garden/rabbit-parts.png`。
- 树：`exec-2b395bda-5bb3-48f7-b598-777c776f8aa8.png` → `public/images/garden/tree-parts.png`。

两张部件图共约 2.6 MiB，上提把水壶约 976 KiB；GSAP 核心约 71 KiB（均为未压缩文件大小）。背景沿用原图，未以“增加库即可提升性能”代替实测。

左右手臂分别使用小兔图集第六、第七格。肘部向身体外侧弯，前爪向内收，水壶居中悬在双爪下方。头部遮住肩部连接处，避免肩膀贴到脸颊上。此前浏览器回归在提壶、倾倒、庆祝和回位的关键帧检查肘部方向、双爪与壶把连接、肩部连接、壶底离地以及出水点。

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

- 首次进入：小兔眨眼、点头、耳朵回弹，约 1.75 秒，有限播放。
- 浇水成功：靠近、持壶倾倒、壶嘴到树根的水流、叶片回应、回到原位，约 3.3 秒。
- 里程碑：同一根部上的枝叶/花果展开，配合小兔下蹲、起跳和落地缓冲，约 4.8 秒；结束后才展示闭合礼物盒，不展示具体奖品。
- 整组完成：一次水滴出现动画，不自动开始下一组。
- 动画仅响应已确认保存的结果，不负责扣水或发礼物；一次只有一条浇水时间线，播放期间不接受新的浇水。第 3 次完整播放后休息。
- 离开页面销毁时间线与监听器，后台切换和动态偏好变化立即收束；`prefers-reduced-motion`、GSAP 缺失或部件图失败时直接显示已保存的结果，避免按钮卡住。

## 视觉验收

在390px手机、820px平板、桌面浏览器检查过场景与日历：无水平溢出；16阶段保留完整树冠，成年树不覆盖标题；图集背景透明；日期上的水滴收入和实际浇水分开展示。

## 新部件的完整生成提示词

### 上提把水壶（参考 rabbit-parts.png）

内置 `image_gen` 编辑，`transparent_background=true`。原始文件 `~/.codex/generated_images/01a1066a-0e1e-74b0-bfa0-3eba3c8af059/exec-ba99eec2-30c4-46a3-88e7-2c5d23a22e9d.png`，原样复制到 `public/images/garden/watering-can-top-handle.png`，保留透明通道。

Use case: precise-object-edit. Edit the sage green watering can from the reference atlas into one standalone small watering can with a TOP CARRY HANDLE. Output ONLY the watering can, no atlas or rabbit parts. Keep the reference's watercolor/gouache children's picture-book texture, sage-green metal, soft brass rim and warm highlights. Compact rounded squat cylindrical reservoir, side view, upright flat bottom, short gently ascending spout pointing RIGHT with a small round perforated rose. Replace the left side loop with a large simple semicircular arch centered ABOVE the reservoir: an overhead carry handle, like a small bucket handle, clearly separated from the open rim by transparent space. This handle must have a wide horizontal top grip and be easy for two little paws to hold together. No rear/side handle. The reservoir is about half as tall as it is wide; the arch rises about half a reservoir height. Complete silhouette centered in a square transparent canvas with generous margins. True transparent background, preserve alpha. No water, hands, paws, rabbit, text, labels, scenery, ground, shadow or border.

### 小兔（参考 companions.png）

Use case: illustration-story. Create a production animation PARTS atlas for the ivory baby rabbit gardener in the reference. Preserve its premium watercolor/gouache paper texture, sage linen overalls, warm gentle face and ivory fur, front view slightly looking right. TRUE transparent background. One square image, EXACT 3 columns x 3 rows, nine equal cells with ample 15% empty gutters. Separate isolated parts, NOT assembled rabbits. Reading order: (1) round rabbit HEAD with open warm brown eyes, nose, cheeks, NO EARS, NO NECK/BODY; (2) IDENTICAL head, same dimensions and pose, eyes gently CLOSED; (3) plump sage overalls TORSO with ivory neck stub and both short legs/feet, NO head/ears/arms; (4) one tall left EAR, ivory with blush inner ear, straight upright; (5) matching right EAR straight upright; (6) left ARM with ivory paw, extended gently down, complete rounded shoulder for overlapping; (7) matching right ARM and paw; (8) sage watering CAN in side view, handle on LEFT and long spout pointing RIGHT, NO water; (9) small closed cream and apricot GIFT with terracotta bow. Every part centered in its own cell, fully contained, no overlap between cells. Soft brush edges, warm dimensional hand-painted nursery picture-book look, simple readable silhouettes. No text, numbers, cell borders, ground, shadow, backdrop, checkerboard, hard vector outlines. The two heads must match exactly except eyelids.

### 树（参考 tree-stages-v2.png）

Use case: illustration-story. Production modular botanical ANIMATION PARTS atlas matching reference's warm watercolor/gouache nursery fruit tree. Create landscape 4 columns x 3 rows, exactly 12 equal square cells with transparent background, generous empty gutters and fully separated objects. Reading order: row1 (1) bare brown fruit tree TRUNK with roots at bottom, graceful main stem and 3 short branching limbs, absolutely NO leaves, NO soil; (2) dense rounded oval cluster of overlapping sage/olive green LEAVES, no trunk/branches; (3) one TWO-LEAF sprig with a tiny connecting petiole, no trunk; (4) slim young sapling bare STEM with tiny root flare and two very short side branches, no leaves. Row2 (5) one closed rosy flower BUD with tiny green sepals; (6) one open pale pink five-petal BLOSSOM yellow center; (7) one GREEN immature round fruit with tiny stalk; (8) one RIPE warm APRICOT orange fruit with tiny stalk. Row3 (9) one small soft amber BUTTERFLY wings open; (10) one adorable blue-gray SONGBIRD perched facing left, complete feet, no branch; (11) one cozy brown twig NEST empty, side view, no tree; (12) one fresh light green single LEAF with short stem. Each item centered, no neighboring elements, maximum80% cell size, clean transparent gutters. Rich hand-painted detail and warm paper grain INSIDE forms only, harmonious restrained colors. No assembled tree, no full backdrop, no ground, no text, numbering, borders or checkerboard. Keep all parts wholly inside their cells, including roots, wings and stems.
