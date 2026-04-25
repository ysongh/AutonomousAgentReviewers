# bootstrap/

Throwaway Day-1 sanity check for the **Autonomous Agent Reviewers (AAR)**
project. This directory is **not** part of the real project structure — it
exists only to verify that uploading and downloading a small JSON payload
through 0G Storage on the 0G Galileo testnet works on this machine.

It is fully self-contained: its own `package.json`, its own `node_modules/`,
its own `.env`. Nothing here is imported by `react/` or any future code.

## Setup

1. Install deps:
   ```
   npm install
   ```
2. Copy the env template and fill in your testnet wallet's private key:
   ```
   cp .env.example .env
   # then edit .env
   ```

`.env` values:
- `PRIVATE_KEY` — funded 0G Galileo testnet wallet private key
- `RPC_URL` — `https://evmrpc-testnet.0g.ai`
- `INDEXER_URL` — `https://indexer-storage-testnet-turbo.0g.ai`

## Run

Upload a small JSON payload, get a root hash:
```
node upload.js
```

Download by root hash and verify the round-trip:
```
node download.js <rootHash>
```

The downloaded payload is written to `bootstrap/downloaded.json`
(gitignored) and printed to the console.

## SDK / contract notes

`@0glabs/0g-ts-sdk@0.3.3` (latest on npm as of 2026-04-25) is **incompatible
with the deployed flow contract** on the 0G Galileo testnet. The contract
was upgraded to a new submission struct that wraps the old
`SubmissionData` with the submitter's address:

```solidity
struct Submission { SubmissionData data; address submitter; }
struct SubmissionData { uint length; bytes tags; SubmissionNode[] nodes; }
```

So:
- SDK's `Indexer.upload(...)` always reverts with `require(false)` because
  it calls the old `submit((uint256,bytes,(bytes32,uint256)[]))` selector
  (`0xef3e12dc`). The deployed contract only has the new
  `submit(((uint256,bytes,(bytes32,uint256)[]),address))` selector
  (`0xbc8c11f8`).
- We bypass `Indexer.upload` and do the on-chain submit ourselves with
  raw ethers using the new ABI, then push segments to storage nodes
  directly using the SDK's `StorageNode.uploadSegmentsByTxSeq(...)`.
- We still use the SDK for `MemData`, `MerkleTree` (via
  `file.merkleTree()`), `file.createSubmission(...)`, and
  `Indexer.selectNodes(...)` — all of which are pure off-chain helpers
  that work fine.
- Download is unaffected — `Indexer.download(...)` only talks to storage
  nodes (no contract calls), so we use it as-is.
