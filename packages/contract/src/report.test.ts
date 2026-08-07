import { describe, expect, it } from 'vitest';

import { EXPORT_DEPTHS_MINUTES, isExportDepth, MAX_EXPORT_DEPTH_MINUTES } from './report';

describe('export depths', () => {
  it('offers exactly the four depths the product promises', () => {
    expect(EXPORT_DEPTHS_MINUTES).toEqual([5, 15, 30, 60]);
  });

  it('caps at one hour', () => {
    expect(Math.max(...EXPORT_DEPTHS_MINUTES)).toBe(MAX_EXPORT_DEPTH_MINUTES);
  });
});

describe('isExportDepth', () => {
  it('accepts every offered depth', () => {
    expect(EXPORT_DEPTHS_MINUTES.every(isExportDepth)).toBe(true);
  });

  it.each([0, 1, 45, 90, '15', null, undefined])('rejects %p', (candidate) => {
    expect(isExportDepth(candidate)).toBe(false);
  });
});
