'use client';

import { useState } from 'react';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FileUpload } from '@/components/ui/FileUpload';
import { useToast } from '@/components/ui/Toast';
import { CreateBookSchema } from '@/lib/validations/library';

type FormValues = {
  isbn?:          string;
  title:          string;
  author:         string;
  subject?:       string;
  publisher?:     string;
  year?:          number;
  shelfLocation?: string;
  coverUrl?:      string;
  totalCopies:    number;
};

export function AddBookModal() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const toast  = useToast();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormValues>({
    resolver: zodResolver(CreateBookSchema) as unknown as Resolver<FormValues>,
    defaultValues: { totalCopies: 1 },
  });

  const coverUrl = watch('coverUrl');

  function handleClose() { reset(); setOpen(false); }

  async function onSubmit(values: FormValues) {
    const res = await fetch('/api/library/books', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...values,
        year:        values.year        ? Number(values.year)        : undefined,
        totalCopies: Number(values.totalCopies),
      }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.message ?? 'Failed to add book'); return; }
    toast.success(`Book added with ${data.data.copies.length} copies`);
    handleClose();
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Add Book</Button>

      <Modal
        open={open}
        onClose={handleClose}
        title="Add Book to Catalog"
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>Cancel</Button>
            <Button form="add-book-form" type="submit" loading={isSubmitting}>Add Book</Button>
          </>
        }
      >
        <form id="add-book-form" onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id="title"
              label="Title"
              required
              placeholder="e.g. Animal Farm"
              error={errors.title?.message}
              {...register('title')}
            />
            <Input
              id="author"
              label="Author"
              required
              placeholder="e.g. George Orwell"
              error={errors.author?.message}
              {...register('author')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              id="isbn"
              label="ISBN (optional)"
              placeholder="978-3-16-148410-0"
              error={errors.isbn?.message}
              {...register('isbn')}
            />
            <Input
              id="subject"
              label="Subject / Genre (optional)"
              placeholder="e.g. Fiction, Science"
              error={errors.subject?.message}
              {...register('subject')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Input
              id="publisher"
              label="Publisher (optional)"
              placeholder="e.g. Penguin Books"
              error={errors.publisher?.message}
              {...register('publisher')}
            />
            <Input
              id="year"
              label="Year (optional)"
              type="number"
              min="1000"
              max={new Date().getFullYear() + 1}
              placeholder="2024"
              error={errors.year?.message}
              {...register('year', { valueAsNumber: true })}
            />
            <Input
              id="shelfLocation"
              label="Shelf Location (optional)"
              placeholder="e.g. A-3"
              error={errors.shelfLocation?.message}
              {...register('shelfLocation')}
            />
          </div>

          <Input
            id="totalCopies"
            label="Number of Copies"
            type="number"
            min="1"
            required
            error={errors.totalCopies?.message}
            {...register('totalCopies', { valueAsNumber: true })}
          />

          <FileUpload
            endpoint="bookCover"
            label="Cover Image (optional)"
            existingUrl={coverUrl || undefined}
            onUpload={(url) => setValue('coverUrl', url)}
          />
        </form>
      </Modal>
    </>
  );
}
