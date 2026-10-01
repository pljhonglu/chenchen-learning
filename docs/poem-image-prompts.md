# 古诗绘本插图提示词

这35张插图使用 Codex 内置 `image_gen`，每首诗单独调用生成一张原创 PNG。面向5岁幼儿，采用简洁水彩绘本风格、单一场景、无文字，帮助记住诗中关键意象。

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
