/**
 * Last minute and Owner stay marks (design option C, 20 Oct 2026).
 *
 * A white pill with a coloured border, the icon set in a solid circle at the
 * left. One component for the office Planning list and the cleaner's cards,
 * so the two read the same. Icons are redrawn from the supplied artwork
 * (stopwatch; suited bust) as flat glyphs that stay crisp at 9–18 px.
 */
import { cn } from '@/lib/utils';

type IconProps = { size?: number; className?: string };

/** Stopwatch: crown, ring, one hand. */
export function StopwatchIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className={className}>
      <rect x="6.2" y="0.4" width="3.6" height="1.7" rx="0.5" fill="currentColor" />
      <rect x="7.35" y="1.9" width="1.3" height="1.6" fill="currentColor" />
      <circle cx="8" cy="9.6" r="5.3" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 9.6 L6.9 5.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="8" cy="9.6" r="1.05" fill="currentColor" />
    </svg>
  );
}

/** Owner: head and shoulders in a suit, with a tie. */
export function OwnerIcon({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className={className}>
      <ellipse cx="8" cy="4.5" rx="3" ry="3.7" fill="currentColor" />
      <path d="M1.6 15.6 C1.6 12.4 4.4 10.9 6 10.4 L8 14.6 L10 10.4 C11.6 10.9 14.4 12.4 14.4 15.6 Z" fill="currentColor" />
      <path d="M7.45 10.9 H8.55 L8.75 13.6 L8 14.9 L7.25 13.6 Z" fill="currentColor" />
    </svg>
  );
}

type PillProps = {
  /** sm: office list (10 px type). md: cleaner card (11 px type). */
  size?: 'sm' | 'md';
  label: string;
  title?: string;
  className?: string;
  /** Extra text after the label inside the same pill (e.g. "· Next check-in 21 Oct, 15:00"). */
  children?: React.ReactNode;
};

const SIZE = {
  sm: { pill: 'text-[10px] leading-[14px] gap-1 pr-1.5', dot: 'w-3.5 h-3.5', glyph: 9 },
  md: { pill: 'text-[11px] leading-4 gap-1.5 pr-2.5 py-0.5', dot: 'w-[18px] h-[18px]', glyph: 11 },
};

function FlagPill({ size = 'sm', label, title, className, children, tone, Icon }: PillProps & {
  tone: { border: string; text: string; dot: string };
  Icon: (p: IconProps) => JSX.Element;
}) {
  const s = SIZE[size];
  return (
    <span
      title={title ?? label}
      className={cn(
        'inline-flex items-center max-w-full rounded-full bg-white border pl-px py-px font-bold uppercase tracking-wide',
        s.pill, tone.border, tone.text, className,
      )}
    >
      <span className={cn('rounded-full text-white inline-flex items-center justify-center flex-shrink-0', s.dot, tone.dot)}>
        <Icon size={s.glyph} />
      </span>
      <span className="min-w-0">{label}</span>
      {children}
    </span>
  );
}

export function LastMinutePill(p: PillProps) {
  return <FlagPill {...p} Icon={StopwatchIcon} tone={{ border: 'border-coral', text: 'text-coral-deep', dot: 'bg-coral' }} />;
}

export function OwnerStayPill(p: PillProps) {
  return <FlagPill {...p} Icon={OwnerIcon} tone={{ border: 'border-sand', text: 'text-sand-deep', dot: 'bg-sand' }} />;
}
