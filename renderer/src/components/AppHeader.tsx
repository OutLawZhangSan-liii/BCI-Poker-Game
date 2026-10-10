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
      <img className="app-header__icon" src={`${import.meta.env.BASE_URL}assets/branding/neuron-icon.png`} alt="" draggable={false} />
      <div className="app-header__brand">
        <h1 className="app-header__title"><BrandWordmark /></h1>
      </div>
    </div>
    {navigation}
    <div className="app-header__status" aria-label="系统状态摘要">{status}</div>
  </header>;
}
