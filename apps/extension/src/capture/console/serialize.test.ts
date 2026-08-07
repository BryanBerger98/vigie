import { describe, expect, it } from 'vitest';

import {
  clipText,
  MAX_ENTRIES,
  MAX_STRING_LENGTH,
  MAX_TEXT_LENGTH,
  serializeArguments,
} from './serialize';

/**
 * The serialiser runs in the user's page, on values the page chose. Everything asserted here is
 * either "the reader can understand it" or "it cannot cost more than a bounded amount", because
 * those are the two ways this module can fail in production and neither shows up as an exception.
 */

describe('primitives', () => {
  it('renders a lone string bare, the way the console shows it', () => {
    expect(serializeArguments(['hello'])).toEqual({ text: 'hello', truncated: false });
  });

  it('joins several arguments with a space', () => {
    expect(serializeArguments(['count', 3, true]).text).toBe('count 3 true');
  });

  it('keeps null and undefined apart', () => {
    expect(serializeArguments([null, undefined]).text).toBe('null undefined');
  });

  it('marks a bigint and a symbol as what they are', () => {
    expect(serializeArguments([10n, Symbol('tag')]).text).toBe('10n Symbol(tag)');
  });

  it('names a function rather than printing its source', () => {
    function handler(): void {}
    expect(serializeArguments([handler]).text).toBe('[Function: handler]');
  });

  it('quotes strings nested in a structure, so an empty string is visible', () => {
    expect(serializeArguments([{ label: '' }]).text).toBe("{ label: '' }");
  });
});

describe('structures', () => {
  it('renders an array', () => {
    expect(serializeArguments([[1, 'two', null]]).text).toBe("[1, 'two', null]");
  });

  it('renders a plain object without a constructor label', () => {
    expect(serializeArguments([{ a: 1, b: { c: 2 } }]).text).toBe('{ a: 1, b: { c: 2 } }');
  });

  it('labels a class instance, which is often the whole point of the log', () => {
    class Session {
      id = 'abc';
    }
    expect(serializeArguments([new Session()]).text).toBe("Session { id: 'abc' }");
  });

  it('renders an empty object without dangling braces', () => {
    expect(serializeArguments([{}]).text).toBe('{}');
  });

  it('renders a Map and a Set as their contents, not as empty objects', () => {
    expect(serializeArguments([new Map([['k', 1]])]).text).toBe("Map(1) {'k' => 1}");
    expect(serializeArguments([new Set([1, 2])]).text).toBe('Set(2) {1, 2}');
  });

  it('survives a getter that throws instead of losing the whole line', () => {
    const value = {
      ok: 1,
      get broken(): never {
        throw new Error('nope');
      },
    };

    expect(serializeArguments([value]).text).toBe("{ ok: 1, broken: '[unreadable]' }");
  });
});

describe('errors', () => {
  it('renders the stack, which already carries the name and the message', () => {
    const error = new Error('boom');
    error.stack = 'Error: boom\n    at page.js:1:1';

    expect(serializeArguments([error]).text).toBe('Error: boom\n    at page.js:1:1');
  });

  it('falls back to the name and message when there is no stack', () => {
    const error = new TypeError('bad type');
    error.stack = undefined;

    expect(serializeArguments([error]).text).toBe('TypeError: bad type');
  });
});

describe('DOM nodes', () => {
  /** Duck-typed on purpose: `Node` does not exist in this environment, the shape check does. */
  const node = (overrides: Record<string, unknown>) => ({
    nodeType: 1,
    nodeName: 'DIV',
    ...overrides,
  });

  it('renders a node as a selector, never as its subtree', () => {
    expect(serializeArguments([node({ id: 'app', className: 'panel dark' })]).text).toBe(
      '<div#app.panel.dark>',
    );
  });

  it('leaves out the parts a node does not have', () => {
    expect(serializeArguments([node({ id: '', className: '' })]).text).toBe('<div>');
  });
});

describe('cycles', () => {
  it('stops at a self-reference without hanging', () => {
    const value: Record<string, unknown> = { name: 'root' };
    value.self = value;

    expect(serializeArguments([value]).text).toBe("{ name: 'root', self: [Circular] }");
  });

  it('stops at a cycle two levels down', () => {
    const parent: Record<string, unknown> = {};
    const child = { parent };
    parent.child = child;

    expect(serializeArguments([parent]).text).toBe('{ child: { parent: [Circular] } }');
  });

  it('renders the same object twice when it is a diamond, not a cycle', () => {
    const shared = { id: 1 };

    expect(serializeArguments([[shared, shared]]).text).toBe('[{ id: 1 }, { id: 1 }]');
  });
});

describe('truncation', () => {
  it('marks a string that exceeds the per-value ceiling', () => {
    const long = 'x'.repeat(MAX_STRING_LENGTH + 10);
    const result = serializeArguments([long]);

    expect(result.truncated).toBe(true);
    expect(result.text).toBe(`${'x'.repeat(MAX_STRING_LENGTH)}…[+10 chars]`);
  });

  it('leaves a string at exactly the ceiling alone', () => {
    const result = serializeArguments(['x'.repeat(MAX_STRING_LENGTH)]);

    expect(result.truncated).toBe(false);
    expect(result.text).toHaveLength(MAX_STRING_LENGTH);
  });

  it('marks an array longer than the breadth ceiling and says how much was dropped', () => {
    const result = serializeArguments([Array.from({ length: MAX_ENTRIES + 3 }, (_, i) => i)]);

    expect(result.truncated).toBe(true);
    expect(result.text).toContain('…[+3 more]');
  });

  it('marks an object with more keys than the breadth ceiling', () => {
    const wide = Object.fromEntries(
      Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => [`k${i}`, i]),
    );
    const result = serializeArguments([wide]);

    expect(result.truncated).toBe(true);
    expect(result.text).toContain('…[+1 more]');
  });

  it('summarises past the depth ceiling rather than walking forever', () => {
    const deep = { a: { b: { c: { d: { e: 'buried' } } } } };
    const result = serializeArguments([deep]);

    expect(result.truncated).toBe(true);
    expect(result.text).toBe('{ a: { b: { c: { d: [Object] } } } }');
    expect(result.text).not.toContain('buried');
  });

  it('summarises a deeply nested array as an array, not as an object', () => {
    const result = serializeArguments([[[[[['deep']]]]]]);

    expect(result.text).toContain('[Array]');
  });

  it('cuts the joined line at the whole-entry ceiling', () => {
    const chunk = 'y'.repeat(MAX_STRING_LENGTH);
    const args = Array.from({ length: 10 }, () => chunk);
    const result = serializeArguments(args);

    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThan(MAX_TEXT_LENGTH + 40);
    expect(result.text).toContain('chars]');
  });
});

describe('clipText', () => {
  it('leaves a short value untouched', () => {
    expect(clipText('short')).toEqual({ text: 'short', truncated: false });
  });

  it('cuts and marks a long one', () => {
    const result = clipText('z'.repeat(MAX_STRING_LENGTH + 1));

    expect(result.truncated).toBe(true);
    expect(result.text.endsWith('…[+1 chars]')).toBe(true);
  });
});
