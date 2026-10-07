import { StrictMode, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { GatewayClient, type CommandResult } from "./bci/gatewayClient";
import { type EegChunk } from "./bci/protocol";
import { StimulusTimingDiagnostics } from "./components/StimulusTimingDiagnostics";
import { StimulusTable } from "./components/StimulusTable";
import { GameTableHud } from "./components/GameTableHud";
import { IntroFlipAnimation, shouldPlayIntro } from "./components/IntroFlipAnimation";
import { TrainingControlBar } from "./components/TrainingLayout";
import { OperationRoundResults } from "./components/OperationRoundResults";
import { OperationTrainingStatus } from "./components/OperationTrainingStatus";
import { OperationRound, EMPTY_ROUND, OPERATION_TRIALS, TRAINING_TIMING, type OperationTrial, type TrialOutcome, type RoundState } from "./teaching/operationRound";
import { AppHeader } from "./components/AppHeader";
import { StatusBadge } from "./components/StatusBadge";
import { ThemedDropdown } from "./components/ThemedDropdown";
import { TeachingCourseNav } from "./components/TeachingCourseNav";
import { TeachingLesson } from "./components/TeachingLesson";
import { TeachingWorkspaceNav, type TeachingWorkspace } from "./components/TeachingWorkspaceNav";
import { RealPrincipleAnalysis } from "./components/RealPrincipleAnalysis";
import { RealEegAnalysisPanel } from "./components/RealEegAnalysisPanel";
import { courseById, teachingCourses, type TeachingCourse } from "./teaching/courses";
import type { NoiseTeachingScenarioId } from "./teaching/simulatedAnalysis";
import type { Stage8SimulationScenario } from "./teaching/simulatedAdvanced";
import type { RealEegTap } from "./teaching/realEegAnalysis";
import { isCurrentTeachingDecision } from "./teaching/decisionGuard";
import { SIMPLE_STIMULUS_FREQUENCY, SIMPLE_STIMULUS_GEOMETRY, SIMPLE_TARGETS, type StimulusFrameStats, type StimulusTarget } from "./bci/stimulus/types";
import { measureDisplayRefreshRate } from "./bci/stimulus/refreshRate";
import type { ResponsiveStimulusGeometrySnapshot } from "./bci/stimulus/geometry";
import { assertGameEngine, cardLabel, generateGameRound, scoreChoice, type GameMode, type GameRound } from "./game/engine";
import { GAME_STIMULUS_MS, GAME_ANALYSIS_GRACE_MS, gameDecisionChoice, gameEegReadiness, type GameEegTrial } from "./game/eegSelection";
import { gameStimulusTemplateForMode } from "./game/stimulusTemplate";
import { GAME_PRESENTATION, GAME_COUNTDOWN_SECONDS, GAME_FEEDBACK_MS } from "./game/presentation";
import { STIMULUS_TIMING_VERSION } from "./bci/stimulus/phase";
import type { WorkerInput, WorkerOutput, BciDecision, CalibrationProgress, RealTrialAnalysis } from "./bci/signal/types";
import { fbccaDecisionPolicy, FBCCA_POLICY_VERSION } from "./bci/signal/decisionPolicy";
import { FBCCA_FILTER_WARMUP_SAMPLES } from "./bci/signal/fbcca";
import "./styles.css";

interface DeviceProperties { acquisition_status: number; sample_rate_hz: number; samples_per_packet: number; channel_count: number; lead_names: string[]; }
interface LinkStats { chunks: number; samplesPerChannel: number; sequenceDiscontinuities: number; reportedGaps: number; chunksPerSecond: number; }
const emptyStats: LinkStats = { chunks: 0, samplesPerChannel: 0, sequenceDiscontinuities: 0, reportedGaps: 0, chunksPerSecond: 0 };
type TrialStage = "ready" | "dealing" | "fixation" | "preview" | "countdown" | "stimulus" | "analyzing" | "feedback" | "rest";
type AppView = "game" | "lab" | "teaching";
type TrialKind = "online" | "calibration" | "isolated_diagnostic" | "teaching";
type TeachingMode = "principle" | "operation";
const gameStageLabels: Record<TrialStage, string> = {
  ready: "等待开始",
  dealing: "发牌中",
  fixation: "请注视目标",
  preview: "请准备选择",
  countdown: "准备注视",
  stimulus: "刺激中 · 请注视所选牌",
  analyzing: "正在识别",
  feedback: "本轮完成",
  rest: "轮间休息",
};
const wait = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
const ONLINE_WINDOW_SECONDS = 2.5;

const pageTitles: Record<AppView, string> = {
  game: "脑控牌桌",
  lab: "设备实验",
  teaching: "教学中心",
};

const gatewayStatusLabels: Record<GatewayStatus, { value: string; tone: "neutral" | "success" | "warning" | "danger" }> = {
  starting: { value: "启动中", tone: "warning" },
  ready: { value: "未连接", tone: "neutral" },
  faulted: { value: "异常", tone: "danger" },
  stopping: { value: "停止中", tone: "warning" },
  stopped: { value: "已停止", tone: "neutral" },
};

const TEACHING_REFERENCE_Y = 0.5;
const teachingPositionsByCount: Record<number, readonly { x: number; y: number }[]> = {
  2: [{ x: 0.32, y: 0.5 }, { x: 0.68, y: 0.5 }],
  3: [{ x: 0.22, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.78, y: 0.5 }],
  4: [{ x: 0.13, y: 0.5 }, { x: 0.376, y: 0.5 }, { x: 0.624, y: 0.5 }, { x: 0.87, y: 0.5 }],
};
const teachingLabels = ["A♠", "K♥", "Q♣", "J♦"];
const buildTeachingTargets = (frequencies: number[], count: number, fillLayout = false): StimulusTarget[] => {
  const targetCount = Math.max(2, Math.min(4, count));
  const positions = fillLayout ? Array.from({ length: targetCount }, (_, index) =>
    ({ x: (index + .5) / targetCount, y: .5 })) : teachingPositionsByCount[targetCount];
  return positions.map((position, index) => ({
    id: `teaching_target_${index}`,
    frequencyHz: frequencies[index],
    phaseRad: index * Math.PI / 2,
    label: teachingLabels[index],
    ...position,
  }));
};

const shuffledBalancedDiagnosticSequence = (): number[] => {
  const sequence = [0, 0, 0, 0, 1, 1, 1, 1];
  const random = new Uint32Array(sequence.length);
  crypto.getRandomValues(random);
  for (let index = sequence.length - 1; index > 0; index -= 1) {
    const swapIndex = random[index] % (index + 1);
    [sequence[index], sequence[swapIndex]] = [sequence[swapIndex], sequence[index]];
  }
  return sequence;
};

function App() {
  const clientRef = useRef(new GatewayClient());
  const lastSequence = useRef<bigint | null>(null);
  const rateWindow = useRef<number[]>([]);
  const workerRef = useRef<Worker | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const diagnosticLastEegRef = useRef<{ sessionId: string; receivedAt: number; packetDurationMs: number; firstSampleIndex: string; gatewayMonotonicNs: string } | null>(null);
  const trialIdRef = useRef<string | null>(null);
  const stimulusStartedAtRef = useRef(0);
  const firstFrameResolverRef = useRef<((value: number) => void) | null>(null);
  const dealCompleteResolverRef = useRef<(() => void) | null>(null);
  const decisionResolverRef = useRef<((decision: BciDecision | null) => void) | null>(null);
  const stimulusEndReasonRef = useRef("not_started");
  const trialKindRef = useRef<TrialKind>("online");
  const cuedTargetIndexRef = useRef<number | null>(null);
  const diagnosticSequenceRef = useRef<number[]>([]);
  const diagnosticSequencePositionRef = useRef(0);
  const diagnosticSequenceIndexRef = useRef<number | null>(null);
  const gameChoiceResolverRef = useRef<((choice: number | null) => void) | null>(null);
  const gameEegTrialRef = useRef<GameEegTrial | null>(null);
  const gameMarkerTrialRef = useRef<GameEegTrial | null>(null);
  const solidDiagnosticTrialRef = useRef<{ sessionId: string; trialId: string; targetAppearance: "card" | "card-face" | "solid"; comparisonRunId?: string; sequenceIndex?: number } | null>(null);
  const gameStimulusTimerRef = useRef<number | null>(null);
  const gameLastDataAtRef = useRef(0);
  const gameRetryRef = useRef(false);
  const gameTimingPendingRef = useRef(false);
  const gameTimingRevisionRef = useRef(0);
  const gameAbortRef = useRef<(message: string) => void>(() => {});
  const gameRunningRef = useRef(false);
  const gameNextTrialRef = useRef<() => void>(() => {});
  const [gameCountdown, setGameCountdown] = useState(0);
  const [gameOnsetMs, setGameOnsetMs] = useState<number | undefined>();
  const [gameSelectedIndex, setGameSelectedIndex] = useState<number | null>(null);
  const [timingDiagnosticActive, setTimingDiagnosticActive] = useState(false);
  // Invalidate an in-flight game/lab trial before a responsive stimulus
  // geometry change can leave its promises or resolvers behind.
  const formalTrialGenerationRef = useRef(0);
  const modalRef = useRef<HTMLElement | null>(null);
  const modalReturnFocusRef = useRef<HTMLElement | null>(null);
  const focusReturnTimerRef = useRef<number | null>(null);
  const teachingTrialIdRef = useRef<string | null>(null);
  const teachingActiveRef = useRef(false);
  const teachingEndReasonRef = useRef("teaching_complete");
  const teachingChoiceResolverRef = useRef<((choice: number) => void) | null>(null);
  const teachingModeRef = useRef<TeachingMode>("principle");
  const teachingTargetsRef = useRef<StimulusTarget[]>([]);
  const teachingGeometryRef = useRef<ResponsiveStimulusGeometrySnapshot | null>(null);
  const teachingCueIndexRef = useRef<number | null>(null);
  const teachingTimingRevisionRef = useRef(0);
  const teachingTimingPendingRef = useRef(false);
  const teachingTimerRef = useRef<number | null>(null);
  const realEegTapRef = useRef<RealEegTap | null>(null);
  const teachingLastDataAtRef = useRef(0);
  const teachingDataTimeoutRef = useRef(1500);
  const acquisitionGenerationRef = useRef(0);
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus>("starting");
  const [appView, setAppView] = useState<AppView>("game");
  const [labWorkspace, setLabWorkspace] = useState<"device" | "timing" | "experiment">("device");
  const [connected, setConnected] = useState(false);
  const [acquiring, setAcquiring] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [properties, setProperties] = useState<DeviceProperties | null>(null);
  const [stats, setStats] = useState<LinkStats>(emptyStats);
  const linkStatsRef = useRef<LinkStats>(emptyStats);
  const [error, setError] = useState<string | null>(null);
  const [trialStage, setTrialStage] = useState<TrialStage>("ready");
  const [trialResult, setTrialResult] = useState("尚未开始");
  const [displayRefreshRateHz, setDisplayRefreshRateHz] = useState<number | null>(null);
  const [calibrationProgress, setCalibrationProgress] = useState<CalibrationProgress>({ counts: [0, 0], requiredPerTarget: 2 });
  const [diagnosticProgress, setDiagnosticProgress] = useState<[number, number]>([0, 0]);
  const [isolatedTargetIndex, setIsolatedTargetIndex] = useState<number | null>(null);
  const [calibrationCue, setCalibrationCue] = useState<string | null>(null);
  const [modelStatus, setModelStatus] = useState("未训练（当前使用 FBCCA）");
  const [modelSaving, setModelSaving] = useState(false);
  const [visualTargets, setVisualTargets] = useState(SIMPLE_TARGETS);
  const [gameVisualTargets, setGameVisualTargets] = useState(() => gameStimulusTemplateForMode("simple").targets);
  const [referenceLabel, setReferenceLabel] = useState("9♠");
  const [gameMode, setGameMode] = useState<GameMode>("simple");
  const [gameRound, setGameRound] = useState<GameRound | null>(null);
  const [gameLength, setGameLength] = useState(10);
  const [selectedGameLength, setSelectedGameLength] = useState(10);
  const [gameRoundNumber, setGameRoundNumber] = useState(0);
  const [gameScore, setGameScore] = useState(0);
  const [gameStreak, setGameStreak] = useState(0);
  const [gameMaxStreak, setGameMaxStreak] = useState(0);
  const [gameRunning, setGameRunning] = useState(false);
  gameRunningRef.current = gameRunning;
  const [gameFinished, setGameFinished] = useState(false);
  const [gameCorrect, setGameCorrect] = useState(0);
  const [gameIncorrect, setGameIncorrect] = useState(0);
  const [gameUncertain, setGameUncertain] = useState(0);
  const [gameDecisionTimeTotal, setGameDecisionTimeTotal] = useState(0);
  const [gameDecisionCount, setGameDecisionCount] = useState(0);
  const [restSeconds, setRestSeconds] = useState(0);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [teachingMode, setTeachingMode] = useState<TeachingMode>("principle");
  const [teachingPreparing, setTeachingPreparing] = useState(false);
  const teachingPreparingRef = useRef(false);
  const teachingPreparationGenerationRef = useRef(0);
  const [teachingLeftHz, setTeachingLeftHz] = useState(12);
  const [teachingRightHz, setTeachingRightHz] = useState(15);
  const [teachingExtraHz, setTeachingExtraHz] = useState([10, 20]);
  const [teachingTargetCount, setTeachingTargetCount] = useState(2);
  const [teachingActiveTargetIndex, setTeachingActiveTargetIndex] = useState<number | null>(null);
  const [teachingActive, setTeachingActive] = useState(false);
  const stimulusUiBusyRef = useRef(false);
  stimulusUiBusyRef.current = teachingActive || trialStage === "stimulus";
  const [teachingTrialNumber, setTeachingTrialNumber] = useState(0);
  const [operationFrequencies, setOperationFrequencies] = useState([12, 15, 10, 20]);
  const [operationTargetCount, setOperationTargetCount] = useState(2);
  const [trainingCountdown, setTrainingCountdown] = useState(0);
  const [trainingStats, setTrainingStats] = useState({ correct: 0, incorrect: 0, rejected: 0 });
  const [roundState, setRoundState] = useState<RoundState>({ ...EMPTY_ROUND });
  const [singleStimulusMode, setSingleStimulusMode] = useState<"TARGET_ONLY" | "LEFT_ONLY" | "RIGHT_ONLY" | "BOTH">("TARGET_ONLY");
  const [singleTarget, setSingleTarget] = useState(0);
  const [operationStimulusIndex, setOperationStimulusIndex] = useState<number | null>(0);
  const operationStimulusIndexRef = useRef<number | null>(0);
  const operationStimulusModeRef = useRef("NONE");
  const roundTrialResolveRef = useRef<((outcome: TrialOutcome) => void) | null>(null);
  const roundRunTrialRef = useRef<(trial: OperationTrial, index: number) => Promise<TrialOutcome>>(async () => "interrupted");
  const roundInterruptRef = useRef<() => void>(() => {});
  const roundDecisionRef = useRef<BciDecision | null>(null);
  const roundRef = useRef<OperationRound | null>(null);
  if (!roundRef.current) roundRef.current = new OperationRound({
    runTrial: (trial, index) => roundRunTrialRef.current(trial, index),
    interruptTrial: () => roundInterruptRef.current(), change: setRoundState,
    error: cause => setError((cause as Error).message),
  });
  const [teachingCueIndex, setTeachingCueIndex] = useState<number | null>(null);
  const [teachingResult, setTeachingResult] = useState("刺激 → 频域特征 → CCA 匹配 → 分类结果");
  const [teachingAnalysis, setTeachingAnalysis] = useState<RealTrialAnalysis | null>(null);
  const [teachingAnalysisProgress, setTeachingAnalysisProgress] = useState<{ samples: number; requiredSamples: number; sampleRateHz: number } | null>(null);
  const [teachingDecision, setTeachingDecision] = useState<BciDecision | null>(null);
  const [teachingDecisionMeta, setTeachingDecisionMeta] = useState<{ sessionId: string; trialId: string } | null>(null);
  const [teachingCourseId, setTeachingCourseId] = useState<TeachingCourse["id"]>("system");
  const [completedTeachingCourses, setCompletedTeachingCourses] = useState<Set<TeachingCourse["id"]>>(new Set());
  const [teachingPreviewFrequency, setTeachingPreviewFrequency] = useState(12);
  const [teachingHarmonicFrequency, setTeachingHarmonicFrequency] = useState(12);
  const [teachingFeedbackCase, setTeachingFeedbackCase] = useState<"candidate" | "rejected" | "empty" | "mouse">("empty");
  const [analysisActionsTarget, setAnalysisActionsTarget] = useState<HTMLDivElement | null>(null);
  const [teachingWorkspace, setTeachingWorkspace] = useState<TeachingWorkspace>("course");
  const teachingFrequencyValues = useMemo(() => [teachingLeftHz, teachingRightHz, ...teachingExtraHz],
    [teachingLeftHz, teachingRightHz, teachingExtraHz]);
  const teachingTargets = useMemo(() => buildTeachingTargets(teachingMode === "operation" && teachingWorkspace === "run" ? operationFrequencies : teachingFrequencyValues, teachingMode === "operation" && teachingWorkspace === "run" ? operationTargetCount : teachingTargetCount, teachingMode === "principle"),
    [teachingMode, teachingWorkspace, operationFrequencies, operationTargetCount, teachingFrequencyValues, teachingTargetCount]);
  const changeTeachingMode = (mode: TeachingMode) => {
    if (teachingActive || teachingPreparing || roundRef.current?.state.active) return;
    roundRef.current?.reset();
    setTeachingMode(mode); teachingModeRef.current = mode;
    setTeachingCueIndex(null); teachingCueIndexRef.current = null;
    teachingTrialIdRef.current = null; teachingChoiceResolverRef.current = null;
    setTeachingDecision(null); setTeachingDecisionMeta(null); setTeachingAnalysis(null); setTeachingAnalysisProgress(null);
    setTeachingResult(mode === "principle" ? "刺激 → 频域特征 → CCA 匹配 → 分类结果" : "准备 → 目标 → 刺激 → 判断 → 反馈");
  };
  const updateTeachingFrequency = (index: number, value: number) => {
    if (teachingWorkspace === "run" && teachingMode === "operation") { setOperationFrequencies(previous => previous.map((frequency, offset) => offset === index ? value : frequency)); return; }
    if (index === 0) setTeachingLeftHz(value);
    else if (index === 1) setTeachingRightHz(value);
    else setTeachingExtraHz((previous) => previous.map((current, offset) => offset === index - 2 ? value : current));
  };

  const selectGameMode = (mode: GameMode) => {
    if (gameRunning || trialStage !== "ready") return;
    if (mode !== "simple" && mode !== "difficult1" && mode !== "difficult2") return;
    const template = gameStimulusTemplateForMode(mode);
    setGameMode(mode);
    // Keep the idle preview and the formal round on the same authoritative
    // layout. React batches these updates, so no stale mode is painted.
    setGameVisualTargets(template.targets);
    setReferenceLabel("9♠");
  };

  useEffect(() => { assertGameEngine(); void measureDisplayRefreshRate().then(setDisplayRefreshRateHz).catch((cause) => setError((cause as Error).message)); }, []);

  useEffect(() => { teachingTargetsRef.current = teachingTargets; teachingModeRef.current = teachingMode; }, [teachingTargets, teachingMode]);
  useEffect(() => { teachingPreparationGenerationRef.current += 1; }, [appView, teachingWorkspace, teachingMode, teachingTargets, activeSessionId]);
  useEffect(() => {
    if (teachingActiveTargetIndex !== null && teachingActiveTargetIndex >= teachingTargetCount) setTeachingActiveTargetIndex(null);
  }, [teachingActiveTargetIndex, teachingTargetCount]);
  useEffect(() => {
    if (restSeconds <= 0) return;
    const timer = window.setInterval(() => setRestSeconds((seconds) => Math.max(0, seconds - 1)), 1_000);
    return () => window.clearInterval(timer);
  }, [restSeconds > 0]);
  useEffect(() => {
    if (!rulesOpen) return;
    if (focusReturnTimerRef.current !== null) {
      window.clearTimeout(focusReturnTimerRef.current);
      focusReturnTimerRef.current = null;
    }
    const previous = modalReturnFocusRef.current;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setRulesOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = modalRef.current;
      if (!dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, summary, [tabindex]:not([tabindex=\"-1\"])"))
        .filter((element) => !element.hasAttribute("disabled") && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const handleFocusIn = (event: FocusEvent) => {
      const dialog = modalRef.current;
      const target = event.target;
      if (!dialog || !(target instanceof Node) || dialog.contains(target)) return;
      const first = dialog.querySelector<HTMLElement>("button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary");
      event.preventDefault();
      first?.focus();
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);
    const focusTimer = window.setTimeout(() => modalRef.current?.querySelector<HTMLElement>("button")?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      window.clearTimeout(focusTimer);
      const returnTarget = previous;
      focusReturnTimerRef.current = window.setTimeout(() => {
        focusReturnTimerRef.current = null;
        if (returnTarget && returnTarget.isConnected && !returnTarget.hasAttribute("disabled")) returnTarget.focus();
      }, 0);
    };
  }, [rulesOpen]);
  useEffect(() => {
    const client = clientRef.current;
    const worker = new Worker(new URL("./bci/signal/signal.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    let publishedLinkStats = linkStatsRef.current;
    const publishStatsTimer = window.setInterval(() => {
      if (teachingActiveRef.current && teachingLastDataAtRef.current > 0 && performance.now() - teachingLastDataAtRef.current > teachingDataTimeoutRef.current) {
        if (teachingModeRef.current === "operation") setTrainingStats(previous => ({ ...previous, rejected: previous.rejected + 1 }));
        teachingActiveRef.current = false; setTeachingActive(false); teachingChoiceResolverRef.current = null;
        setTeachingAnalysis(null); setTeachingAnalysisProgress(null); setTeachingResult("本轮未能确定选择：EEG 数据中断，请重新开始"); roundTrialResolveRef.current?.("interrupted"); roundTrialResolveRef.current = null;
        if (teachingTimerRef.current !== null) { window.clearTimeout(teachingTimerRef.current); teachingTimerRef.current = null; }
        worker.postMessage({ type: "stop_trial" } satisfies WorkerInput);
      }
      if (gameEegTrialRef.current && gameLastDataAtRef.current > 0 && performance.now() - gameLastDataAtRef.current > teachingDataTimeoutRef.current) gameAbortRef.current("EEG 数据中断，本轮已取消");
      // Stimulation has priority over visual counters. Accumulate
      // all data now and publish the latest counters after the trial ends.
      if (stimulusUiBusyRef.current) return;
      if (publishedLinkStats !== linkStatsRef.current) {
        publishedLinkStats = linkStatsRef.current; setStats(publishedLinkStats);
      }
    }, 250);
    worker.onmessage = (event: MessageEvent<WorkerOutput>) => {
      if (event.data.type === "stimulus_window_invalidated") {
        if (event.data.sessionId === sessionIdRef.current && event.data.trialId === teachingTrialIdRef.current && event.data.revision === teachingTimingRevisionRef.current) teachingTimingPendingRef.current = false;
        if (event.data.sessionId === gameEegTrialRef.current?.sessionId && event.data.trialId === gameEegTrialRef.current?.trialId && event.data.revision === gameTimingRevisionRef.current) gameTimingPendingRef.current = false;
        return;
      }
      if (teachingTimingPendingRef.current && (event.data.type === "analysis" || event.data.type === "analysis_progress" || event.data.type === "decision")) return;
      if (event.data.type === "analysis" && teachingActiveRef.current && event.data.analysis.sessionId === sessionIdRef.current && event.data.analysis.trialId === teachingTrialIdRef.current) setTeachingAnalysis(event.data.analysis);
      else if (event.data.type === "analysis_progress" && teachingActiveRef.current && event.data.sessionId === sessionIdRef.current && event.data.trialId === teachingTrialIdRef.current) setTeachingAnalysisProgress(event.data);

      else if (event.data.type === "decision") {
        const decision = event.data.decision;
        const publishDecision = (teachingActiveRef.current && teachingModeRef.current === "principle") || !stimulusUiBusyRef.current || !decision.rejected;
        const isTeachingResult = teachingActiveRef.current && isCurrentTeachingDecision(decision, sessionIdRef.current, teachingTrialIdRef.current);
        if (isTeachingResult && roundRef.current?.state.active && !teachingTimingPendingRef.current) roundDecisionRef.current = decision;
        if (isTeachingResult && publishDecision) {
          setTeachingDecision(decision);
          setTeachingDecisionMeta({ sessionId: decision.sessionId, trialId: decision.trialId });
        }
        const { matches: _displayMatches, ...wireDecision } = decision;
        void client.command("bci_decision", wireDecision).catch((cause) => setError((cause as Error).message));
        if (!decision.rejected && decision.candidateIndex !== null) {
          decisionResolverRef.current?.(decision);
          const gameTrial = gameEegTrialRef.current;
          if (gameTrial && !gameTimingPendingRef.current) {
            const choice = gameDecisionChoice(decision, gameTrial, performance.now());
            if (choice !== null) gameChoiceResolverRef.current?.(choice);
          }
          if (isTeachingResult) teachingChoiceResolverRef.current?.(decision.candidateIndex);
        }
      }
      else if (event.data.type === "calibration_progress") setCalibrationProgress(event.data.progress);
      else if (event.data.type === "etraca_model") {
        const trainedLabel = `eTRCA 已训练：${event.data.model.trialsPerTarget.join("/")} 次`;
        const sessionId = sessionIdRef.current;
        if (!sessionId) { setModelStatus(`${trainedLabel}（未保存）`); setError("训练完成，但当前没有活动采集会话，模型未保存"); }
        else {
          setModelSaving(true); setModelStatus(`${trainedLabel}，正在保存…`);
          void client.command("calibration_model", { sessionId, ...event.data.model })
            .then(() => setModelStatus(`${trainedLabel}，已保存`))
            .catch((cause) => { setModelStatus(`${trainedLabel}（保存失败）`); setError((cause as Error).message); })
            .finally(() => setModelSaving(false));
        }
      }
      else if (event.data.type === "error") {
        setError(event.data.message);
        if (gameEegTrialRef.current) gameAbortRef.current("EEG 分析异常，本轮已取消");
        if (teachingActiveRef.current) {
          teachingActiveRef.current = false; setTeachingActive(false); setTeachingAnalysis(null); setTeachingAnalysisProgress(null);
          setTeachingResult("当前数据质量不足，无法分析"); roundTrialResolveRef.current?.("interrupted"); roundTrialResolveRef.current = null; teachingChoiceResolverRef.current = null;
          if (teachingTimerRef.current !== null) { window.clearTimeout(teachingTimerRef.current); teachingTimerRef.current = null; }
          worker.postMessage({ type: "stop_trial" } satisfies WorkerInput);
        }
      }
    };
    const onEeg = (event: Event) => {
      const chunk = (event as CustomEvent<EegChunk>).detail;
      const now = performance.now(); rateWindow.current.push(now);
      diagnosticLastEegRef.current = { sessionId: chunk.sessionId, receivedAt: now,
        packetDurationMs: chunk.sampleCountPerChannel * 1000 / chunk.sampleRateHz,
        firstSampleIndex: String(chunk.firstSampleIndex), gatewayMonotonicNs: String(chunk.gatewayMonotonicNs) };
      if (chunk.sessionId === gameEegTrialRef.current?.sessionId) gameLastDataAtRef.current = now;
      if (chunk.sessionId === sessionIdRef.current && teachingActiveRef.current) teachingLastDataAtRef.current = now;
      rateWindow.current = rateWindow.current.filter((value) => now - value <= 1_000);
      const discontinuity = lastSequence.current !== null && chunk.gatewaySequence !== lastSequence.current + 1n;
      lastSequence.current = chunk.gatewaySequence;
      const previous = linkStatsRef.current;
      linkStatsRef.current = { chunks: previous.chunks + 1, samplesPerChannel: previous.samplesPerChannel + chunk.sampleCountPerChannel,
        sequenceDiscontinuities: previous.sequenceDiscontinuities + (discontinuity ? 1 : 0),
        reportedGaps: previous.reportedGaps + (chunk.transportGapSuspected ? 1 : 0), chunksPerSecond: rateWindow.current.length };
      // Publish visual counters at 4 Hz; every packet still reaches both EEG
      // processing paths immediately. High packet rates must not redraw the
      // entire React interface at the acquisition frequency.
      realEegTapRef.current?.acceptChunk(chunk);
    };
    const onDisconnected = () => { if (gameRunningRef.current) gameAbortRef.current("EEG 已断开，请重新连接设备"); acquisitionGenerationRef.current += 1; teachingPreparationGenerationRef.current += 1; teachingActiveRef.current = false; setTeachingActive(false); setTeachingResult("未连接 EEG 设备，等待连接"); worker.postMessage({ type: "stop_trial" } satisfies WorkerInput); if (teachingTimerRef.current !== null) { window.clearTimeout(teachingTimerRef.current); teachingTimerRef.current = null; } realEegTapRef.current?.invalidate(); sessionIdRef.current = null; setConnected(false); setAcquiring(false); setActiveSessionId(null); setTeachingDecision(null); setTeachingDecisionMeta(null); setTeachingAnalysis(null); setTeachingAnalysisProgress(null); teachingTrialIdRef.current = null; teachingChoiceResolverRef.current = null; };
    const onProtocolError = (event: Event) => {
      if (gameRunningRef.current) gameAbortRef.current("EEG 数据无效，本轮已取消");
      realEegTapRef.current?.invalidate(); setTeachingAnalysis(null); setTeachingAnalysisProgress(null);
      setTeachingDecision(null); setTeachingDecisionMeta(null);
      worker.postMessage({ type: "stop_trial" } satisfies WorkerInput);
      teachingActiveRef.current = false; setTeachingActive(false); teachingChoiceResolverRef.current = null;
      if (teachingTimerRef.current !== null) { window.clearTimeout(teachingTimerRef.current); teachingTimerRef.current = null; }
      setTeachingResult("当前数据质量不足，无法分析"); roundTrialResolveRef.current?.("interrupted"); roundTrialResolveRef.current = null; setError((event as CustomEvent<Error>).detail.message);
    };
    const onEegBinary = (event: Event) => {
      const binary = (event as CustomEvent<ArrayBuffer>).detail;
      worker.postMessage({ type: "eeg", buffer: binary } satisfies WorkerInput, [binary]);
    };
    client.addEventListener("eeg", onEeg); client.addEventListener("eeg-binary", onEegBinary);
    client.addEventListener("disconnected", onDisconnected); client.addEventListener("protocol-error", onProtocolError);
    return () => { client.removeEventListener("eeg", onEeg); client.removeEventListener("disconnected", onDisconnected);
      client.removeEventListener("eeg-binary", onEegBinary); client.removeEventListener("protocol-error", onProtocolError);
      window.clearInterval(publishStatsTimer); client.disconnect(); worker.terminate(); workerRef.current = null; };
  }, []);

  useEffect(() => {
    void window.brainGameDesktop.getGatewayStatus().then(setGatewayStatus);
    return window.brainGameDesktop.onGatewayStatusChanged((status) => { setGatewayStatus(status); if (status !== "ready") clientRef.current.disconnect(); });
  }, []);

  const run = async (operation: () => Promise<void>) => { setError(null); try { await operation(); } catch (cause) { setError((cause as Error).message); } };
  const waitForDealComplete = () => new Promise<void>((resolve) => { dealCompleteResolverRef.current = resolve; });
  const resolveDealComplete = () => { const resolve = dealCompleteResolverRef.current; dealCompleteResolverRef.current = null; resolve?.(); };
  const configureSignalWorker = (device: DeviceProperties, targetFrequenciesHz = SIMPLE_TARGETS.map((target) => target.frequencyHz), publishAnalysis = false, publishMatches = false, maxTrialSeconds?: number) => {
    teachingDataTimeoutRef.current = Math.max(1500, device.samples_per_packet / device.sample_rate_hz * 2000);
    workerRef.current?.postMessage({ type: "configure", config: { sampleRateHz: device.sample_rate_hz,
      channelCount: device.channel_count, leadNames: device.lead_names, targetFrequenciesHz,
      windowSeconds: ONLINE_WINDOW_SECONDS, hopSeconds: 0.25, harmonics: 3, ...fbccaDecisionPolicy(targetFrequenciesHz.length), publishAnalysis, publishMatches, maxTrialSeconds } } satisfies WorkerInput);
  };
  const connect = () => run(async () => {
    const requestGeneration = acquisitionGenerationRef.current;
    const connection = await window.brainGameDesktop.getGatewayConnection(); if (!connection) throw new Error("设备网关尚未就绪");
    if (requestGeneration !== acquisitionGenerationRef.current) return;
    await clientRef.current.connect(connection); setConnected(true);
    const result = await clientRef.current.command<DeviceProperties>("get_device_properties");
    if (requestGeneration !== acquisitionGenerationRef.current) return;
    setProperties(result.data); configureSignalWorker(result.data);
  });
  const start = () => run(async () => {
    const requestGeneration = ++acquisitionGenerationRef.current;
    // Invalidate the previous observation synchronously, before any delayed
    // device-property response can return.
    realEegTapRef.current?.invalidate(); setActiveSessionId(null);
    // Acquisition software settings may change while the gateway connection is
    // open. Refresh the dimensions before starting so the Worker never keeps a
    // stale sample-rate configuration from an earlier connection.
    const device = await clientRef.current.command<DeviceProperties>("get_device_properties");
    if (requestGeneration !== acquisitionGenerationRef.current) return;
    setProperties(device.data); configureSignalWorker(device.data);
    linkStatsRef.current = emptyStats; setStats(emptyStats); lastSequence.current = null; rateWindow.current = [];
    setDiagnosticProgress([0, 0]); setIsolatedTargetIndex(null);
    diagnosticSequenceRef.current = shuffledBalancedDiagnosticSequence(); diagnosticSequencePositionRef.current = 0; diagnosticSequenceIndexRef.current = null;
    trialKindRef.current = "online"; cuedTargetIndexRef.current = null;
    const sessionId = crypto.randomUUID();
    setTeachingDecision(null); setTeachingDecisionMeta(null); setTeachingAnalysis(null); setTeachingAnalysisProgress(null);
    if (requestGeneration !== acquisitionGenerationRef.current) return;
    await clientRef.current.command("start_acquisition", { sessionId });
    if (requestGeneration !== acquisitionGenerationRef.current) return;
    sessionIdRef.current = sessionId; setActiveSessionId(sessionId); setAcquiring(true);
  });
  const stop = () => run(async () => {
    if (gameRunningRef.current) gameAbortRef.current("EEG 采集已停止，本轮已取消");
    acquisitionGenerationRef.current += 1;
    formalTrialGenerationRef.current += 1;
    teachingActiveRef.current = false; setTeachingActive(false);
    if (teachingTimerRef.current !== null) { window.clearTimeout(teachingTimerRef.current); teachingTimerRef.current = null; }
    resolveDealComplete();
    firstFrameResolverRef.current?.(performance.now()); firstFrameResolverRef.current = null;
    decisionResolverRef.current?.(null); decisionResolverRef.current = null;
    realEegTapRef.current?.invalidate(); setActiveSessionId(null);
    const result: CommandResult = await clientRef.current.command("stop_acquisition"); setAcquiring(false);
    workerRef.current?.postMessage({ type: "stop_trial" } satisfies WorkerInput);
    sessionIdRef.current = null; trialIdRef.current = null; trialKindRef.current = "online"; cuedTargetIndexRef.current = null;
    teachingTrialIdRef.current = null; teachingChoiceResolverRef.current = null; setTeachingDecision(null); setTeachingDecisionMeta(null); setTeachingAnalysis(null); setTeachingAnalysisProgress(null);
    setIsolatedTargetIndex(null); setCalibrationCue(null); setTrialStage("ready");
    if (result.confirmation !== "device_status") setError("停止命令已发送，但设备未明确确认");
  });

  const onStimulusFirstFrame = (performanceMs: number) => {
    const sessionId = sessionIdRef.current, trialId = trialIdRef.current;
    stimulusStartedAtRef.current = performanceMs;
    if (!sessionId || !trialId) return;
    workerRef.current?.postMessage({ type: "start_trial", sessionId, trialId } satisfies WorkerInput);
    void clientRef.current.command<{ markerSampleIndex: string; gatewayMonotonicNs: number }>("stimulus_marker", { markerType: "stimulus_start", sessionId, trialId,
      rendererPerformanceMs: performanceMs, plannedRefreshRateHz: displayRefreshRateHz, luminanceBaseline: 0.5, modulationAmplitude: 0.45,
      trialKind: trialKindRef.current, cuedTargetIndex: cuedTargetIndexRef.current,
      activeTargetIds: cuedTargetIndexRef.current === null || trialKindRef.current !== "isolated_diagnostic"
        ? SIMPLE_TARGETS.map(({ id }) => id) : [SIMPLE_TARGETS[cuedTargetIndexRef.current].id],
      stimulusGeometry: SIMPLE_STIMULUS_GEOMETRY,
      stimulusFrequencyVersion: SIMPLE_STIMULUS_FREQUENCY.version,
      stimulusTimingVersion: STIMULUS_TIMING_VERSION,
      analysisWindowSeconds: ONLINE_WINDOW_SECONDS,
      classifierVersion: "0.3.0", filterMode: "continuous-fir", filterWarmupSamples: FBCCA_FILTER_WARMUP_SAMPLES,
      decisionPolicyVersion: FBCCA_POLICY_VERSION, decisionPolicy: fbccaDecisionPolicy(SIMPLE_TARGETS.length),
      diagnosticSequenceIndex: trialKindRef.current === "isolated_diagnostic" ? diagnosticSequenceIndexRef.current : null,
      diagnosticSequence: trialKindRef.current === "isolated_diagnostic" ? diagnosticSequenceRef.current : null,
      targets: SIMPLE_TARGETS.map(({ id, frequencyHz, phaseRad, x, y }) => ({ id, frequencyHz, phaseRad, x, y })) })
      .then((result) => {
        if (sessionIdRef.current !== sessionId || trialIdRef.current !== trialId) return;
        workerRef.current?.postMessage({ type: "set_trial_marker", sessionId, trialId, firstSampleIndex: result.data.markerSampleIndex } satisfies WorkerInput);
        firstFrameResolverRef.current?.(performanceMs);
      })
      .catch((cause) => { setError((cause as Error).message); firstFrameResolverRef.current?.(performanceMs); });
  };

  const onStimulusFrameStats = (frameStats: StimulusFrameStats) => {
    const sessionId = sessionIdRef.current, trialId = trialIdRef.current; if (!sessionId || !trialId) return;
    void clientRef.current.command("stimulus_marker", { markerType: "stimulus_end", sessionId, trialId,
      rendererPerformanceMs: frameStats.lastFramePerformanceMs, durationMs: frameStats.lastFramePerformanceMs - frameStats.firstFramePerformanceMs,
      endReason: stimulusEndReasonRef.current, ...frameStats }).catch((cause) => setError((cause as Error).message));
  };

  const executeTrial = async (calibrationLabel: number | null, isolatedDiagnostic = false) => {
    const sessionId = sessionIdRef.current; if (!sessionId || !acquiring) throw new Error("请先开始采集");
    if (trialStage !== "ready") throw new Error("当前试次尚未结束");
    const executionGeneration = ++formalTrialGenerationRef.current;
    const stillCurrent = () => executionGeneration === formalTrialGenerationRef.current;
    if (document.hidden) throw new Error("窗口不可见，无法开始刺激试次");
    const measuredRefreshRateHz = await measureDisplayRefreshRate();
    if (!stillCurrent()) return;
    if (document.hidden) throw new Error("窗口不可见，无法开始刺激试次");
    setDisplayRefreshRateHz(measuredRefreshRateHz);
    const trialId = crypto.randomUUID(); trialIdRef.current = trialId;
    trialKindRef.current = isolatedDiagnostic ? "isolated_diagnostic" : calibrationLabel === null ? "online" : "calibration";
    cuedTargetIndexRef.current = calibrationLabel;
    setIsolatedTargetIndex(isolatedDiagnostic ? calibrationLabel : null);
    setVisualTargets(SIMPLE_TARGETS); setReferenceLabel("9♠");
    setCalibrationCue(calibrationLabel === null ? null : `${isolatedDiagnostic ? "单目标诊断" : "请持续注视"}：${SIMPLE_TARGETS[calibrationLabel].label}`);
    setTrialResult(calibrationLabel === null ? "准备发牌" : `${isolatedDiagnostic ? "诊断" : "校准"}目标：${SIMPLE_TARGETS[calibrationLabel].label}`);
    setTrialStage("dealing"); await waitForDealComplete(); if (!stillCurrent()) return;
    setTrialStage("fixation"); await wait(500); if (!stillCurrent()) return;
    setTrialStage("preview"); await wait(800); if (!stillCurrent()) return;
    const firstFrame = new Promise<number>((resolve) => { firstFrameResolverRef.current = resolve; });
    if (!stillCurrent()) return;
    const selected = new Promise<BciDecision | null>((resolve) => { decisionResolverRef.current = resolve; });
    stimulusEndReasonRef.current = "deadline"; setTrialStage("stimulus"); await firstFrame;
    if (!stillCurrent()) return;
    const result = calibrationLabel === null ? await Promise.race([selected, wait(GAME_STIMULUS_MS).then(() => null)]) : await wait(GAME_STIMULUS_MS).then(() => null);
    if (!stillCurrent()) return;
    stimulusEndReasonRef.current = isolatedDiagnostic ? "isolated_diagnostic_complete" : calibrationLabel !== null ? "calibration_complete" : result ? "selected" : "deadline";
    decisionResolverRef.current = null; firstFrameResolverRef.current = null;
    if (calibrationLabel !== null && !isolatedDiagnostic) workerRef.current?.postMessage({ type: "add_calibration_trial", labelIndex: calibrationLabel } satisfies WorkerInput);
    workerRef.current?.postMessage({ type: "stop_trial" } satisfies WorkerInput);
    if (calibrationLabel !== null && isolatedDiagnostic) {
      setDiagnosticProgress((previous) => calibrationLabel === 0 ? [previous[0] + 1, previous[1]] : [previous[0], previous[1] + 1]);
    }
    setTrialResult(calibrationLabel !== null
      ? `${isolatedDiagnostic ? "已保存单目标诊断" : "已保存校准样本"}：${SIMPLE_TARGETS[calibrationLabel].label}`
      : result ? `识别目标：${SIMPLE_TARGETS[result.candidateIndex!]?.label ?? result.candidateIndex}` : "未能确定选择");
    setTrialStage("feedback"); await wait(800); if (!stillCurrent()) return;
    setTrialStage("rest"); await wait(700); if (!stillCurrent()) return;
    trialIdRef.current = null; trialKindRef.current = "online"; cuedTargetIndexRef.current = null;
    setIsolatedTargetIndex(null); setCalibrationCue(null); setTrialStage("ready");
  };
  const runTrial = () => run(() => executeTrial(null, false));
  const runCalibrationTrial = () => run(async () => {
    const label = calibrationProgress.counts[0] <= calibrationProgress.counts[1] ? 0 : 1;
    await executeTrial(label, false);
  });
  const runIsolatedDiagnosticTrial = () => run(async () => {
    const sequenceIndex = diagnosticSequencePositionRef.current;
    const label = diagnosticSequenceRef.current[sequenceIndex];
    if (label === undefined) throw new Error("本轮随机隔离序列已完成，请重新开始采集");
    diagnosticSequencePositionRef.current += 1; diagnosticSequenceIndexRef.current = sequenceIndex;
    await executeTrial(label, true);
  });
  const trainModel = () => run(async () => {
    if (calibrationProgress.counts.some((count) => count < calibrationProgress.requiredPerTarget)) throw new Error("快速校准尚未完成");
    setModelStatus("正在训练 eTRCA…");
    workerRef.current?.postMessage({ type: "train_etraca", requiredPerTarget: calibrationProgress.requiredPerTarget } satisfies WorkerInput);
  });

  const onTeachingFirstFrame = (performanceMs: number) => {
    const sessionId = sessionIdRef.current, trialId = teachingTrialIdRef.current;
    const targets = teachingTargetsRef.current;
    if (!teachingActiveRef.current || !sessionId || !trialId || !targets.length) return;
    teachingLastDataAtRef.current = performance.now();
    const operation = teachingModeRef.current === "operation";
    workerRef.current?.postMessage({ type: "start_trial", sessionId, trialId } satisfies WorkerInput);
    void clientRef.current.command<{ markerSampleIndex: string }>("stimulus_marker", {
      markerType: "stimulus_start", sessionId, trialId, rendererPerformanceMs: performanceMs,
      plannedRefreshRateHz: displayRefreshRateHz, luminanceBaseline: 0.5, modulationAmplitude: 0.45,
      trialKind: "teaching", teachingMode: teachingModeRef.current,
      cuedTargetIndex: teachingCueIndexRef.current,
      stimulusMode: operation ? operationStimulusModeRef.current : undefined,
      activeTargetIds: operation ? operationStimulusIndexRef.current === null ? targets.map(({ id }) => id) : [targets[operationStimulusIndexRef.current]?.id]
        : teachingActiveTargetIndex === null ? targets.map(({ id }) => id) : [targets[teachingActiveTargetIndex]?.id],
      targets: targets.map(({ id, frequencyHz, phaseRad, x, y }) => ({ id, frequencyHz, phaseRad, x, y })),
      stimulusGeometry: { ...SIMPLE_STIMULUS_GEOMETRY, version: operation ? "teaching-geometry-v3" : "teaching-geometry-v5", referenceY: TEACHING_REFERENCE_Y, referenceVisible: false,
        layout: "horizontal-single-row", targetSize: operation ? "standard" : "teaching-fill" },
      responsiveStimulusGeometry: teachingGeometryRef.current,
      stimulusFrequencyVersion: "teaching-custom-v2",
      stimulusTimingVersion: STIMULUS_TIMING_VERSION,
      analysisWindowSeconds: ONLINE_WINDOW_SECONDS,
      classifierVersion: "0.3.0", filterMode: "continuous-fir", filterWarmupSamples: FBCCA_FILTER_WARMUP_SAMPLES,
      decisionPolicyVersion: FBCCA_POLICY_VERSION, decisionPolicy: fbccaDecisionPolicy(targets.length),
      attentionConfirmed: false, attentionInstruction: teachingCueIndexRef.current,
    }).then((result) => {
      if (!teachingActiveRef.current || sessionIdRef.current !== sessionId || teachingTrialIdRef.current !== trialId) return;
      workerRef.current?.postMessage({ type: "set_trial_marker", sessionId, trialId, firstSampleIndex: result.data.markerSampleIndex } satisfies WorkerInput);
    }).catch((cause) => {
      if (teachingActiveRef.current && sessionIdRef.current === sessionId && teachingTrialIdRef.current === trialId) setError((cause as Error).message);
    });
  };

  const onTeachingTimingDisruption = (warning: boolean, invalidate: boolean) => {
    const sessionId = sessionIdRef.current, trialId = teachingTrialIdRef.current;
    if (!teachingActiveRef.current || !sessionId || !trialId) return;
    if (invalidate) {
      teachingTimingPendingRef.current = true;
      roundDecisionRef.current = null;
      setTeachingAnalysis(null); setTeachingAnalysisProgress(null); setTeachingDecision(null); setTeachingDecisionMeta(null);
      workerRef.current?.postMessage({ type: "invalidate_stimulus_window", sessionId, trialId, revision: ++teachingTimingRevisionRef.current } satisfies WorkerInput);
    }
    setTeachingResult(warning ? "显示不稳定：刺激继续，等待完整稳定 EEG 窗口" : invalidate ? "明显卡顿：刺激继续，重新积累稳定 EEG 窗口" : teachingModeRef.current === "operation" ? "请注视目标" : "刺激中，等待真实 EEG 窗口");
  };

  const onTeachingFrameStats = (frameStats: StimulusFrameStats) => {
    const sessionId = sessionIdRef.current, trialId = teachingTrialIdRef.current;
    if (!sessionId || !trialId) return;
    void clientRef.current.command("stimulus_marker", {
      markerType: "stimulus_end", sessionId, trialId, trialKind: "teaching",
      teachingMode: teachingModeRef.current, rendererPerformanceMs: frameStats.lastFramePerformanceMs,
      durationMs: frameStats.lastFramePerformanceMs - frameStats.firstFramePerformanceMs,
      endReason: teachingEndReasonRef.current, ...frameStats,
    }).catch((cause) => setError((cause as Error).message));
    teachingTrialIdRef.current = null;
  };

  const finishTeaching = (message: string, endReason = "teaching_complete") => {
    const round = roundRef.current;
    const cue = teachingCueIndexRef.current;
    const outcome = message.startsWith("选择正确") ? "correct" : message.startsWith("选择了") ? "incorrect" : message.includes("未能确定") ? "rejected" : null;
    if (round?.state.active && cue !== null && outcome && endReason === "teaching_complete") {
      const decision = roundDecisionRef.current;
      const predicted = outcome === "rejected" || decision?.rejected ? null : decision?.candidateIndex;
      const target = teachingTargetsRef.current[cue];
      const prediction = predicted == null ? null : teachingTargetsRef.current[predicted];
      round.recordResult({ index: round.state.index, stimulusMode: OPERATION_TRIALS[round.state.index].stimulusMode,
        targetLabel: target.label, targetFrequencyHz: target.frequencyHz, predictedLabel: prediction?.label ?? null, predictedFrequencyHz: prediction?.frequencyHz ?? null,
        outcome, matches: decision?.matches ?? [], reason: decision?.reason });
    }
    if (teachingActiveRef.current && teachingModeRef.current === "operation") {
      const outcome = message.startsWith("选择正确") ? "correct" : message.startsWith("选择了") ? "incorrect" : message.includes("未能确定") ? "rejected" : null;
      if (outcome) setTrainingStats(previous => ({ ...previous, [outcome]: previous[outcome] + 1 }));
    }
    teachingActiveRef.current = false;
    operationStimulusModeRef.current = "NONE";
    teachingEndReasonRef.current = endReason;
    if (teachingTimerRef.current !== null) { window.clearTimeout(teachingTimerRef.current); teachingTimerRef.current = null; }
    setTeachingActive(false); setTeachingResult(message);
    teachingCueIndexRef.current = null;
    teachingChoiceResolverRef.current = null;
    workerRef.current?.postMessage({ type: "stop_trial" } satisfies WorkerInput);
    const resolve = roundTrialResolveRef.current; roundTrialResolveRef.current = null;
    resolve?.(endReason === "round_pause" ? "paused" : message.startsWith("选择正确") ? "correct" : message.startsWith("选择了") ? "incorrect" : message.includes("未能确定") && endReason === "teaching_complete" ? "rejected" : "interrupted");
  };

  const applyTeachingTargetPreset = (count: 2 | 3 | 4) => {
    if (teachingActive) return;
    const presets: Record<2 | 3 | 4, number[]> = { 2: [12, 15], 3: [12, 15, 10], 4: [12, 15, 10, 20] };
    const frequencies = presets[count];
    setTeachingTargetCount(count);
    setTeachingLeftHz(frequencies[0]); setTeachingRightHz(frequencies[1]);
    setTeachingExtraHz([frequencies[2] ?? 10, frequencies[3] ?? 20]);
  };
  const focusTeachingWorkspace = (workspace: TeachingWorkspace) => {
    window.setTimeout(() => document.getElementById(`teaching-${workspace}-workspace`)?.focus(), 0);
  };
  const selectTeachingWorkspace = (workspace: TeachingWorkspace) => {
    if (teachingActive || teachingPreparing || roundRef.current?.state.active) return;
    setTeachingWorkspace(workspace);
    focusTeachingWorkspace(workspace);
  };
  const applyNoiseTeachingScenario = (id: NoiseTeachingScenarioId) => {
    if (teachingActive) return;
    setTeachingResult("原理演示仅使用真实 EEG，请先连接设备并开始采集");
    changeTeachingMode("principle");
    setTeachingWorkspace("run");
    focusTeachingWorkspace("run");
  };
  const applyAdvancedSimulationScenario = (id: Stage8SimulationScenario["id"]) => {
    if (teachingActive) return;
    setTeachingResult("原理演示仅使用真实 EEG，请先连接设备并开始采集");
    changeTeachingMode("principle");
    setTeachingWorkspace("run");
    focusTeachingWorkspace("run");
  };
  const goToPrincipleDemo = () => { changeTeachingMode("principle"); setTeachingWorkspace("run"); focusTeachingWorkspace("run"); };

  const handleTeachingChoice = (choice: number) => {
    if (!teachingActiveRef.current || teachingModeRef.current !== "operation") return;
    const cue = teachingCueIndexRef.current;
    finishTeaching(cue === choice ? `选择正确：${teachingTargets[choice]?.label ?? "目标"}` : `选择了 ${teachingTargets[choice]?.label ?? "目标"}，正确目标是 ${teachingTargets[cue ?? 0]?.label ?? "目标"}`);
  };

  const performTeachingStimulus = async (operationTrial?: OperationTrial, roundIndex?: number) => {
    if (teachingActiveRef.current || teachingPreparingRef.current) return;
    if (!connected || !properties || !acquiring || !sessionIdRef.current) throw new Error("请先连接 EEG 设备并开始采集");
    const names = properties.lead_names.map(name => name.trim().toUpperCase());
    if (["O1", "O2", "P3", "P4"].some(name => !names.includes(name))) throw new Error("当前数据质量不足：分类需要 O1、O2、P3、P4 真实导联");
    setTeachingWorkspace("run");
    if (teachingMode === "operation" && teachingTargets.length < 2) throw new Error("操作训练至少需要两个目标");
    const frequencies = teachingTargets.map((target) => target.frequencyHz);
    if (frequencies.some((frequency) => !Number.isFinite(frequency) || frequency < 6 || frequency > 30)) {
      throw new Error("教学频率必须在每秒 6–30 Hz 范围内");
    }
    if (new Set(frequencies.map((frequency) => frequency.toFixed(3))).size !== frequencies.length) {
      throw new Error("教学目标频率不能重复");
    }
    if (document.hidden) throw new Error("窗口不可见，无法开始刺激试次");
    // Recheck the current screen after navigation or moving between monitors.
    // A refresh rate retained from application startup can mislabel normal
    // callbacks on a slower screen as dropped frames.
    teachingPreparingRef.current = true; setTeachingPreparing(true);
    const preparationGeneration = teachingPreparationGenerationRef.current;
    try {
      const refreshRate = await measureDisplayRefreshRate(60);
      if (preparationGeneration !== teachingPreparationGenerationRef.current) return;
      if (document.hidden) throw new Error("窗口不可见，无法开始刺激试次");
      setDisplayRefreshRateHz(refreshRate);
    } finally {
      teachingPreparingRef.current = false; setTeachingPreparing(false);
    }
    if (preparationGeneration !== teachingPreparationGenerationRef.current) return;
    if (!connected || !acquiring || !sessionIdRef.current) throw new Error("EEG 采集会话已停止，请重新开始采集");
    configureSignalWorker(properties!, frequencies, teachingMode === "principle", Boolean(operationTrial), teachingMode === "operation" ? TRAINING_TIMING.stimulusMs / 1000 : undefined);
    roundDecisionRef.current = null;
    teachingModeRef.current = teachingMode;
    const cue = teachingMode === "operation" ? operationTrial?.target ?? (singleStimulusMode === "LEFT_ONLY" ? 0 : singleStimulusMode === "RIGHT_ONLY" ? 1 : singleStimulusMode === "BOTH" ? Math.min(singleTarget, teachingTargets.length - 1) : Math.floor(Math.random() * teachingTargets.length)) : teachingActiveTargetIndex;
    const stimulusMode = operationTrial?.stimulusMode ?? (singleStimulusMode === "TARGET_ONLY" && teachingTargets.length === 2 ? cue === 0 ? "LEFT_ONLY" : "RIGHT_ONLY" : singleStimulusMode);
    const flickerIndex = stimulusMode === "BOTH" ? null : stimulusMode === "LEFT_ONLY" ? 0 : stimulusMode === "RIGHT_ONLY" ? 1 : cue;
    operationStimulusIndexRef.current = flickerIndex; setOperationStimulusIndex(flickerIndex);
    operationStimulusModeRef.current = stimulusMode;
    teachingTimingPendingRef.current = false;
    teachingTrialIdRef.current = crypto.randomUUID();
    teachingLastDataAtRef.current = performance.now();
    teachingActiveRef.current = true;
    teachingEndReasonRef.current = "teaching_complete";
    teachingChoiceResolverRef.current = teachingMode === "operation" ? handleTeachingChoice : null;
    teachingCueIndexRef.current = cue;
    setTeachingDecision(null); setTeachingDecisionMeta(null); setTeachingAnalysis(null); setTeachingAnalysisProgress(null); setTeachingCueIndex(cue);
    if (teachingMode === "operation") {
      teachingActiveRef.current = false;
      teachingPreparingRef.current = true; setTeachingPreparing(true);
      try {
        for (let seconds = TRAINING_TIMING.cueSeconds; seconds > 0; seconds--) {
          setTrainingCountdown(seconds); setTeachingResult(`目标：${teachingTargets[cue ?? 0].label} · ${seconds} 秒后开始`);
          await (operationTrial ? roundRef.current!.delay(1000) : new Promise(resolve => window.setTimeout(resolve, 1000)));
          if (operationTrial) await roundRef.current!.gate();
          if (preparationGeneration !== teachingPreparationGenerationRef.current || document.hidden || !sessionIdRef.current) { teachingTrialIdRef.current = null; teachingChoiceResolverRef.current = null; setTeachingCueIndex(null); setTeachingResult("准备已取消"); return; }
        }
      } finally { setTrainingCountdown(0); teachingPreparingRef.current = false; setTeachingPreparing(false); }
      teachingLastDataAtRef.current = performance.now();
      teachingActiveRef.current = true;
      setTeachingTrialNumber(number => roundIndex === undefined ? number + 1 : roundIndex + 1);
      if (operationTrial) roundRef.current!.setPhase("STIMULATING");
    }
    setTeachingActive(true);
    setTeachingResult(teachingMode === "operation" ? `请注视 ${teachingTargets[cue ?? 0].label}` : "刺激中，等待真实 EEG 窗口");
    if (teachingMode === "operation") teachingTimerRef.current = window.setTimeout(() => finishTeaching("本轮未能确定选择"), TRAINING_TIMING.stimulusMs);
  };
  const startTeachingStimulus = () => run(async () => { roundRef.current?.reset(); await performTeachingStimulus(); });
  roundRunTrialRef.current = (trial, index) => new Promise<TrialOutcome>((resolve, reject) => {
    roundTrialResolveRef.current = resolve;
    void performTeachingStimulus(trial, index).then(() => {
      if (!teachingActiveRef.current && !teachingPreparingRef.current) { roundTrialResolveRef.current = null; resolve("interrupted"); }
    }).catch(cause => { roundTrialResolveRef.current = null; reject(cause); });
  });
  roundInterruptRef.current = () => {
    teachingPreparationGenerationRef.current++;
    if (teachingTimerRef.current !== null) { window.clearTimeout(teachingTimerRef.current); teachingTimerRef.current = null; }
    workerRef.current?.postMessage({ type: "stop_trial" } satisfies WorkerInput);
    const paused = Boolean(roundRef.current?.state.paused);
    if (teachingActiveRef.current || teachingPreparingRef.current || roundTrialResolveRef.current) finishTeaching(paused ? "训练已暂停" : "训练已结束", paused ? "round_pause" : "round_stop");
    teachingPreparingRef.current = false; setTeachingPreparing(false); setTrainingCountdown(0);
  };
  const startOperationRound = () => run(async () => {
    if (operationTargetCount !== 2) throw new Error("完整轮次使用两张牌，请将目标数量设为 2 个");
    if (teachingActive || teachingPreparing) return;
    await roundRef.current!.start();
  });
  useEffect(() => {
    if (roundRef.current?.state.active && (!connected || !acquiring || !activeSessionId || appView !== "teaching" || teachingWorkspace !== "run" || teachingMode !== "operation")) roundRef.current.stop();
  }, [connected, acquiring, activeSessionId, appView, teachingWorkspace, teachingMode]);
  useEffect(() => () => roundRef.current?.stop(), []);

  const startEegGame = (rounds: number) => {
    const readiness = gameEegReadiness(connected, acquiring && Boolean(sessionIdRef.current), properties?.lead_names ?? []);
    if (readiness) { setError(readiness); return false; }
    if (trialStage !== "ready") return false;
    gameRetryRef.current = false; setGameSelectedIndex(null);
    if (restSeconds > 0) { setError(`请休息 ${restSeconds} 秒后再开始下一局`); return false; }
    setError(null); setGameLength(rounds); setGameRoundNumber(0); setGameScore(0); setGameStreak(0); setGameMaxStreak(0);
    setGameCorrect(0); setGameIncorrect(0); setGameUncertain(0); setGameDecisionTimeTotal(0); setGameDecisionCount(0);
    setGameFinished(false); setGameRound(null); setGameOnsetMs(undefined); setGameCountdown(0);
    setGameRunning(true); setRulesOpen(false); setTrialResult("准备发牌");
    return true;
  };
  const playEegRound = () => run(async () => {
    try {
    const executionGeneration = ++formalTrialGenerationRef.current;
    const stillCurrent = () => executionGeneration === formalTrialGenerationRef.current;
    if (!gameRunning || gameRoundNumber >= gameLength) throw new Error("当前游戏已经结束");
    const readiness = gameEegReadiness(connected, acquiring && Boolean(sessionIdRef.current), properties?.lead_names ?? []);
    if (readiness) throw new Error(readiness);
    if (document.hidden) throw new Error("窗口不可见，无法开始刺激");
    setGameOnsetMs(undefined); setTrialStage("preview"); setTrialResult("正在检查显示");
    const refreshRate = await measureDisplayRefreshRate(60);
    if (!stillCurrent() || !sessionIdRef.current) return;
    setDisplayRefreshRateHz(refreshRate);
    const round = gameRetryRef.current && gameRound ? gameRound : generateGameRound(gameMode); setGameRound(round); setReferenceLabel(cardLabel(round.reference));
    const template = gameStimulusTemplateForMode(gameMode);
    setGameVisualTargets(template.targets.map((target, index) => ({ ...target, label: cardLabel(round.candidates[index]) })));
    setTrialResult(GAME_PRESENTATION[gameMode].rule);
    if (!gameRetryRef.current) {
      setTrialStage("dealing"); await waitForDealComplete(); if (!stillCurrent()) return;
    }
    setTrialStage("preview"); await wait(GAME_PRESENTATION[gameMode].observationMs); if (!stillCurrent()) return;
    setTrialStage("countdown");
    for (let seconds = GAME_COUNTDOWN_SECONDS; seconds > 0; seconds--) {
      setGameCountdown(seconds);
      await wait(1000); if (!stillCurrent()) return;
    }
    setGameCountdown(0);
    const sessionId = sessionIdRef.current;
    if (!sessionId || document.hidden) { cancelGameTrialForDisplay("EEG 或显示尚未就绪"); return; }
    const targets = template.targets.map((target, index) => ({ ...target, label: cardLabel(round.candidates[index]) }));
    setGameSelectedIndex(null);
    configureSignalWorker(properties!, targets.map(target => target.frequencyHz), false, false, GAME_STIMULUS_MS / 1000);
    const onsetMs = performance.now();
    const trial: GameEegTrial = { sessionId, trialId: crypto.randomUUID(), frequencies: targets.map(target => target.frequencyHz), onsetMs, sampleRateHz: properties!.sample_rate_hz };
    gameEegTrialRef.current = trial; gameMarkerTrialRef.current = trial; gameTimingPendingRef.current = false;
    gameLastDataAtRef.current = onsetMs; stimulusStartedAtRef.current = onsetMs;
    stimulusEndReasonRef.current = "game_stimulus_deadline";
    workerRef.current?.postMessage({ type: "start_trial", sessionId, trialId: trial.trialId } satisfies WorkerInput);
    const choice = new Promise<number | null>(resolve => { gameChoiceResolverRef.current = resolve; });
    setGameOnsetMs(onsetMs); setTrialStage("stimulus"); setTrialResult("采集中 · 请注视所选牌");
    void clientRef.current.command<{ markerSampleIndex: string }>("stimulus_marker", { markerType: "stimulus_start", sessionId, trialId: trial.trialId,
      rendererPerformanceMs: onsetMs, plannedRefreshRateHz: refreshRate, luminanceBaseline: .5, modulationAmplitude: .45,
      trialKind: "online", cuedTargetIndex: null, activeTargetIds: targets.map(target => target.id),
      stimulusGeometry: { ...SIMPLE_STIMULUS_GEOMETRY, layout: template.layout, referenceX: template.referenceX, referenceY: template.referenceY },
      stimulusFrequencyVersion: gameMode === "simple" ? SIMPLE_STIMULUS_FREQUENCY.version : `${template.layout}-frequency-v1`,
      stimulusTimingVersion: STIMULUS_TIMING_VERSION, analysisWindowSeconds: ONLINE_WINDOW_SECONDS,
      classifierVersion: "0.3.0", filterMode: "continuous-fir", filterWarmupSamples: FBCCA_FILTER_WARMUP_SAMPLES,
      decisionPolicyVersion: FBCCA_POLICY_VERSION, decisionPolicy: fbccaDecisionPolicy(targets.length),
      gameMode, roundNumber: gameRoundNumber + 1, retry: gameRetryRef.current,
      referenceCard: round.reference, candidateCards: round.candidates, correctIndex: round.correctIndex,
      targets: targets.map(({ id, label, frequencyHz, phaseRad, x, y }) => ({ id, label, frequencyHz, phaseRad, x, y })) })
      .then(result => { if (gameEegTrialRef.current === trial) workerRef.current?.postMessage({ type: "set_trial_marker", sessionId, trialId: trial.trialId, firstSampleIndex: result.data.markerSampleIndex } satisfies WorkerInput); })
      .catch(() => { if (gameEegTrialRef.current === trial) gameAbortRef.current("EEG 刺激标记失败，本轮已取消"); });
    gameStimulusTimerRef.current = window.setTimeout(() => {
      gameStimulusTimerRef.current = null;
      if (gameEegTrialRef.current === trial) { setTrialStage("analyzing"); setTrialResult("分析中"); }
    }, Math.max(0, onsetMs + GAME_STIMULUS_MS - performance.now()));
    const selected = await Promise.race([choice, wait(Math.max(0, onsetMs + GAME_STIMULUS_MS + GAME_ANALYSIS_GRACE_MS - performance.now())).then(() => null)]);
    gameChoiceResolverRef.current = null;
    if (!stillCurrent()) return;
    if (gameStimulusTimerRef.current !== null) window.clearTimeout(gameStimulusTimerRef.current);
    gameStimulusTimerRef.current = null;
    stimulusEndReasonRef.current = selected === null ? "game_rejected" : "game_classified";
    const decisionTime = Math.min(GAME_STIMULUS_MS, performance.now() - onsetMs);
    const recordGameResult = (outcome: "correct" | "incorrect" | "rejected", totalScore: number) => {
      void clientRef.current.command("stimulus_marker", { markerType: "game_result", sessionId, trialId: trial.trialId,
        gameMode, roundNumber: gameRoundNumber + 1, selectedIndex: selected, correctIndex: round.correctIndex,
        outcome, decisionTimeMs: decisionTime, totalScore,
        referenceCard: round.reference, candidateCards: round.candidates,
        source: "real-eeg-fbcca", attentionConfirmed: false }).catch(cause => setError(`游戏结果保存失败：${(cause as Error).message}`));
    };
    gameEegTrialRef.current = null; gameLastDataAtRef.current = 0;
    workerRef.current?.postMessage({ type: "stop_trial" } satisfies WorkerInput);
    setGameSelectedIndex(selected);
    if (selected === null) {
      recordGameResult("rejected", gameScore);
      gameRetryRef.current = true; setGameUncertain(previous => previous + 1);
      setTrialResult("本次未确定 / 拒识，请重新选择"); setTrialStage("feedback");
      await wait(GAME_FEEDBACK_MS); if (!stillCurrent()) return; setTrialStage("ready"); return;
    }
    gameRetryRef.current = false;
    const scored = scoreChoice(gameMode, gameScore, gameStreak, selected, round.correctIndex, decisionTime);
    recordGameResult(scored.correct ? "correct" : "incorrect", scored.total);
    setGameScore(scored.total); setGameStreak(scored.streak);
    const nextCorrect = gameCorrect + (scored.correct ? 1 : 0);
    const nextIncorrect = gameIncorrect + (selected !== null && !scored.correct ? 1 : 0);
    const nextUncertain = gameUncertain + (selected === null ? 1 : 0);
    const nextDecisionTimeTotal = gameDecisionTimeTotal + (selected !== null ? decisionTime : 0);
    const nextDecisionCount = gameDecisionCount + (selected !== null ? 1 : 0);
    setGameCorrect(nextCorrect); setGameIncorrect(nextIncorrect); setGameUncertain(nextUncertain);
    setGameDecisionTimeTotal(nextDecisionTimeTotal); setGameDecisionCount(nextDecisionCount);
    const maximumStreak = Math.max(gameMaxStreak, scored.streak); setGameMaxStreak(maximumStreak);
    setTrialResult(`EEG 选择：${cardLabel(round.candidates[selected])} · ${scored.correct ? `正确，+${scored.gained}` : `选择错误，正确答案是 ${cardLabel(round.candidates[round.correctIndex])}`}`);
    setTrialStage("feedback"); await wait(GAME_FEEDBACK_MS); if (!stillCurrent()) return;
    const nextRound = gameRoundNumber + 1; setGameRoundNumber(nextRound); setTrialStage("ready");
    if (nextRound >= gameLength) {
      modalReturnFocusRef.current = null;
      setGameRunning(false); setGameFinished(true); setRestSeconds(gameLength === 10 ? 30 : 60);
      setTrialResult(`本局完成：${scored.total} 分，最高连胜 ${maximumStreak}`);
    }
    } catch (cause) { gameAbortRef.current("EEG 游戏试次未能启动，请重新开始"); throw cause; }
  });

  gameNextTrialRef.current = playEegRound;
  useEffect(() => {
    if (!gameRunning || trialStage !== "ready") return;
    // Begin after React commits the expanded desk and current round counters.
    // Cleanup prevents an exit from launching a pending automatic round.
    const timer = window.setTimeout(() => gameNextTrialRef.current(), 100);
    return () => window.clearTimeout(timer);
  }, [gameRunning, trialStage]);

  const cancelGameTrialForDisplay = (message = "显示环境已变化，请重新开始") => {
    if (!gameRunningRef.current) return;
    formalTrialGenerationRef.current += 1;
    resolveDealComplete();
    gameChoiceResolverRef.current?.(null);
    gameChoiceResolverRef.current = null;
    gameEegTrialRef.current = null; gameLastDataAtRef.current = 0; gameRetryRef.current = false;
    stimulusEndReasonRef.current = "game_canceled";
    if (gameStimulusTimerRef.current !== null) window.clearTimeout(gameStimulusTimerRef.current);
    gameStimulusTimerRef.current = null;
    workerRef.current?.postMessage({ type: "stop_trial" } satisfies WorkerInput);
    setGameRunning(false);
    setGameCountdown(0); setGameOnsetMs(undefined);
    setGameRound(null);
    setTrialStage("ready");
    setTrialResult(message);
    if (message !== "已退出本局，EEG 采集继续运行") setError(message);
  };

  gameAbortRef.current = cancelGameTrialForDisplay;
  const onGameFrameStats = (frameStats: StimulusFrameStats) => {
    const trial = gameMarkerTrialRef.current; if (!trial) return;
    gameMarkerTrialRef.current = null;
    void clientRef.current.command("stimulus_marker", { markerType: "stimulus_end", sessionId: trial.sessionId, trialId: trial.trialId,
      rendererPerformanceMs: Math.min(performance.now(), trial.onsetMs + GAME_STIMULUS_MS),
      durationMs: Math.min(GAME_STIMULUS_MS, performance.now() - trial.onsetMs), endReason: stimulusEndReasonRef.current,
      ...frameStats, logicalStimulusStartMs: trial.onsetMs }).catch(cause => setError((cause as Error).message));
  };
  const onGameTimingDisruption = (warning: boolean, invalidate: boolean) => {
    const trial = gameEegTrialRef.current; if (!trial) return;
    if (invalidate) {
      gameTimingPendingRef.current = true;
      workerRef.current?.postMessage({ type: "invalidate_stimulus_window", sessionId: trial.sessionId, trialId: trial.trialId, revision: ++gameTimingRevisionRef.current } satisfies WorkerInput);
    }
    if (warning) setTrialResult("请注视所选牌 · 显示不稳定");
  };

  const cancelLabTrialForDisplay = (endReason = "display_environment_changed", message = "显示环境已变化，请重新开始") => {
    if (gameRunning || (trialStage !== "stimulus" && trialStage !== "dealing" && trialStage !== "fixation" && trialStage !== "preview")) return;
    formalTrialGenerationRef.current += 1;
    resolveDealComplete();
    const canceledGeneration = formalTrialGenerationRef.current;
    stimulusEndReasonRef.current = endReason;
    firstFrameResolverRef.current?.(performance.now());
    firstFrameResolverRef.current = null;
    decisionResolverRef.current?.(null);
    decisionResolverRef.current = null;
    workerRef.current?.postMessage({ type: "stop_trial" } satisfies WorkerInput);
    setIsolatedTargetIndex(null);
    setCalibrationCue(null);
    setTrialStage("ready");
    setTrialResult(message);
    // Let the active StimulusTable cleanup emit its normal end statistics,
    // then clear trial identity without ever touching a newer trial.
    window.setTimeout(() => {
      if (formalTrialGenerationRef.current !== canceledGeneration) return;
      trialIdRef.current = null;
      trialKindRef.current = "online";
      cuedTargetIndexRef.current = null;
    }, 250);
  };

  useEffect(() => {
    const onVisibilityChange = () => {
      if (!document.hidden) return;
      if (teachingActive) finishTeaching("窗口已隐藏，本次教学试次已停止", "display_hidden");
      if (trialStage === "ready") return;
      if (gameRunning) cancelGameTrialForDisplay("窗口已隐藏，本轮已取消");
      else cancelLabTrialForDisplay("display_hidden", "窗口已隐藏，本次试次无效，请重做");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [trialStage, gameRunning, teachingActive]);

  const openGameRules = () => {
    modalReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRulesOpen(true);
  };
  const exitEegGame = () => {
    cancelGameTrialForDisplay("已退出本局，EEG 采集继续运行");
    setGameFinished(false); setRulesOpen(false); setGameCountdown(0); setError(null);
  };
  const recommendNextGame = () => {
    setGameFinished(false);
    const nextMode = GAME_PRESENTATION[gameMode].next;
    if (nextMode) { selectGameMode(nextMode); openGameRules(); }
  };

  const gatewaySummary = connected ? { value: "已连接", tone: "success" as const } : gatewayStatusLabels[gatewayStatus];
  const teachingUsesRealEeg = Boolean(connected && activeSessionId && acquiring);
  const teachingHasActiveEegSession = Boolean(activeSessionId && acquiring);
  const teachingRunIsPrinciple = teachingWorkspace === "run" && teachingMode === "principle";
  const teachingRunIsOperation = teachingWorkspace === "run" && teachingMode === "operation";
  const teachingRealAnalysisVisible = teachingWorkspace === "observe";
  const currentTeachingCourse = courseById(teachingCourseId);
  const completeTeachingCourse = () => setCompletedTeachingCourses((previous) => new Set(previous).add(teachingCourseId));
  const selectTeachingCourse = (id: TeachingCourse["id"]) => { setTeachingCourseId(id); setTeachingDecision(null); setTeachingDecisionMeta(null); setTeachingAnalysis(null); setTeachingAnalysisProgress(null); };
  const gameConsoleStatus = restSeconds > 0
    ? `轮间休息 ${restSeconds} 秒`
    : gameFinished
      ? "游戏结束"
      : gameRunning
        ? trialStage === "preview"
          ? trialResult === "正在检查显示" ? trialResult : "观察参考牌 · 找到目标"
          : gameStageLabels[trialStage]
        : (trialResult || "等待开始");
  return <main className={`shell shell--${appView} ${appView === "lab" ? `shell--lab-${labWorkspace}` : appView === "teaching" ? `shell--teaching-${teachingWorkspace}` : ""}`}><section className="dashboard">
    <AppHeader title={pageTitles[appView]}
      navigation={<nav className="view-nav view-nav--segmented" aria-label="主界面" onKeyDown={event => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        if (index < 0 || !buttons.length) return;
        event.preventDefault();
        buttons[(index + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length].focus();
      }}>
        <span className="view-nav__indicator" aria-hidden="true" style={{ transform: `translateX(${appView === "game" ? 0 : appView === "teaching" ? 100 : 200}%)` }} />
        <button aria-current={appView === "game" ? "page" : undefined} onClick={() => setAppView("game")} disabled={timingDiagnosticActive || trialStage !== "ready" || teachingActive}>游戏牌桌</button>
        <button aria-current={appView === "teaching" ? "page" : undefined} onClick={() => setAppView("teaching")} disabled={timingDiagnosticActive || gameRunning || trialStage !== "ready" || teachingActive}>教学模式</button>
        <button aria-current={appView === "lab" ? "page" : undefined} onClick={() => setAppView("lab")} disabled={timingDiagnosticActive || gameRunning || trialStage !== "ready" || teachingActive}>设备与实验</button></nav>}
      status={<><StatusBadge label="网关" value={gatewaySummary.value} tone={gatewaySummary.tone} /><StatusBadge label="采集" value={acquiring ? "进行中" : "未采集"} tone={acquiring ? "success" : "neutral"} /></>} />
    {error && <div className="error" role="alert">{error}</div>}
    {appView === "lab" && <>
    <div className="lab-workspace-nav" aria-label="设备与实验工作区"><nav className="lab-workspace-nav__buttons" aria-label="工作区页签"><button type="button" aria-current={labWorkspace === "device" ? "page" : undefined} className={labWorkspace === "device" ? "" : "secondary"} disabled={timingDiagnosticActive} onClick={() => setLabWorkspace("device")}>设备与诊断</button><button type="button" aria-current={labWorkspace === "experiment" ? "page" : undefined} className={labWorkspace === "experiment" ? "" : "secondary"} disabled={timingDiagnosticActive} onClick={() => setLabWorkspace("experiment")}>实验与校准</button><button type="button" aria-current={labWorkspace === "timing" ? "page" : undefined} className={labWorkspace === "timing" ? "" : "secondary"} disabled={timingDiagnosticActive} onClick={() => setLabWorkspace("timing")}>刺激时序诊断</button></nav><ThemedDropdown className="lab-workspace-nav__select" theme="dark" label="当前工作区" ariaLabel="选择设备与实验工作区" menuLabel="设备与实验工作区"
      disabled={timingDiagnosticActive} value={labWorkspace} onChange={setLabWorkspace}
      options={[{ value: "device", label: "设备与诊断" }, { value: "experiment", label: "实验与校准" }, { value: "timing", label: "刺激时序诊断" }]} /></div>
    {labWorkspace === "device" && <section className="lab-device-workspace" aria-label="设备与诊断工作区">
    <div className="actions lab-device-toolbar"><div className="lab-device-toolbar__status"><span className="lab-device-toolbar__label">当前链路</span><strong>{connected ? `设备已连接 · ${acquiring ? "采集中" : "未采集"}` : gatewayStatus === "ready" ? "网关可用，设备未连接" : "网关未启动"}</strong></div><div className="lab-device-toolbar__actions"><button onClick={connect} disabled={gatewayStatus !== "ready" || connected}>连接网关</button>
      <button onClick={start} disabled={!connected || acquiring}>开始采集</button><button onClick={stop} disabled={!acquiring || modelSaving}>停止采集</button>
      <button className="secondary" onClick={() => window.brainGameDesktop.openSessionFolder()}>会话目录</button></div></div>
    <div className="grid lab-device-main"><article className="card"><h2>设备属性</h2><dl>
      <div><dt>连接</dt><dd>{connected ? "已连接" : "未连接"}</dd></div><div><dt>采样率</dt><dd>{properties ? `${properties.sample_rate_hz} Hz` : "—"}</dd></div>
      <div><dt>通道</dt><dd>{properties?.channel_count ?? "—"}</dd></div><div><dt>每包样本</dt><dd>{properties?.samples_per_packet ?? "—"}</dd></div>
    </dl></article><article className="card"><h2>实时链路</h2><dl>
      <div><dt>数据块</dt><dd>{stats.chunks}</dd></div><div><dt>块/秒</dt><dd>{stats.chunksPerSecond}</dd></div>
      <div><dt>每通道样本</dt><dd>{stats.samplesPerChannel}</dd></div><div><dt>序号不连续</dt><dd>{stats.sequenceDiscontinuities}</dd></div>
      <div><dt>网关间隔告警</dt><dd>{stats.reportedGaps}</dd></div>
    </dl></article></div>
    <details className="card lab-log-summary"><summary>日志与会话信息</summary><p>最近错误：{error ?? "—"}</p><p>链路告警：序号不连续 {stats.sequenceDiscontinuities} · 网关间隔告警 {stats.reportedGaps}</p><button className="secondary" onClick={() => window.brainGameDesktop.openSessionFolder()}>会话目录</button></details>
</section>}
    {labWorkspace === "timing" && <section className="lab-timing-workspace" aria-label="刺激时序诊断工作区">
    <StimulusTimingDiagnostics disabled={gameRunning || teachingActive || teachingPreparing || roundState.active || trialStage !== "ready"} comparisonEnabled={acquiring && Boolean(activeSessionId)} onRunningChange={setTimingDiagnosticActive}
      getEegFreshness={() => { const latest = diagnosticLastEegRef.current;
        return latest && latest.sessionId === sessionIdRef.current ? { ageMs: Math.max(0, performance.now() - latest.receivedAt), packetDurationMs: latest.packetDurationMs } : { ageMs: null, packetDurationMs: null }; }}
      onFirstFrame={(performanceMs, mode, refreshRateHz, context) => {
        const sessionId = sessionIdRef.current; if (!sessionId) return;
        const trialId = crypto.randomUUID(); solidDiagnosticTrialRef.current = { sessionId, trialId, targetAppearance: context.appearance, comparisonRunId: context.comparisonRunId, sequenceIndex: context.sequenceIndex };
        const cue = context.condition ? 0 : mode === "left" ? 0 : mode === "right" ? 1 : null;
        const latest = diagnosticLastEegRef.current;
        return clientRef.current.command("stimulus_marker", { markerType: "stimulus_start", sessionId, trialId,
          trialKind: "timing_diagnostic", targetAppearance: context.appearance, rendererPerformanceMs: performanceMs,
          fixationPoint: context.fixationPoint,
          fixationMode: context.fixationMode, eegFreshnessPolicy: context.eegFreshnessPolicy,
          fixationModulation: { mode: context.fixationMode, phaseOffsetRad: 0,
            method: context.fixationMode === "synchronous" ? "concentric-rgb-scaled-by-target-level-v1" : "opaque-concentric-v1",
            geometry: context.geometry?.targets.map(target => ({ x: target.centerX, y: target.centerY, radius: 10 })) },
          comparisonRunId: context.comparisonRunId, comparisonProtocol: context.protocol, sequenceIndex: context.sequenceIndex, repetition: context.repetition,
          comparisonSegment: context.segment, analysisWindowsSeconds: context.analysisWindowsSeconds,
          stimulusFootprint: context.stimulusFootprint, outerFlicker: context.outerFlicker, brightnessMethod: context.brightnessMethod,
          modulatedRegionGeometry: context.geometry?.targets.map(target => ({ ...(context.stimulusFootprint === "card" ? target.card : target.ring), cornerRadius: context.stimulusFootprint === "card" ? 10 : 16 })),
          rgbLevelMapping: "42+178*luminance-v1",
          excludedFromModulationGeometry: context.appearance === "card" ? context.geometry?.targets.map(target => ({ ...target.card, cornerRadius: 10 })) : [],
          rgbChannelStyle: context.appearance === "card" ? "legacy-blue-plus5" : "achromatic",
          condition: context.condition, plannedDurationMs: context.plannedDurationMs, responsiveStimulusGeometry: context.geometry,
          rendererCallbackDelayMs: Math.max(0, performance.now() - performanceMs),
          lastEegAgeMs: latest && latest.sessionId === sessionId ? Math.max(0, performance.now() - latest.receivedAt) : null,
          lastEegPacketDurationMs: latest?.packetDurationMs, lastEegFirstSampleIndex: latest?.firstSampleIndex, lastEegGatewayMonotonicNs: latest?.gatewayMonotonicNs,
          synchronizationMethod: "gateway-arrival-estimate", hardwareSynchronized: false,
          plannedRefreshRateHz: refreshRateHz, luminanceBaseline: .5, modulationAmplitude: context.modulationAmplitude,
          cuedTargetIndex: cue, attentionConfirmed: false,
          activeTargetIds: context.activeTargetIds,
          targets: context.targets.map(({ id, label, frequencyHz, phaseRad, x, y }) => ({ id, label, frequencyHz, phaseRad, x, y })),
          stimulusGeometry: context.condition ? { version: "diagnostic-central-v1", referenceVisible: false, targetX: .5, targetY: .5 } : { ...SIMPLE_STIMULUS_GEOMETRY, referenceVisible: false },
          stimulusFrequencyVersion: context.condition ? "diagnostic-0-12-15-v1" : SIMPLE_STIMULUS_FREQUENCY.version,
          stimulusTimingVersion: STIMULUS_TIMING_VERSION }).then(() => {}).catch(cause => { setError((cause as Error).message); throw cause; });
      }}
      onComplete={(frameStats, endReason) => {
        const trial = solidDiagnosticTrialRef.current; solidDiagnosticTrialRef.current = null;
        if (!trial || sessionIdRef.current !== trial.sessionId) return;
        const latest = diagnosticLastEegRef.current;
        return clientRef.current.command("stimulus_marker", { markerType: "stimulus_end", ...trial,
          trialKind: "timing_diagnostic",
          lastEegAgeMs: latest && latest.sessionId === trial.sessionId ? Math.max(0, performance.now() - latest.receivedAt) : null,
          rendererCallbackDelayMs: Math.max(0, performance.now() - frameStats.lastFramePerformanceMs),
          rendererPerformanceMs: frameStats.lastFramePerformanceMs,
          durationMs: frameStats.lastFramePerformanceMs - frameStats.firstFramePerformanceMs,
          endReason, ...frameStats }).then(() => {}).catch(cause => { setError((cause as Error).message); throw cause; });
      }} />
    </section>}
    </>}
    {appView === "lab" && labWorkspace === "experiment" && <article className="experiment-card lab-experiment-workspace">
      <div className="experiment-toolbar"><div><p className="eyebrow">实验工具</p><h2>校准与在线识别</h2></div>
      <div className="trial-status"><span>{trialStage} · {displayRefreshRateHz ? `${displayRefreshRateHz} Hz` : "检测刷新率"}</span><strong>{calibrationCue ?? trialResult}</strong></div>
      <button onClick={runTrial} disabled={!acquiring || trialStage !== "ready" || !displayRefreshRateHz}>运行一次试次</button></div>
      <StimulusTable active={trialStage === "stimulus"} dealing={trialStage === "dealing"} targets={visualTargets} activeTargetIndex={isolatedTargetIndex} referenceLabel={referenceLabel}
        referenceY={SIMPLE_STIMULUS_GEOMETRY.referenceY} refreshRateHz={displayRefreshRateHz ?? 60}
        onFirstFrame={onStimulusFirstFrame} onFrameStats={onStimulusFrameStats} onDealComplete={resolveDealComplete}
        onResizeWhileActive={() => cancelLabTrialForDisplay()}
        onTimingFault={() => cancelLabTrialForDisplay("dropped_frame", "刺激出现丢帧，本次试次无效，请重做")}
        onTargetClick={undefined} />
      <p className="stimulus-note">静止牌面 · 牌后正弦光带 · 最长 {GAME_STIMULUS_MS} ms · 实际首帧发送 marker · 刷新率预检驱动</p>
      <div className="calibration-bar"><div><strong>快速校准（链路检查）</strong><span>左 {calibrationProgress.counts[0]}/2 · 右 {calibrationProgress.counts[1]}/2 · {modelStatus}</span></div>
        <button className="secondary" onClick={runCalibrationTrial} disabled={!acquiring || trialStage !== "ready"}>采集下一校准样本</button>
        <button onClick={trainModel} disabled={!acquiring || modelSaving || trialStage !== "ready" || calibrationProgress.counts.some((count) => count < 2)}>{modelSaving ? "正在保存模型" : "训练 eTRCA"}</button></div>
      <div className="calibration-bar"><div><strong>单目标隔离诊断</strong><span>随机平衡序列 · 左 {diagnosticProgress[0]}/4 · 右 {diagnosticProgress[1]}/4 · 仅被提示目标闪烁，不进入 eTRCA</span></div>
        <button className="secondary" onClick={runIsolatedDiagnosticTrial} disabled={!acquiring || trialStage !== "ready" || diagnosticProgress.every((count) => count >= 4)}>采集下一单目标测试</button>
        <span>{diagnosticProgress.every((count) => count >= 4) ? "8 次已完成" : "共需 8 次"}</span></div>
    </article>}
    {appView === "teaching" && <article className={`teaching-panel teaching-panel--${teachingWorkspace} ${teachingActive ? "teaching-live" : ""}`}>
      <TeachingWorkspaceNav current={teachingWorkspace} disabled={teachingActive || teachingPreparing || roundState.active} onSelect={selectTeachingWorkspace} />

      <section id="teaching-course-workspace" className="teaching-workspace-panel teaching-course-workspace" role="tabpanel" tabIndex={-1} aria-label="课程学习工作区" hidden={teachingWorkspace !== "course"}>
        <TeachingCourseNav courses={teachingCourses} currentId={teachingCourseId} completed={completedTeachingCourses} disabled={teachingActive}
          onSelect={selectTeachingCourse} />
        <TeachingLesson course={currentTeachingCourse} completed={completedTeachingCourses.has(teachingCourseId)} onComplete={completeTeachingCourse} onSelectCourse={selectTeachingCourse}
          frequencyPreview={teachingPreviewFrequency} onFrequencyPreview={setTeachingPreviewFrequency}
          harmonicFrequency={teachingHarmonicFrequency} onHarmonicFrequencyChange={setTeachingHarmonicFrequency}
          targetCount={teachingTargetCount} onTargetPreset={applyTeachingTargetPreset}
          feedbackCase={teachingFeedbackCase} onFeedbackCaseChange={setTeachingFeedbackCase}
          onNoiseScenario={applyNoiseTeachingScenario} onSimulationScenario={applyAdvancedSimulationScenario} onGoToSimulation={goToPrincipleDemo} locked={teachingActive} />
      </section>

      <div className={`training-top ${teachingMode === "principle" ? "training-top--principle" : ""}`} hidden={teachingWorkspace !== "run"}>
        <div className="teaching-switch"><div className="teaching-segmented teaching-segmented--modes" style={{ "--segment-count": 2 } as CSSProperties}>
          <span className="teaching-segmented__indicator" aria-hidden="true" style={{ transform: `translateX(${teachingMode === "principle" ? 0 : 100}%)` }} />
          <button aria-current={teachingMode === "principle" ? "page" : undefined} onClick={() => changeTeachingMode("principle")} disabled={teachingActive || teachingPreparing || roundState.active}>原理演示</button>
          <button aria-current={teachingMode === "operation" ? "page" : undefined} onClick={() => changeTeachingMode("operation")} disabled={teachingActive || teachingPreparing || roundState.active}>操作训练</button></div></div>
        <details key={`settings-${teachingMode}`} className="teaching-settings-details" open={teachingMode === "principle" ? true : undefined}>
          <summary aria-disabled={teachingActive || teachingPreparing || roundState.active} onClick={(event) => { if (teachingActive || teachingPreparing || roundState.active) event.preventDefault(); }} title={teachingActive ? "训练期间保持布局稳定，停止后可展开参数。" : undefined}>{teachingMode === "principle" ? "演示控制" : "刺激参数"}</summary>
        <div className="teaching-settings">
          {teachingTargets.map((target, index) => <label key={target.id}>{target.label} 频率
            <input type="number" min="6" max="30" step="0.5" value={target.frequencyHz}
              onChange={(event) => updateTeachingFrequency(index, Number(event.target.value))} disabled={teachingActive || teachingPreparing || roundState.active} /> Hz</label>)}
          <label>目标数量 <select value={teachingMode === "operation" ? operationTargetCount : teachingTargetCount} onChange={(event) => { const count = Number(event.target.value); if (teachingMode === "operation") { setOperationTargetCount(count); if (count !== 2 && (singleStimulusMode === "LEFT_ONLY" || singleStimulusMode === "RIGHT_ONLY")) setSingleStimulusMode("TARGET_ONLY"); } else setTeachingTargetCount(count); }} disabled={teachingActive || teachingPreparing || roundState.active}><option value={2}>2 个</option><option value={3}>3 个</option><option value={4}>4 个</option></select></label>
          {teachingMode === "operation" && <>
            <label>单试次刺激 <select aria-label="单试次刺激条件" value={singleStimulusMode} disabled={teachingActive || teachingPreparing || roundState.active} onChange={event => setSingleStimulusMode(event.target.value as typeof singleStimulusMode)}><option value="TARGET_ONLY">目标单闪</option>{operationTargetCount === 2 && <><option value="LEFT_ONLY">左牌单闪</option><option value="RIGHT_ONLY">右牌单闪</option></>}<option value="BOTH">同时闪烁</option></select></label>
            {singleStimulusMode === "BOTH" && <label>注视目标 <select aria-label="单试次注视目标" value={Math.min(singleTarget, operationTargetCount - 1)} disabled={teachingActive || teachingPreparing || roundState.active} onChange={event => setSingleTarget(Number(event.target.value))}>{teachingTargets.map((target, index) => <option key={target.id} value={index}>{target.label}</option>)}</select></label>}
          </>}
          {teachingMode === "principle" && <label>观察目标 <select value={teachingActiveTargetIndex ?? "all"} onChange={(event) => setTeachingActiveTargetIndex(event.target.value === "all" ? null : Number(event.target.value))} disabled={teachingActive}><option value="all">全部目标</option>{teachingTargets.map((target, index) => <option key={target.id} value={index}>{target.label} · {target.frequencyHz} Hz</option>)}</select></label>}
         </div>
        </details>
        <TrainingControlBar key={`control-${teachingMode}`} mode={teachingMode} countdown={trainingCountdown} trial={teachingTrialNumber} realEeg={teachingUsesRealEeg} running={teachingActive} preparing={teachingPreparing} result={teachingResult} error={error}>
          {teachingMode === "operation" && roundState.active ? <>
            <button onClick={() => roundState.paused ? roundRef.current?.resume() : roundRef.current?.pause()}>{roundState.paused ? "恢复训练" : "暂停训练"}</button>
            <button className="secondary" onClick={() => { roundRef.current?.stop(); setTeachingResult("训练已结束"); }}>结束本轮</button>
          </> : <>
          <button disabled={teachingPreparing} onClick={teachingActive ? () => finishTeaching(teachingMode === "principle" ? "演示已暂停" : "训练已暂停") : startTeachingStimulus}>{teachingPreparing ? trainingCountdown ? `${trainingCountdown} 秒后开始` : "正在检查显示…" : teachingActive ? teachingMode === "principle" ? "停止演示" : "停止训练" : teachingMode === "principle" ? "开始原理演示" : roundState.phase === "ROUND_COMPLETE" ? "开始单试次" : teachingTrialNumber ? "下一试次" : "开始操作训练"}</button>
            {teachingMode === "operation" && <button className="secondary" onClick={startOperationRound} disabled={teachingActive || teachingPreparing || operationTargetCount !== 2} title={operationTargetCount !== 2 ? "完整轮次使用两张牌，请将目标数量设为 2 个" : "左单闪、右单闪、同时闪看左、同时闪看右"}>{roundState.phase === "ROUND_COMPLETE" ? "再来一轮" : "开始完整轮次"}</button>}
          </>}

        </TrainingControlBar>
      </div>
      <div className={`teaching-run-layout ${teachingRunIsPrinciple ? "principle-demo-layout" : teachingRunIsOperation ? "operation-focus-layout" : ""}`}>
      <section id="teaching-run-workspace" className="teaching-workspace-panel teaching-run-workspace" role="tabpanel" aria-label="演示与训练工作区" tabIndex={-1} hidden={teachingWorkspace !== "run"}>
        <div className={`stimulus-stage ${teachingRunIsOperation && roundState.phase === "ROUND_COMPLETE" ? "stimulus-stage--results" : ""}`} aria-label="训练刺激主区域">
        <StimulusTable active={teachingActive} targets={teachingTargets} activeTargetIndex={teachingMode === "operation" ? operationStimulusIndex : teachingActiveTargetIndex}
          targetSize={teachingRunIsPrinciple ? "teaching-fill" : "standard"}
          onGeometryChange={snapshot => { teachingGeometryRef.current = snapshot; }}
          referenceLabel="9♠" referenceY={TEACHING_REFERENCE_Y} showReference={false} compactCards={false} showFrequencyLabels refreshRateHz={displayRefreshRateHz ?? 60} onFirstFrame={onTeachingFirstFrame} onFrameStats={onTeachingFrameStats}
          onResizeWhileActive={() => { if (teachingActive) finishTeaching("显示环境已变化，请重新开始", "display_environment_changed"); }}
          onTimingDisruption={onTeachingTimingDisruption}
          onTimingFault={() => { if (teachingActive && teachingHasActiveEegSession) finishTeaching("刺激严重或持续丢帧，本次试次已停止", "dropped_frame"); }}
          onTargetClick={undefined} />
        {teachingRunIsOperation && roundState.phase !== "ROUND_COMPLETE" && <OperationTrainingStatus trial={teachingTrialNumber} preparing={teachingPreparing} countdown={trainingCountdown} running={teachingActive}
          target={teachingCueIndex === null ? null : teachingTargets[teachingCueIndex]?.label ?? null}
          recognizedTarget={teachingDecision?.candidateIndex == null || teachingDecision.rejected ? null : teachingTargets[teachingDecision.candidateIndex]?.label ?? null}
          result={teachingResult} error={error} round={roundState} />}
        {teachingRunIsOperation && roundState.phase === "ROUND_COMPLETE" && <OperationRoundResults round={roundState} onRestart={startOperationRound} onClose={() => { roundRef.current?.reset(); setTeachingResult("准备就绪"); }} />}
        </div>

      </section>

      <aside className={`teaching-run-side ${teachingRunIsPrinciple ? "principle-demo-side" : "teaching-run-side--observe"}`} aria-label="分析区域" hidden={!teachingRunIsPrinciple && teachingWorkspace !== "observe"}>
        {teachingRunIsPrinciple && <RealPrincipleAnalysis analysis={teachingAnalysis} labels={teachingTargets.map(target => target.label)} targetFrequencies={teachingTargets.filter((_, index) => teachingActiveTargetIndex === null || teachingActiveTargetIndex === index).map(target => target.frequencyHz)} connected={connected} acquiring={acquiring && Boolean(activeSessionId)} running={teachingActive} progress={teachingAnalysisProgress} notice={teachingResult} />}
        <section id="teaching-observe-workspace" className="teaching-workspace-panel teaching-observe-workspace" role="tabpanel" aria-label="信号观察工作区" tabIndex={-1} hidden={teachingWorkspace !== "observe"}>
          <div className="teaching-analysis-toolbar">
            <span className="real-eeg-source-title">实时网关 EEG</span>
            <div className="teaching-analysis-toolbar__actions" ref={setAnalysisActionsTarget} />
          </div>
          <RealEegAnalysisPanel actionsTarget={teachingWorkspace === "observe" ? analysisActionsTarget : null} active={teachingRealAnalysisVisible && teachingHasActiveEegSession} visible={teachingRealAnalysisVisible} activeSessionId={activeSessionId} acquiring={acquiring} properties={properties} chunkTapRef={realEegTapRef} onGoToLab={() => setAppView("lab")} />
        </section>
      </aside>
      </div>
    </article>}
    {appView === "game" && <section className={`game-workspace ${gameRunning || gameFinished ? "game-focus" : ""} ${gameRunning ? "game-live" : ""}`} aria-label="游戏工作区">
      {!gameRunning && !gameFinished && <div className="game-console game-console--setup" aria-label="游戏控制台">
        <div className="game-console__settings">
          <ThemedDropdown compact className="game-console__field" theme="dark" label="难度" ariaLabel="游戏难度" menuLabel="游戏难度选项"
            value={gameMode} onChange={selectGameMode} options={[{ value: "simple", label: "简单" }, { value: "difficult1", label: "进阶" }, { value: "difficult2", label: "困难" }]} />
          <ThemedDropdown compact className="game-console__field" theme="dark" label="局长" ariaLabel="游戏局长" menuLabel="游戏局长选项"
            value={String(selectedGameLength)} onChange={(value) => setSelectedGameLength(Number(value))} disabled={restSeconds > 0}
            options={[{ value: "10", label: "10 轮" }, { value: "15", label: "15 轮" }]} />
        </div>
        <div className="game-console__actions">
          <button className="game-console__primary" onClick={openGameRules} disabled={restSeconds > 0}>开始本局</button>
          <button className="secondary game-console__rules" onClick={openGameRules}>规则</button>
          {restSeconds > 0 && <small role="status">休息 {restSeconds} 秒</small>}
        </div>
      </div>}
      <article className="experiment-card table-only game-table-card">
        <div className="game-table-frame">
          <StimulusTable surface="game" active={trialStage === "stimulus"} dealing={trialStage === "dealing"} targets={gameVisualTargets} activeTargetIndex={null}
            stimulusStartTimestamp={gameOnsetMs} stimulusEndTimestamp={gameOnsetMs === undefined ? undefined : gameOnsetMs + GAME_STIMULUS_MS} selectedTargetIndex={trialStage === "feedback" ? gameSelectedIndex : null} showReference referenceLabel={referenceLabel}
            referenceX={gameStimulusTemplateForMode(gameMode).referenceX} referenceY={gameStimulusTemplateForMode(gameMode).referenceY} referenceTag={gameMode === "difficult2" ? "参考牌" : undefined} refreshRateHz={displayRefreshRateHz ?? 60}
            modulationDepth={1}
            onFrameStats={onGameFrameStats} onDealComplete={resolveDealComplete}
            onTimingDisruption={onGameTimingDisruption} onTimingFault={() => cancelGameTrialForDisplay("刺激严重或持续丢帧，本轮已取消")}
            onResizeWhileActive={() => cancelGameTrialForDisplay()}
            onTargetClick={undefined} />
          {(gameRunning || gameFinished) && <GameTableHud mode={gameMode} round={gameRoundNumber} length={gameLength} score={gameScore} streak={gameStreak}
            status={gameConsoleStatus} countdown={gameCountdown} finished={gameFinished} correct={gameCorrect} incorrect={gameIncorrect} rejected={gameUncertain} restSeconds={restSeconds}
            feedback={trialStage === "feedback" ? trialResult : null} selectedLabel={gameSelectedIndex !== null && gameRound ? cardLabel(gameRound.candidates[gameSelectedIndex]) : null}
            onExit={exitEegGame} onReplay={openGameRules} onNextMode={recommendNextGame} />}
        </div>
      </article>
      {rulesOpen && <div className="game-modal-backdrop" role="presentation"><section className="game-modal game-rules-modal" role="dialog" aria-modal="true" aria-labelledby="game-rules-title" aria-describedby="game-rules-description" tabIndex={-1} ref={(element) => { modalRef.current = element; }}>
        <div className="game-modal__header"><h2 id="game-rules-title">{GAME_PRESENTATION[gameMode].name}</h2><span>{GAME_PRESENTATION[gameMode].count} 张候选牌</span></div>
        <div className="game-modal__body">
          <h3>玩法</h3><p id="game-rules-description">{GAME_PRESENTATION[gameMode].rule}</p>
          <h3>选择方式</h3><p>请注视目标牌，系统使用真实 EEG + FBCCA 完成选牌。</p>
          <h3>识别失败</h3><p>未确定 / 拒识时，保留本轮手牌并自动重新尝试。</p>
          <details><summary>注意事项</summary><p>如出现头痛、眩晕、恶心或视觉不适，请退出本局并休息。</p></details>
          {restSeconds > 0 && <small>休息 {restSeconds} 秒后可开始</small>}
          <div className="game-modal__actions"><button className="secondary" onClick={() => { setRulesOpen(false); setGameFinished(false); }}>返回调整</button>
            <button onClick={() => startEegGame(selectedGameLength)} disabled={restSeconds > 0}>开始本局</button></div>
        </div>
      </section></div>}
    </section>}
  </section></main>;
}

function Startup() {
  const [entered, setEntered] = useState(() => !shouldPlayIntro());
  const [mainReady, setMainReady] = useState(entered);
  return <>
    {mainReady && <div className="startup-main" inert={!entered} aria-hidden={!entered}><App /></div>}
    {!entered && <IntroFlipAnimation onReveal={() => setMainReady(true)} onComplete={() => setEntered(true)} />}
  </>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><Startup /></StrictMode>);
