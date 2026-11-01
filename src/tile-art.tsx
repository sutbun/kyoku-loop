const files = import.meta.glob<string>("./assets/tiles/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

const honors = ["Ton", "Nan", "Shaa", "Pei", "Haku", "Hatsu", "Chun"];
export function TileArt({ tile }: { tile: string }) {
  const suit = { m: "Man", p: "Pin", s: "Sou" }[tile[1]];
  const name =
    tile[1] === "z"
      ? honors[Number(tile[0]) - 1]
      : suit && `${suit}${tile[0] === "0" ? "5-Dora" : tile[0]}`;
  const src = files[`./assets/tiles/${name}.svg`];
  return src ? (
    <img className="tile-art" src={src} alt="" draggable={false} />
  ) : null;
}
