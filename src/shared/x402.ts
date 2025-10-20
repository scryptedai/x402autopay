import type { ChallengeDetails } from "./types";

const HEADER_CHALLENGE_JSON = "x-payment-challenge";
const HEADER_ID = "x-402-id";

type HeaderSource = {
  get(name: string): string | null;
  forEach(callback: (value: string, key: string) => void): void;
};

function baseDetails(
  headers: HeaderSource,
  requestInfo: { origin: string; endpoint: string; method: string },
) {
  const rawHeaders: Record<string, string> = {};
  headers.forEach((value, key) => {
    rawHeaders[key.toLowerCase()] = value;
  });
  const challengeId =
    headers.get(HEADER_ID) ?? rawHeaders[HEADER_ID] ?? crypto.randomUUID();
  return { rawHeaders, challengeId } as const;
}

function parseChallengeValue(
  value: string,
  requestInfo: { origin: string; endpoint: string; method: string },
  rawHeaders: Record<string, string>,
  fallbackId: string,
): ChallengeDetails | undefined {
  const attempts: string[] = [];
  const trimmed = value.trim();
  if (trimmed) {
    attempts.push(trimmed);
    const base64Pattern = /^[A-Za-z0-9+/=]+$/;
    if (base64Pattern.test(trimmed)) {
      try {
        const decoded = atob(trimmed);
        attempts.push(decoded);
      } catch (error) {
        console.warn("Failed to base64 decode challenge value", error);
      }
    }
  }
  for (const attempt of attempts) {
    const challenge = fromJsonChallenge(attempt, requestInfo, rawHeaders, fallbackId);
    if (challenge) {
      return challenge;
    }
  }
  return undefined;
}

function fromJsonChallenge(
  challengeJson: string,
  requestInfo: { origin: string; endpoint: string; method: string },
  rawHeaders: Record<string, string>,
  fallbackId: string,
): ChallengeDetails | undefined {
  try {
    const parsed = JSON.parse(challengeJson);
    if (!parsed || typeof parsed !== "object") return undefined;
    const {
      amount,
      amountUsd,
      token,
      chainId,
      seller,
      tokenAddress,
      tokenName,
      tokenVersion,
      tokenDecimals,
      id,
    } = parsed as Record<string, unknown>;
    const atomic = typeof amount === "string" ? amount : String(amount ?? "0");
    const requestAmountUsd = typeof amountUsd === "number" ? amountUsd : Number(amountUsd ?? 0);
    const tokenSymbol = typeof token === "string" ? (token.toUpperCase() as ChallengeDetails["tokenSymbol"]) : "USDC";
    const chain = typeof chainId === "number" ? chainId : Number(chainId ?? 0);
    if (!chain || !tokenAddress || typeof seller !== "string") return undefined;
    return {
      amountUsd: Number.isFinite(requestAmountUsd) ? requestAmountUsd : 0,
      tokenSymbol,
      challengeId: typeof id === "string" ? id : fallbackId,
      endpoint: requestInfo.endpoint,
      origin: requestInfo.origin,
      method: requestInfo.method,
      rawHeaders,
      chainId: chain,
      tokenAddress: tokenAddress as `0x${string}`,
      seller: seller as `0x${string}`,
      amountAtomic: atomic,
      tokenName: typeof tokenName === "string" ? tokenName : undefined,
      tokenVersion: typeof tokenVersion === "string" ? tokenVersion : undefined,
      tokenDecimals: typeof tokenDecimals === "number" ? tokenDecimals : undefined,
      rawChallenge: parsed,
    } satisfies ChallengeDetails;
  } catch (error) {
    console.warn("Failed to parse x402 challenge JSON", error);
    return undefined;
  }
}

export function parseChallengeHeaders(
  headers: HeaderSource,
  requestInfo: { origin: string; endpoint: string; method: string },
): ChallengeDetails | undefined {
  const { rawHeaders, challengeId } = baseDetails(headers, requestInfo);
  const jsonHeader = headers.get(HEADER_CHALLENGE_JSON) ?? rawHeaders[HEADER_CHALLENGE_JSON];
  if (jsonHeader) {
    const parsed = parseChallengeValue(jsonHeader, requestInfo, rawHeaders, challengeId);
    if (parsed) return parsed;
  }

  const authHeader = headers.get("www-authenticate") ?? rawHeaders["www-authenticate"];
  if (authHeader) {
    const parsed = fromAuthenticateChallenge(authHeader, requestInfo, rawHeaders, challengeId);
    if (parsed) return parsed;
  }

  // Fallback legacy headers
  const amountUsd = Number(rawHeaders["x-402-amount"] ?? rawHeaders["x-payment-amount-usd"] ?? 0);
  const tokenSymbol = (rawHeaders["x-402-token"] ?? rawHeaders["x-payment-token"] ?? "USDC") as ChallengeDetails["tokenSymbol"];
  const seller = rawHeaders["x-402-address"] ?? rawHeaders["x-payment-seller"];
  const tokenAddress = rawHeaders["x-402-token-address"] ?? rawHeaders["x-payment-token-address"];
  const chain = Number(rawHeaders["x-402-chain"] ?? rawHeaders["x-payment-chain"] ?? 137);
  const atomic = rawHeaders["x-402-amount-atomic"] ?? rawHeaders["x-payment-amount"];
  if (!seller || !tokenAddress || !atomic) {
    return undefined;
  }
  return {
    amountUsd,
    tokenSymbol,
    challengeId,
    endpoint: requestInfo.endpoint,
    origin: requestInfo.origin,
    method: requestInfo.method,
    rawHeaders,
    chainId: chain,
    tokenAddress: tokenAddress as `0x${string}`,
    seller: seller as `0x${string}`,
    amountAtomic: String(atomic),
  } satisfies ChallengeDetails;
}

export function isX402ResponseStatus(status: number) {
  return status === 402;
}

function fromAuthenticateChallenge(
  headerValue: string,
  requestInfo: { origin: string; endpoint: string; method: string },
  rawHeaders: Record<string, string>,
  fallbackId: string,
): ChallengeDetails | undefined {
  const match = headerValue.match(/^\s*(x-?402)\s+(.+)$/i);
  if (!match) return undefined;
  const paramsPart = match[2];
  const paramRegex = /\s*([a-zA-Z0-9_-]+)=(("[^"]*")|([^,]+))/g;
  const params: Record<string, string> = {};
  let exec: RegExpExecArray | null;
  while ((exec = paramRegex.exec(paramsPart)) !== null) {
    const key = exec[1];
    const raw = exec[3] ?? exec[4] ?? "";
    params[key] = raw.replace(/^"|"$/g, "");
  }

  const challengeValue = params.challenge ?? params.payload;
  if (challengeValue) {
    const parsed = parseChallengeValue(challengeValue, requestInfo, rawHeaders, fallbackId);
    if (parsed) {
      return parsed;
    }
  }

  const amountUsdStr = params.amountUsd ?? params.amount_usd ?? params.price ?? params.cost;
  const amountUsd = amountUsdStr ? Number(amountUsdStr) : 0;
  const tokenParam = params.token ?? params.tokenSymbol ?? params.token_symbol ?? "USDC";
  const tokenSymbol = tokenParam.toString().toUpperCase() as ChallengeDetails["tokenSymbol"];
  const seller = params.seller ?? params.to;
  const tokenAddress = params.tokenAddress ?? params.token_address ?? params.contract;
  const chainRaw = params.chainId ?? params.chain_id ?? params.chain;
  const chainId = chainRaw ? Number(chainRaw) : 137;
  const amountAtomicParam = params.amountAtomic ?? params.amount_atomic ?? params.amount;
  if (!seller || !tokenAddress || !amountAtomicParam) {
    return undefined;
  }
  const challenge: ChallengeDetails = {
    amountUsd: Number.isFinite(amountUsd) ? amountUsd : 0,
    tokenSymbol,
    challengeId: typeof params.id === "string" && params.id.length > 0 ? params.id : fallbackId,
    endpoint: requestInfo.endpoint,
    origin: requestInfo.origin,
    method: requestInfo.method,
    rawHeaders,
    chainId: Number.isFinite(chainId) ? chainId : 137,
    tokenAddress: tokenAddress as `0x${string}`,
    seller: seller as `0x${string}`,
    amountAtomic: String(amountAtomicParam),
    rawChallenge: params,
  } satisfies ChallengeDetails;
  return challenge;
}
