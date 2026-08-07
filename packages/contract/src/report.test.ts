import { describe, expect, it } from 'vitest';

import {
  EXPORT_DEPTHS_MINUTES,
  GAP_STATEMENTS,
  isExportDepth,
  MAX_EXPORT_DEPTH_MINUTES,
  reportGap,
  STRUCTURAL_GAPS,
  type GapKind,
} from './report';

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

describe('gaps', () => {
  const KINDS: GapKind[] = [
    'response-bodies-unavailable',
    'browser-messages-out-of-reach',
    'capture-started-after-page-load',
    'window-shrunk-by-quota',
  ];

  it('has a statement for every kind, so no gap can render as a bare code', () => {
    expect(Object.keys(GAP_STATEMENTS).sort()).toEqual([...KINDS].sort());
  });

  it.each(KINDS)('states %s as a sentence, not a label', (kind) => {
    const statement = GAP_STATEMENTS[kind];

    expect(statement.length).toBeGreaterThan(60);
    expect(statement.endsWith('.')).toBe(true);
  });

  it('builds a gap from its canonical wording', () => {
    expect(reportGap('window-shrunk-by-quota')).toEqual({
      kind: 'window-shrunk-by-quota',
      statement: GAP_STATEMENTS['window-shrunk-by-quota'],
    });
  });

  it('declares the two gaps that hold for every report, whatever was captured', () => {
    expect(STRUCTURAL_GAPS).toEqual([
      'response-bodies-unavailable',
      'browser-messages-out-of-reach',
    ]);
  });

  it('leaves the two conditional gaps out of the structural set', () => {
    expect(STRUCTURAL_GAPS).not.toContain('capture-started-after-page-load');
    expect(STRUCTURAL_GAPS).not.toContain('window-shrunk-by-quota');
  });
});
