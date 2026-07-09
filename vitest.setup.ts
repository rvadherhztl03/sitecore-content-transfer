// vitest.setup.ts
import '@testing-library/jest-dom';

// Mock window.parent since it's used by the SDK and may throw in jsdom
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'parent', {
    value: {
      postMessage: () => {}
    },
    writable: true
  });
}
