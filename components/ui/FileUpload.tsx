'use client';

import { cn } from '@/lib/utils';
import { useUploadThing } from '@/lib/uploadthing';
import { useCallback, useRef, useState } from 'react';
import type { OurFileRouter } from '@/app/api/upload/route';

type Endpoint = keyof OurFileRouter;

const ENDPOINT_ACCEPT: Record<Endpoint, string> = {
  proofOfPayment: 'image/jpeg,image/png,image/webp,application/pdf',
  assetImage:     'image/jpeg,image/png,image/webp',
  bookCover:      'image/jpeg,image/png,image/webp',
};

type Status = 'idle' | 'uploading' | 'done' | 'error';

interface FileUploadProps {
  endpoint:     Endpoint;
  label?:       string;
  onUpload:     (url: string) => void;
  existingUrl?: string;
  className?:   string;
}

export function FileUpload({ endpoint, label, onUpload, existingUrl, className }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging,    setIsDragging]    = useState(false);
  const [status,        setStatus]        = useState<Status>(existingUrl ? 'done' : 'idle');
  const [progress,      setProgress]      = useState(0);
  const [uploadedUrl,   setUploadedUrl]   = useState<string | null>(existingUrl ?? null);
  const [uploadedName,  setUploadedName]  = useState<string | null>(
    existingUrl ? (existingUrl.split('/').pop() ?? 'Uploaded file') : null,
  );
  const [errorMsg,      setErrorMsg]      = useState('');

  const { startUpload } = useUploadThing(endpoint, {
    onUploadProgress: (p) => { setStatus('uploading'); setProgress(p); },
    onClientUploadComplete: (res) => {
      const url  = res?.[0]?.url;
      const name = res?.[0]?.name;
      if (url) {
        setUploadedUrl(url);
        setUploadedName(name ?? url.split('/').pop() ?? 'Uploaded file');
        setStatus('done');
        onUpload(url);
      }
    },
    onUploadError: (err) => {
      setStatus('error');
      setErrorMsg(err.message ?? 'Upload failed. Please try again.');
    },
  });

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return;
      setErrorMsg('');
      setStatus('uploading');
      startUpload(Array.from(files));
    },
    [startUpload],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (status !== 'uploading') handleFiles(e.dataTransfer.files);
    },
    [handleFiles, status],
  );

  function handleChange() {
    setStatus('idle');
    setUploadedUrl(null);
    setUploadedName(null);
    setErrorMsg('');
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {label && (
        <span className="text-sm font-medium text-[#292524]">{label}</span>
      )}

      {/* Done state */}
      {status === 'done' && uploadedUrl && (
        <div className="flex items-center justify-between gap-2 rounded-md border border-[#065f46] bg-[#f0fdf4] px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            {uploadedUrl.match(/\.(jpe?g|png|webp|gif)$/i) ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={uploadedUrl}
                alt="Uploaded preview"
                className="h-8 w-8 flex-shrink-0 rounded object-cover"
              />
            ) : (
              <svg className="h-5 w-5 flex-shrink-0 text-[#065f46]" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M15.621 4.379a3 3 0 00-4.242 0l-7 7a3 3 0 004.241 4.243h.001l.497-.5a.75.75 0 011.064 1.057l-.498.501-.002.002a4.5 4.5 0 01-6.364-6.364l7-7a4.5 4.5 0 016.368 6.36l-3.455 3.553A2.625 2.625 0 119.52 9.52l3.45-3.451a.75.75 0 111.061 1.06l-3.45 3.451a1.125 1.125 0 001.587 1.595l3.454-3.553a3 3 0 000-4.242z" clipRule="evenodd" />
              </svg>
            )}
            <a
              href={uploadedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-sm text-[#065f46] underline underline-offset-2"
            >
              {uploadedName ?? 'View file'}
            </a>
          </div>
          <button
            type="button"
            onClick={handleChange}
            className="flex-shrink-0 text-xs font-medium text-[#78716c] hover:text-[#292524]"
          >
            Change
          </button>
        </div>
      )}

      {/* Drop zone (shown in idle, uploading, error states) */}
      {status !== 'done' && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload file — click or drag and drop"
          onClick={() => status !== 'uploading' && inputRef.current?.click()}
          onKeyDown={(e) => {
            if (status !== 'uploading' && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => { e.preventDefault(); if (status !== 'uploading') setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex min-h-[100px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-[#065f46]/40',
            status === 'uploading'
              ? 'cursor-not-allowed border-[#e7e5e4] bg-stone-50'
              : isDragging
                ? 'cursor-copy border-[#065f46] bg-[#065f46]/5'
                : 'cursor-pointer border-[#e7e5e4] hover:border-[#065f46]/50 hover:bg-stone-50',
          )}
        >
          {status === 'uploading' ? (
            <div className="flex w-full max-w-[220px] flex-col items-center gap-3 px-4">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-200">
                <div
                  className="h-full rounded-full bg-[#065f46] transition-all duration-150"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-[#78716c]">Uploading… {progress}%</p>
            </div>
          ) : (
            <>
              <svg
                className="h-8 w-8 text-[#78716c]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.338-2.32 5.75 5.75 0 011.548 9.095" />
              </svg>
              <p className="text-sm text-[#78716c]">
                Drag & drop or{' '}
                <span className="font-medium text-[#065f46]">click to upload</span>
              </p>
            </>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ENDPOINT_ACCEPT[endpoint]}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => handleFiles(e.target.files)}
      />

      {status === 'error' && errorMsg && (
        <p role="alert" className="text-xs text-[#b91c1c]">{errorMsg}</p>
      )}
    </div>
  );
}
