import { Route, Router, Switch } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { Toaster } from 'sonner';
import { DialogHost, TooltipProvider } from '@/ui';
import { useResolvedTheme } from '@/state/settings';
import { Dashboard } from '@/features/dashboard/Dashboard';
import { Workspace } from '@/features/workspace/Workspace';
import { CommandPalette } from '@/features/palette/CommandPalette';
import { SettingsDialog } from '@/features/settings/SettingsDialog';
import { JoinRoute } from '@/features/collab/JoinRoute';

export function App() {
  const theme = useResolvedTheme((s) => s.theme);
  return (
    <TooltipProvider>
      <Router hook={useHashLocation}>
        <Switch>
          <Route path="/p/:id">{(params) => <Workspace key={params.id} projectId={params.id} />}</Route>
          <Route path="/join/:room">{(params) => <JoinRoute room={params.room} />}</Route>
          <Route>
            <Dashboard />
          </Route>
        </Switch>
        <CommandPalette />
        <SettingsDialog />
        <DialogHost />
      </Router>
      <Toaster
        theme={theme}
        position="bottom-right"
        richColors
        closeButton
        toastOptions={{ className: 'font-sans !text-[13px]', style: { borderRadius: 12 } }}
      />
    </TooltipProvider>
  );
}
