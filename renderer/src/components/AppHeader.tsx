import type { ReactNode } from "react";

interface AppHeaderProps {
  title: string;
  navigation: ReactNode;
  status: ReactNode;
}

export function AppHeader({ title, navigation, status }: AppHeaderProps) {
  return <header className="app-header">
    <div className="app-header__identity">
      <h1 className="app-header__title">{title}</h1>
    </div>
    {navigation}
    <div className="app-header__status" aria-label="系统状态摘要">{status}</div>
  </header>;
}
