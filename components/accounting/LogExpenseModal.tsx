'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ExpenseForm } from './ExpenseForm';

export function LogExpenseModal() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Log Expense</Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Log Expense"
        size="md"
      >
        <ExpenseForm onSuccess={() => setOpen(false)} />
      </Modal>
    </>
  );
}
