import type { ReactNode } from "react";

export type AppTab = "study" | "replays" | "settings";
export function AppHeader({ children }: { children: ReactNode }) {
  return (
    <header className="phone-header">
      <b>KyokuLoop</b>
      {children}
    </header>
  );
}
export function AppNavigation({
  screen,
  disabled,
  inert,
  onChange,
}: {
  screen: AppTab;
  disabled: boolean;
  inert?: boolean;
  onChange: (tab: AppTab) => void;
}) {
  return (
    <nav inert={inert} className="phone-nav" aria-label="メイン">
      {(
        [
          ["study", "学習"],
          ["replays", "牌譜"],
          ["settings", "設定"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          disabled={disabled}
          aria-current={screen === id ? "page" : undefined}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
