// filecoin-storage.js — the productionized Filecoin Warm Storage client for the
// Demo Judge feature. ONLY intake uses this (to store the demo video); the demo
// judge retrieves the video over plain HTTP from the retrievalUrl on the
// SubmissionRecord and never imports this module. JSON verdicts stay on 0G —
// Filecoin holds ONLY the video.
//
// Productionized from bootstrap-filecoin/. The Phase-0 spike footguns are
// non-negotiable context and are reproduced here:
//
//   1. ESM-ONLY SDK FROM A CommonJS MODULE. @filoz/synapse-sdk (v0.41+) and its
//      required peer dep `viem` are ESM-only. shared/ and the agents are
//      CommonJS, so we cannot `require()` them — we load them with dynamic
//      `import()` and cache the resolved client. This is the only way to bridge
//      the boundary without converting the whole agent to ESM.
//   2. ethers -> viem migration. There is NO Synapse.create({ privateKey }).
//      You build a LOCAL viem account with privateKeyToAccount(0x...) and pass
//      it as SynapseOptions.account. The `calibration` chain (chainId 314159,
//      RPC, USDFC + Warm Storage addresses) is baked into the SDK.
//   3. Payment txs don't await receipts. We do NO payment setup at runtime —
//      the spike wallet's USDFC deposit + Warm Storage operator approval are
//      already done. assertRunway() only READS balances; if any future code
//      path mines a tx, it MUST waitForTransactionReceipt + assert success
//      (see the spike's setup-payments.js). Upload itself is awaited to piece
//      confirmation by the SDK via the onPiecesConfirmed callback.
//
// Reuses the funded bootstrap-filecoin spike wallet via FILECOIN_PRIVATE_KEY in
// the root .env. NEVER reuses any 0G AAR key.

const fs = require('fs');

// --- runway thresholds -------------------------------------------------------
// Read-only sanity gates checked at intake startup. We do no payment setup at
// runtime, so if either of these is dry the operator must top up the spike
// wallet (tFIL: https://faucet.calibnet.chainsafe-fil.io/funds.html ;
// USDFC: https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc).
const MIN_TFIL_WEI = 1_000_000_000_000_000n; // 0.001 tFIL — gas for piece-adds is tiny
const MIN_USDFC_DEPOSITED_WEI = 1_000_000_000_000_000n; // 0.001 USDFC deposited in Filecoin Pay

let clientPromise; // cached { synapse, account, viem } — built once per process

// Dynamic-import the ESM SDK + viem and construct a local-account Synapse client.
async function getClient() {
  if (clientPromise) return clientPromise;
  clientPromise = (async () => {
    const pk = process.env.FILECOIN_PRIVATE_KEY;
    if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) {
      throw new Error(
        'FILECOIN_PRIVATE_KEY missing or malformed in root .env (expected 0x + 64 hex). ' +
          'Reuse the funded bootstrap-filecoin spike wallet.',
      );
    }
    const viem = await import('viem');
    const { privateKeyToAccount } = await import('viem/accounts');
    const { Synapse, calibration } = await import('@filoz/synapse-sdk');
    const account = privateKeyToAccount(pk);
    // source is a required SynapseOptions field (telemetry tag); null = unset.
    const synapse = Synapse.create({ account, chain: calibration, source: null });
    return { synapse, account, viem };
  })().catch((err) => {
    clientPromise = undefined; // allow a later retry after a transient import/RPC failure
    throw err;
  });
  return clientPromise;
}

// Read-only startup gate. Fail loud if the spike wallet can't pay gas or has no
// USDFC runway deposited. Does NOT set up payments — that was done once in the
// spike and must not happen on the synchronous submit path.
async function assertRunway() {
  const { synapse, account, viem } = await getClient();
  const addr = account.address;
  const tfilWei = await synapse.client.getBalance({ address: addr });
  const decimals = synapse.payments.decimals();
  const usdfcDeposited = await synapse.payments.balance({ token: 'USDFC' });

  const problems = [];
  if (tfilWei < MIN_TFIL_WEI) {
    problems.push(
      `tFIL gas too low: ${viem.formatEther(tfilWei)} tFIL (need >= ${viem.formatEther(MIN_TFIL_WEI)})`,
    );
  }
  if (usdfcDeposited < MIN_USDFC_DEPOSITED_WEI) {
    problems.push(
      `USDFC deposited too low: ${viem.formatUnits(usdfcDeposited, decimals)} USDFC ` +
        `(need >= ${viem.formatUnits(MIN_USDFC_DEPOSITED_WEI, decimals)} in Filecoin Pay)`,
    );
  }
  if (problems.length) {
    throw new Error(
      `Filecoin Warm Storage runway insufficient for wallet ${addr}:\n  - ${problems.join('\n  - ')}`,
    );
  }
  return {
    address: addr,
    tfil: viem.formatEther(tfilWei),
    usdfcDeposited: viem.formatUnits(usdfcDeposited, decimals),
  };
}

// Upload a demo video to Warm Storage. Accepts a file path (string), a Buffer,
// or a Uint8Array. Returns the content-addressed PieceCID and an HTTP-streamable
// retrievalUrl (video/mp4, range-capable) that the demo judge fetches directly.
async function uploadVideo(filePathOrBuffer, { logger } = {}) {
  const { synapse } = await getClient();

  let bytes;
  if (typeof filePathOrBuffer === 'string') {
    bytes = new Uint8Array(fs.readFileSync(filePathOrBuffer));
  } else if (Buffer.isBuffer(filePathOrBuffer)) {
    bytes = new Uint8Array(filePathOrBuffer);
  } else if (filePathOrBuffer instanceof Uint8Array) {
    bytes = filePathOrBuffer;
  } else {
    throw new Error('uploadVideo: expected a file path, Buffer, or Uint8Array');
  }
  const sizeBytes = bytes.byteLength;

  // Operational escape hatch: comma-separated provider ids to avoid. With
  // copies:1 there is NO provider failover (the copies:2 default is what gives
  // you that), so if the selected Warm Storage provider's piece-store endpoint
  // is degraded, set FILECOIN_EXCLUDE_PROVIDER_IDS=<id[,id...]> to force the SDK
  // onto a healthy provider (a new data set is created there). Defaults to none.
  const excludeProviderIds = (process.env.FILECOIN_EXCLUDE_PROVIDER_IDS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => BigInt(s));

  const t0 = Date.now();
  const result = await synapse.storage.upload(bytes, {
    // v1: single copy; revisit 2-copy redundancy for production. The SDK
    // defaults to 2 copies across providers (doubles lockup + piece-add txs).
    copies: 1,
    ...(excludeProviderIds.length ? { excludeProviderIds } : {}),
    callbacks: {
      onProviderSelected: (p) =>
        logger?.info({ event: 'filecoin-provider-selected', provider: p.serviceProvider ?? p.payee }),
      onDataSetResolved: (i) =>
        logger?.info({ event: 'filecoin-dataset-resolved', dataSetId: String(i.dataSetId) }),
      onPiecesConfirmed: (dataSetId, providerId, pieces) =>
        logger?.info({
          event: 'filecoin-pieces-confirmed',
          dataSetId: String(dataSetId),
          providerId: String(providerId),
          pieces: pieces.length,
        }),
    },
  });
  const uploadMs = Date.now() - t0;

  const pieceCid = result.pieceCid.toString();
  const retrievalUrl = result.copies[0]?.retrievalUrl;
  if (!retrievalUrl) {
    throw new Error(`Filecoin upload returned no retrievalUrl (pieceCid=${pieceCid})`);
  }

  return { pieceCid, retrievalUrl, uploadMs, sizeBytes };
}

module.exports = { uploadVideo, assertRunway };
