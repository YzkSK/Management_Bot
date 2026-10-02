/**
 * 現在ページ(0始まり)を中心に、表示するページ番号(0始まり)を最大maxVisible個返す。
 * 端に寄った場合は反対側へ詰めて、常に可能な限りmaxVisible個を表示する。
 */
export function visiblePages(current: number, totalPages: number, maxVisible = 5): number[] {
  const count = Math.min(maxVisible, totalPages);
  const start = Math.max(0, Math.min(current - Math.floor(count / 2), totalPages - count));
  return Array.from({ length: count }, (_, i) => start + i);
}
