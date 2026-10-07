import type { CSSProperties } from "react";

export type TeachingWorkspace = "course" | "observe" | "run";

interface Props {
  current: TeachingWorkspace;
  disabled?: boolean;
  onSelect: (workspace: TeachingWorkspace) => void;
}

const items: Array<{ id: TeachingWorkspace; label: string }> = [
  { id: "course", label: "课程学习" },
  { id: "observe", label: "信号观察" },
  { id: "run", label: "演示与训练" },
];

export function TeachingWorkspaceNav({ current, disabled = false, onSelect }: Props) {
  return <nav className="teaching-workspace-nav" aria-label="教学工作区">
    <div className="teaching-segmented" style={{ "--segment-count": 3 } as CSSProperties}>
    <span className="teaching-segmented__indicator" aria-hidden="true" style={{ transform: `translateX(${items.findIndex(item => item.id === current) * 100}%)` }} />
    {items.map((item) => <button
      key={item.id}
      type="button"
      aria-current={current === item.id ? "page" : undefined}
      aria-controls={`teaching-${item.id}-workspace`}
      className={current === item.id ? "" : "secondary"}
      disabled={disabled}
      onClick={() => onSelect(item.id)}
    >
      <span>{item.label}</span>
    </button>)}
    </div>
  </nav>;
}
