'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export function ImportStudentsModal() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const toast = useToast();

  function handleClose() {
    setOpen(false);
    setResult(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function handleFile(file: File) {
    setBusy(true);
    setResult(null);
    try {
      const text = await file.text();
      const res = await fetch('/api/admin/students/import', {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: text,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.message ?? 'Failed to import students');
        return;
      }
      setResult(data.data);
      if (data.data.imported > 0) {
        toast.success(`Imported ${data.data.imported} student(s)`);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Import from CSV</Button>

      <Modal
        open={open}
        onClose={handleClose}
        title="Import Students from CSV"
        footer={<Button onClick={handleClose}>Done</Button>}
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[#78716c]">
            Upload a CSV file with the columns: <code className="font-mono text-xs">fullName, parentName, parentPhone, class</code>.
            The <code className="font-mono text-xs">class</code> value must match an existing class name exactly (e.g. &quot;Form 4A&quot;).
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
            className="block w-full text-sm text-[#292524] file:mr-4 file:min-h-[44px] file:rounded-md file:border-0 file:bg-[#065f46] file:px-4 file:text-sm file:font-medium file:text-white hover:file:bg-[#047857]"
          />
          {busy && <p className="text-sm text-[#78716c]">Importing…</p>}
          {result && (
            <div className="rounded-lg border border-[#e7e5e4] bg-[#fafaf9] p-4 text-sm">
              <p className="font-medium text-[#292524]">
                Imported {result.imported} student(s), skipped {result.skipped}.
              </p>
              {result.errors.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-xs text-[#b91c1c]">
                  {result.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
