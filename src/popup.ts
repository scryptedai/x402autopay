import { ethers } from "ethers";
import { INITIAL_STATE } from "./shared/storage";
import type {
  BalanceCache,
  ChainId,
  ExtensionSettings,
  ExtensionState,
  PaymentRecord,
  SitePolicy,
  WalletData,
} from "./shared/types";

type State = ExtensionState;

const state: State = structuredClone(INITIAL_STATE);
const DEFAULT_LOCK_MINUTES = 15;
const CHAIN_LABELS: Record<ChainId, string> = {
  polygon: "Polygon",
  polygonAmoy: "Polygon Amoy",
};

const elements = {
  walletAddress: document.getElementById("wallet-address") as HTMLElement,
  copyWallet: document.getElementById("copy-wallet") as HTMLButtonElement,
  backupWallet: document.getElementById("backup-wallet") as HTMLButtonElement,
  walletSeedForm: document.getElementById("wallet-seed-form") as HTMLFormElement,
  walletPrivateKey: document.getElementById("wallet-private-key") as HTMLTextAreaElement,
  walletPassphrase: document.getElementById("wallet-passphrase") as HTMLInputElement,
  walletPassphraseConfirm: document.getElementById("wallet-passphrase-confirm") as HTMLInputElement,
  walletLockDuration: document.getElementById("wallet-lock-duration") as HTMLInputElement,
  createWallet: document.getElementById("create-wallet") as HTMLButtonElement,
  regenWallet: document.getElementById("regen-wallet") as HTMLButtonElement,
  clearWallet: document.getElementById("clear-wallet") as HTMLButtonElement,
  walletConfigured: document.getElementById("wallet-configured") as HTMLElement,
  walletStatus: document.getElementById("wallet-status") as HTMLElement,
  walletError: document.getElementById("wallet-error") as HTMLElement,
  unlockForm: document.getElementById("unlock-form") as HTMLFormElement,
  unlockPassphrase: document.getElementById("unlock-passphrase") as HTMLInputElement,
  unlockDuration: document.getElementById("unlock-duration") as HTMLInputElement,
  lockWallet: document.getElementById("lock-wallet") as HTMLButtonElement,
  backupForm: document.getElementById("backup-form") as HTMLFormElement,
  backupPassphrase: document.getElementById("backup-passphrase") as HTMLInputElement,
  backupResult: document.getElementById("backup-result") as HTMLElement,
  backupPrivateKey: document.getElementById("backup-private-key") as HTMLTextAreaElement,
  backupCopy: document.getElementById("backup-copy") as HTMLButtonElement,
  backupCancel: document.getElementById("backup-cancel") as HTMLButtonElement,
  backupClose: document.getElementById("backup-close") as HTMLButtonElement,
  backupError: document.getElementById("backup-error") as HTMLElement,
  balanceTableBody: document.querySelector<HTMLTableSectionElement>("#balance-table tbody")!,
  refreshBalance: document.getElementById("refresh-balance") as HTMLButtonElement,
  thresholdInput: document.getElementById("threshold-input") as HTMLInputElement,
  dailyCapInput: document.getElementById("daily-cap-input") as HTMLInputElement,
  tokenSelect: document.getElementById("token-select") as HTMLSelectElement,
  chainSelect: document.getElementById("chain-select") as HTMLSelectElement,
  policyList: document.getElementById("policy-list") as HTMLUListElement,
  resetPolicies: document.getElementById("reset-policies") as HTMLButtonElement,
  historyList: document.getElementById("history-list") as HTMLUListElement,
  clearHistory: document.getElementById("clear-history") as HTMLButtonElement,
  buildInfo: document.getElementById("build-info") as HTMLElement,
  statusIndicator: document.getElementById("status-indicator") as HTMLElement,
  statusLabel: document.getElementById("status-label") as HTMLElement,
  settingsForm: document.getElementById("settings-form") as HTMLFormElement,
  promptToggle: document.getElementById("prompt-toggle") as HTMLInputElement,
} as const;

async function loadState() {
  const response = await chrome.runtime.sendMessage({ type: "x402:getState" });
  Object.assign(state, structuredClone(INITIAL_STATE), response as State);
  state.balance = state.balances?.[state.settings.chain] ?? state.balance;
  const balancesResponse = await chrome.runtime.sendMessage({ type: "x402:refreshAllBalances" });
  if (balancesResponse?.balances) {
    state.balances = balancesResponse.balances as Record<ChainId, BalanceCache>;
    state.balance = state.balances[state.settings.chain] ?? state.balance;
  }
  render();
}

function render() {
  renderWallet(state.wallet);
  renderBalances(state.balances);
  renderSettings(state.settings);
  renderPolicies(state.policies);
  renderHistory(state.history);
  renderStatus(state.extensionStatus);
}

function showWalletError(message: string) {
  elements.walletError.textContent = message;
  elements.walletError.classList.remove("hidden");
}

function clearWalletError() {
  elements.walletError.textContent = "";
  elements.walletError.classList.add("hidden");
}

function resetBackupUI() {
  elements.backupForm.classList.add("hidden");
  elements.backupResult.classList.add("hidden");
  elements.backupError.classList.add("hidden");
  elements.backupError.textContent = "";
  elements.backupPassphrase.value = "";
  elements.backupPrivateKey.value = "";
}

function showBackupError(message: string) {
  elements.backupError.textContent = message;
  elements.backupError.classList.remove("hidden");
}

function renderWallet(wallet?: WalletData) {
  clearWalletError();
  resetBackupUI();
  const now = Date.now();
  const lockDuration = wallet?.lockDurationMinutes ?? DEFAULT_LOCK_MINUTES;
  elements.walletLockDuration.value = lockDuration.toString();
  elements.unlockDuration.value = lockDuration.toString();
  if (!wallet) {
    elements.walletAddress.textContent = "(not configured)";
    elements.copyWallet.disabled = true;
    elements.backupWallet.disabled = true;
    elements.walletConfigured.classList.add("hidden");
    elements.walletSeedForm.classList.remove("hidden");
    elements.walletStatus.textContent = "Wallet not configured";
    elements.unlockForm.classList.add("hidden");
    elements.lockWallet.classList.add("hidden");
    return;
  }
  elements.walletAddress.textContent = wallet.address;
  elements.copyWallet.disabled = false;
  elements.backupWallet.disabled = !wallet.encryptedPrivateKey;
  elements.walletConfigured.classList.remove("hidden");
  const unlocked = typeof wallet.lockedUntil === "number" && wallet.lockedUntil > now;
  const secured = Boolean(wallet.encryptedPrivateKey);
  if (!secured) {
    elements.walletStatus.textContent = "Unsecured wallet - re-import with passphrase.";
    elements.unlockForm.classList.add("hidden");
    elements.lockWallet.classList.add("hidden");
    elements.walletSeedForm.classList.remove("hidden");
  } else if (unlocked) {
    elements.walletStatus.textContent = `Unlocked until ${new Date(wallet.lockedUntil).toLocaleTimeString()}`;
    elements.unlockForm.classList.add("hidden");
    elements.lockWallet.classList.remove("hidden");
    elements.walletSeedForm.classList.add("hidden");
  } else {
    elements.walletStatus.textContent = "Locked";
    elements.unlockForm.classList.remove("hidden");
    elements.lockWallet.classList.add("hidden");
    elements.walletSeedForm.classList.add("hidden");
  }
  elements.unlockPassphrase.value = "";
}

function renderBalances(balances: Record<ChainId, BalanceCache>) {
  elements.balanceTableBody.innerHTML = "";
  const chains: ChainId[] = ["polygon", "polygonAmoy"];
  for (const chain of chains) {
    const balance =
      balances[chain] ??
      ({
        tokenBalance: "0",
        rawBalance: "0",
        usd: 0,
        usdRate: 1,
        lastFetched: 0,
        tokenSymbol: "USDC",
        decimals: 6,
      } satisfies BalanceCache);
    const tr = document.createElement("tr");
    const isActive = chain === state.settings.chain;
    const amountValue = Number(balance.tokenBalance);
    const tokenDecimals = balance.decimals ?? 6;
    const amountDisplay = Number.isFinite(amountValue)
      ? amountValue.toFixed(Math.min(tokenDecimals, 6))
      : balance.tokenBalance;
    tr.innerHTML = `
      <td>${CHAIN_LABELS[chain] ?? chain}${isActive ? " •" : ""}</td>
      <td>${balance.tokenSymbol}</td>
      <td>${amountDisplay}</td>
      <td>$${balance.usd.toFixed(4)}</td>
      <td>${balance.lastFetched ? new Date(balance.lastFetched).toLocaleTimeString() : "never"}</td>
    `;
    elements.balanceTableBody.appendChild(tr);
  }
}

function renderSettings(settings: ExtensionSettings) {
  elements.thresholdInput.value = settings.thresholdUsd.toString();
  elements.dailyCapInput.value = settings.dailyAutoCapUsd.toString();
  elements.tokenSelect.value = settings.preferredToken;
  elements.promptToggle.checked = settings.promptRequired;
  elements.chainSelect.value = settings.chain;
}

function renderPolicies(policies: Record<string, SitePolicy>) {
  elements.policyList.innerHTML = "";
  for (const policy of Object.values(policies)) {
    const li = document.createElement("li");
    li.innerHTML = `
      <strong>${policy.origin}</strong>
      <small>Lifetime $${policy.lifetimeUsd.toFixed(4)} · Daily $${policy.dailyUsd.toFixed(2)}</small>
      <div class="policy-actions">
        <button data-origin="${policy.origin}" data-action="allow" ${
          policy.allowUnderThreshold ? "disabled" : ""
        }>Always allow ≤ threshold</button>
        <button data-origin="${policy.origin}" data-action="deny" ${
          policy.mode === "deny" ? "disabled" : ""
        }>Block</button>
      </div>
    `;
    elements.policyList.appendChild(li);
  }
  if (elements.policyList.children.length === 0) {
    elements.policyList.innerHTML = '<li><small>No site policies yet.</small></li>';
  }
}

function renderHistory(history: PaymentRecord[]) {
  elements.historyList.innerHTML = "";
  const limited = history.slice(0, 10);
  for (const item of limited) {
    const li = document.createElement("li");
    li.innerHTML = `
      <div><strong>${item.origin}</strong> → <code>${item.endpoint}</code></div>
      <div class="history-amount">${item.amountUsd.toFixed(4)} ${item.tokenSymbol}</div>
      <small>${new Date(item.timestamp).toLocaleString()} · ${item.status}${
        item.autoApproved ? " · auto" : ""
      }</small>
    `;
    elements.historyList.appendChild(li);
  }
  if (limited.length === 0) {
    elements.historyList.innerHTML = '<li><small>No payments yet.</small></li>';
  }
}

function renderStatus(status: ExtensionState["extensionStatus"]) {
  const current = status ?? "idle";
  elements.statusIndicator.dataset.status = current;
  const labelMap: Record<ExtensionState["extensionStatus"], string> = {
    idle: "Idle",
    paying: "Processing",
    verified: "Verified",
  };
  const label = labelMap[current] ?? "Idle";
  elements.statusIndicator.title = label;
  elements.statusLabel.textContent = label;
}

elements.copyWallet.addEventListener("click", () => {
  if (!state.wallet) return;
  navigator.clipboard.writeText(state.wallet.address).catch(() => undefined);
});

elements.backupWallet.addEventListener("click", () => {
  if (!state.wallet || !state.wallet.encryptedPrivateKey) return;
  if (elements.backupResult.classList.contains("hidden") === false) {
    resetBackupUI();
    return;
  }
  elements.backupForm.classList.remove("hidden");
  elements.backupError.classList.add("hidden");
  elements.backupPassphrase.value = "";
  setTimeout(() => elements.backupPassphrase.focus(), 0);
});

elements.backupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.wallet) return;
  elements.backupError.classList.add("hidden");
  const passphrase = elements.backupPassphrase.value;
  if (!passphrase) {
    showBackupError("Passphrase required.");
    return;
  }
  const response = await chrome.runtime.sendMessage({
    type: "x402:exportWallet",
    passphrase,
  });
  if (response?.error) {
    showBackupError(String(response.error));
    elements.backupPassphrase.select();
    return;
  }
  if (typeof response?.privateKey !== "string") {
    showBackupError("Unable to export private key.");
    return;
  }
  elements.backupForm.classList.add("hidden");
  elements.backupPassphrase.value = "";
  elements.backupPrivateKey.value = response.privateKey;
  elements.backupResult.classList.remove("hidden");
});

elements.backupCancel.addEventListener("click", () => {
  resetBackupUI();
});

elements.backupClose.addEventListener("click", () => {
  resetBackupUI();
});

elements.backupCopy.addEventListener("click", () => {
  if (!elements.backupPrivateKey.value) return;
  navigator.clipboard.writeText(elements.backupPrivateKey.value).catch(() => undefined);
});

elements.walletSeedForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearWalletError();
  const key = elements.walletPrivateKey.value.trim();
  const passphrase = elements.walletPassphrase.value;
  const confirm = elements.walletPassphraseConfirm.value;
  const lockDuration = Number(elements.walletLockDuration.value) || DEFAULT_LOCK_MINUTES;
  if (!key) {
    showWalletError("Private key required.");
    return;
  }
  if (!passphrase || passphrase.length < 8) {
    showWalletError("Passphrase must be at least 8 characters.");
    return;
  }
  if (passphrase !== confirm) {
    showWalletError("Passphrase confirmation does not match.");
    return;
  }
  const response = await chrome.runtime.sendMessage({
    type: "x402:updateWallet",
    wallet: {
      privateKey: key,
      passphrase,
      lockDurationMinutes: lockDuration,
    },
  });
  if (response?.error) {
    showWalletError(String(response.error));
    return;
  }
  elements.walletPrivateKey.value = "";
  elements.walletPassphrase.value = "";
  elements.walletPassphraseConfirm.value = "";
  await loadState();
});

elements.createWallet.addEventListener("click", () => {
  clearWalletError();
  const wallet = ethers.Wallet.createRandom();
  elements.walletPrivateKey.value = wallet.privateKey;
  elements.walletPassphrase.value = "";
  elements.walletPassphraseConfirm.value = "";
});

elements.regenWallet.addEventListener("click", () => {
  clearWalletError();
  const wallet = ethers.Wallet.createRandom();
  elements.walletSeedForm.classList.remove("hidden");
  elements.walletPrivateKey.value = wallet.privateKey;
  elements.walletPassphrase.value = "";
  elements.walletPassphraseConfirm.value = "";
  elements.walletLockDuration.value = (state.wallet?.lockDurationMinutes ?? DEFAULT_LOCK_MINUTES).toString();
  elements.walletSeedForm.scrollIntoView({ behavior: "smooth", block: "center" });
});

elements.clearWallet.addEventListener("click", async () => {
  clearWalletError();
  if (!state.wallet) return;
  const first = window.confirm("Remove this wallet from X402 Autopay?");
  if (!first) return;
  const second = window.confirm("This will permanently delete the stored private key and passphrase. Continue?");
  if (!second) return;
  await chrome.runtime.sendMessage({ type: "x402:updateWallet", wallet: null });
  elements.walletPrivateKey.value = "";
  elements.walletPassphrase.value = "";
  elements.walletPassphraseConfirm.value = "";
  resetBackupUI();
  await loadState();
});

elements.unlockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearWalletError();
  const passphrase = elements.unlockPassphrase.value;
  const duration = Number(elements.unlockDuration.value) || state.wallet?.lockDurationMinutes || DEFAULT_LOCK_MINUTES;
  if (!passphrase) {
    showWalletError("Passphrase required to unlock.");
    return;
  }
  const response = await chrome.runtime.sendMessage({
    type: "x402:unlockWallet",
    passphrase,
    lockDurationMinutes: duration,
  });
  if (response?.error) {
    showWalletError(String(response.error));
    return;
  }
  elements.unlockPassphrase.value = "";
  await loadState();
});

elements.lockWallet.addEventListener("click", async () => {
  clearWalletError();
  await chrome.runtime.sendMessage({ type: "x402:lockWallet" });
  await loadState();
});

elements.refreshBalance.addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ type: "x402:refreshAllBalances" });
  if (result?.balances) {
    state.balances = result.balances as Record<ChainId, BalanceCache>;
    state.balance = state.balances[state.settings.chain] ?? state.balance;
    renderBalances(state.balances);
  }
});

elements.settingsForm.addEventListener("input", async () => {
  const settings: Partial<ExtensionSettings> = {
    thresholdUsd: Number(elements.thresholdInput.value) || 0,
    dailyAutoCapUsd: Number(elements.dailyCapInput.value) || 0,
    preferredToken: elements.tokenSelect.value as ExtensionSettings["preferredToken"],
    promptRequired: elements.promptToggle.checked,
    chain: elements.chainSelect.value as ExtensionSettings["chain"],
  };
  await chrome.runtime.sendMessage({ type: "x402:updateSettings", settings });
});

elements.resetPolicies.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "x402:resetPolicies" });
  await loadState();
});

elements.historyList.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.dataset.action === "note" && target.dataset.id) {
    const record = state.history.find((item) => item.id === target.dataset.id);
    if (record?.note) alert(record.note);
  }
});

elements.clearHistory.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "x402:clearHistory" });
  await loadState();
});

elements.policyList.addEventListener("click", async (event) => {
  const target = event.target as HTMLElement;
  const origin = target.dataset.origin;
  if (!origin) return;
  if (target.dataset.action === "allow") {
    await chrome.runtime.sendMessage({
      type: "x402:updatePolicy",
      origin,
      update: { allowUnderThreshold: true, mode: "ask" },
    });
  }
  if (target.dataset.action === "deny") {
    await chrome.runtime.sendMessage({
      type: "x402:updatePolicy",
      origin,
      update: { mode: "deny" },
    });
  }
  await loadState();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.state) return;
  Object.assign(state, structuredClone(INITIAL_STATE), changes.state.newValue as State);
  state.balance = state.balances?.[state.settings.chain] ?? state.balance;
  render();
});

fetch(chrome.runtime.getURL(".built-at"))
  .then((resp) => resp.text())
  .then((text) => {
    elements.buildInfo.textContent = text.trim();
  })
  .catch(() => undefined);

loadState().catch((error) => console.error("Failed to load popup state", error));
