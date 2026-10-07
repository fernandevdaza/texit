import { Sparkles } from 'lucide-react';
import { StatusButton } from '@/features/workspace/StatusBar';
import { useLayout } from '@/state/workspace';
import { Spinner } from '@/ui';
import { useAiSettings } from './store';
import { useChat } from './chat/store';

/** Status bar: current chat model + spinner while the agent runs (click → toggle panel). */
export function AiStatusItem() {
  const ref = useAiSettings((s) => s.chatModel);
  const provider = useAiSettings((s) => s.providers.find((p) => p.id === s.chatModel?.providerId));
  const running = useChat((s) => Object.keys(s.running).length > 0);
  return (
    <StatusButton
      onClick={() => useLayout.getState().toggle('aiOpen')}
      title={ref ? `AI: ${provider?.name ?? ''} · ${ref.modelId}` : 'AI assistant — no model configured'}
      className={running ? 'text-accent' : undefined}
    >
      {running ? <Spinner className="size-3" /> : <Sparkles />}
      <span className="max-w-[140px] truncate">{ref ? ref.modelId : 'AI'}</span>
    </StatusButton>
  );
}
