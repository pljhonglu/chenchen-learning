# 古诗绘本插图提示词

这40张插图使用 Codex 内置 `image_gen`，每首诗单独调用生成一张原创 PNG。面向5岁幼儿，采用简洁水彩绘本风格、单一场景、无文字，帮助记住诗中关键意象。

生成后保留内置工具默认路径的原图。网页使用缩至 960 像素宽、质量 84 的 WebP 编码版本，保持完整画面，文件为 `public/images/poems/poem-XX.webp`；编码使用 sharp，仅用于减小传输体积。对应的无障碍描述和看图提示见 `public/data/poem-illustrations.json`。

## 通用提示词

Use case: illustration-story. Create one original wide 3:2 illustration (1536×1024) for a Chinese-poem learning card for a 5-year-old kindergarten child. Style: simple warm children's picture book, soft watercolor and matte gouache, rounded clear silhouettes, large simple subject groups, gentle pleasing colors, very sparse background, easy to read at small size. Limit to 2–4 main subject groups, avoid detailed textures and clutter. No writing, Chinese characters, labels, numbers, speech bubbles, border, collage, panels, watermark, or photorealism. Single coherent scene.

## 每首诗的场景提示词

### poem-01 · 早发白帝城

A kind Chinese poet in a small wooden boat glides quickly along a blue river between two green mountain banks. Peach morning clouds, one tiny monkey on the bank.

### poem-02 · 望洞庭

A still round silvery-blue lake under a round autumn moon; a single small emerald-green rounded island in the middle looks like a spiral snail. Make the natural island rounded, no actual snail or plate. A few soft blue mountain silhouettes very far away. Calm open water reflection.

### poem-03 · 饮湖上初晴后雨

West Lake in gentle rain just as sunlight breaks through; turquoise rippling lake, soft misty green hills, one small Chinese pavilion on a tiny lakeside bank. Soft sun rays and sparse light raindrops in a single unified scene. No people.

### poem-04 · 望天门山

Two large rounded green mountains face each other across a turquoise river opening like a gate. One small sailing boat with a single white sail approaches from near a warm golden sun on the horizon. Clear simple river shape and mountain silhouettes.

### poem-05 · 夜书所见

A kind curious ancient Chinese child crouches beside a bamboo fence in a cozy autumn night, looking at one small cricket in grass by a warm lantern. A few large golden wutong leaves drift nearby. Soft navy sky, lantern gold, gentle safe mood, no scary dark details.

### poem-06 · 赠刘景文

An early-winter small garden: one orange tree with large orange-yellow and green citrus fruits as main focus, beside a little spent lotus leaf stalk and a sturdy chrysanthemum branch with a few faded gold petals. A faint touch of frost on ground, warm optimistic mood.

### poem-07 · 山行

A winding simple stone path rises into a rounded autumn mountain toward one tiny cozy white house under white cloud. In the foreground a vivid red maple tree beside a small ancient wooden cart stopped on the path. Dominant red leaves and soft cool mountains.

### poem-08 · 所见

A young Chinese cowherd has just stopped beside a gentle golden-yellow ox under one leafy tree, closes his mouth and looks up at a single clearly visible cicada on a low branch. Child and ox central, restful summer greenery. No insect catching cage or extra animals.

### poem-09 · 舟夜书所见

A small fishing boat with a single glowing golden lantern floats on a soft deep blue river on a moonless night. Gentle ripples scatter its golden reflection into star-like little lights across the water. No moon, no literal stars in river, no people needed, calm reassuring mood.

### poem-10 · 绝句

View through a very simple ancient wooden window: exactly two yellow orioles perch on one fresh green willow branch; a small diagonal row of three white egrets flies into blue sky. Below, one quiet moored wooden boat; distant soft snowy mountain. Clear 4 visual subject groups, uncluttered.

### poem-11 · 晓出净慈寺送林子方

A sunlit summer lotus lake. Three large emerald round lotus leaves and two large vivid pink-red lotus blooms dominate foreground, a few softly simplified green leaf shapes stretch to horizon. Warm round morning sun. Bold clean broad shapes, no people or buildings.

### poem-12 · 赋得古原草送别

Fresh vivid green grass shoots grow across an ancient curved path and some faded brown old grass on dark earth. Two small kind ancient Chinese friends at the path gently wave goodbye; distant tiny old city wall silhouette. Spring breeze visible through softly bending grass, no fire, no smoke.

### poem-13 · 咏柳

One elegant rounded bright green willow tree with long drooping silk-like green branches and clearly defined small pointed young leaves beside a tiny blue stream. A gentle spring breeze bends the hanging branches. Main focus tree and green ribbonlike branches. No actual scissors, no people.

### poem-14 · 村居

Two happy kindergarten-age ancient Chinese children fly one simple swallow-shaped paper kite on a grassy riverside in spring. One willow tree gently bends over the low bank, one tiny yellow oriole flying. Focus children kite and willow, sunny soft sky.

### poem-15 · 敕勒歌

Wide peaceful grassland under one very large domed blue sky; wind bends the tall green grasses to reveal one sturdy gentle brown cow and two fluffy sheep. Low soft blue Yin mountains on distant horizon. Big clear animal shapes, expansive simple composition.

### poem-16 · 夜宿山寺

A tall simple ancient Chinese temple tower rises from a rounded mountain into a friendly starry night. One kind poet safely stands behind a high balcony railing with one hand reaching toward a few large nearby glowing stars. Dreamlike closeness of stars, gentle purple blue palette.

### poem-17 · 江雪

A lone elderly fisherman in a straw rain cape and wide straw hat sits in one small wooden boat on a quiet pale blue river surrounded by smooth snow-covered mountains. One fishing rod, a few soft snowflakes. Spacious, peaceful, no birds, no other people, no footprints.

### poem-18 · 望庐山瀑布

A very tall bright white waterfall flows straight down one rounded emerald mountain into a pale blue pool. Warm sunshine makes soft lavender mist near the summit. The waterfall reads like a long shining silver ribbon falling from sky, large central focus. No stars or night scene.

### poem-19 · 登鹳雀楼

A kind Chinese poet climbs broad steps on a simple ancient Chinese tower, safely inside a railing, looking out at a round warm setting sun behind distant mountains and one broad golden Yellow River winding toward a far pale blue sea. Four main simple visual groups.

### poem-20 · 小儿垂钓

A little ancient Chinese child with slightly tousled hair sits sideways on a low grassy riverbank holding a simple bamboo fishing rod. Child gently raises one open hand to a friendly traveler some distance behind, keeping mouth closed to avoid startling one small fish in clear water. Large child main focus.

### poem-21 · 梅花

One small plum tree branch with several white-to-pale-pink plum blossoms grows beside a simple warm ivory garden wall corner in winter. A little soft snow on ground, blossoms distinct from snow, a few subtle curved scent lines. Clean close-up, 2 main subjects, no people.

### poem-22 · 画鸡

One large friendly white rooster with a vivid red comb and red wattles walks proudly in a simple courtyard at sunrise, beak open gently crowing. A tiny warm cottage doorway is opening in the soft background. Snow-white body, clear red crown, cheerful not aggressive.

### poem-23 · 小池

Close simple view of a tiny calm pale blue pond: one newly emerged curled pointed young green lotus leaf above water, one gentle orange dragonfly clearly perched on its pointed tip. A small trickle from a smooth rock and a soft tree reflection nearby. Focus leaf and dragonfly, no big blossom.

### poem-24 · 池上

One small ancient Chinese child in a small wooden skiff holds a white lotus seedpod while returning across a green duckweed-covered pond. A clearly visible pale blue open-water trail parts the duckweed behind the boat. A few simple white lotus flowers at edge. Emphasize the trail left by the boat.

### poem-25 · 寻隐者不遇

Under one large simple pine tree, a friendly ancient Chinese poet bends slightly to ask a young boy a question. Boy points up toward one soft green mountain covered in large white clouds, holding a small empty herb basket. No extra people, simple 3 subject groups.

### poem-26 · 静夜思

A kind ancient Chinese poet sits beside a low simple wooden bed in a quiet cozy room, looking gently up at a round moon framed by an open window. A broad pool of silver moonlight lies on the floor like frost. Sparse room, warm cream and soft blue, peaceful and thoughtful.

### poem-27 · 赠汪伦

Two close ancient Chinese friends saying goodbye at a calm turquoise lakeshore: one kind poet sits in a small wooden boat waving; one friend on shore sings and gently taps a foot as farewell, hand raised. One simplified pink peach blossom branch. Warm friendly emotion.

### poem-28 · 春晓

A sleepy friendly ancient Chinese child or young scholar waking beside a simple open window in gentle spring morning light. Outside one small flowering branch with two singing birds, several fallen pink petals and a small puddle show last night's rain. Bright warm peaceful composition.

### poem-29 · 风

A single coherent riverside scene showing invisible wind by motion: three tall green bamboo stalks bend in the same direction above small rolling blue river waves; a few large orange leaves drift through air, one little pink flower opens at bank. No wind person or face, simple dynamic rounded shapes.

### poem-30 · 古朗月行

A young ancient Chinese child points up at a large round luminous moon above soft blue clouds. On the moon, a tiny friendly white rabbit gently uses a mortar beside one simple leafy osmanthus tree, rendered as whimsical lunar folklore. Keep moon, child, rabbit-tree as 3 groups, no extra celestial figures or writing.

### poem-31 · 悯农（其一）

An ancient Chinese farmer sits tired but dignified at the edge of a rich golden millet field, holding a small visibly empty wooden bowl. A few large millet heads heavy with seeds beside him, cultivated field stretches softly behind. Child-appropriate gentle compassion, no death, no skeletal bodies, no frightening imagery, no smiling feast.

### poem-32 · 悯农（其二）

A kind ancient Chinese farmer wearing a straw hat hoes a small row of green millet seedlings under a large warm midday sun. A few clear sweat drops fall from his face toward brown soil. Strong readable farmer and hoe silhouette, simple crop row, respectful gentle child-friendly scene.

### poem-33 · 画

A single simple Chinese landscape painting presented as a hanging paper scroll: green mountain, quietly flowing blue stream, one pink flowering branch and one bird resting calmly. A small friendly child's hand at edge points toward the bird to show it stays still because it is painted. No writing on scroll, no symbols, simple natural composition.

### poem-34 · 江南

Top-down and slightly angled simple view of a clear turquoise lotus pond: several broad rounded emerald lotus leaves, one pale pink flower, and four friendly orange fish swimming in different directions between leaves. Fish large and clear, playful but natural, no arrows or labels, open uncluttered composition.

### poem-35 · 咏鹅

One large graceful friendly white goose floats on clear emerald-green water, curved long neck raised with beak open gently singing, two orange-red webbed feet clearly visible paddling just below transparent water. A few simple soft blue ripples, no other animals, very simple uncluttered close view.


首张《早发白帝城》的初次生成使用等价独立提示词，强调彩云、轻舟、两岸青山和一只小猿。其余每张将通用提示词与对应场景提示词拼接，不使用参考图。

## poem-36 · 水调歌头·明月几时有

使用内置 `image_gen` 生成；网页文件为 `public/images/poems/poem-36.webp`（960 × 640，WebP 质量 84）。

完整提示词：

```text
Use case: illustration-story. Create one original wide 3:2 illustration (1536×1024) for a Chinese-poem learning card for a 5-year-old kindergarten child. Style: simple warm children's picture book, soft watercolor and matte gouache, rounded clear silhouettes, large simple subject groups, gentle pleasing colors, very sparse background, easy to read at small size. Limit to 2–4 main subject groups, avoid detailed textures and clutter. No writing, Chinese characters, labels, numbers, speech bubbles, border, collage, panels, watermark, or photorealism. Single coherent scene.

Scene for Su Shi's “Shui Diao Ge Tou — When Will the Bright Moon Appear”: A kind Song-dynasty Chinese poet in a simple pale traditional robe stands safely in a quiet ancient Chinese courtyard beside a low window, looking up at one large softly glowing Mid-Autumn full moon. A few rounded distant blue hills and one tiny cozy house suggest loved ones far away sharing the same moonlight. Keep poet, full moon, and distant hills-with-house as three clear visual subject groups. Soft indigo and pale blue night with warm cream moonlight; peaceful, tender longing and reassuring warmth. No flying people, moon palace, fantasy creatures, wine vessel, extra characters, or lettering.
```

## 2026-10-24 新增篇目

以下四张使用内置 `image_gen`，逐张单独调用，将上面的通用提示词与各自场景提示词拼接，不使用参考图。原始 PNG 保留在工具默认目录，网页版本使用 sharp 等比例缩为 960 × 640、WebP 质量 84。已目视确认主题意象清楚、无文字、水印或伤亡场面。

### poem-37 · 惠崇春江晚景

A peaceful early-spring turquoise river with two friendly ducks swimming in the foreground. On the bank, three slender green bamboo stalks frame a peach branch with a few pink blossoms. Beside the water, a small simple patch of leafy green mugwort and short fresh pointed reed shoots signals the start of spring. Soft distant hills, fresh warm sunlight. Main focus on the ducks and spring plants, no people, no fish.

网页文件：`public/images/poems/poem-37.webp`。

原图来源：`/Users/neo/.codex/generated_images/01a16b9b-dffb-72b3-85e5-ef3dfc14ca8b/exec-14de744a-213e-431e-a796-9dc105b15369.png`。

### poem-38 · 三衢道中

A kind ancient Chinese traveler walks along a simple gently climbing mountain path beside a clear small stream in bright early-summer sunshine. A nearby leafy plum branch holds several large ripe yellow plums. Fresh dense green shade arches over the path, with exactly two bright yellow orioles clearly perched on one low branch. Rounded distant green hills. The traveler is small; emphasize yellow plums, green shade, stream and singing birds, one coherent uncrowded landscape.

网页文件：`public/images/poems/poem-38.webp`。

原图来源：`/Users/neo/.codex/generated_images/01a16b9b-dffb-72b3-85e5-ef3dfc14ca8b/exec-2ffd145f-b5fa-46c5-b75b-3d6124d0c233.png`。

### poem-39 · 忆江南

A simple beautiful Jiangnan river at spring sunrise. A small round golden sun rises over distant soft hills; a few vivid red riverside blossoms glow in its warm light, reflected beside a broad calm rich emerald-blue river. One tiny white-walled dark-roofed ancient Jiangnan house far away on the bank. Strong clear contrast between warm red blossoms and cool blue-green water, spacious peaceful composition, no people.

网页文件：`public/images/poems/poem-39.webp`。

原图来源：`/Users/neo/.codex/generated_images/01a16b9b-dffb-72b3-85e5-ef3dfc14ca8b/exec-0161f3ed-5758-45c1-a1cb-33c981eeb1ad.png`。

### poem-40 · 守株待兔

An ancient Chinese farmer in plain simple clothes sits idly on the ground beside a large cut tree stump, looking expectantly toward an empty path with a patient but puzzled face. His wooden-handled hoe has been put aside against the stump. Behind him a small neglected field has sparse wilted crop rows and a few tall weeds. Make the farmer and tree stump large and clear, gentle humorous child-friendly storytelling about waiting instead of working. No rabbits, no injury, no dead animals, no violence, no frightening details.

网页文件：`public/images/poems/poem-40.webp`。

原图来源：`/Users/neo/.codex/generated_images/01a16b9b-dffb-72b3-85e5-ef3dfc14ca8b/exec-2f2920a3-825b-4261-bcfc-6afdf5604e9a.png`。

## 2026-11-27 新增篇目

每篇使用内置 `image_gen` 单独生成一张图。将以下通用提示词与对应场景拼接。网页图以 `public/images/poems/<ID>.webp` 保存（960 × 640，WebP 质量 84）。

```text
Use case: illustration-story. Create one original wide landscape 3:2 illustration for a Chinese-poem learning card for a 5-year-old kindergarten child. Simple warm children's picture book, soft traditional watercolor and matte gouache on gently textured cream paper, softly rounded but distinct silhouettes, 2–4 large subject groups, clear easy-to-read composition in small thumbnails, sparse background and gentle colors. One coherent scene filling the whole canvas. No writing of any kind, no Chinese characters, captions, border, panels, collage, watermark, or photorealism.
```

### poem-41 · 暮江吟

Sunset over a broad quiet river. One low warm red sun casts a long coral-red reflection across exactly one side of the water; the other side remains deep jade green. Higher in the lilac twilight is one very thin bow-shaped crescent moon. In the close foreground, a few large pearl-like dew beads on simple blades of grass. Show only a single crescent moon, never a full moon. No people, boats, or buildings.

### poem-42 · 题西林壁

Mountain peaks of Mount Lu with a winding path. One gentle ancient Chinese traveler in a simple muted Song-era robe stands small on the path between the slopes, looking toward a round elongated wooded ridge on the left and a tall pointed peak on the right. A few fog wisps and hazier faraway peaks suggest different distances. One coherent landscape in calm moss-green, warm cream, and blue-gray.

### poem-43 · 元日

Early Song-era Chinese New Year morning: in a clear central foreground, an adult hangs a fresh unlettered flat peachwood plaque beside a dark red wooden front door while a child holds the worn old plaque safely. A small scattered cluster of red paper firecracker remnants rests away from the pair. Warm golden sunrise illuminates two simple nearby rooftops. No live firecrackers, no explosions, no writing on the plain plaques.

### poem-44 · 雪梅（其一）

One large dark curved plum branch with a few clean coral-pink plum blossoms stretches over soft fresh white snow. A small Song-era poet at a simple open window in the middle distance pauses, brush set down beside blank paper, looking at the snow and plum blossoms. Emphasize the bold white snow, gentle pink blossoms and calm visual comparison. No writing or lettering even on the paper.

### poem-45 · 精卫填海

Jingwei, one small magical bird based on an ancient Chinese legend, flies over a broad calm teal East Sea carrying one clearly visible small twig in its beak. The bird has a subtly patterned head, white beak and red feet. A few rounded pebbles and softly layered distant green western hills; bird and twig large enough to read in a thumbnail. Quiet waves. No people, no drowning, no frightening imagery.

### poem-46 · 出塞

An old Chinese frontier pass at night, viewed from outside its simple stone walls. One luminous full moon above an ancient gate and gently layered silhouette of the far Yin Mountains. One tiny resting horse and a single distant travel figure can appear near the gate, safely at rest. Slate blue and moonlit ivory. A quiet landscape about distance from home. No battle, weapons, banners with text, or injury.

### poem-47 · 凉州词

A Tang-era northwest frontier camp at dusk, quietly recalling a poem. In the foreground a small pale jade luminous cup stands beside a little cluster of purple grapes on a simple low wooden table. A robed musician in the middle distance holds a clearly pear-shaped four-string Chinese pipa lute, with a quiet horse silhouette and two rolling sandy hills farther behind. Copper gold and muted violet. No battle, weapons, drinking, or injury.

### poem-48 · 夏日绝句

At the quiet bank of a wide ancient eastern Chinese river, a brave solitary historical traveler inspired by Xiang Yu stands in a simple traditional cloak, with dignified posture, facing the broad waters and far shore. One empty little wooden ferry is tied near the bank and calm gray-green river fills the view. A light wind moves the cloak. Use muted teal, ocher and pale cream. No combat, weapons, injury, death, or ghosts.

### poem-49 · 清明

Gentle Qingming spring rain over an ancient Jiangnan countryside path. A kind Tang-era traveler with a plain bamboo hat and pale umbrella pauses as a young herder riding a calm water buffalo points with one finger to a tiny village nestled among pink apricot blossoms in the distance. Clear diagonal path, sparse soft rain, fresh green and cream, child-friendly faces. No signs or lettering.

### poem-50 · 九月九日忆山东兄弟

Double Ninth festival in the Tang era. In the foreground one solitary Chinese traveler in a pale robe holds a small unlettered dogwood sprig with a few red berries and looks thoughtfully toward a distant hill. On one far hill path, three small robed family members walk together, one carrying a dogwood sprig, suggesting a family gathering far from the traveler. Soft golden autumn slopes, warm sepia, moss, and light blue, tender longing. One continuous landscape, no panels.
