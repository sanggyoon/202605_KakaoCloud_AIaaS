'use client';

import { PATTERNS } from '@/app/lib/data';

interface PatternChipProps {
  pattern: string;
  active?: boolean;
}

export default function PatternChip({ pattern, active = false }: PatternChipProps) {
  const p = PATTERNS[pattern];
  if (!p) return null;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '3px 8px',
      borderRadius: 999,
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.04em',
      background: active ? 'color-mix(in oklch, var(--accent) 18%, transparent)' : 'rgba(255,255,255,0.05)',
      color: active ? 'var(--accent)' : 'rgba(255,255,255,0.7)',
      border: `1px solid ${active ? 'color-mix(in oklch, var(--accent) 35%, transparent)' : 'rgba(255,255,255,0.08)'}`,
      fontFamily: 'var(--font-mono), monospace',
      textTransform: 'uppercase',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: 999, background: active ? 'var(--accent)' : 'rgba(255,255,255,0.4)', display: 'inline-block' }} />
      {p.name}
    </span>
  );
}
