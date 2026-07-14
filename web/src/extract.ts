export function dedupeKey(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}
