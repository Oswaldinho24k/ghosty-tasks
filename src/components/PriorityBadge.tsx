type Priority = string | null;

const PRIORITY_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  urgent: { label: 'Urgente', color: 'text-red-500', dot: 'bg-red-500' },
  high:   { label: 'Alta',    color: 'text-orange-500', dot: 'bg-orange-500' },
  medium: { label: 'Media',   color: 'text-yellow-500', dot: 'bg-yellow-400' },
  low:    { label: 'Baja',    color: 'text-blue-400', dot: 'bg-blue-400' },
};

export function PriorityBadge({ priority, showLabel = false }: { priority: Priority; showLabel?: boolean }) {
  if (!priority) return null;
  const cfg = PRIORITY_CONFIG[priority];
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${cfg.color}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      {showLabel && cfg.label}
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
      <option value="urgent">🔴 Urgente</option>
      <option value="high">🟠 Alta</option>
      <option value="medium">🟡 Media</option>
      <option value="low">🔵 Baja</option>
    </select>
  );
}
