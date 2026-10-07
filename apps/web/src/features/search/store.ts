import { create } from 'zustand';
import type { SearchOptions } from './engine';

interface SearchUiState extends SearchOptions {
  replace: string;
  showReplace: boolean;
  showFilters: boolean;
  /** Bumped to focus the query input (e.g. Find in project while already open). */
  focusNonce: number;
  set(patch: Partial<Omit<SearchUiState, 'set'>>): void;
}

/** Search panel state survives switching sidebar panels. */
export const useSearchUi = create<SearchUiState>((set) => ({
  query: '',
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  include: '',
  exclude: '',
  replace: '',
  showReplace: false,
  showFilters: false,
  focusNonce: 0,
  set: (patch) => set(patch),
}));
