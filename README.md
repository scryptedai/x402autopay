# x402 Autopay Extension

x402 Autopay is a Chromium extension that intercepts HTTP 402 “Payment Required”
challenges, evaluates site policies, and either auto-pays from a local hot
wallet or prompts the user to approve the transaction. The project is built and
bundled with **Bun** and targets Polygon Amoy (testnet) and Polygon mainnet
using USDC authorizations.

---

## Quick Start

1. Install dependencies: `bun install`
2. Build the extension bundle: `bun run build` (outputs to `dist/`)
3. Load the unpacked extension at `chrome://extensions` → Enable Developer Mode
   → **Load unpacked…** → select the `dist/` directory.
4. Optional: `bun run pack` rebuilds the bundles and zips them into
   `x402-autopay.zip` for distribution.

The repository includes a simple demo page (`demo-joke.html`) that triggers an
x402 challenge against the facilitator endpoint for local testing.

---

## Repository Layout

| Path | Description |
| --- | --- |
| `src/background.ts` | Service worker orchestrating policy evaluation, authorizations, and wallet state. |
| `src/content.main.ts` | Injected script that patches `window.fetch`, parses challenges, and coordinates retries. |
| `src/popup.ts`, `popup.html`, `popup.css` | Popup UI for wallet management, balances, policies, and history. |
| `src/prompt.ts`, `prompt.html`, `prompt.css` | Approval window presented when manual confirmation is required. |
| `src/shared/*` | Shared types, storage helpers, API utilities, cryptography helpers, and challenge parsing. |
| `scripts/build.ts`, `scripts/pack.ts` | Bun-powered build/pack utilities. |
| `dist/` | Generated assets after running `bun run build`. |
| `spec/PRD.md` | Product notes and requirements. |

---

## Current Capabilities

- **Challenge interception:** The content script inspects 402 responses, parses
  challenge headers/bodies, and relays them to the background service worker.
- **Policy-aware auto-pay:** The background worker tracks per-origin policies,
  thresholds, and daily limits. Approved challenges are signed using EIP-3009
  `TransferWithAuthorization` payloads and retried with the required headers.
- **Prompt workflow:** When manual approval is needed, the prompt window lists
  merchant, endpoint, amount, balance, and wallet status before collecting a
  decision.
- **Wallet management:** The popup supports importing or generating wallets,
  enforcing passphrase-based encryption, unlocking for a configurable duration,
  on-demand private-key backup, and full removal with double confirmation.
- **USDC balances:** Balances are refreshed per supported chain via public RPC
  endpoints and CoinGecko pricing, and can be refreshed manually from the popup.
- **History & policies:** The popup surfaces recent payments, status indicators,
  and basic allow/deny policy toggles for each origin.

---

## Development Guidelines

- **Bun first:** Use `bun install`, `bun run build`, `bun run pack`, and
  `bun test` (when tests exist). Avoid Node/npm/vite alternatives per repository
  policy.
- **TypeScript conventions:** Two-space indentation, trailing commas on
  multi-line literals, `camelCase` for values, `PascalCase` for
  types/components, `SCREAMING_SNAKE_CASE` for constants, and relative imports.
- **Manual QA:** After changes, run `bun run build`, reload the unpacked
  extension, trigger the demo page, verify prompt + retry flow, confirm balances
  update, and ensure wallet lock/unlock/backups behave as expected.

---

## Build, Packaging, and CI

- `bun run build` clears `dist/`, bundles TypeScript entry points, and copies
  static assets while stamping `.built-at`.
- `bun run pack` rebuilds and zips the distribution into `x402-autopay.zip`.
- A GitHub Action (`.github/workflows/pack.yml`) runs on every push to `main`,
  executes `bun run pack`, and publishes `x402-autopay.zip` to a release that
  uses GitHub’s automatic release notes.

---

## Security & Operational Notes

- **Passphrase-encrypted hot wallet:** Wallets are stored encrypted in
  `chrome.storage.local`. Unlocking refreshes the in-memory key for the
  configured duration; removal wipes both the cipher text and runtime cache.
- **Manual backups:** The popup’s “Back up” control requires the passphrase
  before revealing the private key, allowing secure offline storage.
- **Pending hardening:** The extension still trusts facilitator-supplied USD
  amounts, and it signs whichever token/chain the challenge specifies. Future
  work should verify `tokenAddress`, recompute USD totals from on-chain
  decimals, and tighten allowlists.
- **Transport coverage:** Only the Fetch API is patched today. XHR, service
  workers, or WebSockets that encounter 402 responses are not yet intercepted.
- **Telemetry & logging:** Console logging is enabled for troubleshooting; scrub
  sensitive data before sharing logs or recordings.

---

## Known Limitations & Roadmap

- Enforce an allowlist for chains/tokens before signing authorizations.
- Reconcile facilitator-provided USD amounts with locally computed values to
  prevent under-reported charges.
- Extend policy UI to configure per-site caps and expose panic lock controls in
  the popup.
- Broaden interception to XHR/WebSocket clients or document the limitation
  explicitly in UX.
- Add automated coverage (`bun test`) for challenge parsing, policy enforcement,
  and wallet flows.

Contributions that address the above gaps are welcome - please coordinate via
issues or PRs.

---

## Testing & Verification Checklist

1. `bun run build` completes without errors.
2. Load `dist/` as an unpacked extension and ensure the popup shows balances for
   Polygon + Amoy after refreshing.
3. Visit `demo-joke.html` (served locally - use something like
   `npx http-server`), click **Fetch joke**, approve the prompt, and confirm the
   joke response is returned.
4. Lock, unlock, back up, and remove the wallet from the popup to confirm
   encryption and cleanup behavior.
5. Review the recent payment history and policy toggles for the origin used
   during manual QA.