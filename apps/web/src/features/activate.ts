/**
 * Activates every built-in feature once at startup. Each feature's `activate()`
 * registers its commands, panels, status-bar items and editor extensions.
 */
import * as workspace from './workspace';
import * as editor from './editor';
import * as files from './files';
import * as outline from './outline';
import * as search from './search';
import * as pdf from './pdf';
import * as compile from './compile';
import * as ai from './ai';
import * as collab from './collab';
import * as history from './history';
import * as plugins from './plugins';
import * as settings from './settings';
import * as palette from './palette';
import * as dashboard from './dashboard';
import * as desktop from './desktop';

const features: Record<string, { activate(): void | (() => void) }> = {
  workspace,
  editor,
  files,
  outline,
  search,
  pdf,
  compile,
  ai,
  collab,
  history,
  settings,
  palette,
  dashboard,
  desktop,
  // Plugins last: the plugin host builds on everything above.
  plugins,
};

let activated = false;

export function activateFeatures() {
  if (activated) return;
  activated = true;
  for (const [name, f] of Object.entries(features)) {
    try {
      f.activate();
    } catch (err) {
      console.error(`[texit] failed to activate feature "${name}"`, err);
    }
  }
}
