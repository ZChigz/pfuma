import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Explicitly clean up the DOM after every test.
// @testing-library/react's auto-cleanup relies on the global afterEach being
// picked up at import time; making it explicit here guarantees it runs even
// when module loading order varies.
afterEach(() => {
  cleanup();
});
