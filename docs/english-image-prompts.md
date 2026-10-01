# 英语绘本插图：生成提示词与来源

本套图片用于现有学习程序的英语图卡。已参考 `public/images/poems/poem-01.webp` 的暖色水彩绘本气质，统一使用奶油色纸纹底、柔和水彩与不透明水粉、圆润轮廓和温暖配色。

- 生成方式：内置 `image_gen.imagegen`，不是 CLI/API 回退。每张图集分别生成，逐张查看确认语义。
- 共 11 张原创图集，提供 71 个具象词汇和情境插图；6 个颜色用界面色块呈现，10 个数字重复本套单个苹果插图，保证数量准确。
- 实际使用资源：`public/images/english/*.webp`，总计 1,909,010 字节（约 1.82 MiB）。
- 原始 PNG 生成后由 sharp 仅进行 WebP 格式编码（quality 88、effort 6），不裁切、不重绘、不改变像素尺寸。PNG 原稿路径保留在下方。
- 原图为 3×2 图集时 1536×1024，3×3 图集时 1254×1254。图卡使用 CSS 按等分网格呈现，不修改图片内容。
- 对应文件：`public/data/english-illustrations.json`。全部 87 个 ID 与 `english.json` 一一对应。图集 `index` 从 0 开始，按从左到右、从上到下排序。
- 原图纸纹和背景保留；无文字标签、品牌、水印。教材范句由页面单独渲染并播放语音。

## 已核对的教学语义

- mouse 是长尾老鼠；hamster 是无长尾、鼓脸的小仓鼠。
- grape 配一颗葡萄，watermelon 配一个完整西瓜；beans 配红褐色菜豆，不以豌豆冒充。
- chicken 在食物单元配熟鸡肉；milk 是白色不透明牛奶，water 是透明清水。
- eye、ear、hand、foot 使用单个部位；knee、toe、shoulder 用箭头指出局部，toe 与整个 foot 有明显区别。
- running 是小狗奔跑；sleeping 是小猫睡觉；dancing 与 jump 用不同姿态。
- big/small 都用相同大小对照的两个球，通过箭头明确指向大球或小球。
- 数字图卡由前端重复苹果图而不是依靠 AI 生成数量，以免出现错误数量。
- 家庭、情感与礼貌表达是示例情境，需要与中文引导及英语声音共同学习；单张静态插图不能穷尽抽象含义。

## animals-and-box

- 项目文件：`public/images/english/animals-and-box.webp`
- 原始 PNG：`/Users/neo/.codex/generated_images/01a0f68a-ae63-7ab1-b9e3-374849e9b3a9/exec-dcd83fa0-e81b-44b8-85a2-e3acfb8922d0.png`
- 网格：3 列 × 2 行
- 按 index 顺序：`0: english-dog`、`1: english-cat`、`2: english-mouse`、`3: english-hippo`、`4: english-hamster`、`5: english-box`

最终提示词：

```text
Use case: scientific-educational, illustration-story. Create one original educational sprite sheet for a five-year-old English learning picturebook app. A single landscape sheet with EXACTLY 3 columns and 2 rows of equal square cells, absolutely no text, captions, labels, letters, numbers, dividing lines or cell borders. Every illustration centered precisely in its own cell with at least 18% empty safe margin on all sides so each tile can be isolated via CSS. Background warm pale ivory watercolor paper, consistent across cells. Style: lovely traditional children's picturebook watercolor and opaque gouache, soft paper grain, rounded natural silhouettes, painterly edges, gentle warm muted ochre, sage and coral palette; polished handpainted art, no vector flat icons, no emoji, no 3D. Match a warm Chinese watercolor picturebook aesthetic. All subjects readable in silhouette and age appropriate; avoid decorative extraneous things.
Exact row-major subjects:
Top left: one friendly small golden-brown dog sitting, whole body.
Top center: one friendly orange-striped cat sitting, whole body, visibly different from dog.
Top right: one tiny gray mouse with a LONG thin tail, large round ears and pointed nose, whole body.
Bottom left: one gentle stout purple-gray hippopotamus, whole body, broad muzzle.
Bottom center: one fluffy golden hamster, rounded cheeks and tiny ears, no long tail, whole body.
Bottom right: one plain open light-brown cardboard box with four open flaps, empty.
Each cell only contains its assigned subject, with a subtle watercolor ground shadow. Output 1536x1024 if available, maintain sheet 3:2 aspect ratio.
```

## school

- 项目文件：`public/images/english/school.webp`
- 原始 PNG：`/Users/neo/.codex/generated_images/01a0f68a-ae63-7ab1-b9e3-374849e9b3a9/exec-f520ca2f-02fc-4cfd-bde9-3aee35109f47.png`
- 网格：3 列 × 2 行
- 按 index 顺序：`0: english-schoolbag`、`1: english-book`、`2: english-pencil`、`3: english-scissors`、`4: english-glue`、`5: english-pencil-case`

最终提示词：

```text
Use case: scientific-educational, illustration-story. Create one original educational sprite sheet for a five-year-old English learning picturebook app. A single landscape sheet with EXACTLY 3 columns and 2 rows of equal square cells, absolutely no text, captions, labels, letters, numbers, dividing lines or cell borders. Every illustration centered precisely in its own cell with at least 15% empty safe margin on all sides so each tile can be isolated via CSS. Background warm pale ivory watercolor paper, consistent across cells. Style: lovely traditional children's picturebook watercolor and opaque gouache, soft paper grain, rounded natural silhouettes, painterly edges, gentle warm muted ochre, sage and coral palette; polished handpainted art, no vector flat icons, no emoji, no 3D. All subjects readable in silhouette and age appropriate; avoid decorative extraneous things. Each cell only contains its assigned subject, with a subtle watercolor ground shadow. Output 1536x1024 if available, maintain sheet 3:2 aspect ratio. Exact row-major subjects:
Top left: one small coral red school backpack, closed front pocket, two visible shoulder straps, no writing.
Top center: one closed sage green book with visible white page edge and plain cover, no lettering.
Top right: one yellow wooden pencil with pink eraser, drawn diagonally, point and eraser clearly seen, no writing.
Bottom left: one pair of child-safe scissors with rounded gray metal tips and red finger loops.
Bottom center: one small white school glue bottle with blue tapered nozzle cap and plain unmarked yellow band.
Bottom right: one zipped elongated soft blue fabric pencil case, subtle decorative dots, no pencils beside it.
```

## fruit-and-vegetables

- 项目文件：`public/images/english/fruit-and-vegetables.webp`
- 原始 PNG：`/Users/neo/.codex/generated_images/01a0f68a-ae63-7ab1-b9e3-374849e9b3a9/exec-e71b972f-79c5-4623-9fa3-1479ab5659db.png`
- 网格：3 列 × 3 行
- 按 index 顺序：`0: english-pear`、`1: english-apple`、`2: english-plum`、`3: english-banana`、`4: english-watermelon`、`5: english-grape`、`6: english-orange`、`7: english-carrot`、`8: english-beans`

最终提示词：

```text
Use case: scientific-educational, illustration-story. Create one original educational sprite sheet for a five-year-old English learning picturebook app. A single square sheet with EXACTLY 3 columns and 3 rows of equal square cells, absolutely no text, captions, labels, letters, numbers, dividing lines or cell borders. Every illustration centered precisely in its own cell with at least 15% empty safe margin on all sides so each tile can be isolated via CSS. Background warm pale ivory watercolor paper, consistent across cells. Style: lovely traditional children's picturebook watercolor and opaque gouache, soft paper grain, rounded natural silhouettes, painterly edges, gentle warm muted ochre, sage and coral palette; polished handpainted art, no vector flat icons, no emoji, no 3D. All subjects readable in silhouette and age appropriate; avoid decorative extraneous things. Each cell only contains its assigned subject, with a subtle watercolor ground shadow. Output 1536x1536 if available, maintain sheet 1:1 aspect ratio. Exact row-major subjects:
Top left: one whole pear, yellow-green skin, recognizably narrow top and wide bottom with a brown stem.
Top center: one whole red apple, brown stem with one small green leaf.
Top right: one whole dark purple plum, slightly oval with a subtle groove and short stem, no leaves.
Middle left: one single curved ripe yellow banana, unpeeled.
Middle center: one single whole round watermelon with green striped rind; no cut pieces.
Middle right: ONE single small purple grape berry with a tiny short stem, not a bunch, no leaves.
Bottom left: one whole bright orange fruit with textured orange peel and one small green leaf.
Bottom center: one whole orange carrot with short fresh green leaves, diagonal.
Bottom right: a small neat group of exactly five red-brown kidney beans, visibly bean-shaped and no green peas or pods.
```

## food-one

- 项目文件：`public/images/english/food-one.webp`
- 原始 PNG：`/Users/neo/.codex/generated_images/01a0f68a-ae63-7ab1-b9e3-374849e9b3a9/exec-dd354e5a-6ae5-41a3-80ac-c5ad698cd911.png`
- 网格：3 列 × 2 行
- 按 index 顺序：`0: english-cheese`、`1: english-pizza`、`2: english-milk`、`3: english-egg`、`4: english-cake`、`5: english-rice`

最终提示词：

```text
Use case: scientific-educational, illustration-story. Create one original educational sprite sheet for a five-year-old English learning picturebook app. A single landscape sheet with EXACTLY 3 columns and 2 rows of equal square cells, absolutely no text, captions, labels, letters, numbers, dividing lines or cell borders. Every illustration centered precisely in its own cell with at least 15% empty safe margin on all sides so each tile can be isolated via CSS. Background warm pale ivory watercolor paper, consistent across cells. Style: lovely traditional children's picturebook watercolor and opaque gouache, soft paper grain, rounded natural silhouettes, painterly edges, gentle warm muted ochre, sage and coral palette; polished handpainted art, no vector flat icons, no emoji, no 3D. All subjects readable in silhouette and age appropriate; avoid decorative extraneous things. Each cell only contains its assigned subject, with a subtle watercolor ground shadow. Output 1536x1024 if available, maintain sheet 3:2 aspect ratio. Exact row-major subjects:
Top left: one wedge of pale golden cheese with several holes, alone.
Top center: one small round whole pizza, golden crust, melted cheese and a few tomato slices, overhead three-quarter view.
Top right: one clear drinking glass filled with opaque white milk, no bottle, no label.
Bottom left: one single whole pale-brown chicken egg, no broken shell.
Bottom center: one small round frosted celebration cake, pale cream with one strawberry on top, no candle, no writing.
Bottom right: one sage green bowl filled with fluffy cooked white rice, individual rice grains visible, no chopsticks, no other food.
```

## food-and-play

- 项目文件：`public/images/english/food-and-play.webp`
- 原始 PNG：`/Users/neo/.codex/generated_images/01a0f68a-ae63-7ab1-b9e3-374849e9b3a9/exec-6f3a3077-2a62-47a3-9961-2568d59511d4.png`
- 网格：3 列 × 2 行
- 按 index 顺序：`0: english-chicken`、`1: english-honey`、`2: english-hamburger`、`3: english-water`、`4: english-ball`、`5: english-happy`

最终提示词：

```text
Use case: scientific-educational, illustration-story. Create one original educational sprite sheet for a five-year-old English learning picturebook app. A single landscape sheet with EXACTLY 3 columns and 2 rows of equal square cells, absolutely no text, captions, labels, letters, numbers, dividing lines or cell borders. Every illustration centered precisely in its own cell with at least 15% empty safe margin on all sides so each tile can be isolated via CSS. Background warm pale ivory watercolor paper, consistent across cells. Style: lovely traditional children's picturebook watercolor and opaque gouache, soft paper grain, rounded natural silhouettes, painterly edges, gentle warm muted ochre, sage and coral palette; polished handpainted art, no vector flat icons, no emoji, no 3D. All subjects readable in silhouette and age appropriate; avoid decorative extraneous things. Each cell only contains its assigned subject, with a subtle watercolor ground shadow. Output 1536x1024 if available, maintain sheet 3:2 aspect ratio. Exact row-major subjects:
Top left: one cooked golden-brown chicken drumstick on a small plain cream plate, unmistakably cooked meat, no live chicken.
Top center: one small transparent jar filled with golden honey, wooden honey dipper resting beside it with a little honey drip, no lid and absolutely no label.
Top right: one hamburger with sesame bun, green lettuce, tomato and brown meat patty, no plate or fries.
Bottom left: one clear drinking glass filled with transparent clean WATER, pale blue reflections, water must be clear not opaque milk, no straw.
Bottom center: one children's toy ball with large muted red, blue and yellow curved panels.
Bottom right: waist-up portrait of a happy smiling five-year-old East Asian child with short dark hair in a sage green t-shirt, rosy cheeks, bright eyes, hands lifted cheerfully, no props.
```

## body-one

- 项目文件：`public/images/english/body-one.webp`
- 原始 PNG：`/Users/neo/.codex/generated_images/01a0f68a-ae63-7ab1-b9e3-374849e9b3a9/exec-89a5a25f-164c-4e28-8f93-cf06d44b84e8.png`
- 网格：3 列 × 2 行
- 按 index 顺序：`0: english-eye`、`1: english-ear`、`2: english-knee`、`3: english-toe`、`4: english-head`、`5: english-shoulder`

最终提示词：

```text
Use case: scientific-educational, illustration-story. Create one original educational sprite sheet for a five-year-old English learning picturebook app. A single landscape sheet with EXACTLY 3 columns and 2 rows of equal square cells, absolutely no text, captions, labels, letters, numbers, dividing lines or cell borders. Every illustration centered precisely in its own cell with at least 15% empty safe margin on all sides so each tile can be isolated via CSS. Background warm pale ivory watercolor paper, consistent across cells. Style: lovely traditional children's picturebook watercolor and opaque gouache, soft paper grain, rounded natural silhouettes, painterly edges, gentle warm muted ochre, sage and coral palette; polished handpainted art, no vector flat icons, no emoji, no 3D. All subjects readable in silhouette and age appropriate; avoid decorative extraneous things. Each cell only contains its assigned subject, with a subtle watercolor ground shadow. Output 1536x1024 if available, maintain sheet 3:2 aspect ratio. Exact row-major subjects:
Educational anatomy pictures, gentle friendly children's book style, not medical, no injuries. Show exactly the requested body part with enough surrounding context to recognize it. Use small hand-painted coral pointer arrows only where specified, and no text.
Top left: close-up of ONE friendly child's brown eye with eyebrow and a little surrounding peach skin, one eye only.
Top center: side close-up of ONE child's ear with gentle peach skin and tiny sliver of dark hair.
Top right: a child's bent leg in blue shorts, bare lower leg, a small coral arrow clearly pointing at the exposed kneecap, focus is KNEE.
Bottom left: close-up of one child's bare foot with five clear toes, viewed from above, a small coral arrow points exactly at the BIG TOE (not the entire foot).
Bottom center: a friendly child's complete HEAD including short dark hair, ears, eyes, nose, smiling mouth and neck, no torso or hands, round head fully contained in cell.
Bottom right: a child's upper torso in a sage green sleeveless shirt viewed three-quarter, neck and upper arms shown, a small coral arrow points precisely to ONE rounded exposed SHOULDER at the top of the arm, head mostly out of composition but never at cell edges.
```

## body-and-size

- 项目文件：`public/images/english/body-and-size.webp`
- 原始 PNG：`/Users/neo/.codex/generated_images/01a0f68a-ae63-7ab1-b9e3-374849e9b3a9/exec-c088359a-1f28-42f8-b66f-26e33947ddab.png`
- 网格：3 列 × 2 行
- 按 index 顺序：`0: english-nose`、`1: english-mouth`、`2: english-hand`、`3: english-foot`、`4: english-big`、`5: english-small`

最终提示词：

```text
Use case: scientific-educational, illustration-story. Create one original educational sprite sheet for a five-year-old English learning picturebook app. A single landscape sheet with EXACTLY 3 columns and 2 rows of equal square cells, absolutely no text, captions, labels, letters, numbers, dividing lines or cell borders. Every illustration centered precisely in its own cell with at least 15% empty safe margin on all sides so each tile can be isolated via CSS. Background warm pale ivory watercolor paper, consistent across cells. Style: lovely traditional children's picturebook watercolor and opaque gouache, soft paper grain, rounded natural silhouettes, painterly edges, gentle warm muted ochre, sage and coral palette; polished handpainted art, no vector flat icons, no emoji, no 3D. All subjects readable in silhouette and age appropriate; avoid decorative extraneous things. Each cell only contains its assigned subject, with a subtle watercolor ground shadow. Output 1536x1024 if available, maintain sheet 3:2 aspect ratio. Exact row-major subjects:
Top left: close-up of ONE friendly child's small nose with a little peach skin surrounding it, nose centered, no other face parts.
Top center: close-up of ONE friendly smiling child's mouth with lips and a few visible teeth, peach skin around it, no other face parts.
Top right: ONE child's open hand palm facing viewer with exactly five clearly separated normal fingers, whole hand and short wrist, no arms.
Bottom left: ONE child's entire bare foot seen from slightly above and to the side, exactly five normal toes, no arrows, no leg.
Bottom center: two identical style red toy balls sitting side by side on same baseline, left ball VERY BIG and right ball small; a little coral downward pointer arrow points to the BIG left ball. Both balls entirely inside this cell, wide gap from other cells.
Bottom right: two identical style red toy balls sitting side by side on same baseline, left ball VERY BIG and right ball small; a little coral downward pointer arrow points to the SMALL right ball. Both balls entirely inside this cell, wide gap from other cells.
Sizes should clearly contrast 3:1 diameter. In last two cells arrows indicate target meaning only; no text or symbols.
```

## actions-one

- 项目文件：`public/images/english/actions-one.webp`
- 原始 PNG：`/Users/neo/.codex/generated_images/01a0f68a-ae63-7ab1-b9e3-374849e9b3a9/exec-6c9424ef-5e67-4c35-9fbe-c02d432acb43.png`
- 网格：3 列 × 2 行
- 按 index 顺序：`0: english-running`、`1: english-dancing`、`2: english-sleeping`、`3: english-look`、`4: english-listen`、`5: english-point`

最终提示词：

```text
Use case: scientific-educational, illustration-story. Create one original educational sprite sheet for a five-year-old English learning picturebook app. A single landscape sheet with EXACTLY 3 columns and 2 rows of equal square cells, absolutely no text, captions, labels, letters, numbers, dividing lines or cell borders. Every illustration centered precisely in its own cell with at least 15% empty safe margin on all sides so each tile can be isolated via CSS. Background warm pale ivory watercolor paper, consistent across cells. Style: lovely traditional children's picturebook watercolor and opaque gouache, soft paper grain, rounded natural silhouettes, painterly edges, gentle warm muted ochre, sage and coral palette; polished handpainted art, no vector flat icons, no emoji, no 3D. All subjects readable in silhouette and age appropriate; avoid decorative extraneous things. Each cell only contains its assigned subject, with a subtle watercolor ground shadow. Output 1536x1024 if available, maintain sheet 3:2 aspect ratio. Exact row-major subjects:
Each cell is a small independent wordless action scene, with generous whitespace and every limb/object inside its own square. Children depicted as friendly five-year-old East Asian children with short dark hair, rounded storybook faces, sage green or coral clothes. Actions unambiguous.
Top left: a golden-brown DOG RUNNING energetically toward the right, full body side view, front and rear legs in a running stride and tail trailing, little dusty motion strokes below feet.
Top center: one child DANCING gracefully with one arm curved overhead and the other to the side, one toe pointed on the floor, both eyes happy, full body, no floating jump, no musical symbols.
Top right: one orange striped CAT SLEEPING curled into a ball on a simple sage cushion, eyes closed, relaxed face and paws tucked, no letters.
Bottom left: one child LOOKING at a small orange cat sitting right beside them, child and cat face each other, child's hand shading eyebrows as if looking carefully, no pointing finger, no touching.
Bottom center: waist-up child LISTENING intently with hand cupped behind ONE ear and head tilted slightly, mouth closed, no headphones, no letters.
Bottom right: child POINTING one extended index finger toward a closed green BOOK on a small low wooden stool, fingertip does not touch the book, clearly pointing, full arm visible.
```

## actions-two

- 项目文件：`public/images/english/actions-two.webp`
- 原始 PNG：`/Users/neo/.codex/generated_images/01a0f68a-ae63-7ab1-b9e3-374849e9b3a9/exec-17975f8a-01ae-4a14-9ffa-744b91f151f3.png`
- 网格：3 列 × 2 行
- 按 index 顺序：`0: english-touch`、`1: english-clap`、`2: english-jump`、`3: english-sit`、`4: english-stand`、`5: english-sad`

最终提示词：

```text
Use case: scientific-educational, illustration-story. Create one original educational sprite sheet for a five-year-old English learning picturebook app. A single landscape sheet with EXACTLY 3 columns and 2 rows of equal square cells, absolutely no text, captions, labels, letters, numbers, dividing lines or cell borders. Every illustration centered precisely in its own cell with at least 15% empty safe margin on all sides so each tile can be isolated via CSS. Background warm pale ivory watercolor paper, consistent across cells. Style: lovely traditional children's picturebook watercolor and opaque gouache, soft paper grain, rounded natural silhouettes, painterly edges, gentle warm muted ochre, sage and coral palette; polished handpainted art, no vector flat icons, no emoji, no 3D. All subjects readable in silhouette and age appropriate; avoid decorative extraneous things. Each cell only contains its assigned subject, with a subtle watercolor ground shadow. Output 1536x1024 if available, maintain sheet 3:2 aspect ratio. Exact row-major subjects:
Each cell is a small independent wordless action scene, with every limb and object entirely inside its own square. SAME friendly five-year-old East Asian child with short dark hair, rounded simple picturebook face, sage green shirt, ochre shorts and red shoes. Not photorealistic, handpainted children's storybook illustration.
Top left: child TOUCHING the top of their own head with one palm resting directly on hair, elbow lifted, other arm relaxed, full body.
Top center: child CLAPPING both hands directly in front of chest, two palms meeting, tiny curved motion strokes near hands, joyful, full body.
Top right: child JUMPING with both feet high off the ground, knees bent, both arms lifted, distinct ground shadow below with clear large air gap, full body.
Bottom left: child SITTING quietly on a small wooden chair, thighs horizontal and feet on floor, hands resting on knees, full chair and body visible.
Bottom center: child STANDING upright facing forward with both feet firmly on floor, arms relaxed at sides, full body and balanced posture.
Bottom right: waist-up child feeling SAD, downturned mouth, watery eyes with a single small tear, head slightly lowered, hands resting on lap, no injury or scary details.
```

## family

- 项目文件：`public/images/english/family.webp`
- 原始 PNG：`/Users/neo/.codex/generated_images/01a0f68a-ae63-7ab1-b9e3-374849e9b3a9/exec-df3bd24d-cd10-4348-9298-3e3ead876758.png`
- 网格：3 列 × 2 行
- 按 index 顺序：`0: english-mum`、`1: english-dad`、`2: english-grandma`、`3: english-grandpa`、`4: english-brother`、`5: english-sister`

最终提示词：

```text
Use case: scientific-educational, illustration-story. Create one original educational sprite sheet for a five-year-old English learning picturebook app. A single landscape sheet with EXACTLY 3 columns and 2 rows of equal square cells, absolutely no text, captions, labels, letters, numbers, dividing lines or cell borders. Every illustration centered precisely in its own cell with at least 15% empty safe margin on all sides so each tile can be isolated via CSS. Background warm pale ivory watercolor paper, consistent across cells. Style: lovely traditional children's picturebook watercolor and opaque gouache, soft paper grain, rounded natural silhouettes, painterly edges, gentle warm muted ochre, sage and coral palette; polished handpainted art, no vector flat icons, no emoji, no 3D. All subjects readable in silhouette and age appropriate; avoid decorative extraneous things. Each cell only contains its assigned subject, with a subtle watercolor ground shadow. Output 1536x1024 if available, maintain sheet 3:2 aspect ratio. Exact row-major subjects:
Each cell contains one individual member of the same warm friendly East Asian family, gently simplified rounded children's picturebook faces. Waist-up individual portraits, relaxed arms and warm smiles, no props or text, distinct age differences visible. Every head and shoulder inside its cell, no frames.
Top left: MUM, a young adult mother in her thirties, shoulder-length black hair, sage green blouse.
Top center: DAD, a young adult father in his thirties, short dark hair, rust-orange collared shirt.
Top right: GRANDMA, an elderly grandmother in her seventies, silver hair in a little bun, fine smile wrinkles, round glasses, lavender cardigan.
Bottom left: GRANDPA, an elderly grandfather in his seventies, short silver hair and silver moustache, fine smile wrinkles, blue cardigan.
Bottom center: BROTHER, a young boy around seven years old, short dark hair, ochre yellow t-shirt, clearly a child, no beard.
Bottom right: SISTER, a young girl around seven years old, dark hair in two short pigtails, coral shirt, clearly a child.
```

## feelings-and-greetings

- 项目文件：`public/images/english/feelings-and-greetings.webp`
- 原始 PNG：`/Users/neo/.codex/generated_images/01a0f68a-ae63-7ab1-b9e3-374849e9b3a9/exec-c6398c98-8843-4a15-be82-926591454690.png`
- 网格：3 列 × 3 行
- 按 index 顺序：`0: english-hungry`、`1: english-thirsty`、`2: english-hello`、`3: english-goodbye`、`4: english-yes`、`5: english-no`、`6: english-please`、`7: english-thanks`

最终提示词：

```text
Use case: scientific-educational, illustration-story. Create one original educational sprite sheet for a five-year-old English learning picturebook app. A single square sheet with EXACTLY 3 columns and 3 rows of equal square cells, absolutely no text, captions, labels, letters, numbers, dividing lines or cell borders. Every illustration centered precisely in its own cell with at least 15% empty safe margin on all sides so each tile can be isolated via CSS. Background warm pale ivory watercolor paper, consistent across cells. Style: lovely traditional children's picturebook watercolor and opaque gouache, soft paper grain, rounded natural silhouettes, painterly edges, gentle warm muted ochre, sage and coral palette; polished handpainted art, no vector flat icons, no emoji, no 3D. All subjects readable in silhouette and age appropriate; avoid decorative extraneous things. Each cell only contains its assigned subject, with a subtle watercolor ground shadow. Output 1536x1536 if available, maintain sheet 1:1 aspect ratio. Exact row-major subjects:
Each cell independent wordless scene showing everyday communication for small children. Children are five-year-old East Asian kids, rounded friendly picturebook faces, short dark hair, sage-green and coral clothes. Allow wide safe margins, clear simple scenes. No dialogue bubbles and NO writing.
Top left HUNGRY: one child sitting behind an empty plain plate at a small table, one hand resting on tummy, looking hopefully at empty plate, mouth slightly downturned, an empty spoon nearby.
Top center THIRSTY: one child after play, a tiny sweat bead and dry lips, holding an EMPTY clear cup toward a small jug of clear water on a low table; lips slightly open, expression wants a drink.
Top right HELLO: two cheerful children facing each other and waving in greeting, both bodies directed toward each other, no door.
Middle left GOODBYE: one child with a little red schoolbag walking AWAY through an open doorway, turning back to wave to the other child staying inside; clear departure scene.
Middle center YES: child smiling and giving a clear thumbs-up, tiny curved vertical motion strokes near head to suggest a nod, waist-up, no text.
Middle right NO: child calmly shaking head side-to-side, one palm held outward to gently decline, tiny curved lateral motion strokes beside head, friendly not angry, waist-up.
Bottom left PLEASE: child politely extending both open hands toward a red toy ball held by an adult's hand entering from the side within the cell, asking to have the ball, earnest gentle face.
Bottom center THANKS: child holding a small wrapped present they have just received, smiling warmly and slightly bowing head toward another child, gentle grateful interaction, both children visible.
Bottom right: leave completely BLANK warm cream watercolor paper, no object or markings.
```
