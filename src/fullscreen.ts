// In a plain browser tab the address bar eats ~56px of a landscape phone's height.
// Going fullscreen reclaims it. The installed app already runs without browser UI,
// so this only acts in "browser" display mode. Must be called from a user tap.
export function enterFullscreen(): void {
  if (!window.matchMedia("(display-mode: browser)").matches) return;
  const el = document.documentElement;
  if (document.fullscreenElement || typeof el.requestFullscreen !== "function") return;
  el.requestFullscreen({ navigationUI: "hide" }).catch(() => { /* refused: keep the tab as is */ });
}
