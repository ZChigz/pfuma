import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '@/components/ui/Badge';

describe('Badge — label', () => {
  it('renders the label text', () => {
    render(<Badge label="Verified" />);
    expect(screen.getByText('Verified')).toBeInTheDocument();
  });

  it('is an inline span element', () => {
    render(<Badge label="Test" />);
    expect(screen.getByText('Test').tagName).toBe('SPAN');
  });
});

describe('Badge — variants', () => {
  it('applies neutral variant classes by default', () => {
    render(<Badge label="Unknown" />);
    const el = screen.getByText('Unknown').closest('span');
    expect(el).toHaveClass('bg-[#f5f5f4]', 'text-[#78716c]');
  });

  it('applies success variant classes', () => {
    render(<Badge variant="success" label="Verified" />);
    const el = screen.getByText('Verified').closest('span');
    expect(el).toHaveClass('bg-[#dcfce7]', 'text-[#15803d]');
  });

  it('applies warning variant classes', () => {
    render(<Badge variant="warning" label="Pending" />);
    const el = screen.getByText('Pending').closest('span');
    expect(el).toHaveClass('bg-[#fef9c3]', 'text-[#b45309]');
  });

  it('applies danger variant classes', () => {
    render(<Badge variant="danger" label="Overdue" />);
    const el = screen.getByText('Overdue').closest('span');
    expect(el).toHaveClass('bg-[#fee2e2]', 'text-[#b91c1c]');
  });

  it('applies gold variant classes', () => {
    render(<Badge variant="gold" label="Director" />);
    const el = screen.getByText('Director').closest('span');
    expect(el).toHaveClass('bg-[#fef3c7]', 'text-[#b45309]');
  });
});

describe('Badge — icon', () => {
  it('renders the icon when provided', () => {
    render(<Badge label="Active" icon={<span data-testid="badge-icon" />} />);
    expect(screen.getByTestId('badge-icon')).toBeInTheDocument();
  });

  it('renders no icon wrapper when icon prop is omitted', () => {
    render(<Badge label="Active" />);
    // The icon wrapper span has aria-hidden="true" — nothing with that should exist
    expect(document.querySelector('span[aria-hidden="true"]')).not.toBeInTheDocument();
  });
});

describe('Badge — className override', () => {
  it('merges a custom className onto the badge', () => {
    render(<Badge label="Custom" className="extra-class" />);
    const el = screen.getByText('Custom').closest('span');
    expect(el).toHaveClass('extra-class');
  });
});
