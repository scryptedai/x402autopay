import { INITIAL_STATE } from "./shared/storage";
import type { ChainId, ExtensionState, PendingChallenge } from "./shared/types";

const state: ExtensionState = structuredClone(INITIAL_STATE);

const challengeId = window.location.hash.slice(1);
const elements = {
  site: document.getElementById("prompt-site") as HTMLElement,
  endpoint: document.getElementById("prompt-endpoint") as HTMLElement,
  amount: document.getElementById("prompt-amount") as HTMLElement,
  token: document.getElementById("prompt-token") as HTMLElement,
  balance: document.getElementById("prompt-balance") as HTMLElement,
  warning: document.getElementById("prompt-warning") as HTMLElement,
  unlockForm: document.getElementById("prompt-unlock") as HTMLFormElement,
  unlockPassphrase: document.getElementById("prompt-passphrase") as HTMLInputElement,
  policyToggle: document.getElementById("prompt-allow") as HTMLInputElement,
  approve: document.getElementById("prompt-approve") as HTMLButtonElement,
  deny: document.getElementById("prompt-deny") as HTMLButtonElement,
  status: document.getElementById("prompt-status") as HTMLElement,
} as const;

async function loadChallenge() {
  if (!challengeId) {
    elements.status.textContent = "Missing challenge identifier";
    elements.approve.disabled = true;
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "x402:getPendingChallenge",
    challengeId,
  });
  const entry = (response?.entry ?? null) as PendingChallenge | null;
  if (!entry) {
    elements.status.textContent = "Payment request expired";
    elements.approve.disabled = true;
    return;
  }

  Object.assign(state, await chrome.runtime.sendMessage({ type: "x402:getState" }));
  const { challenge } = entry;
  const policy = state.policies[challenge.origin];
  const challengeChain = mapChainId(challenge.chainId);
  const chainBalance = challengeChain ? state.balances?.[challengeChain] : undefined;

  elements.site.textContent = challenge.origin;
  elements.endpoint.textContent = `${challenge.method} ${challenge.endpoint}`;
  const decimals = challenge.tokenDecimals ?? chainBalance?.decimals ?? 6;
  const requiredAtomic = safeBigInt(challenge.amountAtomic);
  const balanceAtomic = safeBigInt(chainBalance?.rawBalance);
  const formattedRequired = formatTokenAmount(requiredAtomic, decimals);
  const formattedBalance = formatTokenAmount(balanceAtomic, decimals);

  elements.amount.textContent = `${challenge.amountUsd.toFixed(4)} USD (${formattedRequired} ${challenge.tokenSymbol})`;
  elements.token.textContent = challenge.tokenSymbol;
  elements.balance.textContent = `${formattedBalance} ${(chainBalance?.tokenSymbol ?? challenge.tokenSymbol)}`;
  elements.policyToggle.checked = policy?.allowUnderThreshold ?? false;

  const insufficient = balanceAtomic < requiredAtomic;
  const locked = isWalletLocked(state.wallet);
  if (insufficient) {
    elements.warning.textContent = `Insufficient ${challenge.tokenSymbol} balance. Requires ${formattedRequired}, available ${formattedBalance}.`;
    elements.warning.classList.remove("hidden");
    elements.approve.disabled = true;
    elements.unlockForm.classList.add("hidden");
  } else if (locked) {
    elements.warning.textContent = "Wallet is locked. Enter your passphrase to unlock.";
    elements.warning.classList.remove("hidden");
    elements.approve.disabled = true;
    elements.unlockForm.classList.remove("hidden");
  } else {
    elements.warning.classList.add("hidden");
    elements.unlockForm.classList.add("hidden");
    elements.approve.disabled = false;
  }
}

elements.approve.addEventListener("click", () => {
  submitDecision(true).catch((error) => {
    elements.status.textContent = String(error);
  });
});

elements.deny.addEventListener("click", () => {
  submitDecision(false).catch((error) => {
    elements.status.textContent = String(error);
  });
});

elements.unlockForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const passphrase = elements.unlockPassphrase.value;
  if (!passphrase) {
    elements.status.textContent = "Passphrase required";
    return;
  }
  const response = await chrome.runtime.sendMessage({
    type: "x402:unlockWallet",
    passphrase,
  });
  if (response?.error) {
    elements.status.textContent = String(response.error);
    return;
  }
  elements.unlockPassphrase.value = "";
  await loadChallenge();
});

async function submitDecision(approve: boolean) {
  if (!challengeId) return;
  await chrome.runtime.sendMessage({
    type: "x402:promptDecision",
    challengeId,
    decision: {
      approve,
      alwaysAllow: elements.policyToggle.checked && approve,
    },
  });
  window.close();
}

function safeBigInt(value: string | number | null | undefined): bigint {
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string" && value.trim() !== "") {
    try {
      return BigInt(value);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

function formatTokenAmount(amount: bigint, decimals: number): string {
  if (decimals <= 0) {
    return amount.toString();
  }
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fraction = amount % base;
  if (fraction === 0n) {
    return whole.toString();
  }
  const fractionStr = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fractionStr}`;
}

function mapChainId(chainId: number): ChainId | undefined {
  if (chainId === 137) return "polygon";
  if (chainId === 80002) return "polygonAmoy";
  return undefined;
}

function isWalletLocked(wallet: ExtensionState["wallet"]): boolean {
  if (!wallet) return true;
  const until = wallet.lockedUntil ?? 0;
  return until <= Date.now();
}

loadChallenge().catch((error) => {
  elements.status.textContent = String(error);
});
