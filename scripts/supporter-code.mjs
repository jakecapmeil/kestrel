// Mint supporter codes to email to donors. Uses the same KESTREL_SECRET as the Worker.
//   KESTREL_SECRET=... node scripts/supporter-code.mjs supporter 5
//   KESTREL_SECRET=... node scripts/supporter-code.mjs champion 1     ($100+, merch sent by hand)
import { mintCode } from '../src/train/support.js';

const [tier = 'supporter', n = '1'] = process.argv.slice(2);
if (!process.env.KESTREL_SECRET) { console.error('Set KESTREL_SECRET to the Worker secret first.'); process.exit(1); }
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
for (let i = 0; i < Number(n); i++) {
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHA[b % ALPHA.length]).join('');
  console.log(await mintCode(process.env.KESTREL_SECRET, tier, nonce));
}
