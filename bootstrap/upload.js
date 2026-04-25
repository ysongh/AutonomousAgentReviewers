require('dotenv').config();
const { ethers, encodeBase64 } = require('ethers');
const { MemData, Indexer, getFlowContract } = require('@0glabs/0g-ts-sdk');

const NEW_SUBMIT_ABI = [
  'function submit(((uint256,bytes,(bytes32,uint256)[]),address) submission) payable returns (uint256, bytes32, uint256, uint256)',
  'function market() view returns (address)',
];
const MARKET_ABI = ['function pricePerSector() view returns (uint256)'];

async function main() {
  const { PRIVATE_KEY, RPC_URL, INDEXER_URL } = process.env;
  if (!PRIVATE_KEY || !RPC_URL || !INDEXER_URL) {
    console.error('Missing PRIVATE_KEY, RPC_URL, or INDEXER_URL in .env');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const submitter = await wallet.getAddress();

  const indexer = new Indexer(INDEXER_URL);
  const [nodes, selectErr] = await indexer.selectNodes(1);
  if (selectErr !== null) {
    console.error('selectNodes failed:', selectErr);
    process.exit(1);
  }
  const status = await nodes[0].getStatus();
  if (status === null) {
    console.error('storage node returned null status');
    process.exit(1);
  }
  console.log('Selected', nodes.length, 'storage node(s); flow:', status.networkIdentity.flowAddress);

  const flow = new ethers.Contract(status.networkIdentity.flowAddress, NEW_SUBMIT_ABI, wallet);
  const flowForEvents = getFlowContract(status.networkIdentity.flowAddress, provider);
  const marketAddr = await flow.market();
  const market = new ethers.Contract(marketAddr, MARKET_ABI, provider);
  const pricePerSector = await market.pricePerSector();

  const payload = {
    type: 'hello-from-aar',
    sender: 'bootstrap-script',
    timestamp: new Date().toISOString(),
    data: 'AAR Day 1 sanity check',
  };
  console.log('Payload to upload:', payload);

  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const file = new MemData(bytes);

  const [tree, treeErr] = await file.merkleTree();
  if (treeErr !== null) {
    console.error('merkleTree() failed:', treeErr);
    process.exit(1);
  }
  const rootHash = tree.rootHash();
  console.log('Computed merkle root:', rootHash);

  const [submission, subErr] = await file.createSubmission('0x');
  if (subErr !== null) {
    console.error('createSubmission failed:', subErr);
    process.exit(1);
  }

  let sectors = 0n;
  for (const n of submission.nodes) sectors += 1n << BigInt(n.height.toString());
  const fee = sectors * pricePerSector;
  console.log('Sectors:', sectors.toString(), 'fee:', fee.toString(), 'wei');

  const wrapped = [
    [BigInt(submission.length), submission.tags, submission.nodes.map((n) => [n.root, BigInt(n.height.toString())])],
    submitter,
  ];

  console.log('Submitting on-chain via new submit ABI...');
  let tx;
  try {
    tx = await flow.submit(wrapped, { value: fee });
  } catch (e) {
    console.error('flow.submit() failed:', e.shortMessage || e.message);
    process.exit(1);
  }
  console.log('Tx hash:', tx.hash);
  const receipt = await tx.wait();
  console.log('Tx mined in block', receipt.blockNumber, 'gasUsed:', receipt.gasUsed.toString());

  const submitTopic = flowForEvents.interface.getEvent('Submit').topicHash;
  let txSeq = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== flow.target.toLowerCase()) continue;
    if (log.topics[0] !== submitTopic) continue;
    const parsed = flowForEvents.interface.parseLog(log);
    txSeq = Number(parsed.args.submissionIndex);
    break;
  }
  if (txSeq === null) {
    console.error('Failed to find Submit event in receipt logs');
    process.exit(1);
  }
  console.log('Submission index (txSeq):', txSeq);

  console.log('Waiting for storage node to sync log entry...');
  let info = null;
  for (let i = 0; i < 60; i++) {
    info = await nodes[0].getFileInfoByTxSeq(txSeq);
    if (info !== null) break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (info === null) {
    console.error('Storage node never saw the log entry after 120s');
    process.exit(1);
  }
  console.log('Log entry available on node.');

  const segIter = file.iterateWithOffsetAndBatch(0, 256 * 1024, true);
  const [ok, iterErr] = await segIter.next();
  if (iterErr !== null || !ok) {
    console.error('failed to iterate segment:', iterErr);
    process.exit(1);
  }
  let segment = segIter.current();
  const numChunks = file.numChunks();
  const expectedLen = 256 * numChunks;
  segment = segment.slice(0, expectedLen);

  const proof = tree.proofAt(0);
  const segWithProof = {
    root: rootHash,
    data: encodeBase64(segment),
    index: 0,
    proof,
    fileSize: file.size(),
  };

  console.log('Uploading segment to', nodes.length, 'node(s)...');
  for (const node of nodes) {
    try {
      const res = await node.uploadSegmentsByTxSeq([segWithProof], txSeq);
      console.log('  ', node.url, '=> result:', res);
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg.includes('already uploaded') || e?.data === 'already uploaded and finalized') {
        console.log('  ', node.url, '=> already uploaded');
      } else {
        console.error('  ', node.url, '=> upload failed:', msg);
        process.exit(1);
      }
    }
  }

  console.log('Waiting for finalization...');
  for (let i = 0; i < 60; i++) {
    const fin = await nodes[0].getFileInfoByTxSeq(txSeq);
    if (fin !== null && fin.finalized) {
      console.log('Finalized.');
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  console.log('\nSUCCESS');
  console.log('  txHash:    ', tx.hash);
  console.log('  txSeq:     ', txSeq);
  console.log('  rootHash:  ', rootHash);
  console.log('\nDownload with: node download.js', rootHash);
}

main().catch((e) => {
  console.error('Unexpected error:', e);
  process.exit(1);
});
