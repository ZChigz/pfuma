import Link from 'next/link';
import { Card } from '@/components/ui/Card';
import type { SetupStep } from '@/lib/system/setup-checklist';

interface Props {
  steps: SetupStep[];
  /** True when the checklist is only showing because it was pinned in School Settings. */
  pinned: boolean;
}

export function SetupChecklist({ steps, pinned }: Props) {
  const done = steps.filter((s) => s.done).length;
  const percent = Math.round((done / steps.length) * 100);

  return (
    <Card
      title="Set up your school"
      subtitle={pinned && done === steps.length ? 'All steps done. Shown because it is pinned in School Settings.' : `${done} of ${steps.length} steps done`}
    >
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-tint" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={steps.length} aria-label={`${done} of ${steps.length} setup steps done`}>
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <ul className="mt-3 divide-y divide-line">
        {steps.map((s) => (
          <li key={s.key}>
            <Link href={s.href} className="flex min-h-[44px] items-start gap-3 rounded-xl py-2.5 hover:bg-rowhover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
              <span
                aria-hidden="true"
                className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border text-xs ${s.done ? 'border-primary bg-primary text-white' : 'border-subtle text-transparent'}`}
              >
                ✓
              </span>
              <span className="min-w-0">
                <span className={`block text-sm ${s.done ? 'text-muted line-through' : 'font-medium text-ink'}`}>{s.label}</span>
                <span className="sr-only">{s.done ? 'Done' : 'Not done'}</span>
                {!s.done && <span className="block text-xs text-muted">{s.hint}</span>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
