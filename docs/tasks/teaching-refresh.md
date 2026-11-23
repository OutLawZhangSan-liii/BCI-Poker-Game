# 教学页重点梳理、平滑切换与演示时频图（2026-11-02）

已完成main源码与构建；实验调试工作区保持不变。本轮未提交、推送或制作安装包。

## 修改与入口

- [TeachingCourseNav](../../renderer/src/components/TeachingCourseNav.tsx)、[TeachingLesson](../../renderer/src/components/TeachingLesson.tsx)：目录、核心结论、观察交互、小练习分层。原理放入可展开区域，不删除教学知识与练习解释；保留完成进度。1920宽使用左侧目录，960宽使用两行四列；较窄页面保留课程选择器。移除原等宽两栏与重复课程入口。
- [styles.css](../../renderer/src/styles.css)、[CrayonTheme.css](../../renderer/src/theme/CrayonTheme.css)：直接整理现有课程样式，继续采用白纸、藏蓝与留白，无新增封闭容器。主导航／教学页签使用360ms连续滑动下划线，移除矩形焦点框，键盘焦点保留虚线下划线。
- [useWorkspaceEntrance](../../renderer/src/components/useWorkspaceEntrance.ts)：页面内容200ms透明度淡入，不叠放旧页面、不延迟按钮响应、不移动Canvas。快速切换取消旧动画；进入游戏、教学准备、正式刺激、操作训练或时序诊断时取消；减少动态偏好下跳过。
- [RealPrincipleAnalysis](../../renderer/src/components/RealPrincipleAnalysis.tsx)、[DemoClassification](../../renderer/src/components/DemoClassification.tsx)：保留一次状态、频率、通道、匹配分数与结果；去除重复说明和“最高匹配”重复结果。详细通道、滤波、窗口及FBCCA参数保留在折叠信息或提示中。此处原理演示仍使用原FBCCA，游戏中的Butterworth试用不变。

## 时频数据路径

[trialSpectrogram](../../renderer/src/teaching/trialSpectrogram.ts)将Worker的RealTrialAnalysis转换为现有[RealSpectrogram](../../renderer/src/components/RealSpectrogram.ts)的显示输入；[PrincipleSpectrogram](../../renderer/src/components/PrincipleSpectrogram.tsx)放在PSD下方，与PSD共用所选P3／P4／Oz／Pz／平均通道。

直接使用同一个channelSpectra对象和windowStartSample／windowEndSample，复用已滤波、Hann加窗的PSD；不重新采样、滤波或FFT，不改变分类器。横轴使用样本对应的窗口中心时间，包含原Worker热身后的窗口起点。最多300列×129行、约30秒；稀疏更新按现有显示逻辑保持最新窗口PSD，实际分析步长仍为原Worker步长。色标为10log10(PSD / 1μV²/Hz)，范围-60至60dB；这属于滑动PSD的时频显示，不是另一套独立分析。

会话、试次、通道、采样率或滤波条件变化时重新开始历史；无效／断流窗口立即清空，重复样本结束位置不重复累积。图像刷新合并到一次RAF、卸载时清除监听和待绘制帧。演示图较矮时改用10Hz大刻度，其他图表默认5Hz不变。

## 验证

- `npm run typecheck`、`npm run build`通过。
- `npm run test:teaching`4项：同PSD对象与样本区间、历史身份隔离、无效数据拒绝、重复窗口／切换／断流清空与300列上限。
- `npm run test:presentation`17项通过，保留历史呈现、牌图、缓存和窗口颜色兼容。
- `node tools/teaching-ui-smoke.cjs`最终52项通过，控制台错误0；1920×1080及960×640的8门课程、内容顺序、字号、目录、练习作答重答、展开原理、主导航快速重定向、设备内容淡入、减少动态偏好、PSD→时频→匹配顺序、统一通道和无数据空图均已检查。合成样本只在隔离显示夹具中使用，覆盖有效能量、样本边界、新试次原点及断流清空；不连接设备或保存真实成绩。
- 已目视检查最终大小窗口课程截图、未连接演示截图与标明模拟的时频图。初次截图发现960宽重复旧选择器与横向目录，已改为两行目录后重跑相关检查。
- 与上一轮本地交付比对确认butterworth、gameClassifier、fbcca、signal.worker、刺激geometry与StimulusTable源码SHA256未变；本轮复用其算法／刺激数值验证，不重复360次EEG回放。当前Worker构建仍为signal.worker-CNCkQSeT.js。

筛选验证副本与源码指纹：[reports/teaching-refresh-20261102](../../reports/teaching-refresh-20261102/)。原始隔离结果：.smoke-user-data/teaching-2026-11-02T05-13-50-957Z/。

## 边界与后续

没有进行新真实EEG采集、实屏GPU帧时间或物理显示同步测试。软件窗口检查不能替代60Hz实屏时序验收。重启main程序查看；相关运行命令沿用README，无依赖新增。


## 分析栏上移与上下图对齐（2026-11-02）

- 原理演示使用同一父网格，右侧分析从左侧参数所在行开始并跨至刺激区底部；不再等待整排参数高度，也不使用会遮挡控件的负偏移。大窗口、小窗口和四目标参数换行均已检查；操作训练和信号观察布局不受此网格规则影响。
- 共用principlePlotBounds：左96px、右预留88px色标、上24px、下48px。PSD与时频图的左右框线、X轴标题中心、Y轴标题位置、顶部标题和图例对齐。大／小功率数值改用紧凑科学记数，不以加宽刻度改变绘图区。上下图都显示一致的刺激频率图例与同色虚线（PSD竖线、时频横线），色标固定在预留右栏；其他绘图场景保留原边距及默认刻度。
- 类型检查、构建与4项教学数据检查通过。扩展现有`node tools/teaching-ui-smoke.cjs --plots-only`，23项定向检查通过：1920×1080／960×640、上下图实际绘制边界及标签锚点、图例位置、分析区起始位置、四目标设置、极大／极小PSD刻度、通道与新试次、断流清空。已查看最终空图与标明模拟的有数据截图。
- 证据：[demo-plot-alignment-20261102](../../reports/demo-plot-alignment-20261102/)。未改变EEG窗口、滤波或识别；本轮没有进行新的真实采集／实屏性能测量。仅main源码与构建，未提交／推送／打包。


## 固定课程版式与横向分析参数（2026-11-02）

- 课程目录和8门课沿用同一视口框架；标题、要点、内容区、底部导航均为固定行。大窗口观察／练习并排，宽度小于1200或高度小于800时，使用同一内容区的“观察学习／小练习”页签。没有用裁切长文字替代阅读：页面摘要按课提炼，完整原理、学习目标、示例和原结论保存在原生dialog阅读窗；作答解释保留。目录进度、重答、课程交互及上一／下一课继续工作。
- 使用青绿色强调、编号、箭头、细横线及单根竖分隔线，不新增封闭布局容器。阅读窗复用既有window appearance能力，在打开／关闭时同步原生标题栏按钮配色；未新增IPC。小窗口目录留足完成标记宽度。
- 新InlineAnalysisDetails供RealEegAnalysisPanel、RealPrincipleAnalysis和SimulatedAnalysisPanel复用。按钮右侧横向展开、短行自动换行；数值与单位保持同组，以竖线分隔。保留采样率、窗口、FFT、频率间隔、样本数及序号、有效数据、峰值、处理方式和告警；冗长操作说明收进提示。真实Worker窗口仍标作左闭右开，观察样本序号仍为包含末样本的区间。只改显示和展开状态，不改变计算或记录。
- 类型检查、构建、4项教学与17项呈现回归通过。扩展现有teaching-ui-smoke：157项全量检查通过，覆盖三尺寸×八课的锚点误差<1px、页面／内容无滚动、作答解释完整、阅读窗与配色调用、横向参数以及既有绘图／数据隔离。之后只提高模拟参数footer的CSS选择器优先级，避免旧display:grid规则覆盖display:contents；最终--plots-only重跑35项，包含模拟参数横向排列。全量课程结果明确复用，未重复未受影响的全部课程检查。
- 已查看大小窗口课程、练习及参数截图。证据：[teaching-fixed-layout-20261102](../../reports/teaching-fixed-layout-20261102/)。测试使用隔离应用、模拟连接状态与明确标注的合成绘图；无真实EEG、设备操作或身份成绩写入。窗口配色检查验证IPC调用及既有配色函数，不等同于拍摄原生按钮像素。仅main源码／构建，未提交／推送／打包。

## 错误反馈改为红色（2026-11-02）

- 错误专用颜色为#B64036：课程答错选项、叉号标记与解释，以及游戏错误文字、叉号和错误选中描边统一红色；操作训练的错误结果文字同步。普通导航／选择仍为藏蓝，正确游戏结果绿色、正确课程选项青绿色、未确定结果灰蓝色不变。仅修改反馈呈现，保留识别、闪烁时序与既有动画。此前交接中“错误为藏蓝叉”的配色已由本次替换。
- 类型检查与构建通过。game-hud-smoke --motion共12项通过，含实际红色描边像素、三类文字／SVG颜色、动画和减少动态偏好；隔离课程界面在1920×1080和960×640检查错误选项／标记／解释为红色，正确选项保留原色，共4项通过。已查看游戏错误与课程答错截图；无真实EEG或成绩写入。
- 原始结果：`.smoke-user-data/game-hud-2026-11-02T07-04-33-815Z/result.json`、`.smoke-user-data/error-colors-2026-11-02T07-05-02-804Z/result.json`。仅main工作区修改，未提交／推送／打包。
