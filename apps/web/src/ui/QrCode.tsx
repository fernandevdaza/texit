import { useMemo } from 'react';
import { encode } from 'uqr';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';

/** Crisp SVG QR code (single path, no canvas). Always dark-on-light for scanner compatibility. */
export function QrCode({ value, size = 160, className, ecc = 'M' }: { value: string; size?: number; className?: string; ecc?: 'L' | 'M' | 'Q' | 'H' }) {
  const t = useT();
  const { path, dim } = useMemo(() => {
    const qr = encode(value, { ecc, border: 2 });
    let d = '';
    for (let y = 0; y < qr.size; y++) {
      let x = 0;
      while (x < qr.size) {
        if (!qr.data[y][x]) {
          x++;
          continue;
        }
        let run = 1;
        while (x + run < qr.size && qr.data[y][x + run]) run++;
        d += `M${x} ${y}h${run}v1h-${run}z`;
        x += run;
      }
    }
    return { path: d, dim: qr.size };
  }, [value, ecc]);
  return (
    <svg
      viewBox={`0 0 ${dim} ${dim}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className={cn('rounded-lg bg-white', className)}
      role="img"
      aria-label={t('ui.qrCode')}
    >
      <path d={path} fill="#111" />
    </svg>
  );
}
