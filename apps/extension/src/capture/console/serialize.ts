/**
 * Turns arbitrary console arguments into one line of text.
 *
 * This is the most exposed code in the extension: it runs in the main thread of the user's page,
 * on values the page chose, synchronously, before the page's own `console` call returns. Three
 * consequences shape every decision here.
 *
 * - **Bounded, always.** Depth, breadth and length all have ceilings. A log of a Redux store or a
 *   DOM tree must cost the same as a log of a string, or the promise of "no perceptible
 *   degradation" (`spec.md:18`) is broken by the first developer who logs their state.
 * - **Marked, never silent.** Every ceiling that bites sets `truncated` and leaves a visible
 *   marker in the text. A reader debugging from the report has to be able to tell a value that
 *   was short from a value that was cut.
 * - **Text, not structure.** The result crosses `postMessage`, and a structured clone of a page
 *   object can fail outright (functions, DOM nodes) or copy megabytes. Serialising here means the
 *   boundary only ever carries a string.
 */

/** Longest a single string value may be. Generous: a stack trace or a JSON blob is the point. */
export const MAX_STRING_LENGTH = 4_096;

/** Longest the whole serialised line may be, after the arguments are joined. */
export const MAX_TEXT_LENGTH = 16_384;

/** How deep an object graph is walked before it is summarised. */
export const MAX_DEPTH = 4;

/** How many array items or object keys are rendered at any one level. */
export const MAX_ENTRIES = 50;

export interface SerializedArguments {
  text: string;
  /** `true` when any ceiling above was reached. Stored on the entry, rendered in the report. */
  truncated: boolean;
}

/** State carried through one serialisation: what was cut, and which objects are ancestors. */
interface Walk {
  truncated: boolean;
  /**
   * The objects currently being rendered, not every object already seen. Deleting on the way out
   * is what makes `[a, a]` render twice and `a.self = a` render as `[Circular]` — a diamond is
   * not a cycle, and calling it one would hide data the reader needs.
   */
  ancestors: WeakSet<object>;
}

function clip(value: string, limit: number, walk: Walk): string {
  if (value.length <= limit) return value;
  walk.truncated = true;
  return `${value.slice(0, limit)}…[+${value.length - limit} chars]`;
}

/**
 * Cuts a single string to the per-value ceiling, saying whether it had to.
 *
 * Exported for the error path, which carries a message and a stack rather than a list of
 * arguments but owes the reader the same guarantee about what was cut.
 */
export function clipText(value: string): SerializedArguments {
  const walk: Walk = { truncated: false, ancestors: new WeakSet() };
  return { text: clip(value, MAX_STRING_LENGTH, walk), truncated: walk.truncated };
}

/**
 * `instanceof` plus the tag, because a page can throw an `Error` built in an iframe's realm, where
 * its prototype chain is not ours.
 */
function isError(value: object): value is Error {
  return value instanceof Error || Object.prototype.toString.call(value) === '[object Error]';
}

/**
 * A DOM node recognised by shape rather than by `instanceof Node`.
 *
 * `Node` is undefined in the unit environment, and an `instanceof` there would silently fall
 * through to the object renderer — a branch tested nowhere would then be the one shipping.
 */
function isDomNode(value: object): boolean {
  const candidate = value as { nodeType?: unknown; nodeName?: unknown };
  return typeof candidate.nodeType === 'number' && typeof candidate.nodeName === 'string';
}

/** A node as a selector rather than as its subtree: `<div#app.panel>`. */
function describeNode(value: object): string {
  const node = value as { nodeName: string; id?: unknown; className?: unknown };
  const name = node.nodeName.toLowerCase();
  const id = typeof node.id === 'string' && node.id ? `#${node.id}` : '';
  const classes =
    typeof node.className === 'string' && node.className.trim()
      ? `.${node.className.trim().split(/\s+/).join('.')}`
      : '';
  return `<${name}${id}${classes}>`;
}

/** The constructor name, prefixed for rendering. Empty for a plain object, which needs no label. */
function label(value: object): string {
  const name = (value as { constructor?: { name?: unknown } }).constructor?.name;
  if (typeof name !== 'string' || name === 'Object' || name === '') return '';
  return `${name} `;
}

/** Reading a property can run a getter, and a getter can throw. That is the page's code, not ours. */
function read(value: object, key: string): unknown {
  try {
    return (value as Record<string, unknown>)[key];
  } catch {
    return '[unreadable]';
  }
}

function joinBounded(parts: string[], total: number, walk: Walk): string {
  if (total <= MAX_ENTRIES) return parts.join(', ');
  walk.truncated = true;
  return [...parts, `…[+${total - MAX_ENTRIES} more]`].join(', ');
}

function render(value: unknown, depth: number, walk: Walk, quoted: boolean): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';

  switch (typeof value) {
    case 'string': {
      const text = clip(value, MAX_STRING_LENGTH, walk);
      // Quoted inside a structure, bare at the top level — which is what `console.log` shows.
      return quoted ? `'${text}'` : text;
    }
    case 'number':
    case 'boolean':
      return String(value);
    case 'bigint':
      return `${value}n`;
    case 'symbol':
      return value.toString();
    case 'function':
      return `[Function: ${value.name || 'anonymous'}]`;
  }

  const object = value as object;
  if (walk.ancestors.has(object)) return '[Circular]';
  if (isError(object)) return renderError(object, walk);
  if (isDomNode(object)) return describeNode(object);

  if (depth >= MAX_DEPTH) {
    walk.truncated = true;
    if (Array.isArray(object)) return '[Array]';
    return `[${label(object).trim() || 'Object'}]`;
  }

  walk.ancestors.add(object);
  try {
    if (Array.isArray(object)) return renderArray(object, depth, walk);
    if (object instanceof Map) return renderMap(object, depth, walk);
    if (object instanceof Set) return renderSet(object, depth, walk);
    return renderObject(object, depth, walk);
  } finally {
    walk.ancestors.delete(object);
  }
}

/** The stack when there is one: it already carries the name and the message on its first line. */
function renderError(error: Error, walk: Walk): string {
  const stack = (error as { stack?: unknown }).stack;
  if (typeof stack === 'string' && stack.length > 0) return clip(stack, MAX_STRING_LENGTH, walk);
  return clip(`${error.name}: ${error.message}`, MAX_STRING_LENGTH, walk);
}

function renderArray(items: unknown[], depth: number, walk: Walk): string {
  const shown = items.slice(0, MAX_ENTRIES).map((item) => render(item, depth + 1, walk, true));
  return `[${joinBounded(shown, items.length, walk)}]`;
}

function renderMap(map: Map<unknown, unknown>, depth: number, walk: Walk): string {
  const shown = [...map.entries()]
    .slice(0, MAX_ENTRIES)
    .map(([key, item]) => `${render(key, depth + 1, walk, true)} => ${render(item, depth + 1, walk, true)}`);
  return `Map(${map.size}) {${joinBounded(shown, map.size, walk)}}`;
}

function renderSet(set: Set<unknown>, depth: number, walk: Walk): string {
  const shown = [...set.values()].slice(0, MAX_ENTRIES).map((item) => render(item, depth + 1, walk, true));
  return `Set(${set.size}) {${joinBounded(shown, set.size, walk)}}`;
}

function renderObject(object: object, depth: number, walk: Walk): string {
  const keys = Object.keys(object);
  if (keys.length === 0) return `${label(object)}{}`;
  const shown = keys
    .slice(0, MAX_ENTRIES)
    .map((key) => `${key}: ${render(read(object, key), depth + 1, walk, true)}`);
  return `${label(object)}{ ${joinBounded(shown, keys.length, walk)} }`;
}

/**
 * Serialises one `console.*` call's arguments, joined the way the console joins them.
 *
 * A value that defeats the renderer — a hostile proxy, a getter that throws past the guard —
 * becomes `[unserializable]` rather than an exception. Nothing here may reach the page: the
 * capture is an observer, and an observer that throws has changed what it observed.
 */
export function serializeArguments(args: readonly unknown[]): SerializedArguments {
  const walk: Walk = { truncated: false, ancestors: new WeakSet() };

  const parts = args.map((argument) => {
    try {
      return render(argument, 0, walk, false);
    } catch {
      walk.truncated = true;
      return '[unserializable]';
    }
  });

  const joined = parts.join(' ');
  if (joined.length <= MAX_TEXT_LENGTH) return { text: joined, truncated: walk.truncated };

  walk.truncated = true;
  return {
    text: `${joined.slice(0, MAX_TEXT_LENGTH)}…[+${joined.length - MAX_TEXT_LENGTH} chars]`,
    truncated: true,
  };
}
