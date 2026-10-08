import { useEffect, useState } from 'react';
import { Check, Dices, Pipette } from 'lucide-react';
import { useSettings } from '@/state/settings';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { Avatar, Button, Input } from '@/ui';
import { Card, Row } from '../parts';

const palette = ['#f97316', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#78716c', '#0f172a'];

const famous = ['Ada Lovelace', 'Grace Hopper', 'Emmy Noether', 'Sofia Kovalevskaya', 'Alan Turing', 'Donald Knuth', 'Leslie Lamport', 'Marie Curie', 'Hypatia', 'Srinivasa Ramanujan', 'Katherine Johnson', 'Leonhard Euler', 'Maryam Mirzakhani', 'Carl Gauss'];

export function ProfileSection() {
  const userName = useSettings((s) => s.userName);
  const userColor = useSettings((s) => s.userColor);
  const set = useSettings((s) => s.set);
  const [draft, setDraft] = useState(userName);
  const t = useT();
  useEffect(() => setDraft(userName), [userName]);

  const commitName = () => {
    const n = draft.trim().slice(0, 40);
    if (n) set({ userName: n });
    else setDraft(userName);
  };

  return (
    <>
      {/* Presence preview */}
      <div className="relative mb-7 overflow-hidden rounded-2xl border border-border bg-surface">
        <div
          className="absolute inset-0 opacity-[0.16]"
          style={{ background: `radial-gradient(120% 140% at 0% 0%, ${userColor}, transparent 60%)` }}
        />
        <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <div className="rounded-full p-[3px]" style={{ background: `conic-gradient(from 200deg, ${userColor}, color-mix(in srgb, ${userColor} 30%, white), ${userColor})` }}>
              <Avatar name={userName} color={userColor} size={56} className="ring-[3px] ring-surface" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-[17px] font-semibold tracking-tight text-fg">{userName}</div>
              <div className="text-[12px] text-fg-subtle">{t('settings.profile.howOthersSee')}</div>
            </div>
          </div>
          {/* Mock editor line with a remote caret */}
          <div className="ml-auto w-full max-w-[300px] rounded-xl border border-border bg-bg/70 p-3 font-mono text-[11.5px] leading-6 text-fg-muted shadow-xs backdrop-blur sm:w-auto">
            <div>
              <span className="text-accent">\section</span>
              {`{${t('settings.profile.mockSection')}}`}
            </div>
            <div className="relative">
              {t('settings.profile.mockLead')}{' '}
              <span className="rounded-[3px] px-0.5" style={{ background: `color-mix(in srgb, ${userColor} 22%, transparent)` }}>
                {t('settings.profile.mockHighlight')}
              </span>
              <span className="relative inline-block h-4 w-[2px] translate-y-[3px] animate-pulse" style={{ background: userColor }}>
                <span
                  className="absolute -top-[17px] right-0 whitespace-nowrap rounded-[4px] rounded-br-none px-1.5 py-[1px] font-sans text-[10px] font-semibold leading-4 text-white shadow-sm"
                  style={{ background: userColor }}
                >
                  {userName.split(' ')[0]}
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <Card title={t('settings.profile.identity')} description={t('settings.profile.identityNote')}>
        <Row title={t('settings.profile.displayName')} description={t('settings.profile.displayNameHint')} stack>
          <div className="flex gap-2">
            <Input
              value={draft}
              maxLength={40}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.blur(), commitName())}
              placeholder={t('settings.profile.namePlaceholder')}
              className="max-w-xs"
            />
            <Button
              variant="ghost"
              icon={<Dices />}
              onClick={() => {
                const n = famous[Math.floor(Math.random() * famous.length)]!;
                set({ userName: n });
              }}
            >
              {t('settings.profile.surprise')}
            </Button>
          </div>
        </Row>
        <Row title={t('settings.profile.color')} description={t('settings.profile.colorHint')} stack>
          <div className="flex flex-wrap items-center gap-2">
            {palette.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={t('settings.profile.useColor', { color: c })}
                onClick={() => set({ userColor: c })}
                className={cn(
                  'flex size-7 items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-offset-2',
                  userColor.toLowerCase() === c && 'ring-2 ring-fg/80 ring-offset-2 ring-offset-surface',
                )}
                style={{ background: c }}
              >
                {userColor.toLowerCase() === c && <Check className="size-3.5 text-white" strokeWidth={3} />}
              </button>
            ))}
            <label
              className={cn(
                'relative flex size-7 cursor-pointer items-center justify-center rounded-full transition-transform hover:scale-110',
                !palette.includes(userColor.toLowerCase()) && 'ring-2 ring-fg/80 ring-offset-2 ring-offset-surface',
              )}
              style={{ background: 'conic-gradient(#f43f5e,#eab308,#22c55e,#06b6d4,#6366f1,#ec4899,#f43f5e)' }}
              title={t('settings.profile.customColor')}
            >
              <Pipette className="size-3.5 text-white drop-shadow" />
              <input type="color" value={userColor} onChange={(e) => set({ userColor: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0" aria-label={t('settings.profile.customColor')} />
            </label>
          </div>
        </Row>
      </Card>
    </>
  );
}
