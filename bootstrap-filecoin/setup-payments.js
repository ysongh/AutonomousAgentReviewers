// setup-payments.js — Phase D: make the wallet ready to pay for Warm Storage.
//
// Path taken: the SDK's ONE-CALL wrapper
//   payments.depositWithPermitAndApproveOperator(...)
// which (a) deposits USDFC into Filecoin Pay via an EIP-2612 permit (no
// separate approve tx — USDFC's Calibration config uses the permit ABI) and
// (b) approves the Warm Storage service as operator with rate + lockup
// allowances, in a single transaction.
//
// Allowances are generous relative to a 50MB piece (cost ~0.0001 USDFC/mo at
// 2.5 USDFC/TiB/mo) but bounded: the operator can never lock up more than
// LOCKUP_ALLOWANCE, and that is capped at what we deposit.
import { formatUnits, parseUnits } from 'viem';
import { makeSynapse } from './client.js';

const DEPOSIT_USDFC = '4';      // move 4 of the 5 wallet USDFC into Filecoin Pay
const RATE_USDFC_PER_EPOCH = '0.1';   // cap on streaming rate (huge headroom)
const LOCKUP_USDFC = '4';       // max total lockup == deposit

const { synapse, account } = makeSynapse();
const dec = synapse.payments.decimals();

const epochsPerMonth = (await synapse.storage.getStorageInfo()).serviceParameters.epochsPerMonth; // ~86400 (30d)

console.log('Wallet  :', account.address);
console.log('Decimals:', dec);

const before = {
  wallet: await synapse.payments.walletBalance({ token: 'USDFC' }),
  deposited: await synapse.payments.balance({ token: 'USDFC' }),
};
console.log('USDFC wallet   (before):', formatUnits(before.wallet, dec));
console.log('USDFC deposited(before):', formatUnits(before.deposited, dec));

const amount = parseUnits(DEPOSIT_USDFC, dec);
if (before.wallet < amount) {
  throw new Error(`Wallet has ${formatUnits(before.wallet, dec)} USDFC, need ${DEPOSIT_USDFC} to deposit.`);
}

console.log(`\nDepositing ${DEPOSIT_USDFC} USDFC + approving Warm Storage operator (one call)…`);
const hash = await synapse.payments.depositWithPermitAndApproveOperator({
  amount,
  rateAllowance: parseUnits(RATE_USDFC_PER_EPOCH, dec),
  lockupAllowance: parseUnits(LOCKUP_USDFC, dec),
  maxLockupPeriod: epochsPerMonth, // ~30 days of runway
  token: 'USDFC',
});
console.log('  tx hash:', hash);
console.log('  explorer:', `https://calibration.filfox.info/en/message/${hash}`);

// QUIRK: the SDK payment methods return the tx hash WITHOUT awaiting the
// receipt. Reading balances immediately shows stale (pre-mined) state, so we
// must wait for the receipt and assert success before trusting post-state.
console.log('  waiting for receipt…');
const receipt = await synapse.client.waitForTransactionReceipt({ hash, timeout: 120000 });
console.log('  status:', receipt.status, '| block:', receipt.blockNumber.toString(), '| gasUsed:', receipt.gasUsed.toString());
if (receipt.status !== 'success') {
  throw new Error(`Payment setup tx reverted (status=${receipt.status}): ${hash}`);
}

// Confirm new state.
const after = {
  wallet: await synapse.payments.walletBalance({ token: 'USDFC' }),
  deposited: await synapse.payments.balance({ token: 'USDFC' }),
};
const appr = await synapse.payments.serviceApproval({ token: 'USDFC' });
console.log('\nUSDFC wallet   (after):', formatUnits(after.wallet, dec));
console.log('USDFC deposited(after):', formatUnits(after.deposited, dec));
console.log('Operator approval:', JSON.stringify(appr, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
console.log('\n✅ Payment setup complete.');
