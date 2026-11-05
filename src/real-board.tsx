import { useState, useRef, useLayoutEffect, type ReactNode } from "react";
import { api } from "./api";
import { tileLabel } from "./demo";
import type { Scene, Meld } from "./real-types";
import { TileArt } from "./tile-art";
import { tileOrder, sortedTiles } from "./tile-order";
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

export function DiscardRiver({
  tiles,
  label,
}: {
  tiles: Scene["rivers"][number];
  label: string;
}) {
  // Each seat's local coordinates: six across twice, then extend row three.
  const rows = [tiles.slice(0, 6), tiles.slice(6, 12), tiles.slice(12)];
  return (
    <div className="river" aria-label={label}>
      {rows.map((row, index) => (
        <div className="river-row" key={index}>
          {row.map((r, i) => (
            <span
              key={i}
              className={`river-discard${r.called ? " called" : ""}${r.reach ? " reach-tile" : ""}`}
              title={
                r.called ? "副露された牌" : r.reach ? "リーチ宣言牌" : undefined
              }
            >
              <RealTile value={r.tile} small />
            </span>
          ))}
        </div>
      ))}
    </div>
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

const seatNames = ["対面", "上家", "自分", "下家"];
function TileBack() {
  return <span className="tile tile-back" role="img" aria-label="裏向きの牌" />;
}

export function MeldTiles({ meld, seat }: { meld: Meld; seat: number }) {
  const concealed = meld.type === "ankan";
  const values = [...meld.consumed].sort((a, b) => tileOrder(a) - tileOrder(b));
  // Keep a red five visible when the two outside tiles of a concealed kan turn over.
  if (concealed) {
    const red = values.findIndex((t) => uiTile(t)[0] === "0");
    if (red === 0 || red === values.length - 1)
      values.splice(1, 0, values.splice(red, 1)[0]);
  }
  const relative = meld.target === undefined ? 0 : (meld.target - seat + 4) % 4;
  const sideways = !concealed && relative !== 0 && !!meld.tile;
  const calledIndex = sideways
    ? relative === 3
      ? 0
      : relative === 2
        ? 1
        : values.length
    : -1;
  if (meld.tile)
    values.splice(sideways ? calledIndex : values.length, 0, meld.tile);
  if (meld.added && !sideways) values.push(meld.added);
  const from =
    relative === 3
      ? "上家"
      : relative === 2
        ? "対面"
        : relative === 1
          ? "下家"
          : "鳴き元不明";
  return (
    <div
      className={`meld${concealed ? " concealed-kan" : ""}`}
      data-kind={meld.type}
      role="group"
      aria-label={`${eventLabels[meld.type] ?? meld.type}${concealed ? "" : `・${from}`}`}
      title={`${eventLabels[meld.type] ?? meld.type}${concealed ? "" : `・${from}`}`}
    >
      {values.map((value, index) => (
        <span
          key={index}
          className={`meld-slot${index === calledIndex ? " meld-called" : ""}`}
        >
          {concealed && (index === 0 || index === values.length - 1) ? (
            <TileBack />
          ) : (
            <RealTile value={value} small />
          )}
          {index === calledIndex && meld.added && (
            <span className="meld-added">
              <RealTile value={meld.added} small />
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

export function TableSeat({
  position,
  seat,
  river,
  melds = [],
  concealedCount = 13 - 3 * melds.length,
  openTiles,
  onToggle,
  loading = false,
  disabled = false,
}: {
  position: number;
  seat: number;
  river: Scene["rivers"][number];
  melds?: Meld[];
  concealedCount?: number;
  openTiles?: string[];
  onToggle?: () => void;
  loading?: boolean;
  disabled?: boolean;
}) {
  const displayTiles = openTiles && sortedTiles(openTiles);
  return (
    <>
      {position !== 2 && (
        <div className={`hand-layer player-${position}`}>
          <button
            type="button"
            className="concealed-hand"
            onClick={onToggle}
            disabled={disabled || !onToggle}
            aria-pressed={!!displayTiles}
            aria-busy={loading}
            aria-label={`相手全員の手牌を${displayTiles ? "伏せる" : "開く"}・${seatNames[position]}${displayTiles ? `・${displayTiles.map((t) => tileLabel(uiTile(t))).join(" ")}` : ""}`}
            title={
              displayTiles
                ? "クリック／タップで相手全員を伏せる"
                : "クリック／タップで相手全員を開く"
            }
          >
            {Array.from(
              { length: displayTiles?.length ?? Math.max(0, concealedCount) },
              (_, i) => (
                <span key={i} aria-hidden="true">
                  {displayTiles ? (
                    <RealTile value={displayTiles[i]} small />
                  ) : (
                    <TileBack />
                  )}
                </span>
              ),
            )}
          </button>
        </div>
      )}
      <div className={`player player-${position}`} data-seat={seat}>
        <DiscardRiver tiles={river} label={`${seatNames[position]}の河`} />
        {melds.length > 0 && (
          <div
            className="seat-melds"
            aria-label={`${seatNames[position]}の副露`}
          >
            {melds.map((meld, index) => (
              <MeldTiles key={index} meld={meld} seat={seat} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export function TableCenter({
  seats,
  children,
}: {
  seats: { wind: string; score: number; reach?: boolean }[];
  children: ReactNode;
}) {
  return (
    <div className="table-center" aria-label="局情報と点数">
      {seats.map((seat, position) => (
        <div className={`center-seat player-${position}`} key={position}>
          <div
            className="player-label"
            aria-label={`${seatNames[position]} ${seat.wind} ${seat.score.toLocaleString()}点${seat.reach ? " リーチ" : ""}`}
          >
            <b>{seat.wind}</b>
            <span>{seat.score.toLocaleString()}</span>
            {seat.reach && <i className="reach-stick" aria-hidden="true" />}
          </div>
        </div>
      ))}
      <div className="table-center-content">{children}</div>
    </div>
  );
}

export function RealTable({
  scene,
  interactive = false,
  selected = null,
  onSelect,
  report,
  annotations,
  reviewHands,
}: {
  scene: Scene;
  interactive?: boolean;
  selected?: string | null;
  onSelect?: (value: string) => void;
  report?: string;
  annotations?: Record<
    string,
    { policy?: number; rank?: number; actual?: boolean; answer?: boolean }
  >;
  reviewHands?: string[][];
}) {
  const [chosenIndex, setChosenIndex] = useState<number | null>(null);
  const hand = [...scene.own_hand];
  if (scene.drawn) hand.splice(hand.lastIndexOf(scene.drawn), 1);
  hand.sort((a, b) => tileOrder(a) - tileOrder(b));
  const tiles = [...hand, ...(scene.drawn ? [scene.drawn] : [])];
  const selectedIndex =
    chosenIndex !== null && tiles[chosenIndex] === selected
      ? chosenIndex
      : tiles.indexOf(selected ?? "");
  const own = scene.seat;
  const key = `${report ?? ""}:${scene.id ?? ""}:${scene.round_index}:${scene.event_index}`;
  const epoch = useRef(0);
  const [hands, setHands] = useState<string[][] | null>(null);
  const [opened, setOpened] = useState(false);
  const [loadingSeat, setLoadingSeat] = useState<number | null>(null);
  const [revealError, setRevealError] = useState("");
  useLayoutEffect(() => {
    epoch.current++;
    setHands(null);
    setOpened(false);
    setLoadingSeat(null);
    setRevealError("");
    return () => {
      epoch.current++;
    };
  }, [key]);
  const toggle = async (seat: number) => {
    if (opened) {
      setOpened(false);
      return;
    }
    if (hands) {
      setOpened(true);
      return;
    }
    const generation = epoch.current;
    setLoadingSeat(seat);
    setRevealError("");
    try {
      const result = reviewHands
        ? { hands: reviewHands }
        : await api<{ hands: string[][] }>({
            action: "open_hands",
            item: scene.id,
            report,
            round_index: scene.round_index,
            event_index: scene.event_index,
          });
      if (generation !== epoch.current) return;
      if (
        !Array.isArray(result.hands) ||
        result.hands.length !== 4 ||
        result.hands.some((h) => !Array.isArray(h) || h.length > 14)
      )
        throw Error("手牌を確認できませんでした。");
      setHands(result.hands);
      setOpened(true);
    } catch (error) {
      if (generation === epoch.current)
        setRevealError(
          error instanceof Error ? error.message : "手牌を開けませんでした。",
        );
    } finally {
      if (generation === epoch.current) setLoadingSeat(null);
    }
  };
  return (
    <div className="table-wrap real-board">
      <div className="table" aria-label={`${roundLabel(scene)}の卓`}>
        {[0, 1, 2, 3].map((position) => {
          const seat = (own + position - 2 + 4) % 4;
          const drawing =
            scene.actor === seat &&
            ["tsumo", "chi", "pon", "reach"].includes(scene.event_type ?? "");
          return (
            <TableSeat
              key={seat}
              position={position}
              seat={seat}
              river={scene.rivers[seat]}
              melds={scene.melds[seat]}
              concealedCount={
                hands?.[seat].length ??
                13 - 3 * scene.melds[seat].length + Number(drawing)
              }
              openTiles={opened ? hands?.[seat] : undefined}
              onToggle={() => void toggle(seat)}
              loading={loadingSeat === seat}
              disabled={
                loadingSeat !== null || (!scene.id && !report && !reviewHands)
              }
            />
          );
        })}
        <TableCenter
          seats={[0, 1, 2, 3].map((position) => {
            const seat = (own + position - 2 + 4) % 4;
            return {
              wind: ["東", "南", "西", "北"][
                (seat - (scene.kyoku - 1) + 4) % 4
              ],
              score: scene.scores[seat],
              reach: scene.reach_declared[seat],
            };
          })}
        >
          <span className="round-name">
            {wind(scene.bakaze)}
            {scene.kyoku}局
          </span>
          <div>
            {scene.honba}本場 · 供託{scene.kyotaku}
          </div>
          <div className="dora">
            ドラ表示{" "}
            {scene.dora_markers.map((t, i) => (
              <RealTile value={t} small key={i} />
            ))}
          </div>
        </TableCenter>
      </div>
      {revealError && (
        <p className="error hand-reveal-error" role="alert">
          {revealError}
        </p>
      )}
      <div
        className={`hand ${interactive ? "playable" : ""}`}
        data-testid="real-hand"
        aria-label="自分の手牌"
      >
        {tiles.map((t, i) => {
          // Each candidate belongs to one tile kind, not every physical copy.
          const mark = tiles.indexOf(t) === i ? annotations?.[t] : undefined;
          const label = mark && (
            <>
              {mark.policy !== undefined && (
                <span
                  className={`review-policy rank-${mark.rank} label-row-${i % 2}`}
                  aria-label={`AI推奨度 ${mark.policy.toFixed(1)}%`}
                >
                  {mark.policy.toFixed(1)}%
                </span>
              )}
              {(mark.actual || mark.answer) && (
                <span className="review-mark">
                  {[mark.actual && "実打", mark.answer && "回答"]
                    .filter(Boolean)
                    .join("・")}
                </span>
              )}
            </>
          );
          return interactive ? (
            <button
              key={i}
              className={`tile-choice ${annotations ? "review-hand-tile" : ""} ${selectedIndex === i ? "selected" : ""} ${scene.drawn && i === tiles.length - 1 ? "drawn" : ""}`}
              aria-label={`${i + 1}枚目 ${tileLabel(uiTile(t))}`}
              aria-pressed={selectedIndex === i}
              onClick={() => {
                setChosenIndex(i);
                onSelect?.(t);
              }}
            >
              <RealTile value={t} />
              {label}
            </button>
          ) : (
            <span
              key={i}
              className={`${annotations ? "review-hand-tile" : ""} ${scene.drawn && i === tiles.length - 1 ? "drawn" : ""}`}
            >
              <RealTile value={t} />
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
