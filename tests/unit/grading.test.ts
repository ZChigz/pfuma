import { describe, it, expect } from 'vitest';

// Grade boundary lookup matching the seed data configuration:
//   A: 80–100, B: 70–79, C: 60–69, D: 50–59, E: 40–49, F: 0–39

interface GradeBoundary {
  min: number;
  letter: string;
}

// Mirrors the lookup logic in app/portal/[token]/page.tsx and the mark-entry API.
// Boundaries are sorted descending so the first match wins.
function lookupGrade(mark: number, boundaries: GradeBoundary[]): string {
  const sorted = [...boundaries].sort((a, b) => b.min - a.min);
  return sorted.find((b) => mark >= b.min)?.letter ?? 'F';
}

const BOUNDARIES: GradeBoundary[] = [
  { min: 80, letter: 'A' },
  { min: 70, letter: 'B' },
  { min: 60, letter: 'C' },
  { min: 50, letter: 'D' },
  { min: 40, letter: 'E' },
  { min: 0,  letter: 'F' },
];

describe('lookupGrade — boundary values', () => {
  it('returns A for exactly 80 (minimum A boundary)', () => {
    expect(lookupGrade(80, BOUNDARIES)).toBe('A');
  });

  it('returns A for 100 (maximum possible mark)', () => {
    expect(lookupGrade(100, BOUNDARIES)).toBe('A');
  });

  it('returns A for a mid-range A mark (95)', () => {
    expect(lookupGrade(95, BOUNDARIES)).toBe('A');
  });

  it('returns B for exactly 70 (minimum B boundary)', () => {
    expect(lookupGrade(70, BOUNDARIES)).toBe('B');
  });

  it('returns B for 79 (one mark below A boundary)', () => {
    expect(lookupGrade(79, BOUNDARIES)).toBe('B');
  });

  it('returns C for exactly 60 (minimum C boundary)', () => {
    expect(lookupGrade(60, BOUNDARIES)).toBe('C');
  });

  it('returns C for 69 (one mark below B boundary)', () => {
    expect(lookupGrade(69, BOUNDARIES)).toBe('C');
  });

  it('returns D for exactly 50 (minimum D boundary)', () => {
    expect(lookupGrade(50, BOUNDARIES)).toBe('D');
  });

  it('returns D for 59 (one mark below C boundary)', () => {
    expect(lookupGrade(59, BOUNDARIES)).toBe('D');
  });

  it('returns E for exactly 40 (minimum E boundary)', () => {
    expect(lookupGrade(40, BOUNDARIES)).toBe('E');
  });

  it('returns E for 49 (one mark below D boundary)', () => {
    expect(lookupGrade(49, BOUNDARIES)).toBe('E');
  });

  it('returns F for 39 (one mark below E boundary)', () => {
    expect(lookupGrade(39, BOUNDARIES)).toBe('F');
  });

  it('returns F for 0 (minimum possible mark)', () => {
    expect(lookupGrade(0, BOUNDARIES)).toBe('F');
  });

  it('returns F for a mid-range failing mark (20)', () => {
    expect(lookupGrade(20, BOUNDARIES)).toBe('F');
  });
});

describe('lookupGrade — boundary ordering robustness', () => {
  it('produces the same result when boundaries are provided in ascending order', () => {
    const ascending: GradeBoundary[] = [
      { min: 0,  letter: 'F' },
      { min: 40, letter: 'E' },
      { min: 50, letter: 'D' },
      { min: 60, letter: 'C' },
      { min: 70, letter: 'B' },
      { min: 80, letter: 'A' },
    ];
    expect(lookupGrade(85, ascending)).toBe('A');
    expect(lookupGrade(75, ascending)).toBe('B');
    expect(lookupGrade(35, ascending)).toBe('F');
  });

  it('returns the fallback F when no boundary matches (empty list)', () => {
    expect(lookupGrade(50, [])).toBe('F');
  });
});
