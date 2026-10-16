'use client';

import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toast';
import { parseFormat, previewNumber } from '@/lib/numbering';
import { NumberingSchema } from '@/lib/validations/system';

type FormInput = z.input<typeof NumberingSchema>;
type FormOutput = z.output<typeof NumberingSchema>;

export interface ModuleInfo { key: string; label: string; on: boolean }

interface Props {
  school: { schoolCode: string; admissionFormat: string };
  year: number;
  /** The highest running number already used this year, plus one, for the format as saved. */
  nextSaved: number;
  /** Highest numbers already used under other formats are not counted; this is for the format as typed. */
  plan: { name: string; status: string; endsAt: string | null } | null;
  modules: ModuleInfo[];
  canUpdate: boolean;
}

export function NumberingTab({ school, year, nextSaved, plan, modules, canUpdate }: Props) {
  const router = useRouter();
  const { register, handleSubmit, watch, formState: { errors, isSubmitting, isDirty } } = useForm<FormInput, unknown, FormOutput>({
    resolver: zodResolver(NumberingSchema),
    defaultValues: school,
  });
  const code = String(watch('schoolCode') ?? '').trim().toUpperCase();
  const format = String(watch('admissionFormat') ?? '').trim();
  const parsed = parseFormat(format);
  // The "next number" is only known for the saved format; a changed format starts again at 1.
  const unchanged = format === school.admissionFormat && code === school.schoolCode;
  const next = unchanged ? nextSaved : 1;
  const preview = parsed.ok ? previewNumber(format, { year, schoolCode: code || 'CODE' }, next) : null;

  async function save(values: FormOutput) {
    const res = await fetch('/api/system/settings/numbering', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    const body = await res.json();
    if (!res.ok) {
      toast.error(body.errors ? Object.values(body.errors as Record<string, string[]>).flat()[0] : body.message ?? 'Could not save');
      return;
    }
    toast.success('Numbering saved');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit(save)} className="flex flex-col gap-4" noValidate>
        <fieldset disabled={!canUpdate} className="contents">
          <Card title="Admission numbers" subtitle="Tokens: {SCHOOLCODE}, {YEAR}, {YY} and the running number as zeros, such as {0000}">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input id="n-code" label="School code" required maxLength={8} hint="1 to 8 letters or digits" error={errors.schoolCode?.message} {...register('schoolCode')} />
              <Input id="n-format" label="Format" required error={errors.admissionFormat?.message} {...register('admissionFormat')} />
            </div>
            <div className="mt-3 rounded-xl bg-canvas p-3 text-sm" aria-live="polite">
              {preview ? (
                <>
                  <p className="text-muted">Next admission number{unchanged ? '' : ' (numbers start again at 1 with a new format)'}:</p>
                  <p className="font-mono text-lg font-semibold text-ink">{preview}</p>
                </>
              ) : (
                <p className="text-danger">{parsed.ok ? 'The school code or format is not valid yet.' : parsed.error}</p>
              )}
            </div>
            <p className="mt-2 text-xs text-muted">Admission numbers already given stay as they are. The running number counts on from the highest one that matches this format in the same year.</p>
          </Card>
        </fieldset>
        {canUpdate ? (
          <div className="flex justify-end"><Button type="submit" loading={isSubmitting} disabled={!isDirty || !preview}>Save numbering</Button></div>
        ) : (
          <p className="text-sm text-muted">You can view these settings but not change them.</p>
        )}
      </form>

      <Card title="Modules" subtitle="The parts of Pfuma your school uses">
        {plan && (
          <p className="mb-3 text-sm text-muted">
            Plan: <strong className="text-ink">{plan.name.charAt(0)}{plan.name.slice(1).toLowerCase()}</strong> ({plan.status.toLowerCase()}{plan.endsAt ? `, until ${plan.endsAt}` : ''})
          </p>
        )}
        <ul className="divide-y divide-line">
          {modules.map((m) => (
            <li key={m.key} className="flex items-center justify-between gap-3 py-2.5 text-sm text-ink">
              {m.label}
              <Badge variant={m.on ? 'success' : 'neutral'} label={m.on ? 'On' : 'Off'} />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-muted">Contact Pfuma to add modules.</p>
      </Card>
    </div>
  );
}
