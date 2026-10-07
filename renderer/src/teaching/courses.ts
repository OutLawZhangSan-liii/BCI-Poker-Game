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

export const teachingCourses: TeachingCourse[] = [
  {
    id: "system", lessonNumber: 1, shortTitle: "从刺激到反馈", title: "从刺激到反馈",
    subtitle: "认识 SSVEP 系统如何把视觉刺激转化为控制信息",
    objective: "理解 SSVEP 系统中“刺激—脑响应—采集—分析—判断—反馈”的基本链路。",
    example: "视觉刺激 → EEG 响应 → 信号采集 → 特征分析 → 目标判断 → 控制反馈。点击每个环节，观察信号如何逐步转化为控制信息。",
    principle: "SSVEP（Steady-State Visual Evoked Potential，稳态视觉诱发电位）是周期性视觉刺激引起的、与刺激频率相关的脑电响应。EEG 采集获得原始脑电，系统还需提取刺激相关特征，再判断用户可能注视的目标。\nBCI（脑机接口）要完成从脑电信号到用户意图，再到反馈或控制的完整解码链路。",
    steps: ["从左到右点击链路环节，区分“获取信号”和“判断目标”。"],
    observe: ["这条链路依靠怎样的周期性刺激？下一课从频率与波形开始。"],
    flowSteps: [
      { label: "视觉刺激", description: "屏幕呈现周期变化的视觉目标，为不同选择提供刺激。" },
      { label: "EEG 响应", description: "注视刺激时，大脑可能产生与刺激频率及其谐波相关的电活动。" },
      { label: "信号采集", description: "电极和设备记录脑电序列；采到数据还不等于判断出用户的选择。" },
      { label: "特征分析", description: "从脑电中提取与刺激频率相关的特征，寻找目标对应的证据。" },
      { label: "目标判断", description: "比较不同目标的证据，形成候选；证据不足时可以暂不判断。" },
      { label: "控制反馈", description: "把有效判断转化为界面反馈或控制信息，闭合系统链路。" },
    ],
    quiz: {
      question: "如果系统已经成功记录到 EEG，但没有对信号进行分析和目标判断，它是否已经完成了 SSVEP 控制？",
      options: ["A. 是，只要记录到 EEG 就完成了 BCI", "B. 不是，还缺少从脑电信号到用户意图的解码", "C. 是，只要视觉刺激频率正确", "D. 与 EEG 是否真实无关"],
      answer: 1,
      explanation: "EEG 采集只是获取信号。SSVEP 系统还必须从信号中识别与刺激目标相关的频率特征，并进一步完成目标判断，才能形成真正的“刺激—感知—解码—反馈”链路。",
    },
    conclusion: "SSVEP 的关键不是“采到脑电”，而是从脑电中提取能够代表用户选择的信息。",
  },
  {
    id: "time", lessonNumber: 2, shortTitle: "从闪烁到波形", title: "从闪烁到波形",
    subtitle: "理解频率、周期与时域信号",
    objective: "理解 Hz、周期以及不同频率在时域波形中的表现。",
    example: "在 1 秒内，12 Hz 信号完成 12 个周期，15 Hz 信号完成 15 个周期；对应周期约为 83.3 ms 和 66.7 ms。下面是归一化区间的数学预览，用来比较重复间距，并非 1 秒真实 EEG 记录。",
    principle: "频率表示周期性信号每秒重复的次数，单位为 Hz（赫兹）；12 Hz 表示每秒完成 12 个周期。周期 T 与频率 f 满足 T = 1 / f，因此频率越高，单个周期越短，相同时间内的重复结构越多。\n在时域波形中，区分频率最直接的依据是重复结构的时间间隔，而不是幅值大小。",
    steps: ["切换 12 Hz / 15 Hz，比较重复结构的间距和周期读数。"],
    observe: ["知道重复速度后，怎样在脑电中找到它？下一课把时域观察转向频谱结构。"],
    quiz: {
      question: "如果 12 Hz 和 15 Hz 两个周期信号同时显示在 1 秒时间范围内，哪项特征最直接反映它们的频率不同？",
      options: ["A. 波形颜色", "B. 周期之间的时间间距", "C. 波形在屏幕中的位置", "D. 第一个采样点的幅值"],
      answer: 1,
      explanation: "频率决定单位时间内重复的次数，因此在时域中最直接表现为周期长度和相邻重复结构之间的时间间距。",
    },
    conclusion: "频率描述“重复得有多快”，在时域中体现为周期长度的变化。",
  },
  {
    id: "harmonics", lessonNumber: 3, shortTitle: "从基频到谐波", title: "从基频到谐波",
    subtitle: "认识 SSVEP 的频谱结构",
    objective: "理解为什么 SSVEP 的有效信息不一定只出现在刺激频率本身。",
    example: "12 Hz 刺激可能在 EEG 中引起 12 Hz、24 Hz、36 Hz 等位置的响应。下面可调整基频，观察整数倍位置如何联动；条形只表示公式位置，不表示实际响应强度。",
    principle: "SSVEP 不一定只在刺激频率本身产生响应。12 Hz 刺激可能在 12、24、36 Hz 等位置出现增强：12 Hz 为基频，24、36 Hz 等整数倍频率称为谐波。\n基频与谐波的强弱随被试、通道和刺激条件而变化，实际分析不能只看单个频点；预期位置也不保证出现实测峰值。",
    steps: ["调整基频，对照 f、2f、3f 的位置，区分公式预期与实测证据。"],
    observe: ["不同刺激会对应不同频率结构；下一课用这些结构为多个目标编码。"],
    quiz: {
      question: "某次 12 Hz 刺激实验中，12 Hz 峰值并不明显，但 24 Hz 和 36 Hz 附近都出现稳定增强。是否应该立即判断“没有产生 SSVEP”？",
      options: ["A. 是，必须只有 12 Hz 才算 SSVEP", "B. 不一定，谐波也可能包含明显的刺激相关响应", "C. 是，24 Hz 一定属于噪声", "D. 只有 36 Hz 有意义"],
      answer: 1,
      explanation: "SSVEP 可以同时表现为基频和多个谐波成分。某些被试或某些通道中，谐波响应甚至可能比基频更突出，因此不能只观察单一频点。",
    },
    conclusion: "SSVEP 的判断依据往往是一组频率结构，而不是一个孤立峰值。",
  },
  {
    id: "targets", lessonNumber: 4, shortTitle: "多目标频率编码", title: "多目标频率编码",
    subtitle: "理解不同刺激目标如何对应不同控制指令",
    objective: "理解 SSVEP 如何利用不同刺激频率区分用户正在注视的目标。",
    example: "左目标使用 12 Hz，右目标使用 15 Hz。如果 EEG 中 12 Hz 相关响应更明显，系统可以把左目标作为候选。对比 12.0 / 12.2 Hz 与 12 / 15 Hz，思考哪组更容易区分。",
    principle: "多目标 SSVEP 用不同刺激频率编码不同选择，再比较 EEG 中与各候选频率相关的响应。例如 A 为 12 Hz、B 为 15 Hz，12 Hz 相关特征更明显时，系统更倾向于把 A 作为候选。\n频率不仅要不同，还要有足够可区分性。频率过于接近，通常需要更长的分析窗口或更好的信号质量才能稳定区分。",
    steps: ["可切换目标数量预设，理解每增加一个目标就需要一组可区分的编码；预设不会启动训练。"],
    observe: ["编码可区分还不够：证据接近时该选哪一个？下一课讨论决策与拒识。"],
    quiz: {
      question: "如果两个刺激目标分别使用 12.0 Hz 和 12.2 Hz，相比使用 12 Hz 和 15 Hz，通常会带来什么问题？",
      options: ["A. 更容易区分", "B. 更难区分，因为两个目标的频率特征更接近", "C. 完全没有区别", "D. 只会影响刺激亮度"],
      answer: 1,
      explanation: "目标频率越接近，对频率分辨能力的要求越高。能否可靠区分还与分析窗口长度、信号质量和算法有关。",
    },
    conclusion: "多目标 SSVEP 本质上是在设计“可区分的频率编码”。",
  },
  {
    id: "feedback", lessonNumber: 5, shortTitle: "从证据到决策", title: "从证据到决策",
    subtitle: "理解分类、置信度与拒识",
    objective: "理解为什么 SSVEP 系统不应该在证据不足时强行输出结果。",
    example: "示意比较：目标 A / B 的证据分数为 0.83 / 0.17 时差距较大；0.52 / 0.48 时非常接近。这里的分数仅用于解释证据强弱，并非真实 EEG 输出或校准后的正确概率。",
    principle: "算法通常输出各候选目标的匹配程度、相关性或分类得分。例如 A / B 为 0.82 / 0.31 时，A 的证据更强；0.52 / 0.48 时，两者接近，强行选择可能造成错误控制。这些数值仅作示意，不是正确概率。\n实际系统可设置置信度、分数差距或拒识条件。证据不足时暂不输出，与做出决定同样重要。",
    steps: ["切换证据较强与证据接近的固定案例，比较候选和拒识的理由。"],
    observe: ["分类证据也可能来自干扰；下一课先认识噪声与伪迹，避免把错误证据当成脑响应。"],
    quiz: {
      question: "为什么一个 SSVEP 系统有时选择“不做决定”，反而比每次强行选择一个目标更加可靠？",
      options: ["A. 因为系统计算速度不够", "B. 因为证据不足时强行分类容易产生错误控制", "C. 因为 EEG 不能实时处理", "D. 因为只能识别一个目标"],
      answer: 1,
      explanation: "BCI 输出通常会直接对应控制指令。如果分类证据非常接近，强行输出可能产生错误操作。拒识能够用一部分“暂不决策”换取更高的可靠性。",
    },
    conclusion: "可靠的 BCI 不只需要“会选择”，还需要知道什么时候不应该选择。",
  },
  {
    id: "noise", lessonNumber: 6, shortTitle: "噪声与伪迹", title: "噪声与伪迹",
    subtitle: "理解频谱中的高峰为什么不一定来自 SSVEP",
    objective: "认识 EEG 中常见噪声和伪迹，并理解“出现峰值”并不等于“发现脑响应”。",
    example: "眼动、眨眼、肌电、运动、工频干扰和电极接触变化，都可能改变时域波形与频谱。下面的加噪场景只模拟背景噪声，帮助比较目标响应的可见性，并不复现全部真实伪迹。",
    principle: "EEG 中的频率成分并不全来自目标脑响应。眼动、眨眼、肌电、运动、电极接触变化和工频干扰，都可能改变时域波形与频谱。\n明显谱峰只是线索，不能单凭峰高认定它来自 SSVEP；还需结合峰所在频率、刺激条件、谐波结构、背景噪声和数据质量判断。",
    steps: ["应用不同加噪场景，再主动开始模拟分析，比较时域与 PSD 中的背景变化。"],
    observe: ["排除错误来源后，如何比较证据质量？下一课关注目标响应相对背景有多突出。"],
    quiz: {
      question: "如果频谱中出现一个非常明显的高峰，能否仅凭这一点认定它来自 SSVEP？",
      options: ["A. 可以，峰值越高越可信", "B. 不可以，还需要结合刺激频率、谐波、背景噪声和实验条件判断", "C. 可以，只要高于其他频率", "D. 只要出现在 50 Hz 就可以"],
      answer: 1,
      explanation: "频谱峰可能由目标脑响应产生，也可能来自外界干扰或生理伪迹。因此不能只根据“峰高”判断来源。",
    },
    conclusion: "发现一个峰只是开始，还需要判断这个峰是否真的与刺激有关。",
  },
  {
    id: "snr", lessonNumber: 7, shortTitle: "信噪比与可靠性", title: "信噪比与可靠性",
    subtitle: "理解什么样的频率响应更值得相信",
    objective: "理解 SNR（Signal-to-Noise Ratio，信噪比）为什么比单纯观察峰值更能反映信号质量。",
    example: "两个 Trial（试次）的 12 Hz 峰高度相同，但第二个试次周围频率的噪声整体更高。比较目标相对背景的突出程度，而不只比较峰高。下面的模拟案例还能分别改变噪声和信号幅值。",
    principle: "SNR（Signal-to-Noise Ratio，信噪比）比较目标响应相对于背景噪声有多突出，不只是衡量目标峰有多高。两个试次的目标峰即使同样高，周围频段噪声更高的那个通常更难辨认。\n高峰值不一定代表高质量；目标相对背景足够突出，结果才更值得信赖。SNR 的估计口径取决于方法，也不等于分类正确率。",
    steps: ["比较低噪声、高噪声和提高信号幅值的案例，观察目标相对背景与模拟 SNR 的变化。"],
    observe: ["要让证据更稳定，往往需要更多数据；下一课讨论这种等待与实时响应之间的权衡。"],
    quiz: {
      question: "两个 trial 的 12 Hz 峰高度相同，但第二个 trial 周围频率的噪声整体明显更高。哪一个结果通常更可靠？",
      options: ["A. 第一个", "B. 第二个", "C. 完全相同", "D. 无法使用 SNR 判断"],
      answer: 0,
      explanation: "虽然两个目标峰一样高，但第一个 trial 的背景噪声更低，因此目标频率相对周围背景更加突出，通常具有更高的信噪比和更好的可辨识性。",
    },
    conclusion: "信号是否可信，取决于目标响应相对于背景噪声有多明显，而不只是峰值有多高。",
  },
  {
    id: "time-frequency", lessonNumber: 8, shortTitle: "实时识别与时频变化", title: "实时识别与时频变化",
    subtitle: "理解时间窗、频率分辨率和实时响应之间的权衡",
    objective: "理解为什么实时 BCI 需要在稳定分析和响应速度之间进行取舍。",
    example: "比较稳定 12 Hz 与 12 Hz 转 15 Hz 的模拟案例：PSD 描述一个窗口的频率成分，时频图展示这些成分随时间的变化。再思考：用 1 秒或 4 秒数据做判断，哪个需要等待更久？",
    principle: "PSD 描述一个分析窗口内整体的频率组成，不能直接说明成分何时出现或消失。时频分析把连续信号分成多个窗口，分别观察频率分布，呈现能量随时间的变化。\n长窗口通常判断更稳定、频率分辨能力更好，但需等待更多数据；短窗口响应更快，结果可能更不稳定。实时 SSVEP 需要权衡响应速度与识别稳定性。",
    steps: ["应用稳定或变频案例，主动开始模拟分析；比较不同窗口下的频带清晰度与变化位置。"],
    observe: ["回顾整条链路：刺激编码 → 频率特征 → 目标判断 → 噪声与可靠性 → 实时反馈。可靠控制需要同时考虑证据质量和等待时间。"],
    quiz: {
      question: "如果将 EEG 分析窗口从 1 秒增加到 4 秒，通常最可能出现什么变化？",
      options: ["A. 判断更稳定，但响应延迟增加", "B. 判断更快，同时更加稳定", "C. 频率信息完全消失", "D. 与实时识别没有关系"],
      answer: 0,
      explanation: "更长的数据窗口通常包含更多周期信息，因此频率估计更稳定、频率分辨能力更好。但系统必须等待更多数据，因此实时反馈延迟也会增加。",
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
