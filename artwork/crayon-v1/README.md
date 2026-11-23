# 粗蜡笔牌面母版

此目录保留首版牌组及历史记录所用资源。当前A—10已替换为用户网页样稿，见 [网页点数牌说明](../web-pips-v2/README.md)；J／Q／K、大小王及牌背继续使用本目录母版合成的资源。

以用户2026-10-21提供的中式童趣牌面为参考，使用内置imagegen生成J／Q／K双头人物和牌背母版；提示词与来源说明见[prompts.json](prompts.json)。母版透明背景，完整保留发饰、兵器、团扇与冠冕。

## 合成与版本

- [合成工具](../../tools/build-crayon-deck.cjs)将三种人物分别复用于对应点数的四种花色，数字、花色、A—10的排列、大小王及闭合外框由固定模板生成。人物不是每张随机生成，避免整副牌风格漂移。
- 成品位于`renderer/public/cards/crayon-v1/`：52张标准牌、两张大小王、牌背，均为1020×1425 PNG；`manifest.json`包含身份、实际绘制的主花色数量、尺寸和SHA256。
- 在项目根目录运行`npm run build:cards`。复用项目内Electron与Windows本地`Segoe Print`／`Comic Sans MS`字体；无在线字体或新增依赖，运行时只读取成品PNG，不加载这些母版或合成工具。
- 固定种子控制纹理与排线，成品已纳入源码。跨系统重新生成的字形可能不同，应先审阅再发布。已经用于实验的牌组版本不得原位改写；变更画面时创建新的版本目录并记录配置。

## 运行与验证入口

呈现、资源解析与历史兼容在`renderer/src/theme/presentation.ts`；绘制和缓存接入在`renderer/src/components/StimulusTable.tsx`。`npm run test:presentation`验证资源完整性、尺寸、哈希、身份映射、历史配置与缓存预算。完整视觉及性能验证见[改版交接](../../docs/tasks/handdrawn-paper-theme.md)。

## 无内框派生版

当前 `crayon-deck-v3` 在同一人物模板中省略蓝色内框，点数及人物位置保持原样；原v1输出与素材继续保留。使用 `npm run build:cards:borderless` 同时生成网页点数牌和人物牌，详见 [v3重建说明](../web-pips-v2/README.md#当前无内框派生版crayon-deck-v3)。
