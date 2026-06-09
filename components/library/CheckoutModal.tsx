'use client';

import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { useToast } from '@/components/ui/Toast';

type Member = {
  id: string;
  borrowingSuspended: boolean;
  user: { fullName: string; role: string };
  _count: { borrowings: number };
};

type BookCopy = {
  id: string;
  accessionNumber: string;
  condition: string;
  status: string;
};

type Book = {
  id: string;
  title: string;
  author: string;
  availableCopiesCount: number;
  copies: BookCopy[];
};

interface Props {
  open:      boolean;
  onClose:   () => void;
  onSuccess: () => void;
}

function defaultDueDate() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().split('T')[0];
}

export function CheckoutModal({ open, onClose, onSuccess }: Props) {
  const toast = useToast();

  const [memberQ,       setMemberQ]       = useState('');
  const [memberResults, setMemberResults] = useState<Member[]>([]);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [memberLoading,  setMemberLoading]  = useState(false);

  const [bookQ,         setBookQ]         = useState('');
  const [bookResults,   setBookResults]   = useState<Book[]>([]);
  const [selectedBook,  setSelectedBook]  = useState<Book | null>(null);
  const [bookLoading,   setBookLoading]   = useState(false);

  const [selectedCopyId, setSelectedCopyId] = useState('');
  const [dueDate,        setDueDate]        = useState(defaultDueDate);
  const [submitting,     setSubmitting]     = useState(false);

  const memberTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bookTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  function reset() {
    setMemberQ(''); setMemberResults([]); setSelectedMember(null);
    setBookQ('');   setBookResults([]);   setSelectedBook(null);
    setSelectedCopyId('');
    setDueDate(defaultDueDate());
  }

  function handleClose() { reset(); onClose(); }

  // Member typeahead
  useEffect(() => {
    if (!memberQ || selectedMember) return;
    if (memberTimer.current) clearTimeout(memberTimer.current);
    memberTimer.current = setTimeout(async () => {
      setMemberLoading(true);
      try {
        const res  = await fetch(`/api/library/members?q=${encodeURIComponent(memberQ)}`);
        const data = await res.json();
        if (res.ok) setMemberResults(data.data.members ?? []);
      } finally { setMemberLoading(false); }
    }, 300);
    return () => { if (memberTimer.current) clearTimeout(memberTimer.current); };
  }, [memberQ, selectedMember]);

  // Book typeahead
  useEffect(() => {
    if (!bookQ || selectedBook) return;
    if (bookTimer.current) clearTimeout(bookTimer.current);
    bookTimer.current = setTimeout(async () => {
      setBookLoading(true);
      try {
        const res  = await fetch(`/api/library/books?q=${encodeURIComponent(bookQ)}&available=true`);
        const data = await res.json();
        if (res.ok) setBookResults(data.data.books ?? []);
      } finally { setBookLoading(false); }
    }, 300);
    return () => { if (bookTimer.current) clearTimeout(bookTimer.current); };
  }, [bookQ, selectedBook]);

  const availableCopies = (selectedBook?.copies ?? []).filter((c) => c.status === 'AVAILABLE');
  const copyOptions = availableCopies.map((c) => ({
    value: c.id,
    label: `${c.accessionNumber} (${c.condition.toLowerCase()})`,
  }));

  async function handleSubmit() {
    if (!selectedMember || !selectedCopyId) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/library/borrowing', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ copyId: selectedCopyId, memberId: selectedMember.id, dueDate }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.message ?? 'Checkout failed'); return; }
      toast.success('Book checked out successfully');
      reset();
      onSuccess();
    } finally { setSubmitting(false); }
  }

  const canSubmit = !!selectedMember && !!selectedCopyId && !submitting;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Checkout Book"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} loading={submitting} disabled={!canSubmit}>
            Checkout
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {/* Member search */}
        <div className="relative flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[#292524]">
            Member <span className="text-[#b91c1c]">*</span>
          </label>
          {selectedMember ? (
            <div className="flex items-center justify-between rounded-md border border-[#065f46] bg-[#f0fdf4] px-3 py-2">
              <div>
                <p className="text-sm font-medium text-[#292524]">{selectedMember.user.fullName}</p>
                <p className="text-xs text-[#78716c]">
                  {selectedMember._count.borrowings} active borrowing{selectedMember._count.borrowings !== 1 ? 's' : ''}
                  {selectedMember.borrowingSuspended && ' · ⚠ Suspended'}
                </p>
              </div>
              <button
                onClick={() => { setSelectedMember(null); setMemberQ(''); setMemberResults([]); }}
                className="text-xs text-[#78716c] hover:text-[#292524]"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <Input
                id="member-search"
                placeholder="Type member name…"
                value={memberQ}
                onChange={(e) => setMemberQ(e.target.value)}
              />
              {(memberResults.length > 0 || memberLoading) && (
                <div className="absolute top-full z-10 mt-1 w-full rounded-lg border border-[#e7e5e4] bg-white shadow-lg">
                  {memberLoading ? (
                    <p className="px-4 py-3 text-sm text-[#78716c]">Searching…</p>
                  ) : (
                    memberResults.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => { setSelectedMember(m); setMemberResults([]); }}
                        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-stone-50"
                      >
                        <span className="font-medium text-[#292524]">{m.user.fullName}</span>
                        <span className="text-xs text-[#78716c]">{m.user.role}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Book search */}
        <div className="relative flex flex-col gap-1.5">
          <label className="text-sm font-medium text-[#292524]">
            Book <span className="text-[#b91c1c]">*</span>
          </label>
          {selectedBook ? (
            <div className="flex items-center justify-between rounded-md border border-[#065f46] bg-[#f0fdf4] px-3 py-2">
              <div>
                <p className="text-sm font-medium text-[#292524]">{selectedBook.title}</p>
                <p className="text-xs text-[#78716c]">
                  {selectedBook.availableCopiesCount} available cop{selectedBook.availableCopiesCount !== 1 ? 'ies' : 'y'}
                </p>
              </div>
              <button
                onClick={() => { setSelectedBook(null); setBookQ(''); setBookResults([]); setSelectedCopyId(''); }}
                className="text-xs text-[#78716c] hover:text-[#292524]"
              >
                Change
              </button>
            </div>
          ) : (
            <>
              <Input
                id="book-search"
                placeholder="Search by title, author, or accession…"
                value={bookQ}
                onChange={(e) => setBookQ(e.target.value)}
              />
              {(bookResults.length > 0 || bookLoading) && (
                <div className="absolute top-full z-10 mt-1 w-full rounded-lg border border-[#e7e5e4] bg-white shadow-lg">
                  {bookLoading ? (
                    <p className="px-4 py-3 text-sm text-[#78716c]">Searching…</p>
                  ) : bookResults.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-[#78716c]">No available books found.</p>
                  ) : (
                    bookResults.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => { setSelectedBook(b); setBookResults([]); }}
                        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-stone-50"
                      >
                        <span className="font-medium text-[#292524]">{b.title}</span>
                        <span className="text-xs text-[#78716c]">{b.availableCopiesCount} available</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Copy selector */}
        {selectedBook && (
          <Select
            id="copy"
            label="Copy"
            required
            placeholder="Select a copy"
            options={copyOptions}
            value={selectedCopyId}
            onChange={(e) => setSelectedCopyId(e.target.value)}
          />
        )}

        {/* Due date */}
        <Input
          id="dueDate"
          label="Due Date"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </div>
    </Modal>
  );
}
