# 神工 · 神游

Electron 桌面版 SSVEP 脑机接口扑克牌游戏，包含游戏牌桌、教学模式、设备与实验。前端使用 React、TypeScript、Vite；Python 网关负责设备通信与本地会话录制。

## Windows 安装版

安装程序为 `release/0.1.4/Shengong-Shenyou-Setup-0.1.4-x64.exe`。安装版已内置 Electron 和 Python 网关，无需另装 Node.js 或 Python。安装后从桌面“神工神游”启动；从 Windows“已安装的应用”或安装目录中的卸载程序卸载。卸载保留用户会话数据。

安装、卸载、构建和软件撰写资料见 [packaging/WINDOWS-RELEASE.md](packaging/WINDOWS-RELEASE.md)。

## 源码启动

需要 Node.js、npm 和可通过 `python` 命令运行的 Python 3.9 或更高版本。本机已验证 Node.js 24.18.1、Python 3.9.12；前端测试需要 Node.js 支持 `--experimental-strip-types`。

在项目根目录执行：

```powershell
npm ci
npm start
```

开发模式：

```powershell
npm run dev
```

应用自动启动 Python 网关。当前网关运行代码使用 Python 标准库；若使用虚拟环境，启动应用前先激活，使 `python` 指向该环境。

## 三关挑战与排行榜

游戏牌桌采用正在完善的暖白主题，上方左侧为难度、局长，右侧为“三关挑战”和规则；底部单独提供“开始游戏”。点击“三关挑战”后在小弹窗中填写学号和姓名，下一步查看简短规则，再开始简单、进阶、困难各10轮。弹窗底部提供与米白底色融合的“排行榜”和“继续挑战”入口；浏览后返回仍保留已输入的身份。每次完整挑战独立上榜，同一人可有多条成绩；直接“开始游戏”为自由游戏，不进入挑战排名。教学与设备入口继续保留。

游戏现在每轮只进行一次有效识别：正确、错误或刺激结束后仍未确定／拒识，均进入下一轮。拒识不得分并中断连胜，不再自动重试同一手牌；设备断流、显示异常等取消的尝试标为无效，可以恢复当前轮。

综合榜依次比较正确率、平均识别用时、单关最长连胜；另有准确榜、速度榜和连胜榜。速度榜要求正确率至少70%，比较正确轮次的平均用时。排序用完整精度，同分并列排名。当前无拒识重试，首次正确率与最终正确率相同；错误和拒识都计入正确率分母。

用时基于应用首个刺激绘制帧与决策／超时的单调时钟时间差，包含分析等待，排除准备与休息；不是硬件或光电同步测量。界面可展开“成绩如何计算”查看口径。每关最长连胜独立计算，挑战取三关最大值。

成绩保存于用户文档目录 `BrainGame/Challenges/`，按挑战独立保存，包含完整身份、手牌、尝试、EEG 会话关联和配置版本；排行榜只显示学号尾四位。不同规则／识别／刺激配置分组。退出或重启后可在三关挑战弹窗中点击“继续挑战”恢复，已完成轮次保留，异常中的尝试作废；关间至少休息30秒。保存失败会暂停并提供“重试保存”，请先完成保存再关闭窗口。

源码入口与验收说明见 [三关挑战交接记录](docs/tasks/three-stage-challenge.md)；暖白改版进度见 [主题改版交接记录](docs/tasks/warm-paper-theme.md)。这些本地成绩不会上传 GitHub，也不会用历史 EEG 会话自动补生成排行榜成绩。

真实采集需先打开厂商采集软件及数据服务，再在应用中连接网关、开始采集。默认设备数据服务为 `127.0.0.1:7110`，配置见 `device_gateway/config.py`。没有采集设备时可查看界面与教学内容，正式脑控选牌需要真实 EEG。

## 代码目录

| 目录 | 用途 |
| --- | --- |
| `desktop/` | Electron 主进程、preload、Python 网关管理 |
| `renderer/src/game/` | 游戏规则、试次与选牌 |
| `desktop/main/challengeModel.ts`、`challengeStore.ts` | 三关挑战共享规则／类型与本地原子保存 |
| `renderer/src/bci/stimulus/` | 刺激相位、几何、刷新率与时序诊断 |
| `renderer/src/bci/signal/` | Signal Worker、预处理与 FBCCA |
| `renderer/src/teaching/` | 教学数据分析与操作训练 |
| `renderer/src/components/` | 界面、刺激画布、图表和开场动画 |
| `renderer/public/` | 扑克牌、桌布与开场素材 |
| `device_gateway/` | 设备通信、会话存储、标记和回放校验 |
| `tools/ssvep_replay/` | 离线导出、刺激对照与前后段分析工具 |

## 后续刺激参数与实验

- 原理演示支持在界面调整目标频率、目标数量和观察目标；实验开始前确定参数，试次中保持配置不变。
- 几何尺寸与相位逻辑分别位于 `renderer/src/bci/stimulus/geometry.ts`、`phase.ts`；绘制与亮度调制见 `renderer/src/components/StimulusTable.tsx`。
- 注视对照协议、条件随机化和数据新鲜度策略见 `renderer/src/bci/stimulus/comparison.ts`；启动与标记写入见 `renderer/src/main.tsx`。
- 当前短版对照比较外围闪烁、牌面闪烁、纯色块，以及固定/同步闪烁注视点；保存实际刺激配置与几何。历史实验协议保留，分析时按协议区分。
- 当前识别使用 P3/P4/Oz/Pz；个人校准未接入选牌。参数有效性需结合独立注视试次和显示输出测量确认。
- 实际注视需人工确认。当前标记对齐基于数据包到达时间估计，不能据此声称硬件同步或相位锁定。

详细设备说明见 [device_gateway/README.md](device_gateway/README.md)，实验分析说明见 [tools/ssvep_replay/README.md](tools/ssvep_replay/README.md)。

离线分析使用额外 Python 包：

```powershell
python -m pip install numpy scipy matplotlib
python -m unittest discover -s tools/ssvep_replay -p "test_*.py" -v
```

## 验证

```powershell
npm run typecheck
npm run build
npm test
```

`npm test` 包含前端刺激/识别测试，以及 Python 网关测试；网关集成测试使用本地模拟服务器，需要允许回环套接字连接。

挑战专项测试与桌面端模拟验收：

```powershell
npm run test:challenge
npm run test:challenge-ui
```

后者会构建并在隐藏 Electron 窗口中用模拟决策走完挑战、退出续玩、四类榜单和自由游戏。测试不连接采集设备、不输出闪烁，身份和成绩仅写入独立的 `.smoke-user-data/challenge-*/test-challenges/`；截图及 `challenge-smoke.json` 保留在同一验收目录。模拟会缩短准备、反馈及休息，不能用于判断真实 EEG 识别率、时序或性能。安装版无法开启此测试入口。

## 本地数据

应用会话保存于用户文档目录的 `BrainGame/Sessions/`，包含原始 EEG、刺激标记和分类决策。原始会话、采集文件、个人实验笔记、报告、缓存、依赖与构建产物由 `.gitignore` 排除，源码仓库不承担实验数据备份。

已有 Git 历史中的文件不会因新增忽略规则自动移除；发布前需要同时检查提交内容与历史。实验数据应单独保存在可追溯的本地目录。

## 扑克牌整体闪烁亮度

整体牌面使用 `black-overlay-linear-rgb-v2`，默认正弦输入映射为原图 RGB 的 5%–100%；亮峰保留原图，暗谷覆盖 95% 黑色。此范围为显示颜色值，不是光电实测亮度。频率、相位与闪烁时序保持不变，外围闪烁及纯色块映射不变。实验标记记录新版本与映射，旧版 v1 数据应分开比较。
