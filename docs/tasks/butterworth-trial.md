# Butterworth试用识别与开放牌桌（2026-11-02）

已完成main源码与构建；实验调试工作区未修改。未提交、推送或制作安装包。

## 使用与边界

- 2026-11-18 起，新自由游戏与三关挑战自动使用 Butterworth。游戏设置只显示难度和局长，旧的本地识别偏好对新对局无效。
- 续玩挑战采用记录中的识别方案，因此旧 FIR 挑战可继续完成。教学和诊断使用原有识别实现。
- 首次交付使用`game-open-v3`扩大候选牌、增加净间距、重排参考牌与候选牌；1920×1080下较`game-card-face-v2`约再大10%—14%，小窗口优先保证安全空间。后续新游戏已升级为`game-open-v4`：再放大5%并适度下移，旧挑战沿用已保存尺寸。
- 新布局的阶段提示移到底部，字号22—30px；识别结果28px（窄窗口22px），位于得分左侧。正确文字与选中描边均为绿色#287A50；结果420ms单次入场，系统减少动态偏好下关闭。刺激期间不播放结果动画。

## 识别实现

入口：[gameClassifier.ts](../../renderer/src/bci/signal/gameClassifier.ts)、[butterworth.ts](../../renderer/src/bci/signal/butterworth.ts)、[signal.worker.ts](../../renderer/src/bci/signal/signal.worker.ts)、[游戏选牌边界](../../renderer/src/game/eegSelection.ts)。

| 项目 | 试用设置 |
| --- | --- |
| profile / 分类器 | butterworth-trial-v1 / fbcca-butterworth trial-1.0.0 |
| 导联 | P3、P4、Oz、Pz |
| 滤波 | 6—45Hz、14—45Hz；每带4阶高通＋4阶低通SOS，因果持续状态 |
| 初始条件 | 每导联首样本去偏置、SOS状态置零，分包不重置 |
| 热身／窗口／步长 | 256样本／2.5秒／round(0.25×fs)样本 |
| 评分 | 两带CCA相关平方按1与2^(-1.25)加权；不做原邻频CCA归一化 |
| 参考信号 | 与原实现一致，最多3谐波，受45Hz截止约束 |
| 决策 | 最大分数占总分≥0.25、第一第二占比差≥0.08，连续2票 |
| 试次 | 原6秒刺激、500ms分析宽限、首绘制帧样本标记规则不变 |

试用路径使用Jacobi求最大特征值、相对ridge=1e-8。与独立SVD参考核对时，原64次幂迭代在接近特征值处存在未充分收敛差异，故仅试用路径替换；没有放宽原评分误差容限。原FIR路径保留原迭代器、ridge、局部归一化、阈值和完全相同的旧配置指纹。Butterworth是滤波方法，该实现仍为滤波器组CCA，不是单带标准CCA。

Worker共享原标记、会话、导联、样本窗口与异常保护；试次携带预期classifierName，拒绝跨profile旧决策。采集标记保存profile、滤波方式、策略和版本，挑战指纹保存带宽、阶数、权重、求解方式及门槛。

## 验证

已执行：

- `npm run typecheck`、`npm run build`通过，最后生产改动为底部字号选择器修正；没有依赖变更。
- `npm run test:stimulus`、`npm run test:presentation`（17项）、`npm run test:challenge`（10项）通过。后续新增试用断包／异常样本／旧标记检查后，单独重跑`node --experimental-strip-types --test renderer/src/bci/signal/butterworth.test.mjs`，5项全部通过；未重复无关检查。
- 首次交付时在 Electron 中验证了旧版识别选项的切换和保存。当前 `node tools/butterworth-ui-smoke.cjs` 验证移除选项后，即使保留原方案偏好，重启仍会使用 Butterworth。
- `node tools/challenge-smoke.cjs`模拟30轮完成与保存、退出及重启恢复、排行榜、旧FIR配置恢复全部通过；20正确／5错误／5拒识是隔离模拟成绩。其后仅扩大参考牌、修正底部字号，故复用该挑战存储与profile验证；不把旧截图当新布局验收。
- `node tools/game-hud-smoke.cjs --feedback`240组反馈布局通过；随后参考牌扩大、底部字号修正后重新执行`--layout`120组，包含10种窗口×3难度×10／15轮×准备／倒计时状态，检查实际标题边界、底部字号≥22、裁切和遮挡。最后`--motion`3项通过，核对绿色描边像素、动画名及减少动态偏好，截图已目视检查。

真实旧数据独立核对：

```powershell
python tools/prepare-butterworth-verification.py --source 'D:\codex_project\脑机接口游戏\reports' --out .smoke-user-data/butterworth-validation
node tools/verify-butterworth.mjs .smoke-user-data/butterworth-validation/reference.json
```

只读原实验导出与其样本索引，校验每份原始导出哈希。250／500／1000Hz的独立SciPy SOS参考最大绝对误差1.84e-12；360试次、3,600同样本窗口、16,800评分最大绝对误差1.26e-6（容限2e-5），360次首次决策全部一致。结果256正确、91错误、13拒识是先前五人探索性数据回放，并非新独立测试集结果。源决策CSV的SHA256为`fc6edfc034ec81b53b625261844d0185f3bb2182be3e66dc26b0b6734f7f466d`。

原始证据在`.smoke-user-data/`各任务目录；筛选副本与本次构建指纹见[本地验证交付目录](../../reports/butterworth-trial-20261102/)。不复制原始EEG或实际身份成绩，不将个人数据加入Git。

## 未验证与下一步

- 未进行新版牌面／新几何／全牌闪烁下的真实EEG测试；历史探索性阈值尚无新条件的独立验证。
- 界面检查使用隔离软件渲染窗口，不能当作Windows实屏GPU、60Hz丢帧、显示器亮度或硬件同步验收。
- 后续实测记录应按识别方案和刺激尺寸核对配置。