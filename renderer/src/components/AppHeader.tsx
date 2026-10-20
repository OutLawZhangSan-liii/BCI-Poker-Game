import type { ReactNode } from "react";
import { BrandWordmark } from "./BrandWordmark";
import "./AppHeader.css";

interface AppHeaderProps {
  title: string;
  navigation: ReactNode;
  status: ReactNode;
}

export function AppHeader({ title, navigation, status }: AppHeaderProps) {
  return <header className="app-header app-header--window" aria-label={title}>
    <div className="app-header__identity">
      <svg className="app-header__icon" viewBox="0 0 1280 1280" aria-hidden="true"><defs><mask id="header-neuron" style={{ maskType: "luminance" }}><image href={`${import.meta.env.BASE_URL}assets/branding/neuron-icon.png`} width="1280" height="1280" /></mask></defs><rect width="1280" height="1280" fill="currentColor" mask="url(#header-neuron)" /></svg>
      <div className="app-header__brand">
        <h1 className="app-header__title"><BrandWordmark /></h1>
      </div>
    </div>
    {navigation}
    <div className="app-header__status" aria-label="系统状态摘要">{status}</div>
  </header>;
}
