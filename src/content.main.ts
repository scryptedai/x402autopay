import type { ChallengeDetails } from "./shared/types";
import { parseChallengeHeaders, isX402ResponseStatus } from "./shared/x402";

type FetchArgs = [input: RequestInfo | URL, init?: RequestInit];

function normalizeRequest(input: RequestInfo | URL, init?: RequestInit) {
  if (input instanceof Request) {
    return {
      input,
      method: input.method,
      headers: new Headers(input.headers),
    };
  }
  const headers = new Headers(init?.headers ?? {});
  const method = init?.method ?? "GET";
  return {
    input,
    method,
    headers,
  };
}

async function runtimeSendMessage<T = unknown>(payload: unknown): Promise<T> {
  const requestId = crypto.randomUUID();
  console.log("x402-autopay: runtimeSendMessage post", { requestId, payload });
  return new Promise<T>((resolve, reject) => {
    const handler = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as
        | { source: "x402-runtime-response"; requestId: string; result?: T; error?: string }
        | undefined;
      if (!data || data.source !== "x402-runtime-response" || data.requestId !== requestId) {
        return;
      }
      window.removeEventListener("message", handler);
      clearTimeout(timer);
      if (data.error) {
        console.warn("x402-autopay: runtimeSendMessage error", { requestId, error: data.error });
        reject(new Error(data.error));
      } else {
        console.log("x402-autopay: runtimeSendMessage result", { requestId });
        resolve(data.result as T);
      }
    };
    const timer = setTimeout(() => {
      window.removeEventListener("message", handler);
      console.warn("x402-autopay: runtimeSendMessage timeout", { requestId });
      reject(new Error("Runtime bridge timeout"));
    }, 10_000);
    window.addEventListener("message", handler);
    window.postMessage(
      {
        source: "x402-runtime-request",
        requestId,
        payload,
      },
      "*",
    );
  });
}

async function handleResponse(
  response: Response,
  requestMeta: ReturnType<typeof normalizeRequest>,
  originalArgs: FetchArgs,
): Promise<Response> {
  console.info("x402-autopay: handleResponse", {
    status: response.status,
    type: response.type,
    url: (response.url || (typeof requestMeta.input === "string" ? requestMeta.input : String(requestMeta.input))),
  });
  if (!isX402ResponseStatus(response.status)) {
    return response;
  }

  const url =
    response.url && response.url !== ""
      ? new URL(response.url)
      : new URL(
          typeof requestMeta.input === "string" ? requestMeta.input : requestMeta.input instanceof URL ? requestMeta.input.toString() : String(requestMeta.input),
        );
  let challenge = parseChallengeHeaders(response.headers, {
    origin: url.origin,
    endpoint: url.pathname,
    method: requestMeta.method,
  });

  if (!challenge) {
    challenge = await parseChallengeFromBody(response, {
      origin: url.origin,
      endpoint: url.pathname,
      method: requestMeta.method,
    });
  }

  if (!challenge) {
    try {
      const headerDump = Object.fromEntries(response.headers.entries());
      console.warn("x402-autopay: received 402 without a parsable challenge", {
        url: url.toString(),
        accessibleHeaders: headerDump,
        note: "If challenge headers are missing, the server may need to expose them via Access-Control-Expose-Headers.",
      });
    } catch (error) {
      console.warn("x402-autopay: received 402 without a parsable challenge", url.toString());
    }
    return response;
  }

  const rawChallenge = challenge.rawChallenge as Record<string, unknown> | undefined;
  const errorMessage = typeof rawChallenge?.error === "string" ? (rawChallenge.error as string) : undefined;
  const hasAccepts =
    rawChallenge && "accepts" in rawChallenge && Array.isArray((rawChallenge as { accepts?: unknown }).accepts)
      ? ((rawChallenge as { accepts?: unknown[] }).accepts?.length ?? 0) > 0
      : false;
  if (errorMessage && !hasAccepts) {
    console.warn("x402-autopay: upstream error", errorMessage);
    return response;
  }

  console.log("x402-autopay: parsed challenge", challenge);
  console.log("x402-autopay: sending challenge message");

  const resolution = await runtimeSendMessage({
    type: "x402:challenge",
    challenge,
  });

  if (!resolution) {
    return response;
  }

  if (resolution.action === "deny" || resolution.action === "error") {
    return response;
  }

  if (resolution.action === "pending" && resolution.challengeId) {
    return new Promise<Response>((resolve) => {
      const handler = (event: MessageEvent) => {
        if (event.source !== window) return;
        const data = event.data as
          | {
              source: "x402-runtime-broadcast";
              message: { type: string; challengeId?: string; resolution?: any };
            }
          | undefined;
        if (!data || data.source !== "x402-runtime-broadcast") return;
        const message = data.message;
        if (message?.type !== "x402:resolution" || message.challengeId !== resolution.challengeId) {
          return;
        }
        window.removeEventListener("message", handler);
        const result = message.resolution;
        if (result?.action === "retry" && result.retryHeaders) {
          retryWithHeaders(result.retryHeaders)
            .then(async (retried) => {
              await processSettlement(retried, result.retryHeaders ?? {});
              resolve(retried);
            })
            .catch((error) => {
              console.warn("Retry after prompt failed", error);
              resolve(response);
            });
        } else {
          resolve(response);
        }
      };
      window.addEventListener("message", handler);
    });
  }

  if (resolution.action === "retry" && resolution.retryHeaders) {
    const retried = await retryWithHeaders(resolution.retryHeaders);
    await processSettlement(retried, resolution.retryHeaders);
    return retried;
  }

  return response;

  function retryWithHeaders(retryHeaders: Record<string, string>) {
    const headers = new Headers(requestMeta.headers);
    for (const [key, value] of Object.entries(retryHeaders)) {
      headers.set(key, value);
    }
    const init: RequestInit = {
      ...originalArgs[1],
      method: requestMeta.method,
      headers,
    };
    return fetch(originalArgs[0], init);
  }
}

async function processSettlement(response: Response, requestHeaders: Record<string, string>) {
  if (!response.ok) return;
  const paymentId = requestHeaders["X-PAYMENT-ID"] ?? requestHeaders["x-payment-id"];
  const settlementHeader = response.headers.get("X-PAYMENT-RESPONSE") ?? response.headers.get("x-payment-response");
  if (!paymentId && !settlementHeader) return;
  try {
    let jwt: string | undefined;
    let txHash: string | undefined;
    let network: string | number | undefined;
    let parsedHeader: any;
    if (settlementHeader) {
      const parsed = parseSettlementValue(settlementHeader);
      parsedHeader = parsed.payload;
      jwt = parsed.jwt;
      if (parsed.payload && typeof parsed.payload === "object") {
        const candidate = parsed.payload as Record<string, unknown>;
        const tx = candidate.transaction ?? candidate.txHash;
        txHash = typeof tx === "string" ? tx : undefined;
        network = candidate.network;
        if (!jwt && typeof candidate.jwt === "string") {
          jwt = candidate.jwt;
        }
      }
    }
    await runtimeSendMessage({
      type: "x402:settlement",
      notice: {
        paymentId: paymentId ?? parsedHeader?.paymentId,
        txHash,
        network,
        jwt,
        status: "success",
      },
    });
  } catch (error) {
    console.warn("Failed to process settlement", error);
  }
}

function parseSettlementValue(raw: string): { payload?: unknown; jwt?: string } {
  const attemptJson = (input: string): unknown | undefined => {
    try {
      return JSON.parse(input);
    } catch {
      return undefined;
    }
  };

  const base64Pattern = /^[A-Za-z0-9+/=]+={0,2}$/;

  const directJson = attemptJson(raw);
  if (directJson && typeof directJson === "object") {
    return {
      payload: directJson,
      jwt: typeof (directJson as Record<string, unknown>).jwt === "string" ? ((directJson as Record<string, unknown>).jwt as string) : undefined,
    };
  }

  if (base64Pattern.test(raw)) {
    try {
      const decoded = atob(raw);
      const decodedJson = attemptJson(decoded);
      if (decodedJson && typeof decodedJson === "object") {
        return {
          payload: decodedJson,
          jwt:
            typeof (decodedJson as Record<string, unknown>).jwt === "string"
              ? ((decodedJson as Record<string, unknown>).jwt as string)
              : undefined,
        };
      }
      if (decoded.includes(".") && decoded.split(".").length >= 3) {
        return { jwt: decoded };
      }
    } catch (error) {
      console.warn("x402-autopay: failed to decode base64 settlement header", error);
    }
  }

  if (raw.includes(".") && raw.split(".").length >= 3) {
    return { jwt: raw };
  }

  return { jwt: raw };
}

const originalFetch = window.fetch.bind(window);
function patchedFetch(...args: FetchArgs) {
  const requestMeta = normalizeRequest(args[0], args[1]);
  return originalFetch(...args).then((response) => handleResponse(response, requestMeta, args));
}
Object.defineProperty(window, "fetch", {
  value: patchedFetch,
  configurable: true,
  writable: true,
});

console.info("x402-autopay: fetch interception enabled", {
  runtimeAvailable: Boolean((globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome?.runtime?.sendMessage),
});

export {};

async function parseChallengeFromBody(
  response: Response,
  requestInfo: { origin: string; endpoint: string; method: string },
): Promise<ChallengeDetails | undefined> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    console.warn("x402-autopay: response body not JSON", { contentType });
    return undefined;
  }
  let payload: unknown;
  try {
    payload = await response.clone().json();
  } catch (error) {
    console.warn("x402-autopay: failed to parse JSON body for challenge", error);
    return undefined;
  }
  if (!payload || typeof payload !== "object") {
    console.warn("x402-autopay: parsed JSON body but it is not an object");
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const recordAny = record as Record<string, unknown>;
  console.log("x402-autopay: body payload", record);
  const accepts = Array.isArray(record.accepts) ? record.accepts : [];
  const exact = accepts.find((entry) => entry && typeof entry === "object" && (entry as any).scheme === "exact") as
    | Record<string, unknown>
    | undefined;
  if (!exact) {
    console.warn("x402-autopay: accepts array missing exact scheme", { accepts });
    return undefined;
  }

  const atomicSource =
    typeof exact.maxAmountRequired === "string"
      ? exact.maxAmountRequired
      : typeof exact.amount === "string"
        ? exact.amount
        : typeof exact.maxAmountRequired === "number"
          ? exact.maxAmountRequired
          : undefined;

  const extra = (typeof exact.extra === "object" && exact.extra) || {};
  const extraAny = extra as Record<string, unknown>;
  const decimalsValue = extraAny.decimals;
  let decimals = 6;
  if (typeof decimalsValue === "number" && Number.isFinite(decimalsValue)) {
    decimals = decimalsValue;
  } else if (typeof decimalsValue === "string" && decimalsValue.trim() !== "") {
    const parsed = Number(decimalsValue);
    if (Number.isFinite(parsed)) {
      decimals = parsed;
    }
  }

  let amountAtomic: string | undefined;
  if (typeof atomicSource === "string") {
    const trimmed = atomicSource.trim();
    if (/^0x[0-9a-f]+$/i.test(trimmed)) {
      try {
        amountAtomic = BigInt(trimmed).toString();
      } catch (error) {
        console.warn("x402-autopay: failed to parse hex amount", { atomic: trimmed, error });
      }
    } else if (trimmed !== "") {
      amountAtomic = trimmed;
    }
  } else if (typeof atomicSource === "number" && Number.isFinite(atomicSource)) {
    amountAtomic = String(atomicSource);
  }

  if (!amountAtomic) {
    console.warn("x402-autopay: missing atomic amount in body", { exact });
    return undefined;
  }

  const asset = typeof exact.asset === "string" ? (exact.asset as `0x${string}`) : undefined;
  const payTo =
    typeof exact.payTo === "string"
      ? (exact.payTo as `0x${string}`)
      : typeof (exact.extra as any)?.recipientAddress === "string"
        ? ((exact.extra as any).recipientAddress as `0x${string}`)
        : undefined;
  if (!asset || !payTo) {
    return undefined;
  }

  const tokenName = typeof extraAny.name === "string" ? (extraAny.name as string) : undefined;
  const tokenVersion = typeof extraAny.version === "string" ? (extraAny.version as string) : undefined;
  const symbol = typeof extraAny.symbol === "string" ? (extraAny.symbol as string) : undefined;
  const bodyToken = typeof recordAny.token === "string" ? (recordAny.token as string) : undefined;
  const tokenSymbol: ChallengeDetails["tokenSymbol"] =
    symbol?.toUpperCase() === "USDC" || tokenName?.toUpperCase().includes("USD") || bodyToken?.toUpperCase() === "USDC"
      ? "USDC"
      : "USDC";

  let amountUsd = Number(recordAny.amountUsd ?? (exact as any).amountUsd ?? extraAny.amountUsd);
  if (!Number.isFinite(amountUsd)) {
    const atomicNumber = Number(amountAtomic);
    if (Number.isFinite(atomicNumber)) {
      amountUsd = atomicNumber / 10 ** decimals;
    } else {
      amountUsd = 0;
    }
  }

  const network = typeof exact.network === "string" ? exact.network : "eip155:137";
  let chainId = 137;
  const [, chainPart] = network.split(":");
  const parsedChain = Number(chainPart ?? network);
  if (Number.isFinite(parsedChain)) {
    chainId = parsedChain;
  }

  const challengeId = typeof recordAny.id === "string" ? (recordAny.id as string) : crypto.randomUUID();

  const rawHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    rawHeaders[key.toLowerCase()] = value;
  });

  console.log("x402-autopay: parsed challenge from body", {
    amountUsd,
    amountAtomic,
    chainId,
    asset,
    payTo,
  });

  return {
    amountUsd,
    tokenSymbol,
    challengeId,
    endpoint: requestInfo.endpoint,
    origin: requestInfo.origin,
    method: requestInfo.method,
    rawHeaders,
    chainId,
    tokenAddress: asset,
    seller: payTo,
    amountAtomic,
    tokenName,
    tokenVersion,
    tokenDecimals: decimals,
    rawChallenge: record,
  } satisfies ChallengeDetails;
}
