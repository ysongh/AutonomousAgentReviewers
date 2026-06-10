# bootstrap-filecoin — Filecoin Warm Storage spike

Phase 0 spike for the proposed **Demo Judge** feature: prove that **Filecoin
Onchain Cloud** (Warm Storage via the **Synapse SDK**) can store and retrieve a
realistic demo-video file on the **Calibration testnet** (chainId 314159).

Like `bootstrap/` (the 0G proof-of-concept), this is **throwaway and
self-contained** — own `package.json`, own `node_modules/`, own fresh `.env`
keypair. It is **NOT wired into the AAR pipeline** (`agents/`, `shared/`,
`react/`). If the Demo Judge ships, videos would live on Filecoin Warm
Storage referenced by **PieceCID** in the `SubmissionRecord`; JSON verdicts
stay on 0G. Additive, not a migration.

## TL;DR verdict

The Synapse SDK is **pleasant to build on** — well-typed, the Calibration
chain config (RPC, USDFC + Warm Storage addresses, filbeam domain) ships
inside the SDK, payment setup is one call, and uploads return a content-
addressed PieceCID with HTTP-retrievable copies. Video upload/retrieval works
end to end, bytes are identical, and the provider endpoint serves `video/mp4`
over plain HTTP **with byte-range support** — so a dashboard `<video src>` can
stream/seek directly. The one real footgun is the **ethers→viem migration**
(see below); catching it before writing code is exactly the 0G lesson applied.

## The SDK footgun (the 0G-style finding)

`@filoz/synapse-sdk` **v0.41 migrated from ethers to viem** (CHANGELOG #555).
Consequences vs. almost every tutorial in circulation:

- **`viem` is a required peer dependency** and `pnpm` does **not** auto-install
  it. Install explicitly: `pnpm add @filoz/synapse-sdk viem`.
- **There is no `Synapse.create({ privateKey, rpcURL })`.** You pass a viem
  `Account`: `SynapseOptions = { account, source, chain?, transport?, withCDN? }`.
  Build the account with `privateKeyToAccount(0x…)` from `viem/accounts` (a
  *local* account; a bare address forces a browser-wallet custom transport via
  an internal guard in `create()`).
- **The `calibration` chain is built into the SDK** — `import { calibration }`.
  No manual RPC/contract addresses needed.
- **Payment methods return the tx hash without awaiting the receipt.** Reading
  balances immediately shows stale state. You must
  `client.waitForTransactionReceipt({ hash })` and assert `status === 'success'`.
- **Docs site is `synapse.filecoin.services`** (not `docs.filecoin.cloud`), and
  both doc sites are client-rendered — the installed dist + README/CHANGELOG are
  the authoritative reference.
- **No `resolvePieceUrl` in this version.** `synapse.filbeam` only exposes
  `getDataSetStats()`. The retrieval URL comes off `UploadResult.copies[].retrievalUrl`.

## SDK call sequence actually used

```js
import { privateKeyToAccount } from 'viem/accounts';
import { Synapse, calibration } from '@filoz/synapse-sdk';

const account = privateKeyToAccount(process.env.FILECOIN_PRIVATE_KEY);
const synapse = Synapse.create({ account, chain: calibration, source: null });

// payment setup — ONE call (deposit via EIP-2612 permit + approve operator)
const hash = await synapse.payments.depositWithPermitAndApproveOperator({
  amount, rateAllowance, lockupAllowance, maxLockupPeriod, token: 'USDFC',
});
await synapse.client.waitForTransactionReceipt({ hash }); // SDK does NOT wait

// upload (default stores 2 copies across providers; first time creates Data Sets)
const r = await synapse.storage.upload(uint8array, { callbacks: { /* … */ } });
r.pieceCid.toString();           // content-addressed PieceCID
r.copies[0].retrievalUrl;        // HTTP endpoint, video/mp4, range-capable

// download by PieceCID → Uint8Array
const bytes = await synapse.storage.download({ pieceCid: r.pieceCid.toString() });
```

## Setup

```bash
cd bootstrap-filecoin
pnpm install                 # installs @filoz/synapse-sdk, viem, dotenv

node gen-wallet.js           # generates a FRESH keypair into .env (gitignored)
                             # prints the address — fund it before continuing:
#   tFIL  : https://faucet.calibnet.chainsafe-fil.io/funds.html
#   USDFC : https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc

node check-balance.js        # verify tFIL + USDFC landed
node setup-payments.js       # deposit USDFC + approve Warm Storage operator
# drop a .mp4 into this directory, then:
node upload-video.js         # upload → PieceCID + upload-result.json
node download-video.js       # download, sha256 verify, gateway HTTP check
node tiny-piece-test.js      # ~2KB JSON round-trip (migration recon)
```

`.env` (gitignored) holds only `FILECOIN_PRIVATE_KEY`. RPC/chain are baked
into the SDK's `calibration` object.

## Scripts

| Script | What it does |
|---|---|
| `gen-wallet.js` | Generate one fresh keypair into `.env` (refuses to overwrite an existing key). Never reuses any AAR key. |
| `client.js` | Shared construction: viem local account + `Synapse.create({ chain: calibration })`. |
| `check-balance.js` | Print tFIL (gas), USDFC wallet, USDFC deposited-in-Filecoin-Pay. |
| `inspect-pricing.js` | Read-only: live pricing, service params (min/max size), operator allowances, local mp4 detection. |
| `setup-payments.js` | One-call deposit (USDFC, EIP-2612 permit) + Warm Storage operator approval; waits for receipt. |
| `upload-video.js` | Upload the local `.mp4`; report PieceCID, dataset/piece txs, wall-clock, cost. Writes `upload-result.json`. |
| `download-video.js` | SDK download by PieceCID (polls for propagation), sha256 byte-identity, ranged HTTP gateway check. |
| `tiny-piece-test.js` | Upload/download a ~2KB JudgeVerdict-shaped JSON; min-size/padding, cost, round-trip. |

## Results (Calibration, 87.24 MB mp4)

| Metric | Value |
|---|---|
| Upload wall-clock (87.24 MB) | **151.5 s** |
| Copies stored | **2** (primary + secondary, different providers) — SDK default |
| Data sets created | 2 (14166, 14167), one per provider, on first upload |
| PieceCID | `bafkzcibfw7gpaeywuiv54f72v6d74gh2qbreesk6pjmcgrgjielsavejuodfmah77ieq` |
| Propagation delay (until retrievable) | **~0 s** (succeeded on first attempt) |
| Download wall-clock | **24.4 s** |
| sha256 byte-identical | **YES** |
| Gateway plain-HTTP GET | **YES** — `206 Partial Content`, `content-type: video/mp4`, `accept-ranges: bytes` |
| `<video src>` viable directly | **YES** (range/seek supported) |
| USDFC locked up (87 MB, 2 copies) | ~0.2484 USDFC (reserved runway, recoverable) |
| Pricing | 2.5 USDFC / TiB / month (no CDN) |

Gateway URL shape (provider PDP endpoint, non-CDN):
`https://<provider-host>/piece/<PieceCID>`
e.g. `https://caliberation-pdp.infrafolio.com/piece/bafkzcibfw7gp…` .
(With `withCDN: true` retrieval would instead route via the filbeam domain
`calibration.filbeam.io`.)

### Tiny-piece (2017-byte JudgeVerdict JSON)

| Metric | Value |
|---|---|
| Raw size | 2017 bytes (SDK floor `MIN_UPLOAD_SIZE` = 127 bytes; leaf = 32 bytes) |
| Copies / data sets | 2 copies, **reused** existing data sets (no new-dataset tx) |
| Upload wall-clock | **96.3 s** |
| Download wall-clock | 0.3 s |
| Round-trip | 96.6 s |
| USDFC locked up | ~0.0000022 USDFC (negligible) |
| Byte-identical | YES |

**Migration implication.** Migrating AAR's small JSON artifacts
(`JudgeVerdict`/`RevisedVerdict`/`PanelVerdict`) to Filecoin would *work* and
be byte-exact and effectively free in token terms — but each write costs
**~90–150 s of on-chain piece-add + confirmation latency** (the 2 KB piece
took 96 s, barely faster than the 87 MB video, because cost is dominated by
chain confirmation across 2 provider copies, not payload size). That is a
large regression versus 0G's ~10 s upload on the synchronous verdict hot path.
Filecoin Warm Storage is a good fit for **large, write-once, read-streamed
blobs (videos)** and a poor fit for **many small, latency-sensitive JSON
writes**. If migration were ever pursued, it would only make sense as an
archival tier and/or by batching many verdicts into a single piece — not as a
drop-in replacement for the per-verdict 0G writes.

## Token consumption (whole spike)

- **tFIL (gas):** ~0.000025 tFIL total across payment setup + 2 dataset
  creations + 4 piece-adds (negligible).
- **USDFC:** 4 of 5 deposited into Filecoin Pay; ~0.2484 USDFC *locked up* as
  storage runway (recoverable by terminating the data sets). Actual settled
  spend over the spike's minutes ≈ 0.

## Notes / quirks summary

- ethers→viem migration; viem is a required, non-auto-installed peer dep.
- Payment txs don't await receipts — wait + assert `status === 'success'`.
- `storage.upload` defaults to **2 copies** across providers (doubles lockup
  and piece-add txs). Configurable via upload options if a single copy is wanted.
- Small-piece latency is dominated by chain confirmation, not size.
- Retrieval is served by the provider PDP host over HTTP with range support;
  filbeam CDN domain applies only to `withCDN` uploads.
