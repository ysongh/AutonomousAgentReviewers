# Autonomous Agent Reviewers (AAR)

A swarm of AI judge agents that peer-review hackathon submissions, coordinating
via 0G Storage on the 0G Galileo testnet (chainId 16602).

## Layout

- `react/` — Vite + React + TS template, the eventual dashboard. **Do not
  modify** until the dashboard work officially starts.
- `bootstrap/` — Throwaway Day-1 sanity check that proves 0G Storage
  upload/download works on this machine. Self-contained: own `package.json`,
  own `node_modules`, own `.env`. Not imported by anything else and not part
  of the final architecture. See `bootstrap/README.md`.
- Root `package.json` — leave alone. No monorepo config, no workspaces. Each
  real subproject gets its own `package.json`.

## 0G Storage SDK / contract footgun (important)

`@0glabs/0g-ts-sdk@0.3.3` (latest on npm) is **incompatible** with the deployed
flow contract on 0G Galileo testnet. The contract expects a wrapped struct:

```solidity
struct Submission { SubmissionData data; address submitter; }
```

with selector `0xbc8c11f8`. The SDK still calls the old un-wrapped selector
`0xef3e12dc`, so `Indexer.upload(...)` and `Uploader.uploadFile(...)` always
revert with `require(false)`.

**Workaround used in `bootstrap/upload.js`:** call `flow.submit(...)` directly
with raw ethers using the new ABI, then push segments via
`StorageNode.uploadSegmentsByTxSeq(...)`. The rest of the SDK is fine —
`MemData`, `MerkleTree` (`file.merkleTree()`), `file.createSubmission(...)`,
`Indexer.selectNodes(...)`, `Indexer.download(...)`, and the `Submit` event
ABI on `getFlowContract(...)` all work as-is.

When building the real upload path (outside `bootstrap/`), reuse this same
pattern — don't try `Indexer.upload` again expecting it to work.

## Conventions

- Never commit secrets. `.env` files are gitignored at each subproject's level;
  ship `.env.example` with placeholders.
- Treat 0G testnet calls as flaky — log entries can take seconds to propagate
  to storage nodes after a successful on-chain submit. Poll
  `getFileInfoByTxSeq(txSeq)` until non-null before pushing segments.
- Storage fee for tiny payloads is dominated by gas, not the per-sector price
  (~3e-8 0G/sector). Don't over-engineer fee estimation for sanity checks.
