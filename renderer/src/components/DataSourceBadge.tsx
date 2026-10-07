export type DataSource = "simulated" | "real-eeg" | "renderer-stats" | "fixed-example";

const sourceLabels: Record<DataSource, string> = {
  simulated: "模拟数据",
  "real-eeg": "实时 EEG",
  "renderer-stats": "实际渲染统计",
  "fixed-example": "固定示意",
};

interface DataSourceBadgeProps {
  source: DataSource;
}

export function DataSourceBadge({ source }: DataSourceBadgeProps) {
  return <StatusBadge value={sourceLabels[source]} tone={source === "real-eeg" ? "success" : "neutral"}
    hint={source === "simulated" ? "合成教学信号与鼠标模拟，未使用真实 EEG。" : source === "real-eeg" ? "来自当前采集会话的 EEG 数据。" : source === "renderer-stats" ? "浏览器绘制回调的统计结果，不是屏幕发光时序测量。" : "固定教学示意，不随采集更新。"} />;
}
import { StatusBadge } from "./StatusBadge";
