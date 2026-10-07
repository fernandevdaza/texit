/**
 * Built-in plugins. Each one talks to the app exclusively through the public
 * `PluginAPI` (they double as reference examples for plugin authors); they only
 * reuse the presentational UI kit and React for rendering their DOM panels.
 */
import type { TexitPlugin } from '@texit/plugin-api';
import wordcount from './wordcount';
import symbols from './symbols';
import tablegen from './tablegen';
import bibtex from './bibtex';
import snippets from './snippets';
import textgen from './textgen';
import zen from './zen';

export const builtinPlugins: TexitPlugin[] = [wordcount, symbols, tablegen, bibtex, snippets, textgen, zen];
