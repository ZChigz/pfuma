'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';

export function ClassSizeSetting({ initial }: { initial: number }) {
  const [value, setValue] = useState(String(initial));
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const toast = useToast();

  async function save() {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 200) {
      setError('Enter a whole number between 1 and 200');
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxClassSize: n }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.errors?.maxClassSize?.[0] ?? body.message ?? 'Failed to save');
        return;
      }
      toast.success('Class size limit saved');
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="sm:w-56">
        <Input
          id="maxClassSize"
          label="Class size limit"
          type="number"
          min={1}
          max={200}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={error}
          hint="Registering beyond this shows a warning"
        />
      </div>
      <Button onClick={save} loading={saving} disabled={value === String(initial)}>Save</Button>
    </div>
  );
}
