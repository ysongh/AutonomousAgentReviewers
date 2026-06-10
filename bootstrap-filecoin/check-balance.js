// check-balance.js — print tFIL (gas) + USDFC (wallet & deposited) balances
// for the spike wallet on Calibration. Fail loud if the wallet has no gas.
import { formatEther, formatUnits } from 'viem';
import { makeSynapse } from './client.js';

const { synapse, account } = makeSynapse();
const addr = account.address;

console.log('Network : Filecoin Calibration (chainId 314159)');
console.log('Address :', addr);
console.log('');

// tFIL native balance — synapse.client is a viem Client with PublicActions.
const tfilWei = await synapse.client.getBalance({ address: addr });
console.log('tFIL (gas)            :', formatEther(tfilWei), 'tFIL');

// USDFC sitting in the wallet (ERC-20), vs USDFC deposited into Filecoin Pay.
const usdfcDecimals = synapse.payments.decimals();
const usdfcWallet = await synapse.payments.walletBalance({ token: 'USDFC' });
const usdfcDeposited = await synapse.payments.balance({ token: 'USDFC' });
console.log('USDFC (wallet)        :', formatUnits(usdfcWallet, usdfcDecimals), 'USDFC');
console.log('USDFC (in Filecoin Pay):', formatUnits(usdfcDeposited, usdfcDecimals), 'USDFC');
console.log('');

// Verdicts.
const haveGas = tfilWei > 0n;
const haveUsdfc = usdfcWallet > 0n || usdfcDeposited > 0n;
if (!haveGas) {
  console.error('❌ No tFIL — cannot pay gas. Fund via https://faucet.calibnet.chainsafe-fil.io/funds.html');
}
if (!haveUsdfc) {
  console.error('❌ No USDFC — cannot pay for storage. Fund via https://forest-explorer.chainsafe.dev/faucet/calibnet_usdfc');
}
if (haveGas && haveUsdfc) {
  console.log('✅ Funded: tFIL for gas and USDFC for storage are both present.');
} else {
  process.exit(1);
}
