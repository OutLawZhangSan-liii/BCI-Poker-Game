import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { teachingCourses, teachingHighlights, teachingFeedbackExamples as feedbackCases, type TeachingCourse } from "../teaching/courses";
import { LessonSignalExample } from "./LessonSignalExample";
import { TemporalRecognitionExample } from "./TemporalRecognitionExample";

interface Props {
  course: TeachingCourse;
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
  onGoToDemo?: () => void;
  locked?: boolean;
  onReferenceOpenChange?: (open:boolean)=>void;
}

function Quiz({ course, onComplete }: { course: TeachingCourse; onComplete: () => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const answered = selected !== null;
  const correct = selected === course.quiz.answer;
  return <section className="teaching-quiz" data-answered={answered} aria-labelledby="teaching-quiz-title">
    <div className="teaching-section-heading">
      <h4 id="teaching-quiz-title">小练习</h4>
      {answered && <button type="button" className="secondary teaching-quiz-retry" onClick={() => setSelected(null)}>重答</button>}
    </div>
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

export function TeachingLesson({ course, onComplete, onSelectCourse, onFrequencyPreview, frequencyPreview = 12, harmonicFrequency = 12, onHarmonicFrequencyChange, onTargetPreset, targetCount = 2, feedbackCase = "empty", onFeedbackCaseChange, onGoToDemo, locked = false, onReferenceOpenChange }: Props) {
  const lesson = useRef<HTMLElement>(null);
  useEffect(() => { const workspace = lesson.current?.closest(".teaching-course-workspace"); if (workspace) workspace.scrollTop = 0; }, [course.id]);
  const [flowStep, setFlowStep] = useState(0);
  useEffect(() => setFlowStep(0), [course.id]);
  const [pane,setPane] = useState<"observe" | "practice">("observe");
  const reference = useRef<HTMLDialogElement>(null);
  const openReference = () => {
    const dialog = reference.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    onReferenceOpenChange?.(true);
  };
  useEffect(() => setPane("observe"), [course.id]);
  useLayoutEffect(() => {
    const dialog = reference.current;
    return () => {
      if (dialog?.open) dialog.close();
      onReferenceOpenChange?.(false);
    };
  }, [course.id, onReferenceOpenChange]);
  const highlight=teachingHighlights[course.id];
  const activeFeedback = feedbackCases[feedbackCase];
  const previewWaves = useMemo(() => [
    { frequency: 12, color: "#416e8e" },
    { frequency: 15, color: "#7888B6" },
  ].map((wave) => ({ ...wave, path: Array.from({ length: 241 }, (_, index) => {
    const x = index / 240 * 500;
    const y = 30 - 20 * Math.sin(index / 240 * 0.25 * Math.PI * 2 * wave.frequency);
    return `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(" ") })), []);
  const courseNumber = course.lessonNumber;
  return <section ref={lesson} className="teaching-lesson" data-pane={pane} aria-labelledby="teaching-lesson-title">
    <header className="teaching-lesson__intro">
      <h3 id="teaching-lesson-title">{course.title}</h3>
      <p className="teaching-lesson__takeaway">{highlight.focus}</p>
    </header>
    <nav className="lesson-pane-nav" aria-label="本课内容"><button type="button" aria-pressed={pane === "observe"} onClick={()=>setPane("observe")}>观察学习</button><button type="button" aria-pressed={pane === "practice"} onClick={()=>setPane("practice")}>小练习</button></nav>
    <div className="teaching-lesson__body">
    <section className="teaching-lesson__main" aria-label="核心观察与交互">
      <div className="teaching-lesson__observation">
      <article><h4>观察</h4><p>{highlight.example}</p></article>
      {course.flowSteps && <div className="teaching-interactive teaching-flow"><div className="teaching-flow__steps">{course.flowSteps.map(({ label }, index) => <button type="button" key={label} className={flowStep === index ? "" : "secondary"} aria-pressed={flowStep === index} onClick={() => setFlowStep(index)}><span className="teaching-flow__number">{String(index + 1).padStart(2, "0")}</span>{label}</button>)}</div><p className="teaching-callout">{course.flowSteps[flowStep]?.description}</p></div>}
      {course.id === "time" && <div className="teaching-interactive"><h4>数学波形预览</h4><div className="teaching-frequency-pick teaching-wave-controls">{previewWaves.map(({ frequency, color }) => <button type="button" key={frequency} className={frequencyPreview === frequency ? "" : "secondary"} aria-pressed={frequencyPreview === frequency} onClick={() => onFrequencyPreview?.(frequency)} disabled={locked}><i className="teaching-wave-key" style={{ backgroundColor: color }} aria-hidden="true" /><span className="teaching-wave-label">{frequency} Hz</span></button>)}<span>周期 T = {(1 / frequencyPreview * 1000).toFixed(1)} ms</span></div><div className="teaching-mini-wave"><svg viewBox="0 0 500 60" preserveAspectRatio="none" role="img" aria-label="12 Hz 与 15 Hz 数学波形叠加预览">{previewWaves.map(({ frequency, color, path }) => <path key={frequency} d={path} style={{ stroke: color, strokeWidth: frequencyPreview === frequency ? 2.5 : 2 }} vectorEffect="non-scaling-stroke" />)}</svg><span>横轴：归一化采样点</span><span>纵轴：相对幅值（无 μV 标定）</span></div></div>}
      {course.id === "harmonics" && <div className="teaching-interactive">
        <label className="teaching-number-control">示例基频
          <input type="range" min="6" max="15" step="0.5" value={harmonicFrequency} aria-valuetext={`${harmonicFrequency} Hz`}
            onChange={(event) => onHarmonicFrequencyChange?.(event.target.valueAsNumber)} disabled={locked} />
          <output>{harmonicFrequency} Hz</output>
        </label>
        <div className="harmonic-preview">{[1, 2, 3].map((multiple) => <div key={multiple}>
          <strong>{multiple === 1 ? "基频" : `${multiple} 次谐波`}</strong><span>{(harmonicFrequency * multiple).toFixed(1)} Hz</span>
          <i style={{ width: `${100 * harmonicFrequency * multiple / 45}%` }} aria-hidden="true" />
        </div>)}</div>
      </div>}
      {course.id === "targets" && <div className="teaching-interactive"><h4>目标数量预设</h4><div className="teaching-frequency-pick">{([2, 3, 4] as const).map((count) => <button type="button" key={count} className={targetCount === count ? "" : "secondary"} aria-pressed={targetCount === count} onClick={() => onTargetPreset?.(count)} disabled={locked}>{count} 目标</button>)}</div><button type="button" className="lesson-demo-link" onClick={onGoToDemo} disabled={locked}>查看 {targetCount} 个演示目标 ↗</button></div>}
      {course.id === "feedback" && <div className="teaching-interactive"><h4>判断示例</h4><div className="teaching-feedback-tabs">{(Object.keys(feedbackCases) as Array<keyof typeof feedbackCases>).map((key) => <button type="button" key={key} className={feedbackCase === key ? "" : "secondary"} aria-pressed={feedbackCase === key} onClick={() => onFeedbackCaseChange?.(key)}>{feedbackCases[key].label}</button>)}</div><dl className="teaching-feedback-case" title={activeFeedback.explanation}><div><dt>候选</dt><dd>{activeFeedback.candidate}</dd></div><div><dt>状态</dt><dd>{activeFeedback.status}</dd></div></dl></div>}
      {(course.id === "noise" || course.id === "snr") &&
        <LessonSignalExample key={course.id} lesson={course.id} locked={locked} />}
      {course.id === "time-frequency" && <TemporalRecognitionExample locked={locked} />}
      </div>
      <button type="button" className="secondary lesson-reference-trigger" aria-haspopup="dialog" onClick={openReference}>
        <svg aria-hidden="true" width="1.1em" height="1.1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 6.3C9 4.8 5.9 4.6 2.6 5.3v13.3c3.5-.6 6.4-.3 9.4 1.2 3-1.5 6-1.8 9.4-1.2V5.3c-3.3-.7-6.4-.5-9.4 1ZM12 6.5v13M5.5 9.1l3 .5m7.1 0 3-.5" />
        </svg>
        进一步理解<span aria-hidden="true">↗</span>
      </button>
    </section>
    {course.quiz && <Quiz key={course.id} course={course} onComplete={onComplete} />}
    </div>
    <dialog ref={reference} className="lesson-reference-dialog" aria-labelledby="lesson-reference-title" onClose={() => onReferenceOpenChange?.(reference.current?.open ?? false)}>
      <header>
        <h3 id="lesson-reference-title">{course.title}</h3>
        <form method="dialog"><button type="submit" className="secondary" autoFocus>关闭</button></form>
      </header>
      <div className="lesson-reference-dialog__text">
        <p>{course.principle}</p>
        <p>{course.example}</p>
      </div>
    </dialog>
    <nav className="teaching-lesson__navigation" aria-label="课程间导航">
      <button type="button" className="secondary" disabled={locked || courseNumber <= 1} onClick={() => onSelectCourse(teachingCourses[courseNumber - 2].id)}>← 上一课</button>
      <button type="button" disabled={locked || courseNumber >= teachingCourses.length} onClick={() => onSelectCourse(teachingCourses[courseNumber].id)}>下一课 →</button>
    </nav>
  </section>;
}
