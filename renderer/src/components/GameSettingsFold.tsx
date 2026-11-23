import { SettingsFold, foldChoices } from "./SettingsFold";
import type { GameMode } from "../game/engine";
import { GAME_PRESENTATION } from "../game/presentation";

export function GameSettingsFold({ mode, length, lengthDisabled, onMode, onLength }: {
  mode: GameMode; length: number; lengthDisabled: boolean;
  onMode: (mode: GameMode) => void; onLength: (length: number) => void;
}) {
  return <SettingsFold scope="游戏" rows={[
    { key: "mode", label: "难度", choices: foldChoices<GameMode>(["simple", "difficult1", "difficult2"], mode, v => GAME_PRESENTATION[v].name, onMode) },
    { key: "length", label: "局长", disabled: lengthDisabled, choices: foldChoices([10, 15], length, v => `${v} 轮`, onLength) },
  ]} />;
}
