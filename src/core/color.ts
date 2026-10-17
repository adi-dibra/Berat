/** The colors native Chrome tab groups support. */
export const GROUP_COLORS = [
  'grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange',
] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

/** CSS colors close to Chrome's own tab group colors, for the UI. */
export const GROUP_COLOR_CSS: Record<GroupColor, string> = {
  grey: '#5f6368', blue: '#1a73e8', red: '#d93025', yellow: '#f9ab00',
  green: '#1e8e3e', pink: '#d01884', purple: '#9334e6', cyan: '#007b83',
  orange: '#fa903e',
};

/** Deterministic color for a name: the same domain always gets the same color. */
export function colorFor(name: string): GroupColor {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return GROUP_COLORS[(h >>> 0) % GROUP_COLORS.length];
}
