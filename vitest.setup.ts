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

// jsdom polyfills for Radix UI
if (typeof Element !== 'undefined') {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
