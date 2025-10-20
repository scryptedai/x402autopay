export type PriceQuote = {
  token: string;
  usdPrice: number;
  fetchedAt: number;
};

interface CachedQuote extends PriceQuote {
  expiresAt: number;
}

const cache: Record<string, CachedQuote> = {};

const DEFAULT_PRICES: Record<string, number> = {
  USDC: 1,
};

export async function getTokenPriceUsd(symbol: string, signal?: AbortSignal): Promise<PriceQuote> {
  const key = symbol.toUpperCase();
  const now = Date.now();
  const cached = cache[key];
  if (cached && cached.expiresAt > now) {
    return cached;
  }

  let usdPrice = DEFAULT_PRICES[key] ?? 1;
  try {
    const response = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=usd`, {
      signal,
    });
    if (response.ok) {
      const data = (await response.json()) as { [k: string]: { usd: number } };
      const quote = data["usd-coin"]?.usd;
      if (typeof quote === "number" && Number.isFinite(quote)) {
        usdPrice = quote;
      }
    }
  } catch (error) {
    console.warn("Price fetch failed", error);
  }

  const entry: CachedQuote = {
    token: key,
    usdPrice,
    fetchedAt: now,
    expiresAt: now + 60 * 1000,
  };
  cache[key] = entry;
  return entry;
}

