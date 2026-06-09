import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Hoist mock variables (must be declared before vi.mock factories run) ─────
const mockToastError   = vi.hoisted(() => vi.fn());
const mockToastSuccess = vi.hoisted(() => vi.fn());

// Stub UploadThing's FileUpload — it uses browser APIs not available in jsdom.
vi.mock('@/components/ui/FileUpload', () => ({
  FileUpload: () => null,
}));

// Stub the toast hook so we can assert on error/success calls.
vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ error: mockToastError, success: mockToastSuccess }),
}));

import { PaymentModal } from '@/components/accounting/PaymentModal';
import type { StudentForPayment } from '@/components/accounting/PaymentModal';

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const student: StudentForPayment = {
  id:          'stu-test-001',
  fullName:    'Tanaka Mutasa',
  grade:       'Form 4',
  parentPhone: '0772114552',
  balanceUSD:  365,
  balanceZiG:  1450,
};

function renderModal(overrides?: Partial<Parameters<typeof PaymentModal>[0]>) {
  return render(
    <PaymentModal
      open={true}
      student={student}
      onSuccess={vi.fn()}
      onClose={vi.fn()}
      {...overrides}
    />,
  );
}

function mockFetchSuccess(paymentOverrides?: object) {
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        data: {
          payment: {
            id:         'pay-001',
            feeLabel:   'Term 1 Fees',
            currency:   'USD',
            amount:     100,
            method:     'CASH',
            status:     'VERIFIED',
            recordedAt: new Date().toISOString(),
            ...paymentOverrides,
          },
          schoolName: 'Ruvimbo Independent College',
        },
      }),
      { status: 200 },
    ),
  );
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', vi.fn());
});

// ─── Rendering ────────────────────────────────────────────────────────────────

describe('PaymentModal — initial render', () => {
  it('displays the student full name in the modal title', () => {
    renderModal();
    expect(screen.getByText(/Tanaka Mutasa/)).toBeInTheDocument();
  });

  it('shows the outstanding USD hint by default', () => {
    renderModal();
    // Balance is $365 — hint should reflect USD outstanding
    expect(screen.getByText(/Outstanding/i)).toBeInTheDocument();
  });

  it('shows the fee label field', () => {
    renderModal();
    expect(screen.getByLabelText(/fee label/i)).toBeInTheDocument();
  });

  it('shows the amount field', () => {
    renderModal();
    expect(screen.getByLabelText(/amount/i)).toBeInTheDocument();
  });
});

// ─── Method toggle — reference field visibility ───────────────────────────────

describe('PaymentModal — method toggle', () => {
  it('does NOT show the reference field when method is Cash (default)', () => {
    renderModal();
    expect(screen.queryByLabelText(/reference/i)).not.toBeInTheDocument();
  });

  it('does NOT show the amber info box when method is Cash (default)', () => {
    renderModal();
    expect(screen.queryByText(/non-cash payments require proof/i)).not.toBeInTheDocument();
  });

  it('shows the reference field and amber box after switching to EcoCash', async () => {
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: 'EcoCash' }));
    expect(screen.getByLabelText(/reference/i)).toBeInTheDocument();
    expect(screen.getByText(/non-cash payments require proof/i)).toBeInTheDocument();
  });

  it('shows the reference field and amber box after switching to Swipe', async () => {
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: 'Swipe' }));
    expect(screen.getByLabelText(/reference/i)).toBeInTheDocument();
    expect(screen.getByText(/non-cash payments require proof/i)).toBeInTheDocument();
  });

  it('shows the reference field and amber box after switching to ZIPIT', async () => {
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: 'ZIPIT' }));
    expect(screen.getByLabelText(/reference/i)).toBeInTheDocument();
  });

  it('hides the reference field when switching back to Cash from EcoCash', async () => {
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: 'EcoCash' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cash' }));
    expect(screen.queryByLabelText(/reference/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/non-cash payments require proof/i)).not.toBeInTheDocument();
  });
});

// ─── Form validation ──────────────────────────────────────────────────────────
// Note: the submit button lives outside the <form> (modal footer) with
// form="payment-form". jsdom does not propagate synthetic submit events from
// out-of-form buttons, so we fireEvent.submit on the form directly to test
// RHF validation behaviour reliably.

describe('PaymentModal — form validation', () => {
  it('does NOT call fetch when the form is submitted empty', async () => {
    renderModal();
    fireEvent.submit(document.getElementById('payment-form')!);
    // Tick so RHF can process validation
    await waitFor(() => expect(vi.mocked(fetch)).not.toHaveBeenCalled());
  });

  it('shows a validation error for missing fee label on submit', async () => {
    renderModal();
    fireEvent.submit(document.getElementById('payment-form')!);
    await waitFor(() => {
      expect(screen.getByText(/fee label is required/i)).toBeInTheDocument();
    });
  });

  it('does NOT call fetch when EcoCash is selected but reference is empty', async () => {
    renderModal();
    await userEvent.click(screen.getByRole('button', { name: 'EcoCash' }));
    await userEvent.type(screen.getByLabelText(/amount/i), '100');
    await userEvent.type(screen.getByLabelText(/fee label/i), 'Term 1');
    // Intentionally leave reference blank — the .refine() check should block submission
    fireEvent.submit(document.getElementById('payment-form')!);
    await waitFor(() => expect(vi.mocked(fetch)).not.toHaveBeenCalled());
  });
});

// ─── API interactions ─────────────────────────────────────────────────────────

describe('PaymentModal — API success', () => {
  it('calls onSuccess with correct receipt data on a successful Cash payment', async () => {
    mockFetchSuccess();
    const onSuccess = vi.fn();
    renderModal({ onSuccess });

    await userEvent.type(screen.getByLabelText(/amount/i), '100');
    await userEvent.type(screen.getByLabelText(/fee label/i), 'Term 1 Fees');
    await userEvent.click(screen.getByRole('button', { name: /record payment/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());

    const receipt = onSuccess.mock.calls[0][0];
    expect(receipt.id).toBe('pay-001');
    expect(receipt.studentFullName).toBe('Tanaka Mutasa');
    expect(receipt.schoolName).toBe('Ruvimbo Independent College');
    expect(receipt.status).toBe('VERIFIED');
  });

  it('reduces balanceUSD in the receipt after a verified Cash/USD payment', async () => {
    mockFetchSuccess({ status: 'VERIFIED', currency: 'USD', amount: 100 });
    const onSuccess = vi.fn();
    renderModal({ onSuccess });

    await userEvent.type(screen.getByLabelText(/amount/i), '100');
    await userEvent.type(screen.getByLabelText(/fee label/i), 'Term 1 Fees');
    await userEvent.click(screen.getByRole('button', { name: /record payment/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    const receipt = onSuccess.mock.calls[0][0];
    // Original balance $365, paid $100 → remaining $265
    expect(receipt.balanceUSD).toBe(265);
  });

  it('does NOT reduce balanceUSD in the receipt for a PENDING (EcoCash) payment', async () => {
    mockFetchSuccess({ status: 'PENDING', method: 'ECOCASH', currency: 'USD', amount: 100 });
    const onSuccess = vi.fn();
    renderModal({ onSuccess });

    await userEvent.click(screen.getByRole('button', { name: 'EcoCash' }));
    await userEvent.type(screen.getByLabelText(/amount/i), '100');
    await userEvent.type(screen.getByLabelText(/fee label/i), 'Term 1 Fees');
    await userEvent.type(screen.getByLabelText(/reference/i), 'ECO-REF-001');
    await userEvent.click(screen.getByRole('button', { name: /record payment/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
    const receipt = onSuccess.mock.calls[0][0];
    // Non-cash payments stay PENDING — balance does not change
    expect(receipt.balanceUSD).toBe(365);
  });
});

describe('PaymentModal — API error', () => {
  it('calls toast.error and does NOT call onSuccess when API returns a non-OK response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Student not found' }), { status: 404 }),
    );
    const onSuccess = vi.fn();
    renderModal({ onSuccess });

    await userEvent.type(screen.getByLabelText(/amount/i), '100');
    await userEvent.type(screen.getByLabelText(/fee label/i), 'Term 1 Fees');
    await userEvent.click(screen.getByRole('button', { name: /record payment/i }));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('Student not found'),
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('falls back to a generic message when the API error has no message field', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({}), { status: 500 }),
    );
    renderModal();

    await userEvent.type(screen.getByLabelText(/amount/i), '100');
    await userEvent.type(screen.getByLabelText(/fee label/i), 'Term 1 Fees');
    await userEvent.click(screen.getByRole('button', { name: /record payment/i }));

    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('Failed to record payment'),
    );
  });
});

// ─── Cancel / close ───────────────────────────────────────────────────────────

describe('PaymentModal — close behaviour', () => {
  it('calls onClose when Cancel is clicked', async () => {
    const onClose = vi.fn();
    renderModal({ onClose });
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
