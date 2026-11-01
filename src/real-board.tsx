import { useState } from "react";
import { tileLabel } from "./demo";
import type { Scene } from "./real-types";
import { TileArt } from "./tile-art";
export const uiTile = (value: string) => {
  const honor = ["E", "S", "W", "N", "P", "F", "C"].indexOf(value);
  return honor >= 0
    ? `${honor + 1}z`
    : value.endsWith("r")
      ? `0${value[1]}`
      : value;
};
const wind = (value: string) =>
  ({ E: "東", S: "南", W: "西", N: "北" })[value] ?? value;
export const roundLabel = (scene: Scene) =>
  `${wind(scene.bakaze)}${scene.kyoku}局 ${scene.honba}本場`;
export function RealTile({
  value,
  small = false,
}: {
  value: string;
  small?: boolean;
}) {
  const tile = uiTile(value);
  return (
    <span
      className={`tile ${small ? "small" : ""} suit-${tile[1]} ${tile[0] === "0" ? "red" : ""}`}
      aria-label={tileLabel(tile)}
      role="img"
    >
      <TileArt tile={tile} />
    </span>
  );
}
export const eventLabels: Record<string, string> = {
  start_kyoku: "配牌",
  tsumo: "ツモ",
  dahai: "打牌",
  chi: "チー",
  pon: "ポン",
  daiminkan: "大明槓",
  ankan: "暗槓",
  kakan: "加槓",
  reach: "リーチ宣言",
  reach_accepted: "リーチ成立",
  dora: "ドラ追加",
};

export function RealTable({
  scene,
  interactive = false,
  selected = null,
  onSelect,
}: {
  scene: Scene;
  interactive?: boolean;
  selected?: string | null;
  onSelect?: (value: string) => void;
}) {
  const [chosenIndex, setChosenIndex] = useState<number | null>(null);
  const hand = [...scene.own_hand];
  if (scene.drawn) hand.splice(hand.lastIndexOf(scene.drawn), 1);
  const order = (t: string) => {
    const v = uiTile(t);
    return "mpsz".indexOf(v[1]) * 10 + (v[0] === "0" ? 5 : Number(v[0]));
  };
  hand.sort((a, b) => order(a) - order(b));
  const tiles = [...hand, ...(scene.drawn ? [scene.drawn] : [])];
  const selectedIndex =
    chosenIndex !== null && tiles[chosenIndex] === selected
      ? chosenIndex
      : tiles.indexOf(selected ?? "");
  const own = scene.seat;
  return (
    <div className="table-wrap real-board">
      <div className="table" aria-label={`${roundLabel(scene)}の卓`}>
        {[0, 1, 2, 3].map((position) => {
          const seat = (own + position - 2 + 4) % 4;
          const label = ["対面", "上家", "あなた", "下家"][position];
          const seatWind = ["東", "南", "西", "北"][
            (seat - (scene.kyoku - 1) + 4) % 4
          ];
          return (
            <div
              className={`player player-${position}`}
              key={seat}
              data-seat={seat}
            >
              <div className="player-label">
                <b>
                  {label} · {seatWind}
                </b>
                <span>
                  {scene.scores[seat].toLocaleString()}
                  {scene.reach_declared[seat] ? " · リーチ" : ""}
                </span>
              </div>
              <div
                className="river"
                aria-label={`${position === 2 ? "自分" : label}の河`}
              >
                {scene.rivers[seat].map((r, i) => (
                  <span
                    key={i}
                    className={`${r.called ? "called" : ""} ${r.reach ? "reach-tile" : ""}`}
                    title={
                      r.called
                        ? "副露された牌"
                        : r.reach
                          ? "リーチ宣言牌"
                          : undefined
                    }
                  >
                    <RealTile value={r.tile} small />
                  </span>
                ))}
              </div>
            </div>
          );
        })}
        <div className="table-center">
          <span>
            {wind(scene.bakaze)}
            {scene.kyoku}局
          </span>
          <strong>
            {scene.source_discard_index +
              (scene.actual || scene.is_decision ? 1 : 0)}
            <small>打目</small>
          </strong>
          <div>
            {scene.honba}本場 · 供託{scene.kyotaku}
          </div>
          <div className="dora">
            ドラ表示{" "}
            {scene.dora_markers.map((t, i) => (
              <RealTile value={t} small key={i} />
            ))}
          </div>
        </div>
      </div>
      {scene.melds.some((m) => m.length > 0) && (
        <div className="public-melds" aria-label="公開された副露">
          {[0, 1, 2, 3].map((position) => {
            const seat = (own + position - 2 + 4) % 4;
            const label = ["対面", "上家", "あなた", "下家"][position];
            return (
              scene.melds[seat].length > 0 && (
                <div className="public-meld-row" key={seat}>
                  <b>{label}</b>
                  <div className="melds" aria-label={`${label}の副露`}>
                    {scene.melds[seat].map((m, i) => (
                      <div className="meld" key={i}>
                        <small>
                          {eventLabels[m.type]}
                          {m.target !== undefined
                            ? `・${(m.target - seat + 4) % 4 === 1 ? "下家" : (m.target - seat + 4) % 4 === 2 ? "対面" : "上家"}から`
                            : ""}
                        </small>
                        <span>
                          {[
                            ...m.consumed,
                            ...(m.tile ? [m.tile] : []),
                            ...(m.added ? [m.added] : []),
                          ].map((t, n) => (
                            <RealTile key={n} value={t} small />
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            );
          })}
        </div>
      )}
      <div className="hand-head">
        <span>あなた · {wind(scene.own_wind)}家</span>
        <span>
          {scene.melds[own].length > 0 && `${scene.melds[own].length}副露`}
          {scene.melds[own].length > 0 && scene.reach_declared[own] && " · "}
          {scene.reach_declared[own] && "リーチ"}
        </span>
      </div>
      <div
        className={`hand ${interactive ? "playable" : ""}`}
        data-testid="real-hand"
        aria-label="自分の手牌"
      >
        {tiles.map((t, i) =>
          interactive ? (
            <button
              key={i}
              className={`tile-choice ${selectedIndex === i ? "selected" : ""} ${scene.drawn && i === tiles.length - 1 ? "drawn" : ""}`}
              aria-label={`${i + 1}枚目 ${tileLabel(uiTile(t))}`}
              aria-pressed={selectedIndex === i}
              onClick={() => {
                setChosenIndex(i);
                onSelect?.(t);
              }}
            >
              <RealTile value={t} />
            </button>
          ) : (
            <span
              key={i}
              className={scene.drawn && i === tiles.length - 1 ? "drawn" : ""}
            >
              <RealTile value={t} />
            </span>
          ),
        )}
      </div>
    </div>
  );
}
