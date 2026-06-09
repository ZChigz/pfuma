import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@/components/ui/Button';

describe('Button — rendering', () => {
  it('renders its children as the accessible button name', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('applies primary variant classes by default', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('bg-[#065f46]');
  });

  it('applies secondary variant classes', () => {
    render(<Button variant="secondary">Cancel</Button>);
    const btn = screen.getByRole('button', { name: 'Cancel' });
    expect(btn).toHaveClass('border', 'border-[#065f46]', 'bg-white');
  });

  it('applies danger variant classes', () => {
    render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('bg-[#b91c1c]');
  });

  it('applies ghost variant classes', () => {
    render(<Button variant="ghost">Menu</Button>);
    expect(screen.getByRole('button', { name: 'Menu' })).toHaveClass('bg-transparent');
  });
});

describe('Button — sizes', () => {
  it('applies sm size classes', () => {
    render(<Button size="sm">Small</Button>);
    expect(screen.getByRole('button', { name: 'Small' })).toHaveClass('px-3', 'text-sm');
  });

  it('applies md size classes by default', () => {
    render(<Button>Medium</Button>);
    expect(screen.getByRole('button', { name: 'Medium' })).toHaveClass('px-4', 'text-sm');
  });

  it('applies lg size classes', () => {
    render(<Button size="lg">Large</Button>);
    expect(screen.getByRole('button', { name: 'Large' })).toHaveClass('px-6', 'text-base');
  });
});

describe('Button — disabled state', () => {
  it('is disabled when the disabled prop is true', () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('does not call onClick when disabled', async () => {
    const handler = vi.fn();
    render(<Button disabled onClick={handler}>Save</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('Button — loading state', () => {
  it('is disabled when loading=true', () => {
    render(<Button loading>Save</Button>);
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('renders the spinner SVG when loading=true', () => {
    render(<Button loading>Save</Button>);
    const btn = screen.getByRole('button', { name: /save/i });
    expect(btn.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('still renders the children label alongside the spinner', () => {
    render(<Button loading>Saving</Button>);
    expect(screen.getByRole('button', { name: /saving/i })).toHaveTextContent('Saving');
  });

  it('does not render a spinner when loading is not set', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    // No SVG (spinner) in a non-loading button
    expect(btn.querySelectorAll('svg')).toHaveLength(0);
  });

  it('does not call onClick while loading', async () => {
    const handler = vi.fn();
    render(<Button loading onClick={handler}>Save</Button>);
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('Button — click behaviour', () => {
  it('calls onClick when the button is enabled and clicked', async () => {
    const handler = vi.fn();
    render(<Button onClick={handler}>Save</Button>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('calls onClick on each of multiple clicks', async () => {
    const handler = vi.fn();
    render(<Button onClick={handler}>+</Button>);
    await userEvent.click(screen.getByRole('button', { name: '+' }));
    await userEvent.click(screen.getByRole('button', { name: '+' }));
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
