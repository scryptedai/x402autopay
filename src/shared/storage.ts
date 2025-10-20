import type {
  BalanceCache,
  ChainId,
  ExtensionSettings,
  ExtensionState,
  JwtCacheEntry,
  PaymentRecord,
  PendingChallenge,
  SitePolicy,
  WalletData,
} from "./types";

let runtimePrivateKey: string | undefined;
let runtimeLockedUntil = 0;

const defaultSettings: ExtensionSettings = {
  thresholdUsd: 0.05,
  dailyAutoCapUsd: 1,
  preferredToken: "USDC",
  chain: "polygonAmoy",
  promptRequired: false,
};

const defaultBalanceTemplate: BalanceCache = {
  tokenBalance: "0",
  rawBalance: "0",
  usd: 0,
  usdRate: 1,
  lastFetched: 0,
  tokenSymbol: "USDC",
  decimals: 6,
};

function cloneBalance(overrides?: Partial<BalanceCache>): BalanceCache {
  return {
    ...defaultBalanceTemplate,
    ...overrides,
  } satisfies BalanceCache;
}

export const INITIAL_STATE: ExtensionState = {
  settings: defaultSettings,
  balance: cloneBalance(),
  balances: {
    polygonAmoy: cloneBalance(),
    polygon: cloneBalance(),
  },
  policies: {},
  history: [],
  jwtCache: {},
  pendingChallenges: {},
  extensionStatus: "idle",
};

function captureRuntimeWallet(wallet: WalletData | undefined) {
  runtimePrivateKey = wallet?.privateKey;
  runtimeLockedUntil = wallet?.lockedUntil ?? 0;
}

function sanitizeWalletForPersist(wallet: WalletData | undefined): WalletData | undefined {
  if (!wallet) return undefined;
  const { privateKey, ...rest } = wallet;
  return rest;
}

function applyRuntimeWallet(state: ExtensionState, includePrivateKey: boolean): ExtensionState {
  if (!state.wallet) return state;
  const now = Date.now();
  const unlocked = runtimePrivateKey && runtimeLockedUntil > now;

  if (!unlocked) {
    runtimePrivateKey = undefined;
    runtimeLockedUntil = 0;
    const { privateKey: _, ...rest } = state.wallet;
    state.wallet = { ...rest, lockedUntil: 0 };
    return state;
  }

  if (includePrivateKey) {
    state.wallet = { ...state.wallet, privateKey: runtimePrivateKey, lockedUntil: runtimeLockedUntil };
  } else {
    const { privateKey: _, ...rest } = state.wallet;
    state.wallet = { ...rest, lockedUntil: runtimeLockedUntil };
  }
  return state;
}

export async function getState(options?: { includePrivateKey?: boolean }): Promise<ExtensionState> {
  const stored = await chrome.storage.local.get("state");
  if (stored.state) {
    const merged: ExtensionState = {
      ...INITIAL_STATE,
      ...stored.state,
      settings: {
        ...defaultSettings,
        ...stored.state.settings,
      },
      balance: cloneBalance(stored.state.balance),
      balances: {
        polygonAmoy: cloneBalance(stored.state.balances?.polygonAmoy),
        polygon: cloneBalance(stored.state.balances?.polygon),
      },
      pendingChallenges: stored.state.pendingChallenges ?? {},
    } satisfies ExtensionState;
    if (stored.state.wallet?.privateKey && merged.wallet) {
      const sanitizedWallet = sanitizeWalletForPersist(merged.wallet);
      if (sanitizedWallet) {
        const persisted = { ...sanitizedWallet, lockedUntil: 0 } satisfies WalletData;
        merged.wallet = persisted;
        runtimePrivateKey = undefined;
        runtimeLockedUntil = 0;
        await chrome.storage.local.set({ state: { ...merged, wallet: persisted } });
      }
    }
    return applyRuntimeWallet(merged, Boolean(options?.includePrivateKey));
  }
  await chrome.storage.local.set({ state: INITIAL_STATE });
  return INITIAL_STATE;
}

export async function setState(update: Partial<ExtensionState>): Promise<ExtensionState> {
  const current = await getState();
  const didUpdateWallet = Object.prototype.hasOwnProperty.call(update, "wallet");
  const nextWallet = didUpdateWallet ? update.wallet : current.wallet;
  const next: ExtensionState = {
    ...current,
    ...update,
    settings: {
      ...current.settings,
      ...update.settings,
    },
    balance: {
      ...current.balance,
      ...update.balance,
    },
    balances: {
      ...current.balances,
      ...update.balances,
    },
    policies: update.policies ?? current.policies,
    history: update.history ?? current.history,
    jwtCache: update.jwtCache ?? current.jwtCache,
    pendingChallenges: update.pendingChallenges ?? current.pendingChallenges,
    wallet: nextWallet,
    extensionStatus: update.extensionStatus ?? current.extensionStatus,
  } satisfies ExtensionState;
  if (didUpdateWallet) {
    captureRuntimeWallet(next.wallet);
  }
  const persisted: ExtensionState = {
    ...next,
    wallet: sanitizeWalletForPersist(next.wallet),
  };
  await chrome.storage.local.set({ state: persisted });
  return next;
}

export async function updateSettings(settings: Partial<ExtensionSettings>) {
  const state = await getState();
  const merged: ExtensionSettings = {
    ...state.settings,
    ...settings,
  };
  return setState({ settings: merged });
}

export async function updateWallet(wallet: WalletData | null | undefined) {
  return setState({ wallet: wallet ?? undefined });
}

export async function updateBalance(chain: ChainId, balance: BalanceCache) {
  const state = await getState();
  const balances = {
    ...state.balances,
    [chain]: balance,
  };
  const isActiveChain = chain === state.settings.chain;
  return setState({
    balance: isActiveChain ? balance : state.balance,
    balances,
  });
}

export async function upsertPolicy(policy: SitePolicy) {
  const state = await getState();
  const policies = { ...state.policies, [policy.origin]: policy };
  return setState({ policies });
}

export async function removePolicy(origin: string) {
  const state = await getState();
  if (!state.policies[origin]) return state;
  const policies = { ...state.policies };
  delete policies[origin];
  return setState({ policies });
}

export async function resetPolicies() {
  return setState({ policies: {} });
}

export async function addHistory(record: PaymentRecord) {
  const state = await getState();
  const history = [record, ...state.history].slice(0, 2000);
  return setState({ history });
}

export async function markSettlement(
  paymentId: string,
  update: Partial<PaymentRecord>,
): Promise<ExtensionState> {
  const state = await getState();
  const history = state.history.map((record) => {
    if (record.id !== paymentId) return record;
    return {
      ...record,
      ...update,
      status: update.status ?? record.status,
      txHash: update.txHash ?? record.txHash,
      note: update.note ?? record.note,
    };
  });
  return setState({ history });
}

export async function clearHistory() {
  return setState({ history: [] });
}

export async function pruneJwtCache() {
  const now = Date.now();
  const state = await getState();
  const jwtCache: Record<string, JwtCacheEntry> = {};
  for (const [key, entry] of Object.entries(state.jwtCache)) {
    if (entry.expiresAt > now) {
      jwtCache[key] = entry;
    }
  }
  return setState({ jwtCache });
}

export async function saveJwt(entry: JwtCacheEntry) {
  const state = await getState();
  const jwtCache = { ...state.jwtCache, [entry.paymentId]: entry };
  return setState({ jwtCache });
}

export async function getJwt(paymentId: string) {
  const state = await getState();
  const entry = state.jwtCache[paymentId];
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    await pruneJwtCache();
    return undefined;
  }
  return entry;
}
