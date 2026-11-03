import { useEffect, useState } from "react";
export type AnswerMode = "button" | "select" | "repeat";
const key = "kyokuloop-answer-mode";
const change = "kyokuloop-study-options";
const modes: [AnswerMode, string][] = [
  ["button", "回答ボタンで決定"],
  ["select", "牌を選択した時点で決定"],
  ["repeat", "選択中の牌をもう一度タップして決定"],
];
function read(): AnswerMode {
  try {
    const value = localStorage.getItem(key);
    return modes.some(([m]) => m === value) ? (value as AnswerMode) : "button";
  } catch {
    return "button";
  }
}
export function useAnswerMode() {
  const [mode, setMode] = useState<AnswerMode>(read);
  useEffect(() => {
    const refresh = () => setMode(read());
    window.addEventListener(change, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(change, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return mode;
}
export function StudyOptions() {
  const mode = useAnswerMode();
  const [error, setError] = useState("");
  return (
    <details className="study-options">
      <summary>学習の設定</summary>
      <fieldset>
        <legend>回答の確定方法</legend>
        {modes.map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="answer-mode"
              value={value}
              checked={mode === value}
              onChange={() => {
                try {
                  localStorage.setItem(key, value);
                  window.dispatchEvent(new Event(change));
                  setError("");
                } catch {
                  setError(
                    "設定を保存できませんでした。現在の設定を保持しています。",
                  );
                }
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <small>この端末で使う方法を選べます。確定後も回答を選び直せます。</small>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
