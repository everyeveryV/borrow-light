import fs from 'node:fs';
import path from 'node:path';
import { root } from './compile.mjs';
const deployment = JSON.parse(fs.readFileSync(path.join(root, 'app/src/chain/deployment.json'), 'utf8'));
if (!deployment.address) throw new Error('No deployed address configured.');
const artifact = JSON.parse(fs.readFileSync(path.join(root, 'contracts/artifacts/BorrowLight.json'), 'utf8'));
const input = JSON.parse(fs.readFileSync(path.join(root, 'contracts/artifacts/standard-input.json'), 'utf8'));
const response = await fetch('https://agents.devnads.com/v1/verify', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chainId: 10143, contractAddress: deployment.address,
    contractName: `${artifact.sourceName}:BorrowLight`, compilerVersion: `v${artifact.compilerVersion.split('.Emscripten')[0]}`,
    standardJsonInput: input, foundryMetadata: artifact.metadata }),
});
const body = await response.text();
if (!response.ok) throw new Error(`Verification API returned ${response.status}: ${body}`);
console.log(body);
