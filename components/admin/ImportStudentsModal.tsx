'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { CSV_COLUMNS, csvTemplate, rejectionReportCsv } from '@/lib/students/csv';

interface RowReport {
  row: number;
  name: string;
  messages: string[];
  admissionNumber?: string;
}

interface ImportResult {
  totalRows: number;
  imported: number;
  termName: string;
  rejected: RowReport[];
  warnings: RowReport[];
}

function download(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ReportTable({ title, tone, rows }: { title: string; tone: 'error' | 'warn'; rows: RowReport[] }) {
  const color = tone === 'error' ? 'text-danger' : 'text-warn';
  return (
    <div>
      <h3 className={`mb-2 text-sm font-semibold ${color}`}>{title} ({rows.length})</h3>
      <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-canvas text-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">Row</th>
              <th className="px-3 py-2 font-semibold">Student</th>
              <th className="px-3 py-2 font-semibold">Why</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-white">
            {rows.map((r) => (
              <tr key={r.row} className="align-top">
                <td className="px-3 py-2 tabular-nums">{r.row}</td>
                <td className="px-3 py-2">
                  {r.name}
                  {r.admissionNumber && <span className="block font-mono text-muted">{r.admissionNumber}</span>}
                </td>
                <td className={`px-3 py-2 ${color}`}>
                  <ul className="list-disc pl-4">
                    {r.messages.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ImportStudentsModal({ disabled }: { disabled?: boolean }) {
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

  function downloadTemplate() {
    download('student-import-template.csv', csvTemplate());
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
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const required = CSV_COLUMNS.filter((c) => c.required).map((c) => c.key);
  const optional = CSV_COLUMNS.filter((c) => !c.required).map((c) => c.key);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} disabled={disabled}>Import from CSV</Button>

      <Modal
        open={open}
        onClose={handleClose}
        title="Import Students from CSV"
        size="lg"
        footer={<Button onClick={handleClose}>Done</Button>}
      >
        <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
          <div className="flex flex-col gap-2 text-sm text-muted">
            <p>Every row is checked with the same rules as the Admit Student form. Rows with errors, likely duplicates or numbers already in use are rejected; all other rows are admitted together into the current term and given an admission number (unless the file supplies one).</p>
            <p><span className="font-medium text-ink">Required columns:</span> <code className="font-mono text-xs">{required.join(', ')}</code></p>
            <p><span className="font-medium text-ink">Optional columns:</span> <code className="font-mono text-xs">{optional.join(', ')}</code></p>
            <p>Dates can be YYYY-MM-DD or DD/MM/YYYY. Gender can be M, F, Male or Female. Level can be &quot;Form 2&quot;, &quot;F2&quot; or just &quot;2&quot;; Lower/Upper Six also work.</p>
            <div>
              <Button size="sm" variant="ghost" onClick={downloadTemplate}>Download template</Button>
            </div>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
            className="block w-full text-sm text-ink file:mr-4 file:min-h-[44px] file:rounded-xl file:border-0 file:bg-primary file:px-4 file:text-sm file:font-medium file:text-white hover:file:bg-primary-hover"
          />
          {busy && <p className="text-sm text-muted">Checking and importing…</p>}

          {result && (
            <div className="flex flex-col gap-4">
              <div className="rounded-lg border border-line bg-rowhover p-4 text-sm text-ink">
                <p className="font-medium">
                  {result.imported} of {result.totalRows} student(s) admitted into {result.termName}
                  {result.rejected.length > 0 && `, ${result.rejected.length} row(s) rejected`}.
                </p>
                {result.rejected.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <p className="text-xs text-muted">Fix the rejected rows and import just those rows again.</p>
                    <Button size="sm" variant="secondary" onClick={() => download('rejected-rows.csv', rejectionReportCsv(result.rejected))}>
                      Download report
                    </Button>
                  </div>
                )}
              </div>
              {result.rejected.length > 0 && <ReportTable title="Rejected" tone="error" rows={result.rejected} />}
              {result.warnings.length > 0 && <ReportTable title="Imported with warnings — please check" tone="warn" rows={result.warnings} />}
            </div>
          )}
        </div>
      </Modal>
    </>
  );
}
