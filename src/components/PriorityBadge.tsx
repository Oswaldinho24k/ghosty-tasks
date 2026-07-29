import { PRIORITIES, priorityColor, priorityLabel } from '../utils/priority';

type Priority = string | null;

// El punto de color del <select> nativo no se puede estilar: se aproxima con emoji.
const EMOJI: Record<string, string> = {
  urgent: '🔴',
  high: '🟠',
  medium: '🔵',
  low: '⚪',
};

export function PriorityBadge({ priority, showLabel = false }: { priority: Priority; showLabel?: boolean }) {
  if (!priority) return null;
  const label = priorityLabel(priority);
  if (!label) return null;
  const color = priorityColor(priority);
  return (
    <span className="inline-flex items-center gap-1 text-xs" style={{ color }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {showLabel && label}
    </span>
  );
}

export function PrioritySelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-ink outline-none focus:border-brand"
    >
      <option value="">Sin prioridad</option>
      {/* Los emojis decían otro color que la franja de la tarjeta (🟡 media, 🔵 baja).
          Salen de la misma lista que el resto para que no vuelvan a divergir. */}
      {PRIORITIES.map((p) => (
        <option key={p.value} value={p.value}>
          {EMOJI[p.value]} {p.label}
        </option>
      ))}
    </select>
  );
}
