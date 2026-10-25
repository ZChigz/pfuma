'use client';

// Barcode and QR scanner for the standing-up screens (roll call, sick bay, library desk, tuck shop, gate, bus, stores).
// It reads with the phone camera (the browser's own BarcodeDetector where there is one, ZXing otherwise), takes a code typed by
// hand, and takes a code from a hardware scanner that "types" into the box and presses Enter. The screen decides what the code means.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { cleanScan, createDebouncer } from '@/lib/facilities/scan';

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

const FORMATS = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'itf', 'codabar', 'data_matrix'];

export interface ScannerProps {
  /** Called with each new code. Return false to say the code was refused (the camera keeps going). */
  onScan: (code: string) => void | boolean | Promise<void | boolean>;
  /** Keep the camera open after a scan (stocktake, bulk issue). Default: close after the first accepted code. */
  continuous?: boolean;
  /** What is being scanned, for the prompt: "a learner card", "a book". */
  prompt?: string;
  onClose?: () => void;
}

/** The camera view plus the type-it-in box. Mount it only while scanning: it releases the camera when it unmounts. */
export function Scanner({ onScan, continuous = false, prompt = 'a barcode or QR code', onClose }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [manual, setManual] = useState('');
  const seen = useRef(createDebouncer());
  const busy = useRef(false);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;
  const handleRef = useRef<(value: string) => Promise<boolean>>(async () => false);

  const handle = useCallback(async (value: string): Promise<boolean> => {
    const code = cleanScan(value);
    if (!code || busy.current || !seen.current(code)) return false;
    busy.current = true;
    try {
      const result = await onScanRef.current(code);
      if (result === false) return false;
      setLast(code);
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate?.(60);
      if (!continuous) onClose?.();
      return true;
    } finally {
      busy.current = false;
    }
  }, [continuous, onClose]);

  handleRef.current = handle;

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let stopZxing: (() => void) | null = null;
    let raf = 0;

    async function start() {
      const video = videoRef.current;
      if (!video) return;
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setError('This phone or browser cannot open the camera. Type the code below instead.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      } catch {
        setError('The camera is blocked. Allow the camera for this site, or type the code below.');
        return;
      }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      await video.play().catch(() => undefined);

      const Native = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      if (Native) {
        const detector = new Native({ formats: FORMATS });
        const tick = async () => {
          if (stopped) return;
          if (video.readyState >= 2) {
            try {
              const found = await detector.detect(video);
              if (found[0]?.rawValue) await handleRef.current(found[0].rawValue);
            } catch { /* a frame that cannot be read is skipped */ }
          }
          raf = requestAnimationFrame(() => { void tick(); });
        };
        void tick();
        return;
      }

      // No built-in detector (iPhone Safari, older Android): ZXing, loaded only now.
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromVideoElement(video, (result) => {
          if (result) void handleRef.current(result.getText());
        });
        if (stopped) controls.stop(); else stopZxing = () => controls.stop();
      } catch {
        setError('The camera opened, but the scanner could not start. Type the code below instead.');
      }
    }

    void start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stopZxing?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    const accepted = await handle(manual);
    if (accepted) setManual('');
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline aria-label="Camera view" />
        <div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-white/70" aria-hidden="true" />
      </div>
      {error && <p role="alert" className="text-center text-sm text-danger">{error}</p>}
      <p className="text-center text-sm text-muted" aria-live="polite">
        {last ? `Read ${last}` : error ? 'Type the code below' : `Point the camera at ${prompt}`}
      </p>
      <form onSubmit={submitManual} className="flex gap-2">
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          enterKeyHint="go"
          aria-label="Type or scan the code"
          placeholder="Type or scan the code"
          className="min-h-[48px] min-w-0 flex-1 rounded-xl border border-line bg-white px-3 text-base text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        <Button type="submit" className="min-h-[48px] min-w-[88px]" disabled={!cleanScan(manual)}>Use</Button>
      </form>
      {continuous && onClose && <Button variant="secondary" className="min-h-[48px]" onClick={onClose}>Done</Button>}
    </div>
  );
}

/** A button that opens the scanner in a dialog. */
export function ScanButton({ label = 'Scan', title = 'Scan', className, ...scanner }: Omit<ScannerProps, 'onClose'> & { label?: string; title?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <Button type="button" variant="secondary" className={`min-h-[48px] ${className ?? ''}`} onClick={() => setOpen(true)}>
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M4 12h16" strokeLinecap="round" />
        </svg>
        {label}
      </Button>
      <Modal open={open} onClose={close} title={title} size="sm">
        {open && <Scanner {...scanner} onClose={close} />}
      </Modal>
    </>
  );
}
