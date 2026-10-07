/** Remembers what had focus before the palette opened so it can be restored before running an action. */
let prev: HTMLElement | null = null;

export function rememberFocus() {
  const el = document.activeElement;
  prev = el instanceof HTMLElement && el !== document.body ? el : null;
}

export function consumePrevFocus(): HTMLElement | null {
  const el = prev;
  prev = null;
  return el;
}
