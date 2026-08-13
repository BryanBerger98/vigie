/**
 * Local declarations for the MV3 surfaces Chrome's own typings still miss.
 *
 * `chrome.debugger` itself is typed: `@wxt-dev/browser` carries `attach`, `detach`, `sendCommand`,
 * `getTargets`, `onDetach` and `onEvent` with real signatures. What stops at the API boundary is
 * everything that travels *through* it. `sendCommand` takes `{ [key: string]: unknown }` and
 * answers `object`; `onEvent` hands over `params?: object`. Those payloads belong to the debugging
 * protocol, not to the extension API, so no typings package carries them and the alternative is
 * `as any` at every call site of the capture layer.
 *
 * Only the slices this product sends or reads are declared. The protocol has several hundred
 * commands and typing them all would be a vendored copy of `browser_protocol.json` that nothing
 * keeps in step with the browser actually running.
 *
 * Declared as type aliases rather than interfaces on purpose: `sendCommand` takes an index
 * signature, and TypeScript only infers an implicit one for an object type alias.
 */

/** Which tab a command or an event belongs to. The only debuggee shape this product uses. */
export type TabDebuggee = { tabId: number };

/**
 * The five parameters of `Network.enable`, none of them optional here.
 *
 * The CDP reference marks all five optional, which is how a caller ends up passing two and letting
 * the renderer buffer grow by hundreds of megabytes on the user's own tab. Requiring them here is
 * what makes an incomplete call a compile error rather than a memory reading nobody takes.
 */
export type NetworkEnableParams = {
  maxTotalBufferSize: number;
  maxResourceBufferSize: number;
  maxPostDataSize: number;
  reportDirectSocketTraffic: boolean;
  enableDurableMessages: boolean;
};

/**
 * Headers as the protocol carries them: one object, values already joined for a repeated name.
 * `webRequest` hands over a list of pairs instead, which is the shape the contract keeps.
 */
export type CdpHeaders = Record<string, string>;

/**
 * The six `Network` events the capture subscribes to, narrowed to the fields it reads.
 *
 * Two clocks travel through them. `timestamp` is monotonic seconds since an arbitrary origin — good
 * for a duration and for nothing else — while `wallTime`, present on the announcement alone, is the
 * epoch in seconds. An entry's moment is therefore rebuilt from the two, never read from one.
 */
export type NetworkRequestWillBeSentParams = {
  requestId: string;
  request: { url: string; method: string; headers: CdpHeaders; postData?: string };
  timestamp: number;
  wallTime: number;
  /** CDP's own `ResourceType`, capitalised — `Document`, `XHR`, `Fetch`. Not `webRequest`'s enum. */
  type?: string;
  /** Present on each hop of a redirect chain, which reuses the same `requestId`. */
  redirectResponse?: { url: string; status: number };
};

/**
 * The wire-level request headers, sent as a second event.
 *
 * This is the one that carries what the ordinary announcement does not: `Cookie`, and the HTTP/2
 * pseudo-headers. It is also the reason an attached tab's entries hold more headers than the rest.
 */
export type NetworkRequestWillBeSentExtraInfoParams = {
  requestId: string;
  headers: CdpHeaders;
};

export type NetworkResponseReceivedParams = {
  requestId: string;
  timestamp: number;
  type?: string;
  response: { url: string; status: number; headers: CdpHeaders; mimeType?: string };
};

export type NetworkDataReceivedParams = {
  requestId: string;
  timestamp: number;
  dataLength: number;
  encodedDataLength: number;
};

export type NetworkLoadingFinishedParams = {
  requestId: string;
  timestamp: number;
  encodedDataLength: number;
};

export type NetworkLoadingFailedParams = {
  requestId: string;
  timestamp: number;
  errorText: string;
  canceled?: boolean;
  blockedReason?: string;
};

/**
 * The one command sent outside the attach sequence, and the only one that can fail routinely.
 *
 * `base64Encoded` is the protocol's answer for a body it does not consider text — an image, a font,
 * a compressed stream it could not decode. The flag is what the caller refuses on, rather than
 * trusting a `Content-Type` a server may not have sent.
 */
export type NetworkGetResponseBodyParams = {
  requestId: string;
};

export type NetworkGetResponseBodyResult = {
  body: string;
  base64Encoded: boolean;
};
