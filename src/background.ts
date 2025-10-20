import { ethers } from "ethers";
import {
  addHistory,
  clearHistory,
  getJwt,
  getState,
  markSettlement,
  pruneJwtCache,
  removePolicy,
  resetPolicies,
  saveJwt,
  setState,
  updateBalance,
  updateSettings,
  updateWallet,
  upsertPolicy,
} from "./shared/storage";
import type {
  BalanceCache,
  ChainId,
  ChallengeDetails,
  ChallengeResolution,
  ExtensionSettings,
  ExtensionState,
  PaymentRecord,
  PendingChallenge,
  PromptDecision,
  SitePolicy,
  TokenSymbol,
  WalletData,
  SettlementNotice,
  ExtensionStatus,
} from "./shared/types";
import { parseChallengeHeaders } from "./shared/x402";
import { getTokenPriceUsd } from "./shared/api";
import { encryptSecret, decryptSecret } from "./shared/crypto";

const BALANCE_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const BALANCE_REFRESH_ALARM = "x402-balance-refresh";
const JWT_TTL_MS = 5 * 60 * 1000;
const PROMPT_WIDTH = 420;
const PROMPT_HEIGHT = 560;

const RPC_URLS: Record<ChainId, string> = {
  polygonAmoy: "https://rpc-amoy.polygon.technology",
  polygon: "https://polygon-rpc.com",
};

const PENDING_CHALLENGE_TTL_MS = 10 * 60 * 1000;
function mapChainId(chainId: number): ChainId | undefined {
  if (chainId === 137) return "polygon";
  if (chainId === 80002) return "polygonAmoy";
  return undefined;
}

const TOKEN_METADATA: Record<ChainId, { address: `0x${string}`; decimals: number }> = {
  polygonAmoy: {
    address: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    decimals: 6,
  },
  polygon: {
    address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    decimals: 6,
  },
};

function encodeBase64(value: string): string {
  if (typeof btoa === "function") {
    return btoa(value);
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(value, "utf-8").toString("base64");
  }
  throw new Error("Base64 encoding not supported in this environment");
}
const MIN_LOCK_MINUTES = 1;
const MAX_LOCK_MINUTES = 1440;
const DEFAULT_LOCK_MINUTES = 15;

type WalletUpdatePayload = {
  privateKey?: string;
  passphrase?: string;
  lockDurationMinutes?: number;
  label?: string;
};

function normalizeLockDuration(minutes?: number): number {
  if (typeof minutes !== "number" || !Number.isFinite(minutes)) {
    return DEFAULT_LOCK_MINUTES;
  }
  const coerced = Math.floor(minutes);
  return Math.min(Math.max(coerced, MIN_LOCK_MINUTES), MAX_LOCK_MINUTES);
}

function computeUnlockExpiry(minutes?: number): number {
  const duration = normalizeLockDuration(minutes);
  return Date.now() + duration * 60 * 1000;
}

async function getPendingChallenges(): Promise<Record<string, PendingChallenge>> {
  await pruneExpiredChallenges();
  const state = await getState();
  return state.pendingChallenges ?? {};
}

async function savePendingChallenges(pending: Record<string, PendingChallenge>) {
  await setState({ pendingChallenges: pending });
}

async function pruneExpiredChallenges() {
  const state = await getState();
  const source = state.pendingChallenges ?? {};
  const now = Date.now();
  let changed = false;
  const pruned: Record<string, PendingChallenge> = {};
  for (const [id, entry] of Object.entries(source)) {
    if (entry.createdAt && now - entry.createdAt > PENDING_CHALLENGE_TTL_MS) {
      changed = true;
      continue;
    }
    pruned[id] = entry;
  }
  if (changed) {
    await setState({ pendingChallenges: pruned });
  }
}

async function ensureChallengeStored(challenge: ChallengeDetails, tabId?: number, windowId?: number) {
  const pending = await getPendingChallenges();
  pending[challenge.challengeId] = {
    challenge,
    tabId,
    windowId,
    createdAt: Date.now(),
  };
  await savePendingChallenges(pending);
}

async function clearChallenge(challengeId: string) {
  const pending = await getPendingChallenges();
  delete pending[challengeId];
  await savePendingChallenges(pending);
}

async function setExtensionStatus(status: ExtensionStatus) {
  await setState({ extensionStatus: status });
}

async function withExtensionStatus<T>(status: ExtensionStatus, fn: () => Promise<T>): Promise<T> {
  await setExtensionStatus(status);
  try {
    const result = await fn();
    const current = await getState();
    if (current.extensionStatus === status) {
      await setExtensionStatus("idle");
    }
    return result;
  } catch (error) {
    const current = await getState();
    if (current.extensionStatus === status) {
      await setExtensionStatus("idle");
    }
    throw error;
  }
}

function createDefaultPolicy(origin: string): SitePolicy {
  const today = new Date().toISOString().slice(0, 10);
  return {
    origin,
    allowUnderThreshold: false,
    mode: "ask",
    capUsd: null,
    lifetimeUsd: 0,
    dailyUsd: 0,
    lastResetISO: today,
  };
}

async function refreshBalance(force = false, chain?: ChainId): Promise<BalanceCache> {
  const state = await getState();
  const activeChain = chain ?? state.settings.chain;
  const wallet = state.wallet;
  if (!wallet) throw new Error("Wallet not configured");
  const current =
    state.balances?.[activeChain] ??
    state.balance ??
    ({
      tokenBalance: "0",
      rawBalance: "0",
      usd: 0,
      usdRate: 1,
      lastFetched: 0,
      tokenSymbol: state.settings.preferredToken,
      decimals: TOKEN_METADATA[activeChain]?.decimals ?? 6,
      tokenAddress: TOKEN_METADATA[activeChain]?.address,
    } satisfies BalanceCache);
  const lastFetched = current?.lastFetched ?? 0;
  const shouldRefresh = force || !lastFetched || Date.now() - lastFetched > BALANCE_REFRESH_INTERVAL_MS;
  if (!shouldRefresh) return current;

  const rpcUrl = RPC_URLS[activeChain];
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  console.info("x402-autopay:bg refreshBalance:start", {
    chain: activeChain,
    force,
    wallet: wallet.address,
    rpcUrl,
  });
  const preferred = state.settings.preferredToken;

  let rawBalance = "0";
  const metadata = TOKEN_METADATA[activeChain];
  const fallbackDecimals = metadata?.decimals ?? 6;
  let decimals = fallbackDecimals;
  let tokenAddress: `0x${string}` | undefined = metadata?.address;
  if (tokenAddress) {
    try {
      tokenAddress = ethers.getAddress(tokenAddress) as `0x${string}`;
    } catch (error) {
      console.error("x402-autopay:bg refreshBalance invalid metadata address", {
        chain: activeChain,
        tokenAddress,
        error,
      });
      throw error;
    }
  }
  if (preferred === "USDC") {
    if (!tokenAddress) {
      tokenAddress = resolveTokenAddress(activeChain, preferred);
    }
    let code: string | null = null;
    try {
      code = await provider.getCode(tokenAddress);
    } catch (error) {
      console.warn("x402-autopay:bg refreshBalance getCode failed", {
        chain: activeChain,
        tokenAddress,
        error,
      });
    }
    const hasBytecode = Boolean(code && code !== "0x");
    if (!hasBytecode) {
      console.warn("x402-autopay:bg token contract missing bytecode; using fallback balance", {
        chain: activeChain,
        tokenAddress,
      });
    } else {
      const contract = new ethers.Contract(
        tokenAddress,
        [
          "function balanceOf(address) view returns (uint256)",
          "function decimals() view returns (uint8)",
        ],
        provider,
      );
      const balanceOf = contract.getFunction("balanceOf");
      const decimalsFn = contract.getFunction("decimals");
      try {
        const balanceOfResult = await balanceOf(wallet.address);
        rawBalance = balanceOfResult.toString();
      } catch (error) {
        const codeValue =
          (error as { code?: string })?.code ?? (error as { info?: { code?: string } })?.info?.code ?? "";
        console.error("x402-autopay:bg refreshBalance balanceOf failed", {
          chain: activeChain,
          tokenAddress,
          wallet: wallet.address,
          error,
        });
        if (codeValue.toLowerCase() !== "bad_data" && codeValue.toLowerCase() !== "call_exception") {
          throw error;
        }
        console.warn("x402-autopay:bg balanceOf returned no data, treating as zero", {
          chain: activeChain,
          tokenAddress,
        });
      }
      const decimalsResult = await decimalsFn().catch((error: unknown) => {
        console.warn("x402-autopay:bg refreshBalance decimals fallback", {
          chain: activeChain,
          tokenAddress,
          error,
        });
        return fallbackDecimals;
      });
      decimals = Number(decimalsResult);
      console.info("x402-autopay:bg refreshBalance", {
        address: wallet.address,
        chain: activeChain,
        rawBalance,
        decimals,
        tokenAddress,
      });
    }
  }

  const tokenBalance = ethers.formatUnits(rawBalance, decimals);
  let usdRate = 1;
  try {
    const quote = await getTokenPriceUsd(preferred);
    usdRate = quote.usdPrice;
  } catch (error) {
    console.warn("x402-autopay:bg refreshBalance price fetch failed", { token: preferred, error });
  }
  const usdApprox = Number(tokenBalance) * usdRate;
  const nextBalance: BalanceCache = {
    tokenBalance: tokenBalance,
    rawBalance,
    usd: usdApprox,
    usdRate,
    lastFetched: Date.now(),
    tokenSymbol: preferred,
    decimals,
    tokenAddress,
  };
  await updateBalance(activeChain, nextBalance);
  console.info("x402-autopay:bg refreshBalance:success", {
    chain: activeChain,
    tokenBalance: nextBalance.tokenBalance,
    usd: nextBalance.usd,
    usdRate,
  });
  return nextBalance;
}

async function refreshAllBalances(force = false): Promise<Record<ChainId, BalanceCache>> {
  const results: Partial<Record<ChainId, BalanceCache>> = {};
  for (const chainId of Object.keys(RPC_URLS) as ChainId[]) {
    try {
      results[chainId] = await refreshBalance(force, chainId);
    } catch (error) {
      const serializedError =
        error instanceof Error
          ? { message: error.message, stack: error.stack, name: error.name }
          : { message: String(error) };
      console.warn("x402-autopay:bg refreshAllBalances failed", {
        chain: chainId,
        error: serializedError,
      });
    }
  }
  const updated = await getState();
  return updated.balances;
}

function resolveTokenAddress(chain: ChainId, token: TokenSymbol): `0x${string}` {
  if (token !== "USDC") {
    throw new Error(`Unsupported token ${token}`);
  }
  const address =
    chain === "polygon"
      ? "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"
      : "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582";
  return ethers.getAddress(address) as `0x${string}`;
}

async function incrementPolicySpend(origin: string, amountUsd: number) {
  const state = await getState();
  const policy = state.policies[origin] ?? createDefaultPolicy(origin);
  const today = new Date().toISOString().slice(0, 10);
  if (policy.lastResetISO !== today) {
    policy.dailyUsd = 0;
    policy.lastResetISO = today;
  }
  policy.dailyUsd += amountUsd;
  policy.lifetimeUsd += amountUsd;
  await setState({
    policies: {
      ...state.policies,
      [origin]: policy,
    },
  });
}

function spentInLast24h(state: Awaited<ReturnType<typeof getState>>): number {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return state.history
    .filter((record) => record.status === "success" && record.autoApproved && record.timestamp >= cutoff)
    .reduce((sum, record) => sum + record.amountUsd, 0);
}

function shouldAutoApprove(state: Awaited<ReturnType<typeof getState>>, challenge: ChallengeDetails): boolean {
  const policy = state.policies[challenge.origin];
  if (policy?.mode === "deny") return false;

  const threshold = state.settings.thresholdUsd;
  if (challenge.amountUsd > threshold) {
    return false;
  }

  if (state.settings.promptRequired) {
    return false;
  }

  if (policy && policy.allowUnderThreshold === false) {
    return false;
  }

  if (policy?.capUsd != null && policy.capUsd > 0 && policy.lifetimeUsd + challenge.amountUsd > policy.capUsd) {
    return false;
  }

  const cap = state.settings.dailyAutoCapUsd;
  if (cap > 0 && spentInLast24h(state) + challenge.amountUsd > cap) {
    return false;
  }

  return true;
}

async function handleChallenge(
  challenge: ChallengeDetails,
  sender: chrome.runtime.MessageSender,
): Promise<ChallengeResolution> {
  const state = await getState();
  const mappedChain = mapChainId(challenge.chainId);
  if (mappedChain && mappedChain !== state.settings.chain) {
    await updateSettings({ chain: mappedChain });
    state.settings = {
      ...state.settings,
      chain: mappedChain,
    } satisfies ExtensionSettings;
  }
  if (mappedChain) {
    refreshBalance(true, mappedChain).catch(() => undefined);
  }
  await ensureChallengeStored(challenge, sender.tab?.id);

  if (shouldAutoApprove(state, challenge)) {
    return withExtensionStatus("paying", () => processPayment(challenge, true));
  }

  const promptUrl = `${chrome.runtime.getURL("prompt.html")}#${challenge.challengeId}`;
  try {
    const promptWindow = await chrome.windows.create({
      url: promptUrl,
      type: "popup",
      width: PROMPT_WIDTH,
      height: PROMPT_HEIGHT,
      focused: true,
    });
    await ensureChallengeStored(challenge, sender.tab?.id, promptWindow?.id ?? undefined);
  } catch (error) {
    console.error("Failed to open prompt", error);
  }

  return { action: "pending", challengeId: challenge.challengeId };
}

type ExactAuthorization = {
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
  signature: string;
};

async function createAuthorization(
  wallet: WalletData,
  settings: ExtensionSettings,
  challenge: ChallengeDetails,
): Promise<{ paymentId: string; xPaymentHeader: string }> {
  const provider = new ethers.JsonRpcProvider(RPC_URLS[settings.chain]);
  const privateKey = wallet.privateKey?.trim();
  if (!privateKey) {
    throw new Error("Wallet missing private key");
  }
  const signer = new ethers.Wallet(privateKey, provider);
  const now = Math.floor(Date.now() / 1000);
  const validAfter = now - 5;
  const validBefore = now + 120;
  const nonce = ethers.hexlify(ethers.randomBytes(32));

  const domain = {
    name: challenge.tokenName ?? "USD Coin",
    version: challenge.tokenVersion ?? "2",
    chainId: challenge.chainId,
    verifyingContract: challenge.tokenAddress,
  } as const;

  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  } satisfies Record<string, Array<{ name: string; type: string }>>;

  const authorization = {
    from: wallet.address,
    to: challenge.seller,
    value: challenge.amountAtomic,
    validAfter: String(validAfter),
    validBefore: String(validBefore),
    nonce,
  };

  const signature = await signer.signTypedData(domain, types, authorization);

  const payload: ExactAuthorization = {
    authorization,
    signature,
  };

  const networkDescriptor =
    typeof challenge.chainId === "number" && Number.isFinite(challenge.chainId) && challenge.chainId > 0
      ? `eip155:${challenge.chainId}`
      : settings.chain === "polygon"
        ? "eip155:137"
        : settings.chain === "polygonAmoy"
          ? "eip155:80002"
          : `eip155:${challenge.chainId ?? 0}`;

  const xPaymentHeaderObj = {
    x402Version: 1,
    scheme: "exact",
    network: networkDescriptor,
    payload,
  };

  const headerJson = JSON.stringify(xPaymentHeaderObj);
  const headerEncoded = encodeBase64(headerJson);

  return {
    paymentId: challenge.challengeId,
    xPaymentHeader: headerEncoded,
  };
}

async function recordPayment(record: PaymentRecord) {
  await addHistory(record);
  await pruneJwtCache();
}

async function processPayment(
  challenge: ChallengeDetails,
  autoApproved: boolean,
): Promise<ChallengeResolution> {
  console.info("x402-autopay:bg processPayment:start", {
    challengeId: challenge.challengeId,
    origin: challenge.origin,
    amountUsd: challenge.amountUsd,
    amountAtomic: challenge.amountAtomic,
    tokenAddress: challenge.tokenAddress,
    seller: challenge.seller,
    autoApproved,
  });
  const state = await getState({ includePrivateKey: true });
  const wallet = state.wallet;
  if (!wallet) {
    console.warn("x402-autopay:bg processPayment:no-wallet");
    return { action: "error", message: "Wallet not configured" };
  }
  const now = Date.now();
  if (!wallet.privateKey || !wallet.lockedUntil || wallet.lockedUntil <= now) {
    console.warn("x402-autopay:bg processPayment:locked", {
      hasPrivateKey: Boolean(wallet.privateKey),
      lockedUntil: wallet.lockedUntil,
      now,
    });
    await setState({
      wallet: {
        ...wallet,
        privateKey: undefined,
        lockedUntil: 0,
      },
    });
    return { action: "error", message: "Wallet locked" };
  }
  try {
    const { paymentId, xPaymentHeader } = await createAuthorization(wallet, state.settings, challenge);
    console.info("x402-autopay:bg processPayment:signed", { paymentId });
    const record: PaymentRecord = {
      id: paymentId,
      origin: challenge.origin,
      endpoint: challenge.endpoint,
      amountUsd: challenge.amountUsd,
      tokenSymbol: challenge.tokenSymbol,
      timestamp: Date.now(),
      status: "pending",
      autoApproved,
    };
    await recordPayment(record);
    await incrementPolicySpend(challenge.origin, challenge.amountUsd);
    const renewedUntil = computeUnlockExpiry(wallet.lockDurationMinutes);
    await setState({
      wallet: {
        ...wallet,
        privateKey: wallet.privateKey,
        lockedUntil: renewedUntil,
      },
    });
    console.info("x402-autopay:bg processPayment:retrying", { paymentId });
    return {
      action: "retry",
      retryHeaders: {
        "X-PAYMENT": xPaymentHeader,
        "X-PAYMENT-ID": paymentId,
      },
    } satisfies ChallengeResolution;
  } catch (error) {
    const record: PaymentRecord = {
      id: challenge.challengeId,
      origin: challenge.origin,
      endpoint: challenge.endpoint,
      amountUsd: challenge.amountUsd,
      tokenSymbol: challenge.tokenSymbol,
      timestamp: Date.now(),
      status: "error",
      autoApproved,
      note: error instanceof Error ? error.message : String(error),
    };
    await recordPayment(record);
    await setState({
      wallet: {
        ...wallet,
        privateKey: wallet.privateKey,
        lockedUntil: computeUnlockExpiry(wallet.lockDurationMinutes),
      },
    }).catch(() => undefined);
    console.error("x402-autopay:bg processPayment:error", { error });
    return { action: "error", message: "Auto payment failed" };
  }
}

async function handlePromptDecision(challengeId: string, decision: PromptDecision) {
  console.info("x402-autopay:bg promptDecision", {
    challengeId,
    decision,
  });
  const pending = await getPendingChallenges();
  const entry = pending[challengeId];
  if (!entry) return;
  const { challenge, tabId, windowId } = entry;

  if (decision.approve) {
    const resolution = await withExtensionStatus("paying", () => processPayment(challenge, false));
    if (tabId != null) {
      chrome.tabs
        .sendMessage(tabId, {
          type: "x402:resolution",
          challengeId,
          resolution,
        })
        .catch(() => undefined);
    }
    if (decision.alwaysAllow) {
      const updatedState = await getState();
      const policy = updatedState.policies[challenge.origin] ?? createDefaultPolicy(challenge.origin);
      policy.allowUnderThreshold = true;
      await setState({
        policies: {
          ...updatedState.policies,
          [challenge.origin]: policy,
        },
      });
    }
  } else {
    const record: PaymentRecord = {
      id: challengeId,
      origin: challenge.origin,
      endpoint: challenge.endpoint,
      amountUsd: challenge.amountUsd,
      tokenSymbol: challenge.tokenSymbol,
      timestamp: Date.now(),
      status: "denied",
      autoApproved: false,
    };
    await recordPayment(record);
    await setExtensionStatus("idle");
    await clearChallenge(challengeId);
    if (tabId != null) {
      chrome.tabs
        .sendMessage(tabId, {
          type: "x402:resolution",
          challengeId,
          resolution: { action: "deny" },
        })
        .catch(() => undefined);
    }
  }

  if (windowId != null) {
    chrome.windows.remove(windowId).catch(() => undefined);
  }
}

async function handleSettlementNotice(notice: SettlementNotice) {
  const { paymentId, txHash, network, jwt, status, message } = notice;
  if (!paymentId) return;
  await markSettlement(paymentId, {
    status: status ?? (txHash ? "success" : "error"),
    txHash,
    note: message,
  });
  if (jwt) {
    await saveJwt({ paymentId, jwt, expiresAt: Date.now() + JWT_TTL_MS });
  }
  await clearChallenge(paymentId);
  await setExtensionStatus("verified");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.info("x402-autopay:bg message", {
    type: message?.type,
    sender: sender?.tab?.url ?? sender?.origin ?? null,
  });
  if (message.type === "x402:challenge") {
    handleChallenge(message.challenge, sender)
      .then(sendResponse)
      .catch((error: unknown) => {
        sendResponse({ action: "error", message: String(error) });
      });
    return true;
  }

  if (message.type === "x402:promptDecision") {
    handlePromptDecision(message.challengeId, message.decision as PromptDecision).catch(
      (error: unknown) => console.error("prompt decision failed", error),
    );
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "x402:getState") {
    getState().then(sendResponse);
    return true;
  }

  if (message.type === "x402:getPendingChallenge" && typeof message.challengeId === "string") {
    getPendingChallenges()
      .then((pending) => sendResponse({ entry: pending[message.challengeId] }))
      .catch((error: unknown) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === "x402:refreshBalance") {
    const chain = typeof message.chain === "string" ? (message.chain as ChainId) : undefined;
    refreshBalance(true, chain)
      .then((balance) => sendResponse({ balance }))
      .catch((error: unknown) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === "x402:refreshAllBalances") {
    refreshAllBalances(true)
      .then((balances) => sendResponse({ balances }))
      .catch((error: unknown) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === "x402:jwtFor" && typeof message.paymentId === "string") {
    getJwt(message.paymentId)
      .then((jwt) => sendResponse({ jwt }))
      .catch((error: unknown) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === "x402:updateSettings") {
    updateSettings(message.settings as Partial<ExtensionSettings>)
      .then((updated) => sendResponse({ settings: updated.settings }))
      .catch((error: unknown) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === "x402:updateWallet") {
    (async () => {
      const payload = (message.wallet ?? null) as WalletUpdatePayload | null;
      if (!payload) {
        const updated = await updateWallet(undefined);
        sendResponse({ wallet: updated.wallet });
        return;
      }
      if (typeof payload.privateKey !== "string" || !payload.privateKey.trim()) {
        sendResponse({ error: "Private key required" });
        return;
      }
      if (typeof payload.passphrase !== "string" || payload.passphrase.length < 8) {
        sendResponse({ error: "Passphrase must be at least 8 characters" });
        return;
      }
      try {
        const trimmedKey = payload.privateKey.trim();
        const signer = new ethers.Wallet(trimmedKey);
        const lockDuration = normalizeLockDuration(payload.lockDurationMinutes);
        const encrypted = await encryptSecret(trimmedKey, payload.passphrase);
        const lockedUntil = computeUnlockExpiry(lockDuration);
        const stored: WalletData = {
          address: signer.address,
          encryptedPrivateKey: encrypted.cipherText,
          encryptionSalt: encrypted.salt,
          encryptionIv: encrypted.iv,
          lockDurationMinutes: lockDuration,
          lockedUntil,
          label: payload.label,
          privateKey: trimmedKey,
        };
        const updated = await updateWallet(stored);
        if (updated.wallet) {
          const { privateKey: _omitted, ...rest } = updated.wallet;
          sendResponse({ wallet: rest, locked: false });
        } else {
          sendResponse({ wallet: undefined, locked: false });
        }
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        sendResponse({ error: messageText });
      }
    })().catch((error: unknown) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === "x402:exportWallet") {
    (async () => {
      const { passphrase } = message as { passphrase?: string };
      if (typeof passphrase !== "string" || passphrase.length === 0) {
        sendResponse({ error: "Passphrase required" });
        return;
      }
      const state = await getState();
      const wallet = state.wallet;
      if (!wallet?.encryptedPrivateKey || !wallet.encryptionIv || !wallet.encryptionSalt) {
        sendResponse({ error: "Wallet not configured" });
        return;
      }
      try {
        const decrypted = await decryptSecret(
          {
            cipherText: wallet.encryptedPrivateKey,
            iv: wallet.encryptionIv,
            salt: wallet.encryptionSalt,
          },
          passphrase,
        );
        const trimmedKey = decrypted.trim();
        const signer = new ethers.Wallet(trimmedKey);
        if (signer.address.toLowerCase() !== wallet.address.toLowerCase()) {
          throw new Error("Passphrase does not match wallet");
        }
        sendResponse({ privateKey: trimmedKey });
      } catch (error) {
        sendResponse({ error: "Incorrect passphrase" });
      }
    })().catch((error: unknown) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === "x402:unlockWallet") {
    (async () => {
      const { passphrase, lockDurationMinutes } = message as {
        passphrase?: string;
        lockDurationMinutes?: number;
      };
      if (typeof passphrase !== "string" || passphrase.length === 0) {
        sendResponse({ error: "Passphrase required" });
        return;
      }
      const state = await getState();
      const wallet = state.wallet;
      if (!wallet?.encryptedPrivateKey || !wallet.encryptionIv || !wallet.encryptionSalt) {
        sendResponse({ error: "Wallet not configured" });
        return;
      }
      try {
        const decrypted = await decryptSecret(
          {
            cipherText: wallet.encryptedPrivateKey,
            iv: wallet.encryptionIv,
            salt: wallet.encryptionSalt,
          },
          passphrase,
        );
        const trimmedKey = decrypted.trim();
        const signer = new ethers.Wallet(trimmedKey);
        if (signer.address.toLowerCase() !== wallet.address.toLowerCase()) {
          throw new Error("Passphrase does not match wallet");
        }
        const duration = normalizeLockDuration(lockDurationMinutes ?? wallet.lockDurationMinutes);
        const lockedUntil = computeUnlockExpiry(duration);
        const updatedWallet: WalletData = {
          ...wallet,
          privateKey: trimmedKey,
          lockDurationMinutes: duration,
          lockedUntil,
        };
        const updated = await setState({ wallet: updatedWallet });
        if (updated.wallet) {
          const { privateKey: _omitted, ...rest } = updated.wallet;
          sendResponse({ wallet: rest, locked: false });
        } else {
          sendResponse({ wallet: undefined, locked: true });
        }
      } catch (error) {
        sendResponse({ error: "Incorrect passphrase" });
      }
    })().catch((error: unknown) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === "x402:lockWallet") {
    (async () => {
      const state = await getState();
      const wallet = state.wallet;
      if (!wallet) {
        sendResponse({ wallet: undefined, locked: true });
        return;
      }
      const lockedWallet: WalletData = {
        ...wallet,
        privateKey: undefined,
        lockedUntil: 0,
      };
      const updated = await setState({ wallet: lockedWallet });
      sendResponse({ wallet: updated.wallet ?? undefined, locked: true });
    })().catch((error: unknown) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === "x402:updatePolicy") {
    const { origin, update } = message as { origin: string; update: Partial<SitePolicy> };
    getState()
      .then((current) => {
        const policy = current.policies[origin] ?? createDefaultPolicy(origin);
        const next: SitePolicy = { ...policy, ...update };
        return upsertPolicy(next);
      })
      .then((updated) => sendResponse({ policies: updated.policies }))
      .catch((error: unknown) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === "x402:removePolicy" && typeof message.origin === "string") {
    removePolicy(message.origin)
      .then((updated) => sendResponse({ policies: updated.policies }))
      .catch((error: unknown) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === "x402:resetPolicies") {
    resetPolicies()
      .then((updated) => sendResponse({ policies: updated.policies }))
      .catch((error: unknown) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === "x402:clearHistory") {
    clearHistory()
      .then((updated) => sendResponse({ history: updated.history }))
      .catch((error: unknown) => sendResponse({ error: String(error) }));
    return true;
  }

  if (message.type === "x402:settlement") {
    const notice = message.notice as SettlementNotice;
    handleSettlementNotice(notice).then(() => sendResponse({ ok: true })).catch((error) => {
      sendResponse({ error: String(error) });
    });
    return true;
  }

  return undefined;
});

chrome.alarms.create(BALANCE_REFRESH_ALARM, {
  periodInMinutes: BALANCE_REFRESH_INTERVAL_MS / 60000,
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BALANCE_REFRESH_ALARM) {
    refreshAllBalances().catch((error) => console.error("balance refresh failed", error));
  }
});

chrome.runtime.onInstalled.addListener(() => {
  refreshAllBalances(true).catch(() => undefined);
});

export {}
