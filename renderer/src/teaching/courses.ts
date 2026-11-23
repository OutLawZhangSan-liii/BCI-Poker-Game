export interface TeachingQuiz {
  question: string;
  options: string[];
  answer: number;
  explanation: string;
}

export interface TeachingCourse {
  id: "system" | "time" | "harmonics" | "targets" | "feedback" | "noise" | "snr" | "time-frequency";
  lessonNumber: number;
  shortTitle: string;
  title: string;
  subtitle: string;
  objective: string;
  principle: string;
  example: string;
  steps: string[];
  observe: string[];
  quiz: TeachingQuiz;
  conclusion: string;
  flowSteps?: Array<{ label: string; description: string }>;
}

export const teachingHighlights: Record<TeachingCourse["id"], { focus: string; example: string }> = {
  system: { focus: "屏幕上的闪烁会在脑电中留下对应的节律。", example: "点选下面的环节，看系统怎样判断你在看哪个目标。" },
  time: { focus: "频率越高，一个周期越短。", example: "比较 12 Hz 和 15 Hz 的波形，哪条曲线的波峰更密？" },
  harmonics: { focus: "脑电响应也可能出现在刺激频率的整数倍处。", example: "改变基频，看二次、三次谐波分别落在哪里。" },
  targets: { focus: "不同目标以不同频率闪烁。", example: "左侧目标以 12 Hz 闪烁，右侧以 15 Hz 闪烁。试试增加目标数量。" },
  feedback: { focus: "两个目标的得分太接近时，系统可以暂缓选择。", example: "切换下面的例子，比较两个目标的得分和判断结果。" },
  noise: { focus: "眨眼、肌肉活动和电源干扰都可能改变脑电频谱。", example: "先固定幅值，慢慢加大噪声，看看 12 Hz 峰何时变得难辨。" },
  snr: { focus: "峰高相同时，背景噪声越低，目标峰越容易辨认。", example: "保持噪声不动，把信号幅值翻倍，看看信噪比增加了多少。" },
  "time-frequency": { focus: "长时间窗更容易分开相近的频率，但要等更久。", example: "把时间拖到第 5 秒，再向后移动。比较 1 秒窗和 4 秒窗，哪个先判为 15 Hz？" },
};

export const teachingCourses: TeachingCourse[] = [
  {
    id: "system", lessonNumber: 1, shortTitle: "从刺激到反馈", title: "从刺激到反馈",
    subtitle: "认识 SSVEP 系统如何把视觉刺激转化为控制信息",
    objective: "理解 SSVEP 系统中“刺激—脑响应—采集—分析—判断—反馈”的基本链路。",
    example: "例如，两张牌分别以 12 Hz 和 15 Hz 闪烁。系统采集脑电（EEG），比较这两组频率的响应，有足够证据时才选牌。",
    principle: "周期性闪烁可以引起稳态视觉诱发电位（SSVEP）。人在看一个闪烁的目标时，脑电中可能出现与闪烁同频或成整数倍的节律。",
    steps: ["从左到右点击链路环节，区分“获取信号”和“判断目标”。"],
    observe: ["这条链路依靠怎样的周期性刺激？下一课从频率与波形开始。"],
    flowSteps: [
      { label: "视觉刺激", description: "屏幕上的目标分别按设定的频率闪烁。" },
      { label: "EEG 响应", description: "注视目标时，脑电中可能出现同频和倍频的响应。" },
      { label: "信号采集", description: "头皮电极记录电压随时间的变化。" },
      { label: "特征分析", description: "系统计算脑电和各个刺激频率的匹配得分。" },
      { label: "目标判断", description: "系统比较各个目标的得分，差距太小时可以暂不选牌。" },
      { label: "控制反馈", description: "确认选择后，界面显示选中的牌。" },
    ],
    quiz: {
      question: "系统已经记录了脑电。要判断你在看哪张牌，接下来还要做什么？",
      options: ["A. 保存脑电文件", "B. 比较脑电与各张牌闪烁频率的匹配程度", "C. 增加屏幕亮度", "D. 重放同一段刺激"],
      answer: 1,
      explanation: "电极记录的是电压变化。系统从中找出与闪烁频率相关的响应，才能判断注视目标。",
    },
    conclusion: "SSVEP 的关键不是“采到脑电”，而是从脑电中提取能够代表用户选择的信息。",
  },
  {
    id: "time", lessonNumber: 2, shortTitle: "从闪烁到波形", title: "从闪烁到波形",
    subtitle: "理解频率、周期与时域信号",
    objective: "理解 Hz、周期以及不同频率在时域波形中的表现。",
    example: "周期 T = 1 / f。12 Hz 的周期约为 83.3 ms，15 Hz 约为 66.7 ms。图中的两条曲线是按公式画出的示意波形。",
    principle: "频率表示每秒重复的次数，单位是赫兹（Hz）。从一个波峰到下一个波峰的时间就是一个周期。",
    steps: ["切换 12 Hz / 15 Hz，比较重复结构的间距和周期读数。"],
    observe: ["知道重复速度后，怎样在脑电中找到它？下一课把时域观察转向频谱结构。"],
    quiz: {
      question: "两条波形显示的时间一样长。看哪里能分辨 12 Hz 和 15 Hz？",
      options: ["A. 波形颜色", "B. 周期之间的时间间距", "C. 波形在屏幕中的位置", "D. 第一个采样点的幅值"],
      answer: 1,
      explanation: "15 Hz 每秒多重复三次，相邻波峰之间的时间更短。",
    },
    conclusion: "频率描述“重复得有多快”，在时域中体现为周期长度的变化。",
  },
  {
    id: "harmonics", lessonNumber: 3, shortTitle: "从基频到谐波", title: "从基频到谐波",
    subtitle: "认识 SSVEP 的频谱结构",
    objective: "理解为什么 SSVEP 的有效信息不一定只出现在刺激频率本身。",
    example: "例如，12 Hz 刺激的二次和三次谐波在 24 Hz 和 36 Hz。不同人、不同通道的峰高会有差异。图中标出的是频率位置，峰高要看实际脑电。",
    principle: "如果目标以频率 f 闪烁，脑电中可能在 f、2f、3f 等位置出现谱峰。后两个位置分别对应二次和三次谐波。",
    steps: ["调整基频，对照 f、2f、3f 的位置，区分公式预期与实测证据。"],
    observe: ["不同刺激会对应不同频率结构；下一课用这些结构为多个目标编码。"],
    quiz: {
      question: "12 Hz 刺激下，12 Hz 峰很弱，24 Hz 和 36 Hz 处却都有峰。能据此排除 SSVEP 吗？",
      options: ["A. 是，必须只有 12 Hz 才算 SSVEP", "B. 不一定，谐波也可能包含明显的刺激相关响应", "C. 是，24 Hz 一定属于噪声", "D. 只有 36 Hz 有意义"],
      answer: 1,
      explanation: "24 Hz 和 36 Hz 都是 12 Hz 的整数倍。有些通道上的谐波比基频更明显。",
    },
    conclusion: "SSVEP 的判断依据往往是一组频率结构，而不是一个孤立峰值。",
  },
  {
    id: "targets", lessonNumber: 4, shortTitle: "多目标频率编码", title: "多目标频率编码",
    subtitle: "理解不同刺激目标如何对应不同控制指令",
    objective: "理解 SSVEP 如何利用不同刺激频率区分用户正在注视的目标。",
    example: "12 Hz 和 15 Hz 相差 3 Hz，12 Hz 和 12.2 Hz 只差 0.2 Hz。在相同的短时间窗内，后一组更难分开。延长观察时间通常有帮助。",
    principle: "系统给每个目标分配一个闪烁频率，再比较脑电与各个频率的匹配程度。",
    steps: ["可切换目标数量预设，理解每增加一个目标就需要一组可区分的编码；预设不会启动训练。"],
    observe: ["编码可区分还不够：证据接近时该选哪一个？下一课讨论决策与拒识。"],
    quiz: {
      question: "在相同的时间窗内，把两个目标从 12 Hz 和 15 Hz 改为 12 Hz 和 12.2 Hz，会怎样？",
      options: ["A. 更容易区分", "B. 更难区分，因为两个目标的频率特征更接近", "C. 完全没有区别", "D. 只会影响刺激亮度"],
      answer: 1,
      explanation: "两个频率只差 0.2 Hz。能否分开，还取决于观察时长、噪声大小和识别方法。",
    },
    conclusion: "多目标 SSVEP 本质上是在设计“可区分的频率编码”。",
  },
  {
    id: "feedback", lessonNumber: 5, shortTitle: "从证据到决策", title: "从证据到决策",
    subtitle: "理解分类、置信度与拒识",
    objective: "理解为什么 SSVEP 系统不应该在证据不足时强行输出结果。",
    example: "示例中，A 得 0.52，B 得 0.48，两者只差 0.04。这里的分数用来演示匹配程度，不能读作选对的概率。",
    principle: "分类得分表示脑电与目标的匹配程度。最高分和次高分很接近时，系统可以拒识，等下一次再判断。",
    steps: ["切换证据较强与证据接近的固定案例，比较候选和拒识的理由。"],
    observe: ["分类证据也可能来自干扰；下一课先认识噪声与伪迹，避免把错误证据当成脑响应。"],
    quiz: {
      question: "两个目标的得分很接近时，系统为什么可以暂不选牌？",
      options: ["A. 因为系统计算速度不够", "B. 因为证据不足时强行分类容易产生错误控制", "C. 因为 EEG 不能实时处理", "D. 因为只能识别一个目标"],
      answer: 1,
      explanation: "两个目标都可能是用户注视的对象，此时输出最高分的目标容易选错。",
    },
    conclusion: "可靠的 BCI 不只需要“会选择”，还需要知道什么时候不应该选择。",
  },
  {
    id: "noise", lessonNumber: 6, shortTitle: "噪声与伪迹", title: "噪声与伪迹",
    subtitle: "理解频谱中的高峰为什么不一定来自 SSVEP",
    objective: "认识 EEG 中常见噪声和伪迹，并理解“出现峰值”并不等于“发现脑响应”。",
    example: "例如，在 12 Hz 刺激下看到 50 Hz 峰，应先排查工频干扰，再检查 12 Hz 及其谐波处的响应。课程里的加噪实验只模拟背景噪声。",
    principle: "眨眼和肌肉活动会混入电极记录的电压，电极松动也会改变波形。电源干扰常在工频附近形成窄峰。",
    steps: ["应用不同加噪场景，再主动开始模拟分析，比较时域与 PSD 中的背景变化。"],
    observe: ["排除错误来源后，如何比较证据质量？下一课关注目标响应相对背景有多突出。"],
    quiz: {
      question: "频谱里有一个很高的峰，单看峰高就能确认它来自视觉刺激吗？",
      options: ["A. 可以，峰值越高越可信", "B. 不可以，还需要结合刺激频率、谐波、背景噪声和实验条件判断", "C. 可以，只要高于其他频率", "D. 只要出现在 50 Hz 就可以"],
      answer: 1,
      explanation: "眨眼、肌电和工频干扰都可能改变频谱。还要核对峰的位置、刺激条件和数据质量。",
    },
    conclusion: "发现一个峰只是开始，还需要判断这个峰是否真的与刺激有关。",
  },
  {
    id: "snr", lessonNumber: 7, shortTitle: "信噪比与可靠性", title: "信噪比与可靠性",
    subtitle: "理解什么样的频率响应更值得相信",
    objective: "理解 SNR（Signal-to-Noise Ratio，信噪比）为什么比单纯观察峰值更能反映信号质量。",
    example: "这里的模拟信号和噪声分别生成，可以直接用两者在同一时间窗内的均方值计算 SNR。选牌正确率则要用有已知答案的试次来统计。",
    principle: "信噪比（SNR）是信号功率与噪声功率的比值。看真实脑电频谱时，常用目标频率附近的频点估计背景噪声。",
    steps: ["比较低噪声、高噪声和提高信号幅值的案例，观察目标相对背景与模拟 SNR 的变化。"],
    observe: ["要让证据更稳定，往往需要更多数据；下一课讨论这种等待与实时响应之间的权衡。"],
    quiz: {
      question: "两次记录的 12 Hz 峰一样高，第二次的背景噪声更强。哪次的峰更容易辨认？",
      options: ["A. 第一次", "B. 第二次", "C. 两次一样清楚", "D. 还要知道采样开始的时刻"],
      answer: 0,
      explanation: "第一次的背景噪声较低，同样高的 12 Hz 峰更容易从周围频点中分辨出来。",
    },
    conclusion: "信号是否可信，取决于目标响应相对于背景噪声有多明显，而不只是峰值有多高。",
  },
  {
    id: "time-frequency", lessonNumber: 8, shortTitle: "实时识别与时频变化", title: "实时识别与时频变化",
    subtitle: "理解时间窗、频率分辨率和实时响应之间的权衡",
    objective: "理解为什么实时 BCI 需要在稳定分析和响应速度之间进行取舍。",
    example: "本例每隔 0.25 秒比较窗口中 12 Hz 和 15 Hz 的功率。第 5 秒，输入从 12 Hz 切到 15 Hz。4 秒窗里还有较多切换前的样本，因此会比 1 秒窗更晚转为 15 Hz。",
    principle: "功率谱描述一个时间窗内有哪些频率。把连续时间窗的功率谱按先后排开，就能在时频图上看到能量随时间的变化。",
    steps: ["应用稳定或变频案例，主动开始模拟分析；比较不同窗口下的频带清晰度与变化位置。"],
    observe: ["回顾整条链路：刺激编码 → 频率特征 → 目标判断 → 噪声与可靠性 → 实时反馈。可靠控制需要同时考虑证据质量和等待时间。"],
    quiz: {
      question: "把分析窗口从 1 秒加长到 4 秒，对第一次判断有什么影响？",
      options: ["A. 判断更稳定，但响应延迟增加", "B. 判断更快，同时更加稳定", "C. 频率信息完全消失", "D. 与实时识别没有关系"],
      answer: 0,
      explanation: "4 秒的数据包含更多周期，更容易区分相近频率。要填满第一个窗口，也比原来多等 3 秒。",
    },
    conclusion: "实时 BCI 的设计，本质上是在“更快响应”和“更稳定判断”之间寻找平衡。",
  },
];

// Fixed lesson examples only; these are not live classifier scores or thresholds.
export const teachingFeedbackExamples = {
  candidate: { label: "证据较强", candidate: "目标 A：0.83 · 目标 B：0.17", status: "A 的证据较强", explanation: "两个分数差距较大，可以把 A 作为候选；能否输出仍需满足系统的判定条件。" },
  rejected: { label: "证据接近", candidate: "目标 A：0.52 · 目标 B：0.48", status: "可以拒识，暂不输出", explanation: "虽然 A 略高，但两者接近。证据不足时，拒识可减少错误控制。" },
  empty: { label: "没有证据", candidate: "暂无本轮结果", status: "不做决定", explanation: "没有当前有效证据时，不能用旧结果代替本轮判断。" },
  mouse: { label: "强行输出", candidate: "目标 A：0.52 · 目标 B：0.48", status: "选择 A，但风险较高", explanation: "只取最高分会得到 A，却忽略证据非常接近；最高分不等于可靠选择。" },
} as const;

export const courseById = (id: TeachingCourse["id"]) => teachingCourses.find((course) => course.id === id) ?? teachingCourses[0];
