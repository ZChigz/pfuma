'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useUploadThing } from '@/lib/uploadthing';
import { Avatar } from '@/components/students/shared';

const MAX_BYTES = 200 * 1024;

/** Centre-crops to a square, shrinks, and lowers the JPEG quality until the file is under 200 KB. */
export async function squareAndCompress(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  let size = Math.min(640, side);
  for (let attempt = 0; attempt < 8; attempt++) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    canvas.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
    for (const q of [0.85, 0.7, 0.55, 0.4]) {
      const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
      if (blob && blob.size <= MAX_BYTES) return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
    }
    size = Math.round(size * 0.8);
  }
  throw new Error('That photo could not be made small enough. Try another.');
}

export function PhotoPicker({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { startUpload } = useUploadThing('studentPhoto');

  async function pick(file: File | undefined) {
    if (!file) return;
    setError('');
    if (!['image/jpeg', 'image/png'].includes(file.type)) { setError('Use a JPG or PNG photo.'); return; }
    setBusy(true);
    try {
      const small = await squareAndCompress(file);
      const res = await startUpload([small]);
      const url = res?.[0]?.url;
      if (!url) throw new Error('The photo did not upload. Try again.');
      onChange(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The photo did not upload. Try again.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Avatar name="Photo" src={value || null} size={64} />
      <div className="flex flex-col gap-1">
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="secondary" loading={busy} onClick={() => input.current?.click()}>{value ? 'Change photo' : 'Add a photo'}</Button>
          {value && <Button type="button" size="sm" variant="ghost" onClick={() => onChange('')}>Remove</Button>}
        </div>
        <input ref={input} type="file" accept="image/jpeg,image/png" className="sr-only" aria-label="Photo file" onChange={(e) => pick(e.target.files?.[0])} />
        <p className="text-xs text-muted">Optional. JPG or PNG. It is cropped square and made small (under 200 KB) before it is sent.</p>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      </div>
    </div>
  );
}
