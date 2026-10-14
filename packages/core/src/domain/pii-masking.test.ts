import { describe, expect, it } from 'vitest';

import { maskEmail, maskPhone } from './pii-masking.js';

describe('maskEmail', () => {
  it('keeps first/last char of the local part and the full domain', () => {
    expect(maskEmail('jasmine@example.test')).toBe('j*****e@example.test');
  });

  it('masks a very short local part entirely', () => {
    expect(maskEmail('ab@example.test')).toBe('**@example.test');
    expect(maskEmail('a@example.test')).toBe('*@example.test');
  });

  it('never reveals the real local part for any input', () => {
    const real = 'founder@healthyaahar.test';
    expect(maskEmail(real)).not.toContain('founder');
  });
});

describe('maskPhone', () => {
  it('keeps a leading + and the last 4 digits, masks the middle', () => {
    expect(maskPhone('+919876543210')).toBe('+********3210');
  });

  it('handles a phone with no country code', () => {
    expect(maskPhone('9876543210')).toBe('******3210');
  });

  it('masks a short number entirely rather than leaking it', () => {
    expect(maskPhone('123')).toBe('***');
  });
});
