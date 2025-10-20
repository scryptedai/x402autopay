export type TokenSymbol = "USDC";

export type ChainId = "polygonAmoy" | "polygon";

export type ExtensionStatus = "idle" | "paying" | "verified";

export interface ExtensionSettings {
  thresholdUsd: number;
  dailyAutoCapUsd: number;
  preferredToken: TokenSymbol;
  chain: ChainId;
  promptRequired: boolean;
}

export interface WalletData {
  address: string;
  encryptedPrivateKey?: string;
  encryptionSalt?: string;
  encryptionIv?: string;
  encryptionTag?: string;
  privateKey?: string;
  lockDurationMinutes?: number;
  lockedUntil?: number;
  label?: string;
}

export interface BalanceCache {
  tokenBalance: string;
  rawBalance: string;
  usd: number;
  usdRate: number;
  lastFetched: number;
  tokenSymbol: TokenSymbol;
  decimals?: number;
  tokenAddress?: string;
}

export type PolicyMode = "ask" | "deny";

export interface SitePolicy {
  origin: string;
  allowUnderThreshold: boolean;
  mode: PolicyMode;
  capUsd: number | null;
  lifetimeUsd: number;
  dailyUsd: number;
  lastResetISO: string;
}

export interface PaymentRecord {
  id: string;
  origin: string;
  endpoint: string;
  amountUsd: number;
  tokenSymbol: TokenSymbol;
  timestamp: number;
  status: "pending" | "success" | "denied" | "error";
  autoApproved: boolean;
  txHash?: string;
  note?: string;
}

export interface JwtCacheEntry {
  paymentId: string;
  jwt: string;
  expiresAt: number;
}

export interface PendingChallenge {
  challenge: ChallengeDetails;
  tabId?: number;
  createdAt: number;
  windowId?: number;
}

export interface ExtensionState {
  settings: ExtensionSettings;
  wallet?: WalletData;
  balance: BalanceCache;
  balances: Record<ChainId, BalanceCache>;
  policies: Record<string, SitePolicy>;
  history: PaymentRecord[];
  jwtCache: Record<string, JwtCacheEntry>;
  pendingChallenges: Record<string, PendingChallenge>;
  extensionStatus: ExtensionStatus;
}

export interface ChallengeDetails {
  amountUsd: number;
  tokenSymbol: TokenSymbol;
  challengeId: string;
  endpoint: string;
  origin: string;
  rawHeaders: Record<string, string>;
  method: string;
  chainId: number;
  tokenAddress: `0x${string}`;
  seller: `0x${string}`;
  amountAtomic: string;
  tokenName?: string;
  tokenVersion?: string;
  tokenDecimals?: number;
  rawChallenge?: unknown;
}

export type ChallengeResolutionAction = "retry" | "deny" | "error" | "pending";

export interface ChallengeResolution {
  action: ChallengeResolutionAction;
  message?: string;
  retryHeaders?: Record<string, string>;
  challengeId?: string;
}

export interface PromptDecision {
  approve: boolean;
  alwaysAllow?: boolean;
}

export interface RequestMetadata {
  method: string;
  url: string;
  headers: Record<string, string>;
}

export interface SettlementNotice {
  paymentId: string;
  txHash?: string;
  network?: string | number;
  jwt?: string;
  status?: "success" | "error";
  message?: string;
}

export interface WalletFormState {
  passphrase?: string;
  confirmPassphrase?: string;
  lockDurationMinutes: number;
}
