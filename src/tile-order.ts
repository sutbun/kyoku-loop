// Canonical report tiles and bundled UI tiles share the same mahjong order.
export function tileOrder(value: string) {
  const honor = ["E", "S", "W", "N", "P", "F", "C"].indexOf(value);
  if (honor >= 0) return 31 + honor;
  return (
    "mpsz".indexOf(value[1]) * 10 + (value[0] === "0" ? 5 : Number(value[0]))
  );
}
export const sortedTiles = (values: readonly string[]) =>
  [...values].sort((a, b) => tileOrder(a) - tileOrder(b));
