// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';
// Browser production uses Web Crypto; CRA's old jsdom needs a test-only runtime.
if (!window.crypto?.getRandomValues) Object.defineProperty(window, 'crypto', {
  configurable: true, value: require('crypto').webcrypto
});
