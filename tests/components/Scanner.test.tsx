import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Scanner, ScanButton } from '@/components/facilities/Scanner';

// jsdom has no camera, so these tests cover the part that works everywhere: the box a person types in or a hardware scanner "types"
// into, and what the screen does with the code.
describe('Scanner without a camera', () => {
  it('says so, and still takes a typed code', async () => {
    const onScan = vi.fn();
    render(<Scanner onScan={onScan} prompt="a learner card" />);
    expect(screen.getByText(/cannot open the camera/i)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Type or scan the code'), 'STU20260042{enter}');
    expect(onScan).toHaveBeenCalledWith('STU20260042');
  });

  it('keeps the Use button off until there is a code, and has touch-sized controls', async () => {
    render(<Scanner onScan={vi.fn()} />);
    const use = screen.getByRole('button', { name: 'Use' });
    expect(use).toBeDisabled();
    expect(use.className).toMatch(/min-h-\[48px\]/);
    expect(screen.getByLabelText('Type or scan the code').className).toMatch(/min-h-\[48px\]/);
    await userEvent.type(screen.getByLabelText('Type or scan the code'), 'X1');
    expect(use).toBeEnabled();
  });

  it('closes after the first accepted code, unless it is continuous', async () => {
    const onClose = vi.fn();
    const { unmount } = render(<Scanner onScan={vi.fn()} onClose={onClose} />);
    await userEvent.type(screen.getByLabelText('Type or scan the code'), 'A1{enter}');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    unmount();

    const onClose2 = vi.fn();
    render(<Scanner onScan={vi.fn()} onClose={onClose2} continuous />);
    await userEvent.type(screen.getByLabelText('Type or scan the code'), 'A1{enter}');
    await userEvent.type(screen.getByLabelText('Type or scan the code'), 'A2{enter}');
    expect(onClose2).not.toHaveBeenCalled();
    expect(screen.getByText('Read A2')).toBeInTheDocument();
  });

  it('keeps going when the screen refuses a code, and clears the box after one it takes', async () => {
    const onScan = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<Scanner onScan={onScan} onClose={onClose} continuous />);
    const box = screen.getByLabelText('Type or scan the code') as HTMLInputElement;
    await userEvent.type(box, 'BAD{enter}');
    expect(box.value).toBe('BAD');
    expect(screen.queryByText('Read BAD')).not.toBeInTheDocument();
    await userEvent.clear(box);
    await userEvent.type(box, 'GOOD{enter}');
    await waitFor(() => expect(box.value).toBe(''));
    expect(onScan).toHaveBeenLastCalledWith('GOOD');
  });

  it('strips control characters a hardware scanner adds', async () => {
    const onScan = vi.fn();
    render(<Scanner onScan={onScan} />);
    const box = screen.getByLabelText('Type or scan the code');
    await userEvent.type(box, 'ACC-9');
    await userEvent.keyboard('{enter}');
    expect(onScan).toHaveBeenCalledWith('ACC-9');
  });
});

describe('ScanButton', () => {
  it('opens the scanner in a dialog', async () => {
    render(<ScanButton onScan={vi.fn()} label="Scan learner" title="Scan a learner card" />);
    await userEvent.click(screen.getByRole('button', { name: /Scan learner/ }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Type or scan the code')).toBeInTheDocument();
  });
});
