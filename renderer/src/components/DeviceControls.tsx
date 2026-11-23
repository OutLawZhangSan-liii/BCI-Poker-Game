import { useLayoutEffect, useRef } from "react";
import { StatusBadge } from "./StatusBadge";
import "./DeviceControls.css";

export type DeviceAction = "gateway" | "connect" | "start" | "stop";

interface DeviceControlsProps {
  id: string;
  workspace: string;
  gatewayStatus: GatewayStatus;
  connected: boolean;
  acquiring: boolean;
  locked: boolean;
  modelSaving: boolean;
  pending: DeviceAction | null;
  error: string | null;
  onStartGateway: () => void;
  onConnect: () => void;
  onStart: () => void;
  onStop: () => void;
  onDiagnostics: () => void;
}

const gatewayLabels: Record<GatewayStatus, string> = {
  starting: "启动中",
  ready: "已就绪",
  faulted: "启动异常",
  stopping: "停止中",
  stopped: "未启动",
};

export function DeviceControls({
  id, workspace, gatewayStatus, connected, acquiring, locked, modelSaving, pending, error,
  onStartGateway, onConnect, onStart, onStop, onDiagnostics,
}: DeviceControlsProps) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { panel.current?.hidePopover(); }, [workspace, locked]);

  const gatewayBusy = pending === "gateway" || gatewayStatus === "starting" || gatewayStatus === "stopping";
  const gatewayValue = pending === "gateway" && gatewayStatus !== "stopping" ? "启动中" : gatewayLabels[gatewayStatus];
  const connectionValue = connected ? "已连接" : pending === "connect" ? "连接中" : "未连接";
  const acquisitionValue = pending === "start" ? "启动中" : pending === "stop" ? "停止中" : acquiring ? "进行中" : "未采集";
  const gatewayTone = gatewayBusy ? "warning" : gatewayStatus === "faulted" ? "danger" : gatewayStatus === "ready" ? "success" : "neutral";
  const deviceTone = connected ? "success" : pending === "connect" ? "warning" : "neutral";
  const acquisitionTone = pending === "start" || pending === "stop" ? "warning" : acquiring ? "success" : "neutral";
  const actionBlocked = locked || pending !== null;

  return <>
    <button type="button" className="app-header__action device-controls__trigger" aria-current={workspace === "lab" ? "true" : undefined} disabled={locked} popoverTarget={id}>
      <span>设备</span>
      <svg className="device-controls__chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg>
    </button>
    <div id={id} className="device-controls__panel" popover="auto" role="region" aria-label="设备连接与采集" ref={panel}>
      <div className="device-controls__heading">
        <h2>设备连接</h2>
        <button type="button" className="device-controls__close" popoverTarget={id} popoverTargetAction="hide" aria-label="关闭设备面板">×</button>
      </div>
      <div className="device-controls__steps">
        <div className="device-controls__step" data-tone={gatewayTone}>
          <StatusBadge label="网关" value={gatewayValue} tone={gatewayTone} />
          {(gatewayStatus === "stopped" || gatewayStatus === "faulted" || pending === "gateway") &&
            <button type="button" onClick={onStartGateway} disabled={actionBlocked || gatewayBusy}>
              {gatewayStatus === "faulted" ? "重试启动" : "开启网关"}
            </button>}
        </div>
        <div className="device-controls__step" data-tone={deviceTone}>
          <StatusBadge label="设备" value={connectionValue} tone={deviceTone} />
          {!connected && <button type="button" onClick={onConnect} disabled={actionBlocked || gatewayStatus !== "ready"}>连接设备</button>}
        </div>
        <div className="device-controls__step" data-tone={acquisitionTone}>
          <StatusBadge label="采集" value={acquisitionValue} tone={acquisitionTone} />
          <button type="button" onClick={acquiring ? onStop : onStart}
            disabled={actionBlocked || !connected || (acquiring && modelSaving)}>
            {acquiring ? "停止采集" : "开始采集"}
          </button>
        </div>
      </div>
      {error && <p className="device-controls__error" role="alert">{error}</p>}
      <div className="device-controls__footer">
        <button type="button" disabled={actionBlocked} onClick={() => { panel.current?.hidePopover(); onDiagnostics(); }}>
          设备与诊断 <span aria-hidden="true">↗</span>
        </button>
      </div>
    </div>
  </>;
}
