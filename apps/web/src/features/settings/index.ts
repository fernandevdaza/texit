/**
 * Settings feature: the app-wide Settings dialog (⌘,) and per-project settings.
 */
import { Info, Monitor, Moon, Settings, Settings2, Sun, SunMoon, UserRound } from 'lucide-react';
import { registerCommands } from '@/services/commands';
import { resolveTheme, useSettings } from '@/state/settings';
import { useWorkspace } from '@/state/workspace';
import { resolveSection, useSettingsUi } from './store';

const inProject = () => !!useWorkspace.getState().project;

export function activate() {
  const d = registerCommands([
    {
      id: 'app.settings',
      title: 'Settings',
      category: 'Preferences',
      icon: Settings,
      keybinding: 'Mod-,',
      global: true,
      keywords: ['preferences', 'options', 'configuration'],
      run: (section?: unknown) => {
        const ui = useSettingsUi.getState();
        const target = resolveSection(section);
        if (ui.open && !target) ui.hide();
        else ui.show(target);
      },
    },
    {
      id: 'app.profile',
      title: 'Edit profile',
      category: 'Preferences',
      icon: UserRound,
      keywords: ['name', 'color', 'avatar'],
      run: () => useSettingsUi.getState().show('profile'),
    },
    {
      id: 'project.settings',
      title: 'Project settings',
      category: 'Project',
      icon: Settings2,
      when: inProject,
      keywords: ['engine', 'main file', 'bibliography', 'biber', 'xelatex', 'lualatex', 'language', 'tags'],
      run: () => useSettingsUi.getState().setProjectOpen(true),
    },
    {
      id: 'view.toggleTheme',
      title: 'Toggle light / dark theme',
      category: 'Preferences',
      icon: SunMoon,
      keywords: ['dark mode', 'light mode', 'appearance'],
      run: () => {
        const s = useSettings.getState();
        s.set({ theme: resolveTheme(s.theme) === 'dark' ? 'light' : 'dark' });
      },
    },
    { id: 'preferences.themeLight', title: 'Theme: Light', category: 'Preferences', icon: Sun, run: () => useSettings.getState().set({ theme: 'light' }) },
    { id: 'preferences.themeDark', title: 'Theme: Dark', category: 'Preferences', icon: Moon, run: () => useSettings.getState().set({ theme: 'dark' }) },
    { id: 'preferences.themeSystem', title: 'Theme: Match system', category: 'Preferences', icon: Monitor, run: () => useSettings.getState().set({ theme: 'system' }) },
    { id: 'help.about', title: 'About TexIt', category: 'Help', icon: Info, keywords: ['version', 'license', 'update'], run: () => useSettingsUi.getState().show('about') },
  ]);
  return () => d.dispose();
}
