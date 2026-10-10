# 神工 · 神游

Electron 桌面版 SSVEP 脑机接口扑克牌游戏，包含游戏牌桌、教学模式、设备与实验。前端使用 React、TypeScript、Vite；Python 网关负责设备通信与本地会话录制。

当前 `codex/stimulus-form-debug` 分支默认打开专用刺激实验工作台：三种形式、2/4/6 目标、216 次主动试次、可续测采集与 CCA/FBCCA/TRCA/eTRCA 离线比较。原游戏与教学模块保留但入口隐藏。完整协议、启动依赖与验收见 [tools/stimulus_lab/README.md](tools/stimulus_lab/README.md)。旧版安装包尚未包含本分支的分析运行环境。

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

真实采集需先打开厂商采集软件及数据服务，再在应用中连接网关、开始采集。默认设备数据服务为 `127.0.0.1:7110`，配置见 `device_gateway/config.py`。没有采集设备时可查看界面与教学内容，正式脑控选牌需要真实 EEG。

## 代码目录

| 目录 | 用途 |
| --- | --- |
| `desktop/` | Electron 主进程、preload、Python 网关管理 |
| `renderer/src/game/` | 游戏规则、试次与选牌 |
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

## 本地数据

应用会话保存于用户文档目录的 `BrainGame/Sessions/`，包含原始 EEG、刺激标记和分类决策。原始会话、采集文件、个人实验笔记、报告、缓存、依赖与构建产物由 `.gitignore` 排除，源码仓库不承担实验数据备份。

已有 Git 历史中的文件不会因新增忽略规则自动移除；发布前需要同时检查提交内容与历史。实验数据应单独保存在可追溯的本地目录。
