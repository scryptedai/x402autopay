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
  walletEmpty: document.getElementById("wallet-empty") as HTMLElement,
  walletConfigured: document.getElementById("wallet-configured") as HTMLElement,
  walletSettings: document.getElementById("wallet-settings") as HTMLButtonElement,
  createWalletBtn: document.getElementById("create-wallet-btn") as HTMLButtonElement,
  importWalletBtn: document.getElementById("import-wallet-btn") as HTMLButtonElement,
  walletStatusBadge: document.getElementById("wallet-status-badge") as HTMLElement,
  walletStatusText: document.getElementById("wallet-status-text") as HTMLElement,
  walletAddressTruncated: document.getElementById("wallet-address-truncated") as HTMLElement,
  walletAddressFull: document.getElementById("wallet-address-full") as HTMLElement,
  addressExpand: document.getElementById("address-expand") as HTMLButtonElement,
  copyWallet: document.getElementById("copy-wallet") as HTMLButtonElement,
  unlockSection: document.getElementById("unlock-section") as HTMLElement,
  unlockForm: document.getElementById("unlock-form") as HTMLFormElement,
  unlockPassphrase: document.getElementById("unlock-passphrase") as HTMLInputElement,
  unlockDuration: document.getElementById("unlock-duration") as HTMLInputElement,
  unlockedSection: document.getElementById("unlocked-section") as HTMLElement,
  unlockTimer: document.getElementById("unlock-timer") as HTMLElement,
  lockWallet: document.getElementById("lock-wallet") as HTMLButtonElement,
  walletError: document.getElementById("wallet-error") as HTMLElement,
  settingsModal: document.getElementById("settings-modal") as HTMLElement,
  settingsClose: document.getElementById("settings-close") as HTMLButtonElement,
  backupWallet: document.getElementById("backup-wallet") as HTMLButtonElement,
  importDifferentWallet: document.getElementById("import-different-wallet") as HTMLButtonElement,
  removeWallet: document.getElementById("remove-wallet") as HTMLButtonElement,
  walletImportForm: document.getElementById("wallet-import-form") as HTMLFormElement,
  walletPrivateKey: document.getElementById("wallet-private-key") as HTMLTextAreaElement,
  walletPassphrase: document.getElementById("wallet-passphrase") as HTMLInputElement,
  walletPassphraseConfirm: document.getElementById("wallet-passphrase-confirm") as HTMLInputElement,
  walletLockDuration: document.getElementById("wallet-lock-duration") as HTMLInputElement,
  importCancel: document.getElementById("import-cancel") as HTMLButtonElement,
  backupModal: document.getElementById("backup-modal") as HTMLElement,
  backupModalClose: document.getElementById("backup-modal-close") as HTMLButtonElement,
  backupForm: document.getElementById("backup-form") as HTMLFormElement,
  backupPassphrase: document.getElementById("backup-passphrase") as HTMLInputElement,
  backupResult: document.getElementById("backup-result") as HTMLElement,
  backupPrivateKey: document.getElementById("backup-private-key") as HTMLTextAreaElement,
  revealKey: document.getElementById("reveal-key") as HTMLButtonElement,
  backupCopy: document.getElementById("backup-copy") as HTMLButtonElement,
  backupClose: document.getElementById("backup-close") as HTMLButtonElement,
  backupCancel: document.getElementById("backup-cancel") as HTMLButtonElement,
  backupError: document.getElementById("backup-error") as HTMLElement,
  confirmModal: document.getElementById("confirm-modal") as HTMLElement,
  confirmClose: document.getElementById("confirm-close") as HTMLButtonElement,
  confirmTitle: document.getElementById("confirm-title") as HTMLElement,
  confirmMessage: document.getElementById("confirm-message") as HTMLElement,
  confirmTypedInput: document.getElementById("confirm-typed-input") as HTMLElement,
  confirmTypedValue: document.getElementById("confirm-typed-value") as HTMLElement,
  confirmInput: document.getElementById("confirm-input") as HTMLInputElement,
  confirmOk: document.getElementById("confirm-ok") as HTMLButtonElement,
  confirmCancel: document.getElementById("confirm-cancel") as HTMLButtonElement,
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
  websiteBranding: document.getElementById("website-branding") as HTMLElement,
  websiteIcon: document.getElementById("website-icon") as HTMLImageElement,
  websiteDomain: document.getElementById("website-domain") as HTMLElement,
  walletEnsAvatar: document.getElementById("wallet-ens-avatar") as HTMLImageElement,
  walletEnsName: document.getElementById("wallet-ens-name") as HTMLElement,
} as const;

async function loadState() {
  const response = await chrome.runtime.sendMessage({ type: "x402:getState" });
  Object.assign(state, structuredClone(INITIAL_STATE), response as State);
  state.balance = state.balances?.[state.settings.chain] ?? state.balance;
  
  render();
  
  chrome.runtime.sendMessage({ type: "x402:refreshBalance", chain: state.settings.chain })
    .then((balanceResponse) => {
      if (balanceResponse?.balance) {
        state.balances = {
          ...state.balances,
          [state.settings.chain]: balanceResponse.balance,
        };
        state.balance = balanceResponse.balance;
        renderBalances(state.balances);
      }
    })
    .catch(() => undefined);
  
  chrome.runtime.sendMessage({ type: "x402:refreshAllBalances" })
    .then((balancesResponse) => {
      if (balancesResponse?.balances) {
        state.balances = balancesResponse.balances as Record<ChainId, BalanceCache>;
        state.balance = state.balances[state.settings.chain] ?? state.balance;
        renderBalances(state.balances);
      }
    })
    .catch(() => undefined);
  
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]?.url) {
      const url = new URL(tabs[0].url);
      if (url.protocol === "http:" || url.protocol === "https:") {
        chrome.runtime.sendMessage({
          type: "x402:detectBranding",
          origin: url.origin,
          tabId: tabs[0].id,
        }).then((response) => {
          if (response?.branding) {
            displayWebsiteBranding(url.origin, response.branding);
          } else {
            displayWebsiteBranding(url.origin, null);
          }
        }).catch(() => {
          displayWebsiteBranding(url.origin, null);
        });
      } else {
        elements.websiteBranding.classList.add("hidden");
      }
    } else {
      elements.websiteBranding.classList.add("hidden");
    }
  } catch {
    elements.websiteBranding.classList.add("hidden");
  }
}

function displayWebsiteBranding(origin: string, branding: { logo?: string; logoDataUri?: string } | null) {
  try {
    const url = new URL(origin);
    const domain = url.hostname;
    elements.websiteBranding.classList.remove("hidden");
    elements.websiteDomain.textContent = domain;
    if (branding?.logoDataUri || branding?.logo) {
      elements.websiteIcon.src = branding.logoDataUri || branding.logo || "";
      elements.websiteIcon.classList.remove("hidden");
    } else {
      elements.websiteIcon.classList.add("hidden");
    }
  } catch {
    elements.websiteBranding.classList.add("hidden");
  }
}

function displayEnsData(ens: { name: string; avatar?: string; avatarDataUri?: string } | null) {
  if (!ens) {
    elements.walletEnsName.classList.add("hidden");
    elements.walletEnsAvatar.classList.add("hidden");
    return;
  }
  
  elements.walletEnsName.textContent = ens.name;
  elements.walletEnsName.classList.remove("hidden");
  
  if (ens.avatarDataUri || ens.avatar) {
    elements.walletEnsAvatar.src = ens.avatarDataUri || ens.avatar || "";
    elements.walletEnsAvatar.classList.remove("hidden");
    elements.walletEnsAvatar.onerror = () => {
      elements.walletEnsAvatar.classList.add("hidden");
    };
  } else {
    elements.walletEnsAvatar.classList.add("hidden");
  }
}

async function resolveWalletEns(address: string) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "x402:resolveEns",
      address,
    });
    if (response?.ens) {
      displayEnsData(response.ens);
    } else {
      displayEnsData(null);
    }
  } catch {
    displayEnsData(null);
  }
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

function truncateAddress(address: string): string {
  if (address.length < 10) return address;
  return `0x${address.slice(2, 6)}...${address.slice(-4)}`;
}

function resetBackupUI() {
  elements.backupForm.classList.remove("hidden");
  elements.backupResult.classList.add("hidden");
  elements.backupError.classList.add("hidden");
  elements.backupError.textContent = "";
  elements.backupPassphrase.value = "";
  elements.backupPrivateKey.value = "";
  actualPrivateKey = "";
  if (elements.backupPrivateKey.classList.contains("masked") === false) {
    elements.backupPrivateKey.classList.add("masked");
  }
  if (elements.revealKey) {
    elements.revealKey.textContent = "Reveal";
  }
  if (keyRevealTimer) {
    clearTimeout(keyRevealTimer);
    keyRevealTimer = null;
  }
}

function showBackupError(message: string) {
  elements.backupError.textContent = message;
  elements.backupError.classList.remove("hidden");
}

function renderWallet(wallet?: WalletData) {
  clearWalletError();
  const now = Date.now();
  const lockDuration = wallet?.lockDurationMinutes ?? DEFAULT_LOCK_MINUTES;
  elements.walletLockDuration.value = lockDuration.toString();
  elements.unlockDuration.value = lockDuration.toString();
  
  if (!wallet) {
    elements.walletEmpty.classList.remove("hidden");
    elements.walletConfigured.classList.add("hidden");
    return;
  }

  elements.walletEmpty.classList.add("hidden");
  elements.walletConfigured.classList.remove("hidden");

  const truncated = truncateAddress(wallet.address);
  elements.walletAddressTruncated.textContent = truncated;
  elements.walletAddressFull.textContent = wallet.address;

  resolveWalletEns(wallet.address).catch(() => undefined);

  const unlocked = typeof wallet.lockedUntil === "number" && wallet.lockedUntil > now;
  const secured = Boolean(wallet.encryptedPrivateKey);

  if (!secured) {
    elements.walletStatusBadge.className = "wallet-status-badge unsecured";
    elements.walletStatusBadge.innerHTML = '<span class="status-icon">⚠️</span><span id="wallet-status-text">Unsecured</span>';
    elements.walletStatusText = document.getElementById("wallet-status-text") as HTMLElement;
    elements.unlockSection.classList.add("hidden");
    elements.unlockedSection.classList.add("hidden");
  } else if (unlocked) {
    elements.walletStatusBadge.className = "wallet-status-badge unlocked";
    elements.walletStatusBadge.innerHTML = '<span class="status-icon">🔓</span><span id="wallet-status-text">Unlocked</span>';
    elements.walletStatusText = document.getElementById("wallet-status-text") as HTMLElement;
    const remaining = Math.floor((wallet.lockedUntil - now) / 60000);
    elements.unlockTimer.textContent = `Unlocked for ${remaining} more minutes`;
    elements.unlockSection.classList.add("hidden");
    elements.unlockedSection.classList.remove("hidden");
  } else {
    elements.walletStatusBadge.className = "wallet-status-badge locked";
    elements.walletStatusBadge.innerHTML = '<span class="status-icon">🔒</span><span id="wallet-status-text">Locked</span>';
    elements.walletStatusText = document.getElementById("wallet-status-text") as HTMLElement;
    elements.unlockSection.classList.remove("hidden");
    elements.unlockedSection.classList.add("hidden");
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

let keyRevealTimer: number | null = null;
let actualPrivateKey: string = "";

elements.copyWallet.addEventListener("click", () => {
  if (!state.wallet) return;
  navigator.clipboard.writeText(state.wallet.address).catch(() => undefined);
});

elements.addressExpand.addEventListener("click", () => {
  elements.walletAddressFull.classList.toggle("hidden");
});

elements.walletSettings.addEventListener("click", () => {
  elements.settingsModal.classList.remove("hidden");
});

elements.settingsClose.addEventListener("click", () => {
  elements.settingsModal.classList.add("hidden");
});

elements.backupWallet.addEventListener("click", () => {
  if (!state.wallet || !state.wallet.encryptedPrivateKey) return;
  resetBackupUI();
  elements.backupModal.classList.remove("hidden");
  setTimeout(() => elements.backupPassphrase.focus(), 0);
});

elements.backupModalClose.addEventListener("click", () => {
  elements.backupModal.classList.add("hidden");
  resetBackupUI();
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
  actualPrivateKey = response.privateKey;
  elements.backupPrivateKey.value = "•".repeat(66);
  elements.backupPrivateKey.classList.add("masked");
  elements.backupResult.classList.remove("hidden");
  if (keyRevealTimer) {
    clearTimeout(keyRevealTimer);
  }
  keyRevealTimer = window.setTimeout(() => {
    elements.backupPrivateKey.value = "•".repeat(66);
    elements.backupPrivateKey.classList.add("masked");
    if (elements.revealKey) elements.revealKey.textContent = "Reveal";
  }, 30000);
});

elements.revealKey.addEventListener("click", () => {
  if (elements.backupPrivateKey.classList.contains("masked")) {
    elements.backupPrivateKey.value = actualPrivateKey;
    elements.backupPrivateKey.classList.remove("masked");
    elements.revealKey.textContent = "Hide";
    if (keyRevealTimer) {
      clearTimeout(keyRevealTimer);
    }
    keyRevealTimer = window.setTimeout(() => {
      elements.backupPrivateKey.value = "•".repeat(66);
      elements.backupPrivateKey.classList.add("masked");
      elements.revealKey.textContent = "Reveal";
    }, 30000);
  } else {
    elements.backupPrivateKey.value = "•".repeat(66);
    elements.backupPrivateKey.classList.add("masked");
    elements.revealKey.textContent = "Reveal";
    if (keyRevealTimer) {
      clearTimeout(keyRevealTimer);
      keyRevealTimer = null;
    }
  }
});

elements.backupCancel.addEventListener("click", () => {
  elements.backupModal.classList.add("hidden");
  resetBackupUI();
});

elements.backupClose.addEventListener("click", () => {
  elements.backupModal.classList.add("hidden");
  resetBackupUI();
});

elements.backupCopy.addEventListener("click", () => {
  if (!actualPrivateKey) return;
  navigator.clipboard.writeText(actualPrivateKey).catch(() => undefined);
});

elements.createWalletBtn.addEventListener("click", () => {
  const wallet = ethers.Wallet.createRandom();
  elements.walletPrivateKey.value = wallet.privateKey;
  elements.walletPassphrase.value = "";
  elements.walletPassphraseConfirm.value = "";
  elements.settingsModal.classList.remove("hidden");
  const details = elements.settingsModal.querySelector("details");
  if (details) details.setAttribute("open", "");
});

elements.importWalletBtn.addEventListener("click", () => {
  elements.settingsModal.classList.remove("hidden");
  const details = elements.settingsModal.querySelector("details");
  if (details) details.setAttribute("open", "");
});

elements.walletImportForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearWalletError();
  const input = elements.walletPrivateKey.value.trim();
  const passphrase = elements.walletPassphrase.value;
  const confirm = elements.walletPassphraseConfirm.value;
  const lockDuration = Number(elements.walletLockDuration.value) || DEFAULT_LOCK_MINUTES;
  if (!input) {
    showWalletError("Private key or mnemonic phrase required.");
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
      privateKeyOrMnemonic: input,
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
  elements.settingsModal.classList.add("hidden");
  await loadState();
});

elements.importCancel.addEventListener("click", () => {
  elements.walletPrivateKey.value = "";
  elements.walletPassphrase.value = "";
  elements.walletPassphraseConfirm.value = "";
  const details = elements.settingsModal.querySelector("details");
  if (details) details.removeAttribute("open");
});

elements.importDifferentWallet.addEventListener("click", () => {
  showConfirmModal(
    "Remove current wallet?",
    "You must remove the current wallet before importing a different one. This action cannot be undone.",
    "REMOVE",
    async () => {
      await chrome.runtime.sendMessage({ type: "x402:updateWallet", wallet: null });
      elements.settingsModal.classList.add("hidden");
      await loadState();
    }
  );
});

elements.removeWallet.addEventListener("click", () => {
  if (!state.wallet) return;
  const addressToConfirm = truncateAddress(state.wallet.address);
  showConfirmModal(
    "Remove wallet?",
    `This will permanently delete the wallet. Type "${addressToConfirm}" to confirm:`,
    addressToConfirm,
    async () => {
      await chrome.runtime.sendMessage({ type: "x402:updateWallet", wallet: null });
      elements.settingsModal.classList.add("hidden");
      await loadState();
    }
  );
});

function showConfirmModal(title: string, message: string, typedValue: string | null, onConfirm: () => void) {
  elements.confirmTitle.textContent = title;
  elements.confirmMessage.textContent = message;
  
  if (typedValue) {
    elements.confirmTypedInput.classList.remove("hidden");
    elements.confirmTypedValue.textContent = typedValue;
    elements.confirmInput.value = "";
  } else {
    elements.confirmTypedInput.classList.add("hidden");
  }

  const handleConfirm = () => {
    if (typedValue && elements.confirmInput.value !== typedValue) {
      return;
    }
    elements.confirmModal.classList.add("hidden");
    onConfirm();
    elements.confirmOk.removeEventListener("click", handleConfirm);
    elements.confirmCancel.removeEventListener("click", handleCancel);
  };

  const handleCancel = () => {
    elements.confirmModal.classList.add("hidden");
    elements.confirmOk.removeEventListener("click", handleConfirm);
    elements.confirmCancel.removeEventListener("click", handleCancel);
  };

  elements.confirmOk.addEventListener("click", handleConfirm);
  elements.confirmCancel.addEventListener("click", handleCancel);
  elements.confirmClose.addEventListener("click", handleCancel);
  elements.confirmModal.classList.remove("hidden");
  if (typedValue) {
    setTimeout(() => elements.confirmInput.focus(), 0);
  }
}

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
