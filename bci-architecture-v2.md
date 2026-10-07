# 脑机接口小游戏 v2.0 Windows 桌面版架构设计

> 状态：技术路线已选定，等待实施。
>
> 决策日期：2026-08-29。
>
> 设备协议事实来源：`/Users/outlaw_zhangsan/Desktop/communication2.2.py`（1227 行）。该文件作为旧实现基线，不直接修改。

## 1. 已确定的产品与技术决策

- 产品形态：只提供 Windows 桌面真机版，不维护网页演示版。
- 目标环境：实验室固定电脑，Windows 10/11 x64。
- 桌面框架：Electron。
- 界面技术：TypeScript + React 19 + Vite + Tailwind CSS 4。
- 刺激呈现：Canvas/WebGL + `requestAnimationFrame`，逐帧记录实际时序。
- 信号处理：Electron renderer 中的 Dedicated Web Worker。
- 设备协议：保留 Python 中已经验证的自定义二进制帧实现。
- 数据策略：离线优先，本地实验不依赖网络；联网时可选同步会话摘要。
- 云端定位：Cloudflare/D1 仅作为可选同步服务，不进入实时采集、分类或游戏链路。
- Unity 定位：不进入新运行链路；现有 C# 骨架暂不删除，后续单独归档或移除。

桌面运行时不再使用 Next.js、vinext 或 Cloudflare Worker。当前游戏是单页面客户端状态机，不需要 SSR、SEO 或服务端路由；React + Vite 更适合 Electron 的静态 renderer 构建和离线启动。

## 2. 为什么选择 Electron 桌面路线

### 2.1 选择理由

1. **复用现有投入**：React、TypeScript、Tailwind、Canvas 和 Worker 代码都可以继续使用，无需重写游戏界面。
2. **固定渲染环境**：Electron 随应用携带 Chromium，实验室可以锁定应用与 Chromium 版本，减少用户浏览器版本、扩展和设置差异。
3. **统一管理 Python**：主进程自动启动、监控、重启和关闭 Python sidecar，实验人员无需手动打开多个程序。
4. **稳定的实验流程**：应用可以统一控制全屏、失焦处理、禁止意外导航、单实例、日志目录和异常退出清理。
5. **更可靠的本地通信**：Python 网关只服务当前桌面应用，不需要解决线上 HTTPS 页面访问 localhost 的混合内容和浏览器权限问题。
6. **适合固定 Windows 设备**：实验室电脑不敏感于 Electron 较大的安装包和内存开销，稳定性与可维护性优先于体积。
7. **清晰的权限边界**：Electron 主进程负责进程和文件权限；renderer 保持沙箱化，仅通过 preload 使用最小能力。[Electron 进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model)

桌面化主要提升部署、设备连接、实验操作、时序记录和异常恢复的稳定性，不会自动提高 EEG 分类准确率。分类效果仍取决于电极质量、信号质量、刺激频率、显示器刷新、同步误差、算法和用户状态。

### 2.2 其他可选方案

| 方案 | 优点 | 缺点 | 本项目结论 |
| --- | --- | --- | --- |
| 浏览器 + Python 网关 | 网页更新和分享方便 | 仍需本地 Python；存在 localhost 权限、浏览器差异和标签页失焦；后台标签页通常暂停动画循环 | 不选，实验环境不够可控。[MDN requestAnimationFrame](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame) |
| Tauri + React | 安装包和内存占用较小 | 引入 Rust 与 WebView2 适配；渲染运行时随系统变化；团队需要维护额外工具链 | 暂不选，体积收益不足以抵消实施复杂度 |
| Python Qt/PySide | Python 设备和算法集成直接 | React 游戏、Canvas 刺激和现有交互需要重写 | 不选，迁移成本最高 |
| Unity | 游戏编辑器与动画能力强 | 本项目是 2D 卡牌和实验流程；会形成第二套设备协议与测试体系 | 不选，不符合当前复杂度 |
| 纯浏览器直连 | 无桌面安装包 | 当前设备通过 TCP 服务 `127.0.0.1:7110`，不是 Web Serial；Web Serial 也不是全浏览器可用能力 | 不选。[MDN Web Serial](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API) |

如果未来产品转为面向大量普通用户、无需真实 EEG 或必须极小安装包，可重新评估浏览器或 Tauri；当前 Windows 实验室场景不需要预留双运行时。

## 3. 目标架构

```text
Windows Electron 桌面应用
│
├─ Electron Main Process
│  ├─ 单实例与窗口生命周期
│  ├─ Python sidecar 启动、健康检查、重启与关闭
│  ├─ 本地目录、日志和可选同步队列
│  └─ 最小化 IPC / preload API
│
├─ Preload Bridge
│  └─ 仅暴露网关状态、连接信息、重启和打开数据目录
│
├─ React + Vite Renderer
│  ├─ 设备与实验状态 UI
│  ├─ Canvas/WebGL SSVEP 刺激引擎
│  ├─ 纯游戏状态机
│  └─ Signal Web Worker
│      └─ 环形缓冲 → 滤波 → FBCCA/TRCA → 决策门控
│
└─ Python Device Gateway（PyInstaller onedir sidecar）
   ├─ TCP 连接 127.0.0.1:7110
   ├─ 自定义二进制协议
   ├─ 属性查询与采集控制
   ├─ EEG 帧接收与 float32 解码
   └─ 127.0.0.1 内部 WebSocket
```

实时数据流：

```text
EEG 服务 :7110
→ Python 自定义帧拆解
→ 内部 WebSocket binary EEG_CHUNK
→ Renderer Signal Worker
→ BciDecision
→ 游戏状态机
→ React UI 与反馈
```

刺激标记反向流：

```text
Canvas 实际呈现帧
→ stimulus_marker
→ Python 单调时钟记录
→ 本地会话日志
```

## 4. Electron 桌面壳

### 4.1 主进程职责

- 获取单实例锁；第二实例不接管设备，只激活已有窗口后退出。
- 创建 `%LOCALAPPDATA%/BrainGame/` 及会话数据目录。
- 启动随安装包分发的 Python sidecar，并传入回环端口、一次性令牌、日志目录和数据目录。
- 监听 sidecar readiness、退出码和 stderr；维护 `starting/ready/faulted/stopping/stopped` 状态。
- sidecar 异常退出时立即通知 renderer，终止当前试次并允许用户手动重启。
- 管理全屏实验窗口、失焦事件、意外导航和新窗口请求。
- 应用退出时协调停止采集、刷盘和 sidecar 关闭。
- 维护可选云同步队列；同步失败不得影响实验。

### 4.2 BrowserWindow 安全配置

- `sandbox: true`
- `contextIsolation: true`
- `nodeIntegration: false`
- renderer 不直接使用 Node、文件系统、进程或 shell API。
- 禁止任意外部导航和未授权新窗口。
- preload 只暴露明确列出的函数，不透传通用 `ipcRenderer`。

### 4.3 Preload 公共接口

```ts
type GatewayStatus =
  | "starting"
  | "ready"
  | "faulted"
  | "stopping"
  | "stopped";

interface GatewayConnection {
  url: string;              // ws://127.0.0.1:<randomPort>
  token: string;            // 仅本次应用进程有效
  protocolVersion: number;
}

interface BrainGameDesktopApi {
  getGatewayStatus(): Promise<GatewayStatus>;
  getGatewayConnection(): Promise<GatewayConnection | null>;
  restartGateway(): Promise<void>;
  openSessionFolder(sessionId?: string): Promise<void>;
  onGatewayStatusChanged(
    listener: (status: GatewayStatus) => void,
  ): () => void;
}
```

renderer 只能在网关状态为 `ready` 时获取连接信息。token 不写入配置、日志或会话文件。

### 4.4 启动与退出生命周期

```text
应用启动
→ 获取单实例锁
→ 创建本地目录
→ 创建 Electron 窗口
→ 启动 Python sidecar
→ Python 连接 EEG 服务 127.0.0.1:7110
→ readiness 握手
→ 查询设备属性
→ renderer 连接内部 WebSocket
→ 用户显式开始采集
→ EEG → Worker → BciDecision → 游戏状态机
→ 用户停止或关闭应用
→ 停止采集 → 会话刷盘 → 关闭 Python → Electron 退出
```

- Python 未就绪时显示设备故障页，不允许开始试次。
- Python 意外退出时，当前试次标记为不完整，不产生有效选牌结果。
- 用户点击重启网关后必须重新查询属性，不能复用旧连接或旧设备状态。
- 采集中关闭应用时，先发送停止命令并等待刷盘；超时后终止 sidecar，同时记录异常退出。
- renderer 崩溃或刷新不能让采集在后台无限继续；主进程负责触发安全停止。

## 5. Python 设备网关

### 5.1 保留范围

Python 只负责：

1. 连接和断开 EEG TCP 服务。
2. 自定义二进制命令编码和发送。
3. 连续字节流拆帧、帧头帧尾与长度验证。
4. 设备属性查询和响应解析。
5. 开始、停止采集和采集状态管理。
6. EEG payload float32 解码与通道顺序归一化。
7. 输出版本化应用消息并保存原始会话数据。

Python 不负责滤波、FFT、CCA/TRCA、选牌判定、计分、刺激呈现或游戏 UI。新网关不再依赖 SciPy 和 scikit-learn；NumPy 仅用于高效 float32 解码和数据打包。

### 5.2 模块边界

```text
device_gateway/
  transport.py          TCP 收发，不理解协议
  frame_parser.py       半包、粘包、帧尾验证与失步恢复
  protocol.py           帧头、长度、命令字、帧尾、payload
  device_client.py      查询、开始、停止、设备状态
  eeg_decoder.py        float32 解码与通道顺序归一化
  messages.py           桌面应用消息模型
  websocket_server.py   仅回环地址的内部应用接口
  session_writer.py     原始 EEG、标记和事件日志
  tests/
```

`communication2.2.py` 先通过 golden vectors 冻结行为，再机械提取这些模块；不得凭猜测改变设备帧常量。

### 5.3 已确认的设备协议

#### 设备连接

- 传输：TCP 字节流。
- 地址：`127.0.0.1:7110`。
- 当前 socket 超时：5 秒。
- 没有发现转义、CRC、序列号或设备时间戳。

#### 发往设备的命令

| 语义 | 字节序列 |
| --- | --- |
| 查询属性 | `A5 01 <property_id> 5A` |
| 开始采集 | `A5 10 01 5A` |
| 停止采集 | `A5 10 02 5A` |

| property_id | 含义 | 当前解析方式 |
| --- | --- | --- |
| `00` | 采集状态 | payload 前 4 字节，little-endian `uint32` |
| `01` | 采样率 | payload 前 4 字节，little-endian `uint32` |
| `02` | 每包样本数 | payload 前 4 字节，little-endian `uint32` |
| `03` | 导联数 | payload 前 4 字节，little-endian `uint32` |
| `04` | 导联名称 | 每个名称固定 8 字节 ASCII，NUL 填充 |
| `05` | EEG 数据 | 每个值 4 字节浮点数 |

#### 设备返回帧

```text
offset  size  field
0       1     0xAA
1       1     attribute_id
2       2     value_count, little-endian uint16
4       4     data_length, little-endian uint32
8       N     payload
8 + N   1     0x55
```

总帧长为 `9 + data_length`。现有 EEG 帧验证：

- 帧头为 `0xAA`；
- 帧尾为 `0x55`；
- `attribute_id == 5`；
- `data_length == value_count * 4`。

EEG payload 当前按以下方式解析：

```text
线性 float32
→ reshape(samples_per_packet, lead_count)
→ transpose
→ [channel][sample]
```

线上的逻辑顺序为“样本优先、通道交错”。旧代码使用宿主机原生浮点字节序；真机样例确认后，新实现显式使用 little-endian `float32`。2026-10-07 用户确认采集软件输出为 μV；解码、采集记录和新建会话元数据统一标注该单位，数值不做额外换算。BGEE v1 二进制头不增加字段，单位由采集软件约定。

### 5.4 设备生命周期

```text
disconnected
→ connecting
→ idle
→ querying_properties → idle
→ starting → acquiring
→ stopping → idle
→ disconnected

任意状态 → faulted → reconnecting/disconnected
```

- 查询属性成功后才允许开始采集。
- 同一设备命令串行执行；设备帧没有 transaction id。
- 属性查询有超时和取消。
- 开始/停止在现有设备协议中是 send-only，应用层区分 `sent` 与 `confirmed`。
- 开始确认优先查询属性 0；不支持时使用首个有效 EEG 帧确认。
- 停止确认优先查询属性 0；不支持时使用无在途数据后的静默期确认。
- 断连时取消挂起请求并清空接收缓冲区。
- 停止时允许少量在途帧，但必须按 sessionId 隔离，不能进入下一会话。

### 5.5 流式拆帧要求

- 处理半包、粘包和帧前噪声。
- payload 内出现 `0xAA` 时不能错误重同步。
- 拒绝超出配置上限的 `data_length`，避免无限内存分配。
- 错误帧尾后继续寻找下一有效帧。
- 正确分发交错到达的属性响应与 EEG 帧。
- 接收队列必须有上限；溢出时记录丢弃范围，不能静默丢样。

设备帧没有序列号，无法精确证明设备侧丢包。网关只能生成应用数据块序号，并依据采样率、每包样本数和到达时间报告“疑似传输间隙”。

## 6. Electron 与 Python 的内部应用协议

### 6.1 连接与安全

- Python 只绑定 `127.0.0.1:<randomPort>`，不得绑定 `0.0.0.0` 或局域网地址。
- Electron 每次启动生成一次性高熵 token，并随 sidecar 启动参数传入。
- WebSocket 建立后的第一条消息必须完成版本与 token 握手；验证失败立即关闭。
- 网关只接受当前桌面应用会话，不对外提供通用 HTTP 管理接口。
- 应用协议版本与设备私有协议分开管理。

### 6.2 控制消息

控制消息使用 UTF-8 JSON：

```text
hello
get_device_properties
start_acquisition
stop_acquisition
get_status
disconnect
stimulus_marker
shutdown
```

统一结果：

```json
{
  "protocolVersion": 1,
  "requestId": "renderer-generated-id",
  "type": "command_result",
  "command": "start_acquisition",
  "ok": true,
  "confirmation": "sent",
  "error": null
}
```

`ok: true` 表示网关成功处理请求，不等同于设备已经确认。`confirmation` 取值：

```text
sent
device_status
first_eeg
silent_after_stop
```

只有达到相应确认级别后，UI 才显示“采集中”或“已停止”。

### 6.3 设备属性消息

```text
acquisitionStatus
channelCount
sampleRateHz
samplesPerPacket
leadNames
sampleEncoding
sampleUnit
```

当前设备没有提供固件版本和设备 ID，字段不得由 UI 静态伪造。

### 6.4 EEG 二进制数据块

高频 EEG 使用 WebSocket binary message，直接进入 Signal Worker：

```text
protocolVersion
messageType = EEG_CHUNK
sessionId
gatewaySequence
firstSampleIndex
deviceTimestamp = null
gatewayMonotonicNs
sampleRateHz
channelCount
sampleCountPerChannel
sampleEncoding = float32
sampleUnit = μV            采集软件约定，BGEE v1 头中没有独立单位字段
samples                   时间优先、通道交错
transportGapSuspected
```

多字节字段固定字节序并写入协议测试。Python 不进行滤波、重参考或幅值归一化。

## 7. 时钟同步与刺激标记

Electron renderer 的 `performance.now()` 与 Python 的 `monotonic_ns()` 不共享原点，桌面封装不会消除这一差异。

1. renderer 连接网关后执行多次 ping/pong，估计时钟偏移和 RTT。
2. 刺激引擎在实际呈现帧回调中发送 `stimulus_marker`。
3. marker 包含 sessionId、trialId、target、频率、相位、renderer 时间和实际帧序号。
4. Python 记录 marker 到达时的单调时间并返回确认。
5. Signal Worker 根据校正时间或连续样本索引切取分类窗口。
6. 会话保存时钟偏移、RTT、实际帧时间和掉帧记录。

若设备支持硬件触发，后续优先使用硬件标记；软件时钟同步不能视为硬件同步。

## 8. 信号处理层

信号处理在 Electron renderer 的 Dedicated Web Worker 中执行，避免阻塞 React 与刺激呈现主线程。

第一版：

```text
EEG_CHUNK
→ session/sequence 检查
→ 环形缓冲区
→ 每个分析窗口逐导联去均值（DC/窗口基线）
→ 50 Hz 工频陷波（可配置）
→ SSVEP 频段带通
→ 固定或滑动时间窗
→ FBCCA
→ 置信度与拒识
→ 连续窗口投票
→ BciDecision
```

积累个人校准数据后再加入 TRCA/eTRCA。深度学习不作为首版依赖。

当前两目标基线实现冻结为 `fbcca-cca 0.2.0`：仅选取 O1/O2/P3/P4，逐通道去除窗口均值且不使用其他未准备导联重参考；以 257 阶线性相位 FIR 构成 6–45 Hz 与 14–45 Hz 两个子带，45 Hz 上限在进入 CCA 前排除 50 Hz 工频。每个候选使用真正的四通道最大典型相关，目标分数再除以 ±0.5/±1 Hz 邻频基线。当前待验证的简单模式频率版本为 `simple-frequency-v4`（左 16.5 Hz、右 12 Hz）；两目标统一使用 2 个谐波，因此不将 16.5×3=49.5 Hz 纳入参考集。在线窗口冻结为 2.5 s、步长 0.25 s，置信度阈值 0.52、领先幅度阈值 0.08，并要求连续 2 个同类有效窗口。环形缓冲按 marker 后的精确 `windowEndSample` 取窗，记录的窗口索引与实际数据一致；窗口长度写入 `stimulus_start.analysisWindowSeconds`。

教学模式使用独立的 `teaching-geometry-v3`：中央参考牌隐藏，2–4 个目标横向单排并垂直居中，目标牌面使用较大尺寸，牌下显示不闪烁的频率小字。教学目标频率由界面按目标数量提供 2–4 个输入，限制为 6–30 Hz 且不得重复；试次开始时将完整位置、频率、相位和版本写入 `stimulus_start`，不复用或污染正式两目标模型。

```ts
interface BciDecision {
  sessionId: string;
  trialId: string;
  candidateIndex: number | null;
  confidence: number;
  windowStartSample: number;
  windowEndSample: number;
  classifierName: string;
  classifierVersion: string;
  rejected: boolean;
  reason?: string;
}
```

鼠标调试也生成同一结构，使游戏状态机不关心决策来源。

## 9. 刺激呈现层

- React 只管理 UI，不通过 React state 或组件重渲染控制闪烁。
- Canvas/WebGL 使用 `requestAnimationFrame` 按实际显示帧驱动刺激。
- 实验开始前测量刷新率，只开放可稳定合成的目标频率。
- 记录每个刺激帧的计划状态、实际时间和掉帧。
- 实验期间使用全屏窗口并阻止意外导航。
- 窗口失焦、最小化、刷新率变化或连续掉帧超过阈值时，本试次作废并进入休息状态。
- 刺激参数在试次开始时冻结，试次中不能被设置 UI 修改。
- 当前两目标刺激几何版本为 `simple-geometry-v2`：目标中心为 `(0.24, 0.64)` 与 `(0.76, 0.64)`，牌面 `136×190 px`，牌后正弦光带向外扩展 `44 px`，Canvas CSS 高度 `600 px`，静止参考牌中心为 `(0.5, 0.24)`。被试复测当前使用频率版本 `simple-frequency-v6`（左 12 Hz、右 15 Hz）；v5 为左 12 Hz、右 16.5 Hz，v4 为左 16.5 Hz、右 12 Hz，三版本必须分开分析。亮度基线/幅度仍为 0.5/0.45。困难模式保持紧凑牌面和原 520 px Canvas。
- `stimulus_start` marker 必须保存几何版本、画布高度、牌面/光带尺寸、参考牌位置及每个目标的归一化 `x/y`。任一几何参数变化都使既有校准和准确率验证失效；变更后先重新进行单目标隔离复测，再进行双目标验证。
- 当前真人 EEG 频率验收因单一被试波动暂缓；在恢复真人测试前，先使用合成信号和历史会话完成算法、marker、时序及异常恢复回归。暂缓期间不得据此生成个体 eTRCA 模板或解锁困难模式。
- 单目标隔离诊断每次采集开始时生成一个左右各 4 次的随机平衡序列；序列位置与完整序列写入 `stimulus_start` marker，分析按 marker 中的 `cuedTargetIndex` 对齐，不假定固定交替顺序。

## 10. 游戏与 UI

游戏采用纯状态机：

```text
ready → fixation → preview → stimulus → feedback → rest
```

输入事件：

```text
START
DEVICE_READY
FIXATION_DONE
STIMULUS_STARTED
BCI_DECISION
DECISION_TIMEOUT
FEEDBACK_DONE
DEVICE_LOST
RESET
```

状态机只负责候选牌、目标比较、计分、连胜和阶段推进，不读取 TCP、不解析 EEG、不执行 FFT，也不直接控制 Canvas 帧循环。

UI 展示真实状态：

- Python sidecar、EEG 服务和设备连接状态；
- 采样率、通道数、每包样本数和导联名称；
- 信号质量和最近一次分类置信度；
- 游戏牌面、目标、分数和阶段；
- 疑似传输间隙、非法帧、缓冲溢出、掉帧和时钟同步；
- 本地保存、未同步和同步失败状态。

## 11. 本地存储与可选同步

### 11.1 本地目录

```text
%LOCALAPPDATA%/BrainGame/
  config/
  logs/
  sync-queue/

%USERPROFILE%/Documents/BrainGame/Sessions/<sessionId>/
  session.json
  eeg.bin
  markers.jsonl
  decisions.jsonl
  events.jsonl
```

- 配置、运行日志和同步队列放在 `%LOCALAPPDATA%`。
- 用户可见实验数据放在 Documents，便于备份和导出。
- 原始 EEG、marker、决策和异常先写入本机，不依赖网络。
- 会话文件采用临时文件写入后原子替换，避免崩溃留下看似完整的数据。
- 卸载应用默认不删除用户会话数据。

### 11.2 云端同步

- Cloudflare/D1 只同步会话摘要、成绩、准确率、响应时间、应用版本和算法版本。
- 原始 EEG 默认不上传。
- 同步是后台可选能力；失败进入本地重试队列，不影响下一次实验。
- 未经单独授权和隐私设计，不增加原始 EEG 上传。

## 12. 建议目录

```text
desktop/
  main/                  Electron 主进程与 Python 监督
  preload/               最小安全桥
  packaging/             electron-builder 与 sidecar 配置

renderer/
  components/            React UI
  stimulus/              Canvas/WebGL 刺激
  bci/                    gateway client、clock sync、Signal Worker
  game/                   状态机、计分、类型

device_gateway/
  transport.py
  frame_parser.py
  protocol.py
  device_client.py
  eeg_decoder.py
  messages.py
  websocket_server.py
  session_writer.py
  tests/
```

Python 使用 PyInstaller `onedir` 打包，Electron 使用 Windows x64 安装包分发。桌面 renderer 使用 Vite 静态构建，不启动 Next.js 服务。

## 13. 分阶段实施

### 阶段 A：冻结设备协议

1. 将 `communication2.2.py` 作为只读基线。
2. 为 5 个属性查询和开始/停止命令建立发送帧 golden vectors。
3. 提取真实属性响应和 EEG 完整帧。
4. 核验 float32 字节序、单位、最大包长和开始/停止确认行为。
5. 建立旧解析结果回放测试。

### 阶段 B：Python 设备网关

1. 在不改变帧结果的前提下拆分协议模块。
2. 实现统一接收分发、状态机、有界队列和错误统计。
3. 实现带 token 的内部 WebSocket、控制消息和 EEG binary chunk。
4. 实现本地 session writer 和安全关闭。
5. 通过录制数据后再进行真机验证。

### 阶段 C：Electron 桌面壳

1. 创建 Electron main、preload 和 Vite renderer。
2. 实现单实例、沙箱窗口、导航限制和 Python 监督。
3. 实现本地目录、日志、退出清理与故障恢复。
4. 使用 PyInstaller onedir 和 Windows 安装包完成离线部署。

### 阶段 D：信号与游戏

1. 建立 Signal Worker、环形缓冲、滤波和 FBCCA。
2. 提取纯游戏状态机，统一鼠标与脑电决策事件。
3. 将 CSS 刺激替换为逐帧记录的 Canvas/WebGL 引擎。
4. 完成时钟同步、刺激 marker 和拒识策略。

### 阶段 E：存储、同步与系统验证

1. 完成本地会话数据、崩溃恢复和导出。
2. 增加可选摘要同步及离线重试队列。
3. 完成真机、长时间运行、异常退出和安装机验证。

## 14. 验收标准

### 桌面应用

- Windows 10/11 x64 标准用户可安装、离线启动和卸载。
- 单实例生效，第二实例不会控制设备。
- renderer 无 Node、任意文件或进程权限。
- Python sidecar 可自动启动、检测故障、手动重启和安全关闭。
- Python 未就绪或崩溃时不产生有效游戏决策。
- 采集中退出能够先停止设备并保存会话；强制终止会留下明确异常记录。

### 设备协议

- 新 Python 结构生成的设备命令与旧实现逐字节一致。
- 旧录制数据解析出相同设备属性和 EEG 样本。
- 任意半包、粘包、错误帧尾和噪声后能够恢复。
- 查询、开始、连续接收、停止、断开和重连可重复运行。
- 错误 token 或非回环连接不能访问网关。

### 信号、刺激和游戏

- 相同 EEG 回放产生可复现分类结果。
- 每次决策可追溯到输入样本、算法和参数版本。
- 低置信度、数据不足、疑似传输间隙或刺激掉帧时拒识。
- 鼠标与脑电通过同一 `BciDecision` 驱动游戏。
- 游戏状态机测试不依赖设备、Electron 或 DOM。
- 刺激刷新率、实际帧时间、失焦和掉帧可以导出。

### 数据与同步

- 完全断网时可完成实验并保存全部本地数据。
- 应用崩溃不会把未完成会话标记为成功完成。
- 同步失败不阻塞实验，并在联网后可重试。
- 默认只同步摘要，不上传原始 EEG。

## 15. 仍需真机确认的设备事实

| 问题 | 当前源码证据 | 实施要求 |
| --- | --- | --- |
| EEG float32 字节序 | `np.frombuffer(..., np.float32)` 使用宿主原生字节序 | 用真实帧确认后显式使用 `<f4` |
| EEG 数值单位 | 2026-10-07 用户确认采集软件输出为 μV | 统一标注 `sampleUnit: μV`，不换算原始数值 |
| 最大 `data_length` | 源码没有上限 | 根据真实最大包设置硬上限 |
| 开始确认 | 发送后直接视为开始 | 验证属性 0 查询或首帧确认 |
| 停止确认 | 发送后直接退出流程 | 验证属性 0 查询或静默期确认 |
| 采集中属性查询 | 旧程序只在采集前查询 | 真机验证统一分发场景 |
| 设备侧丢包 | 帧内没有序列号 | 只报告疑似传输间隙 |
| 硬件刺激标记 | 源码未体现 | 查询设备协议；没有则保留软件时钟同步 |
