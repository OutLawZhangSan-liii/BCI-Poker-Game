# 网页点数牌 A—10

依据用户提供的“国风涂鸦扑克 · 手绘感样稿”HTML替换四种花色的A（1）—10，共40张。`source.html`为原网页的完整归档，未修改内容；它是素材来源，不是应用入口。

## 导出与范围

- 在项目根目录执行 `npm run build:pips`，使用现有Electron离线导出1020×1425 PNG，保留网页的SVG花色路径、点数位置、轻微旋转、套色错位、固定噪声种子和纸面纹理。
- 固定网页默认参数：抖动3、错位2、留白0.3、线宽1.5，草稿线开启、铅笔跳动关闭。统一适配既有牌面宽高比，不改变软件中的刺激几何。输出为静态图片，运行时不执行SVG滤镜、随机绘画或网页计时器。
- 成品及哈希清单位于 `renderer/public/cards/web-pips-v2/`。牌组版本为 `crayon-deck-v2`：A—10使用新目录；J／Q／K、大小王和牌背沿用 `crayon-v1` 资源，未重绘。旧目录不覆盖。
- 本轮没有引入网页滑杆、人物牌、背景主题或“换一笔”功能，仅采用点数牌。修改后可在现有游戏、教学和诊断入口查看。

## 字体来源与许可

导出使用网页指定的 `Ma Shan Zheng` 字体，已将原始字体及 [SIL OFL 1.1许可](OFL.txt)一同保存。来源为Google Fonts官方仓库：[字体](https://github.com/google/fonts/blob/main/ofl/mashanzheng/MaShanZheng-Regular.ttf)、[许可](https://github.com/google/fonts/blob/main/ofl/mashanzheng/OFL.txt)。构建工具去除网页在线样式表，将字体嵌入临时SVG，仅供栅格化；最终应用不加载此字体，也不需要联网。

## 兼容与验证

新挑战／采集标记写入 `crayon-deck-v2`，主题仍为 `crayon-paper-v1`。旧挑战按其保存的牌组加载，未带牌组字段的手绘记录按v1处理；排行榜保持配置分组。牌组在刺激中锁定。

`npm run test:presentation`检查40张牌的身份、点数元数据、尺寸、SHA256及来源一致性，并覆盖历史资源路径、旧挑战恢复和分组。`node tools/presentation-smoke.cjs --cards-only`检查实际界面、2／4／6目标和新旧牌组渲染。交付截图与点数校对图在本地 `reports/web-pips-v2/`；整体改版历史见 [交接记录](../../docs/tasks/handdrawn-paper-theme.md)。

## 历史无内框派生版（crayon-deck-v3）

- v3阶段的新挑战使用该版本；本目录保留原始HTML、字体与v2说明，历史输出不覆盖。
- 根目录执行 `npm run build:cards:borderless`：先从克隆SVG移除唯一的蓝色内框矩形，再从人物牌Canvas模板省略内框，导出54张牌与牌背到 `renderer/public/cards/borderless-v3/`。
- 点数、花色路径、字号、位置、静态滤镜参数与纸纹保持原样。输出仍为1020×1425；清单记录来源哈希、各牌身份、点数和输出哈希。
- 牌背图本身沿用原像素；新牌堆由Canvas绘制清晰纸边与前景牌背，按背板像素对齐，历史牌组继续使用原叠放方式。
- 验证：`npm run test:presentation`；界面专项：先 `npm run build`，再 `node tools/presentation-smoke.cjs --fixture-only --cards-only`。


## 当前统一纸面版（crayon-deck-v4）

- 重建 `npm run build:cards:uniform`，输出 `renderer/public/cards/uniform-v4/`。只在克隆SVG中移除偏黄纸底与棕色纸纹，使用与人物模板一致的#FFFEFC柔白底及轻微静态颗粒；点数、花色和笔触滤镜保持原样。人物、大小王及牌背像素与v3一致。
- 共54张牌与牌背，清单记录来源与逐张哈希。运行时v4采用带浅色描边的藏蓝十字注视点；v1—v3保留圆形点。牌组在试次中锁定，旧挑战不迁移，新成绩按配置分组。
- 底色像素审计、界面截图及测试结果见本地 `reports/uniform-v4/`。仅修改 main，实验分支未变。
