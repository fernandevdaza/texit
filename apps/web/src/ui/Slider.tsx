import { Slider as S } from 'radix-ui';
import { cn } from '@/lib/cn';

/** Single-thumb slider (settings). */
export function Slider({
  value,
  onValueChange,
  onValueCommit,
  min = 0,
  max = 100,
  step = 1,
  className,
  disabled,
  'aria-label': ariaLabel,
}: {
  value: number;
  onValueChange: (v: number) => void;
  onValueCommit?: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  return (
    <S.Root
      value={[value]}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(v) => onValueChange(v[0]!)}
      onValueCommit={onValueCommit ? (v) => onValueCommit(v[0]!) : undefined}
      className={cn('relative flex h-5 w-40 touch-none select-none items-center data-[disabled]:opacity-50', className)}
    >
      <S.Track className="relative h-1 grow overflow-hidden rounded-full bg-border-strong/70">
        <S.Range className="absolute h-full rounded-full bg-accent" />
      </S.Track>
      <S.Thumb
        aria-label={ariaLabel}
        className="block size-4 rounded-full border border-black/10 bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] outline-none transition-[box-shadow,transform] hover:scale-110 focus-visible:ring-4 focus-visible:ring-accent/25"
      />
    </S.Root>
  );
}
