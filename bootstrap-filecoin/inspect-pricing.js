// inspect-pricing.js — recon for payment setup: live Warm Storage pricing,
// service parameters (min/max upload size), current operator allowances,
// and whether a local .mp4 payload is present yet. Read-only.
import { readdirSync, statSync } from 'node:fs';
import { formatUnits } from 'viem';
import { makeSynapse } from './client.js';

const { synapse } = makeSynapse();

const info = await synapse.storage.getStorageInfo();
const d = info.pricing.tokenSymbol === 'USDFC' ? 18 : 18;

console.log('=== Warm Storage pricing (', info.pricing.tokenSymbol, ') ===');
console.log('  per TiB / month :', formatUnits(info.pricing.noCDN.perTiBPerMonth, d));
console.log('  per TiB / day   :', formatUnits(info.pricing.noCDN.perTiBPerDay, d));
console.log('  per TiB / epoch :', formatUnits(info.pricing.noCDN.perTiBPerEpoch, d));
console.log('  token address   :', info.pricing.tokenAddress);

console.log('\n=== Service parameters ===');
console.log('  epochsPerMonth  :', info.serviceParameters.epochsPerMonth.toString());
console.log('  epochsPerDay    :', info.serviceParameters.epochsPerDay.toString());
console.log('  epochDuration(s):', info.serviceParameters.epochDuration);
console.log('  minUploadSize   :', info.serviceParameters.minUploadSize, 'bytes');
console.log('  maxUploadSize   :', info.serviceParameters.maxUploadSize, 'bytes');
console.log('  providers       :', info.providers.length);

console.log('\n=== Current operator allowances ===');
if (info.allowances == null) {
  console.log('  none — Warm Storage operator not yet approved.');
} else {
  console.log('  isApproved      :', info.allowances.isApproved);
  console.log('  service         :', info.allowances.service);
  console.log('  rateAllowance   :', formatUnits(info.allowances.rateAllowance, d));
  console.log('  lockupAllowance :', formatUnits(info.allowances.lockupAllowance, d));
  console.log('  rateUsed        :', formatUnits(info.allowances.rateUsed, d));
  console.log('  lockupUsed      :', formatUnits(info.allowances.lockupUsed, d));
}

console.log('\n=== Local .mp4 payloads ===');
const mp4s = readdirSync(new URL('./', import.meta.url)).filter((f) => f.toLowerCase().endsWith('.mp4'));
if (mp4s.length === 0) {
  console.log('  (none yet — drop your .mp4 into bootstrap-filecoin/ before the upload step)');
} else {
  for (const f of mp4s) {
    const sz = statSync(new URL(`./${f}`, import.meta.url)).size;
    console.log(`  ${f} — ${(sz / 1024 / 1024).toFixed(2)} MB (${sz} bytes)`);
  }
}
