const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { ethers, encodeBase64 } = require('ethers');
const { MemData, Indexer, getFlowContract } = require('@0glabs/0g-ts-sdk');
const { EVENTS, startTimer } = require('./logger');

// The deployed flow contract on 0G Galileo wraps SubmissionData with the
// submitter's address. The published SDK still calls the un-wrapped selector
// (0xef3e12dc) and reverts. We bypass it and call the new selector
// (0xbc8c11f8) ourselves. See CLAUDE.md and bootstrap/README.md for details.
const NEW_SUBMIT_ABI = [
  'function submit(((uint256,bytes,(bytes32,uint256)[]),address) submission) payable returns (uint256, bytes32, uint256, uint256)',
  'function market() view returns (address)',
];
const MARKET_ABI = ['function pricePerSector() view returns (uint256)'];

const SEGMENT_SIZE = 256 * 1024;
const CHUNK_SIZE = 256;
const PROPAGATION_TIMEOUT_MS = 120_000;
const FINALIZATION_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 2000;
// Random pre-submit jitter (ms). Staggers concurrent uploads from different
// wallets across multiple Galileo blocks (~1.5s block time) to avoid the
// cross-submitter race in the flow contract. See CLAUDE.md. For the round-1 /
// round-2 judge fan-out, the coordinator additionally passes an explicit
// `submitDelayMs` slot offset (see SUBMIT_SLOT_MS in config.js) so the three
// concurrent submits are serialized on-chain; this random jitter is then just
// within-slot fuzz on top of that offset. Solo uploads (SubmissionRecord, panel
// verdict, demo verdict) pass no offset and behave exactly as before.
const UPLOAD_JITTER_MAX_MS = 2000;

function requireNetworkEnv() {
  const { RPC_URL, INDEXER_URL } = process.env;
  if (!RPC_URL || !INDEXER_URL) {
    throw new Error('Missing RPC_URL or INDEXER_URL in environment');
  }
  return { RPC_URL, INDEXER_URL };
}

// Legacy shared-wallet signer. Used by bootstrap/ scripts and any other
// non-agent caller that hasn't migrated to per-agent wallets. Agents must
// pass their own signer (see shared/agent-wallet.js).
function getDefaultSigner() {
  const { RPC_URL } = requireNetworkEnv();
  const { PRIVATE_KEY } = process.env;
  if (!PRIVATE_KEY) {
    throw new Error('PRIVATE_KEY missing — getDefaultSigner() requires the legacy shared key in .env');
  }
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  return new ethers.Wallet(PRIVATE_KEY, provider);
}

async function uploadJSON(obj, signer, { logger, submissionId, submitDelayMs } = {}) {
  if (!signer || typeof signer.getAddress !== 'function') {
    throw new Error('uploadJSON now requires an explicit ethers.Wallet signer as its second argument');
  }
  const { INDEXER_URL } = requireNetworkEnv();
  const overallTimer = startTimer();

  const provider = signer.provider;
  if (!provider) throw new Error('signer must be connected to a provider');
  const submitter = await signer.getAddress();

  // Coordinated slot offset (round-1/round-2 fan-out) + within-slot random fuzz.
  // submitDelayMs is 0/undefined for solo uploads, so they keep the original
  // 0–2000ms random-only behavior.
  const baseDelay = Number.isFinite(submitDelayMs) ? Math.max(0, submitDelayMs) : 0;
  const jitterMs = baseDelay + Math.floor(Math.random() * UPLOAD_JITTER_MAX_MS);
  logger?.info({ event: 'upload-jitter', submissionId, submitter, jitterMs, submitDelayMs: baseDelay });
  await new Promise((r) => setTimeout(r, jitterMs));

  const indexer = new Indexer(INDEXER_URL);
  const [nodes, selectErr] = await indexer.selectNodes(1);
  if (selectErr !== null) throw new Error(`selectNodes failed: ${selectErr}`);
  const status = await nodes[0].getStatus();
  if (status === null) throw new Error('storage node returned null status');

  const flow = new ethers.Contract(status.networkIdentity.flowAddress, NEW_SUBMIT_ABI, signer);
  const flowForEvents = getFlowContract(status.networkIdentity.flowAddress, provider);
  const marketAddr = await flow.market();
  const market = new ethers.Contract(marketAddr, MARKET_ABI, provider);
  const pricePerSector = await market.pricePerSector();

  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  const file = new MemData(bytes);

  const [tree, treeErr] = await file.merkleTree();
  if (treeErr !== null) throw new Error(`merkleTree() failed: ${treeErr}`);
  const rootHash = tree.rootHash();

  const [submission, subErr] = await file.createSubmission('0x');
  if (subErr !== null) throw new Error(`createSubmission failed: ${subErr}`);

  let sectors = 0n;
  for (const n of submission.nodes) sectors += 1n << BigInt(n.height.toString());
  const fee = sectors * pricePerSector;

  const wrapped = [
    [
      BigInt(submission.length),
      submission.tags,
      submission.nodes.map((n) => [n.root, BigInt(n.height.toString())]),
    ],
    submitter,
  ];

  logger?.info({
    event: EVENTS.UPLOAD_START,
    submissionId,
    rootHash,
    submitter,
    sizeBytes: bytes.length,
    fee: fee.toString(),
  });
  const tx = await flow.submit(wrapped, { value: fee });
  const receipt = await tx.wait();

  const submitTopic = flowForEvents.interface.getEvent('Submit').topicHash;
  let txSeq = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== flow.target.toLowerCase()) continue;
    if (log.topics[0] !== submitTopic) continue;
    const parsed = flowForEvents.interface.parseLog(log);
    txSeq = Number(parsed.args.submissionIndex);
    break;
  }
  if (txSeq === null) throw new Error('Failed to find Submit event in receipt logs');

  logger?.info({
    event: 'upload-mined',
    submissionId,
    rootHash,
    txHash: tx.hash,
    txSeq,
    block: receipt.blockNumber,
  });

  // Wait for storage node to see the log entry
  const propDeadline = Date.now() + PROPAGATION_TIMEOUT_MS;
  let info = null;
  while (Date.now() < propDeadline) {
    info = await nodes[0].getFileInfoByTxSeq(txSeq);
    if (info !== null) break;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  if (info === null) throw new Error(`Storage node never saw txSeq ${txSeq} after ${PROPAGATION_TIMEOUT_MS}ms`);

  // Upload the single segment (covers payloads up to 256KiB)
  const segIter = file.iterateWithOffsetAndBatch(0, SEGMENT_SIZE, true);
  const [ok, iterErr] = await segIter.next();
  if (iterErr !== null || !ok) throw new Error(`segment iterate failed: ${iterErr}`);
  let segment = segIter.current();
  const expectedLen = CHUNK_SIZE * file.numChunks();
  segment = segment.slice(0, expectedLen);

  const proof = tree.proofAt(0);
  const segWithProof = {
    root: rootHash,
    data: encodeBase64(segment),
    index: 0,
    proof,
    fileSize: file.size(),
  };

  for (const node of nodes) {
    try {
      await node.uploadSegmentsByTxSeq([segWithProof], txSeq);
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg.includes('already uploaded') || e?.data === 'already uploaded and finalized') continue;
      throw new Error(`segment upload to ${node.url} failed: ${msg}`);
    }
  }

  // Wait for finalization
  const finDeadline = Date.now() + FINALIZATION_TIMEOUT_MS;
  while (Date.now() < finDeadline) {
    const fin = await nodes[0].getFileInfoByTxSeq(txSeq);
    if (fin !== null && fin.finalized) break;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  logger?.info({
    event: EVENTS.UPLOAD_COMPLETE,
    submissionId,
    rootHash,
    txHash: tx.hash,
    txSeq,
    durationMs: overallTimer(),
  });
  return { rootHash, txHash: tx.hash, txSeq };
}

async function downloadJSON(rootHash, { logger, submissionId } = {}) {
  const { INDEXER_URL } = requireNetworkEnv();
  const indexer = new Indexer(INDEXER_URL);
  const tmpFile = path.join(os.tmpdir(), `aar-dl-${crypto.randomUUID()}.json`);
  const timer = startTimer();
  logger?.info({ event: EVENTS.DOWNLOAD_START, submissionId, rootHash });
  try {
    const err = await indexer.download(rootHash, tmpFile, true);
    if (err !== null) throw new Error(`download failed: ${err}`);
    const raw = fs.readFileSync(tmpFile, 'utf8');
    const parsed = JSON.parse(raw);
    logger?.info({
      event: EVENTS.DOWNLOAD_COMPLETE,
      submissionId,
      rootHash,
      sizeBytes: raw.length,
      durationMs: timer(),
    });
    return parsed;
  } finally {
    if (fs.existsSync(tmpFile)) {
      try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore */ }
    }
  }
}

module.exports = { uploadJSON, downloadJSON, getDefaultSigner };
