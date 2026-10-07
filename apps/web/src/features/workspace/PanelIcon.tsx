import { icons, Puzzle, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

/** Renders a lucide component, a lucide icon name ('sigma', 'book-open') or an inline SVG string. */
export function PanelIcon({ icon, className }: { icon?: LucideIcon | string; className?: string }) {
  if (!icon) return <Puzzle className={className} />;
  if (typeof icon !== 'string') {
    const C = icon;
    return <C className={className} />;
  }
  if (icon.trim().startsWith('<svg')) {
    return <span className={cn('inline-flex [&>svg]:size-full', className)} dangerouslySetInnerHTML={{ __html: icon }} />;
  }
  const pascal = icon.replace(/(^|[-_ ])(\w)/g, (_, __, c: string) => c.toUpperCase()) as keyof typeof icons;
  const C = icons[pascal] ?? Puzzle;
  return <C className={className} />;
}
