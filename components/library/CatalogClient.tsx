'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Table } from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { AddBookModal } from '@/components/library/AddBookModal';
import { BookCopiesModal } from '@/components/library/BookCopiesModal';
import type { CopyCondition, CopyStatus, UserRole } from '@/types';

type Copy = {
  id: string;
  accessionNumber: string;
  condition: CopyCondition;
  status: CopyStatus;
};

type BookRow = {
  id: string;
  title: string;
  author: string;
  subject: string | null;
  isbn: string | null;
  publisher: string | null;
  year: number | null;
  shelfLocation: string | null;
  coverUrl: string | null;
  copies: Copy[];
  availableCopiesCount: number;
  [key: string]: unknown;
};

interface Props {
  initialBooks: BookRow[];
  userRole:     UserRole;
}

export function CatalogClient({ initialBooks, userRole }: Props) {
  const router = useRouter();

  const [q,            setQ]            = useState('');
  const [selectedBook, setSelectedBook] = useState<BookRow | null>(null);

  const canManage = ['DIRECTOR', 'HEAD', 'LIBRARIAN'].includes(userRole);

  const filtered = useMemo(() => {
    if (!q) return initialBooks;
    const lower = q.toLowerCase();
    return initialBooks.filter((b) =>
      b.title.toLowerCase().includes(lower) ||
      b.author.toLowerCase().includes(lower) ||
      (b.isbn  ?? '').toLowerCase().includes(lower) ||
      b.copies.some((c) => c.accessionNumber.toLowerCase().includes(lower)),
    );
  }, [initialBooks, q]);

  const columns = [
    {
      key: 'title',
      label: 'Title',
      render: (row: BookRow) => (
        <span className="font-medium text-[#292524]">{row.title}</span>
      ),
    },
    {
      key: 'author',
      label: 'Author',
      render: (row: BookRow) => row.author,
    },
    {
      key: 'subject',
      label: 'Subject',
      render: (row: BookRow) => row.subject ?? '—',
    },
    {
      key: 'copies',
      label: 'Available',
      render: (row: BookRow) => {
        const avail = row.availableCopiesCount;
        const total = row.copies.length;
        const variant = avail === 0 ? 'danger' : avail < total ? 'warning' : 'success';
        return <Badge variant={variant} label={`${avail} / ${total}`} />;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#292524]">Book Catalog</h1>
          <p className="mt-0.5 text-sm text-[#78716c]">
            {initialBooks.length} title{initialBooks.length !== 1 ? 's' : ''} in collection
          </p>
        </div>
        {canManage && <AddBookModal />}
      </div>

      {/* Search */}
      <Input
        id="catalog-search"
        placeholder="Search by title, author, ISBN or accession number…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-md"
      />

      {/* Table */}
      <Table
        columns={columns as never}
        data={filtered}
        emptyMessage="No books found."
        onRowClick={(row) => setSelectedBook(row as BookRow)}
      />

      {/* Book copies modal */}
      <BookCopiesModal
        book={selectedBook}
        onClose={() => setSelectedBook(null)}
      />
    </div>
  );
}
