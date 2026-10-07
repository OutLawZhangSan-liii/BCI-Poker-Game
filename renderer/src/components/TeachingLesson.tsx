import { useEffect, useMemo, useRef, useState } from "react";
import { teachingCourses, teachingFeedbackExamples as feedbackCases, type TeachingCourse } from "../teaching/courses";
import { NOISE_TEACHING_SCENARIOS, type NoiseTeachingScenarioId } from "../teaching/simulatedAnalysis";
import { SNR_TEACHING_SCENARIOS, TIME_FREQUENCY_TEACHING_SCENARIOS, type Stage8SimulationScenario } from "../teaching/simulatedAdvanced";

interface Props {
  course: TeachingCourse;
  completed: boolean;
  onComplete: () => void;
  onSelectCourse: (id: TeachingCourse["id"]) => void;
  onFrequencyPreview?: (frequency: number) => void;
  frequencyPreview?: number;
  harmonicFrequency?: number;
  onHarmonicFrequencyChange?: (frequency: number) => void;
  onTargetPreset?: (count: 2 | 3 | 4) => void;
  targetCount?: number;
  feedbackCase?: "candidate" | "rejected" | "empty" | "mouse";
  onFeedbackCaseChange?: (value: "candidate" | "rejected" | "empty" | "mouse") => void;
  onNoiseScenario?: (scenarioId: NoiseTeachingScenarioId) => void;
  onSimulationScenario?: (scenarioId: Stage8SimulationScenario["id"]) => void;
  onGoToSimulation?: () => void;
  locked?: boolean;
}

function Quiz({ course, completed, onComplete }: { course: TeachingCourse; completed: boolean; onComplete: () => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const answered = selected !== null;
  const correct = selected === course.quiz.answer;
  return <section className="teaching-quiz" data-answered={answered} aria-labelledby="teaching-quiz-title">
    <div className="teaching-section-heading"><h4 id="teaching-quiz-title">思考题</h4><div className="teaching-quiz-actions"><span>{answered ? correct ? "已完成" : "已作答" : completed ? "已完成，可重答" : "选择后查看解释"}</span>{answered && <button type="button" className="secondary teaching-quiz-retry" onClick={() => setSelected(null)}>重答</button>}</div></div>
    <p>{course.quiz.question}</p>
    <div className="teaching-quiz-options">{course.quiz.options.map((option, index) => {
      const isSelected = selected === index;
      const isAnswer = index === course.quiz.answer;
      const state = !answered ? "secondary" : isAnswer ? "quiz-correct" : isSelected ? "quiz-wrong" : "quiz-muted";
      const marker = !answered ? "" : isSelected ? isAnswer ? "✓ 已选" : "✕ 已选" : isAnswer ? "✓ 正确" : "";
      return <button type="button" key={option} className={state} disabled={answered} aria-pressed={isSelected}
        aria-label={`${option}${answered ? isSelected ? isAnswer ? "，你的选择，回答正确" : "，你的选择，回答错误" : isAnswer ? "，正确答案" : "，未选择" : ""}`}
        onClick={() => { if (answered) return; setSelected(index); if (isAnswer) onComplete(); }}>{option}{marker && <span className="quiz-answer-mark" aria-hidden="true">{marker}</span>}</button>;
    })}</div>
    {answered && <p className={`teaching-quiz-feedback ${correct ? "is-correct" : "is-wrong"}`} role="status"><strong>{correct ? "回答正确" : "再想想"}</strong>：{course.quiz.explanation}</p>}
  </section>;
}

export function TeachingLesson({ course, completed, onComplete, onSelectCourse, onFrequencyPreview, frequencyPreview = 12, harmonicFrequency = 12, onHarmonicFrequencyChange, onTargetPreset, targetCount = 2, feedbackCase = "empty", onFeedbackCaseChange, onNoiseScenario, onSimulationScenario, onGoToSimulation, locked = false }: Props) {
  const lesson = useRef<HTMLElement>(null);
  useEffect(() => { const workspace = lesson.current?.closest(".teaching-course-workspace"); if (workspace) workspace.scrollTop = 0; }, [course.id]);
  const [flowStep, setFlowStep] = useState(0);
  const activeFeedback = feedbackCases[feedbackCase];
  const previewWaves = useMemo(() => [
    { frequency: 12, color: "#34d399" },
    { frequency: 15, color: "#f2b85c" },
  ].map((wave) => ({ ...wave, path: Array.from({ length: 241 }, (_, index) => {
    const x = index / 240 * 500;
    const y = 30 - 20 * Math.sin(index / 240 * 0.25 * Math.PI * 2 * wave.frequency);
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ") })), []);
  const courseNumber = course.lessonNumber;
  return <section ref={lesson} className="teaching-lesson" aria-labelledby="teaching-lesson-title">
    <header className="teaching-lesson__intro"><div><p className="eyebrow">第 {courseNumber} 课</p><h3 id="teaching-lesson-title" title={course.subtitle}>{course.title}</h3></div></header>
    <section className="teaching-lesson__goal" aria-label="学习目标"><h4>学习目标</h4><p>{course.objective}</p></section>
    <section className="teaching-lesson__main" aria-label="核心观察与交互">
      <div className="teaching-lesson__principle"><h4>简短原理</h4>{course.principle.split("\n").map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
      <div className="teaching-lesson__observation">
      <article><h4 title={course.example}>观察 / 示例</h4>{course.lessonNumber > 3 && <p>{course.example}</p>}</article>
      {course.flowSteps && <div className="teaching-interactive teaching-flow"><div className="teaching-flow__steps">{course.flowSteps.map(({ label }, index) => <button type="button" key={label} className={flowStep === index ? "" : "secondary"} aria-pressed={flowStep === index} onClick={() => setFlowStep(index)}>{label}</button>)}</div><p className="teaching-callout">{course.flowSteps[flowStep]?.description}</p></div>}
      {course.id === "time" && <div className="teaching-interactive"><h4>数学波形预览</h4><div className="teaching-frequency-pick">{previewWaves.map(({ frequency, color }) => <button type="button" key={frequency} className={frequencyPreview === frequency ? "" : "secondary"} aria-pressed={frequencyPreview === frequency} onClick={() => onFrequencyPreview?.(frequency)} disabled={locked}><i className="teaching-wave-key" style={{ backgroundColor: color }} aria-hidden="true" />{frequency} Hz</button>)}<span>周期 T = {(1 / frequencyPreview * 1000).toFixed(1)} ms</span></div><div className="teaching-mini-wave"><svg viewBox="0 0 500 60" preserveAspectRatio="none" role="img" aria-label="12 Hz 与 15 Hz 数学波形叠加预览">{previewWaves.map(({ frequency, color, path }) => <path key={frequency} d={path} style={{ stroke: color, strokeWidth: frequencyPreview === frequency ? 2.5 : 2 }} vectorEffect="non-scaling-stroke" />)}</svg><span>横轴：归一化采样点</span><span>纵轴：相对幅值（无 μV 标定）</span></div></div>}
      {course.id === "harmonics" && <div className="teaching-interactive"><label className="teaching-number-control">示例基频 <input type="number" min="6" max="15" step="0.5" value={harmonicFrequency} onChange={(event) => onHarmonicFrequencyChange?.(Number(event.target.value))} disabled={locked} /> Hz</label><div className="harmonic-preview">{[1, 2, 3].map((multiple) => <div key={multiple}><strong>{multiple === 1 ? "基频" : `${multiple} 次谐波`}</strong><span>{(harmonicFrequency * multiple).toFixed(1)} Hz</span><i style={{ width: `${Math.min(100, 22 + multiple * 18)}%` }} /></div>)}</div></div>}
      {course.id === "targets" && <div className="teaching-interactive"><h4>目标数量预设</h4><div className="teaching-frequency-pick">{([2, 3, 4] as const).map((count) => <button type="button" key={count} className={targetCount === count ? "" : "secondary"} onClick={() => onTargetPreset?.(count)} disabled={locked}>{count} 目标</button>)}<span>当前 {targetCount} 目标；仅更新教学配置</span></div><p className="teaching-callout">原理教学与操作训练分开：预设不会启动闪烁、采集或试次。</p></div>}
      {course.id === "feedback" && <div className="teaching-interactive"><h4>固定反馈案例</h4><div className="teaching-feedback-tabs">{(Object.keys(feedbackCases) as Array<keyof typeof feedbackCases>).map((key) => <button type="button" key={key} className={feedbackCase === key ? "" : "secondary"} onClick={() => onFeedbackCaseChange?.(key)}>{feedbackCases[key].label}</button>)}</div><dl className="teaching-feedback-case" title={activeFeedback.explanation}><div><dt>候选</dt><dd>{activeFeedback.candidate}</dd></div><div><dt>状态</dt><dd>{activeFeedback.status}</dd></div></dl></div>}
      {course.id === "noise" && <div className="teaching-interactive teaching-noise-lab"><h4>可重复加噪实验</h4><div className="teaching-noise-lab__scenarios">{NOISE_TEACHING_SCENARIOS.map((scenario) => <button type="button" key={scenario.id} className="secondary" onClick={() => onNoiseScenario?.(scenario.id)} disabled={locked}>{scenario.label}<small>12 Hz · 幅值 {scenario.amplitudeScale} · σ={scenario.noiseSigma}</small></button>)}</div><div className="teaching-frequency-pick"><button type="button" onClick={onGoToSimulation}>前往模拟分析</button></div></div>}
      {course.id === "snr" && <div className="teaching-interactive teaching-noise-lab"><h4 title="三个案例使用相同种子；SNR 是模拟已知分量的原始窗口均方比值，不是分类正确率。">SNR 案例</h4><div className="teaching-noise-lab__scenarios">{SNR_TEACHING_SCENARIOS.map((scenario) => <button type="button" key={scenario.id} className="secondary" onClick={() => onSimulationScenario?.(scenario.id)} disabled={locked}>{scenario.label}<small>幅值 {scenario.amplitudeScale} · σ={scenario.noiseSigma}</small></button>)}</div><div className="teaching-frequency-pick"><button type="button" onClick={onGoToSimulation}>前往模拟分析</button></div></div>}
      {course.id === "time-frequency" && <div className="teaching-interactive teaching-noise-lab"><h4 title="时频图由同一模拟样本流按完整窗口计算，频率变化不是修改真实刺激频率。">时频案例</h4><div className="teaching-noise-lab__scenarios">{TIME_FREQUENCY_TEACHING_SCENARIOS.map((scenario) => <button type="button" key={scenario.id} className="secondary" onClick={() => onSimulationScenario?.(scenario.id)} disabled={locked}>{scenario.label}<small>Fs 256 Hz · 无噪声</small></button>)}</div><div className="teaching-frequency-pick"><button type="button" onClick={onGoToSimulation}>前往模拟分析</button></div></div>}
      </div>
    </section>
    {course.quiz && <Quiz key={course.id} course={course} completed={completed} onComplete={onComplete} />}
    <nav className="teaching-lesson__navigation" aria-label="课程间导航">
      <button type="button" className="secondary" disabled={locked || courseNumber <= 1} onClick={() => onSelectCourse(teachingCourses[courseNumber - 2].id)}>← 上一课</button>
      <button type="button" disabled={locked || courseNumber >= teachingCourses.length} onClick={() => onSelectCourse(teachingCourses[courseNumber].id)}>下一课 →</button>
    </nav>
  </section>;
}
