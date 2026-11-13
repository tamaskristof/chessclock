import type { Category } from "./chesscom";
import type { Side, TimeControl } from "./clock";

export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
export const categoryLabel = (c: Category): string => cap(c);
export const sideLabel = (s: Side): string => cap(s);

/** "5+0", "3+2". */
export function tcLabel(tc: TimeControl): string {
  return `${tc.baseMs / 60_000}+${tc.incrementMs / 1000}`;
}
