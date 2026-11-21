import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createPublicClient, createWalletClient, custom, decodeErrorResult, getAddress, parseEther } from 'viem';
import { hardhat } from 'viem/chains';
import { compile, root } from './compile.mjs';
import { bytes, contractLevel } from './config.mjs';

process.env.HARDHAT_CONFIG = path.join(root, 'contracts/hardhat.config.cjs');
const { default: hre } = await import('hardhat');
const artifact = compile();
const abi = artifact.abi;
const transport = custom(hre.network.provider);
const client = createPublicClient({ chain: hardhat, transport });
const wallet = createWalletClient({ chain: hardhat, transport });
const accounts = (await wallet.getAddresses()).map(address => getAddress(address));
const owner = accounts[0];
const levels = JSON.parse(fs.readFileSync(path.join(root, 'shared/levels.json'), 'utf8'));
const vectors = JSON.parse(fs.readFileSync(path.join(root, 'shared/vectors.json'), 'utf8')).vectors;
const seeds = JSON.parse(fs.readFileSync(path.join(root, 'shared/seeds.json'), 'utf8'));
const deployed = await client.waitForTransactionReceipt({ hash: await wallet.deployContract({ account: owner, abi, bytecode: artifact.bytecode }) });
const address = deployed.contractAddress;
assert.ok(address);
let assertions = 0;
const gas = [];
async function read(functionName, args = []) { return client.readContract({ address, abi, functionName, args }); }
async function send(functionName, args = [], account = owner, value = 0n) {
  const call = { address, abi, functionName, args, account, value };
  const { request } = await client.simulateContract(call);
  const receipt = await client.waitForTransactionReceipt({ hash: await wallet.writeContract(request) });
  assert.equal(receipt.status, 'success');
  return receipt;
}
function errorData(error) {
  if (error?.data?.errorName) return error.data;
  if (typeof error?.data === 'string' && error.data.startsWith('0x')) {
    try { return decodeErrorResult({ abi, data: error.data }); } catch {}
  }
  return error?.cause ? errorData(error.cause) : null;
}
async function rejects(call, expected, args) {
  try { await call(); assert.fail(`Expected ${expected}`); }
  catch (error) {
    const decoded = errorData(error);
    assert.ok(decoded, `Missing decoded ${expected}: ${error.shortMessage ?? error.message}`);
    assert.equal(decoded.errorName, expected);
    if (args) assert.deepEqual(decoded.args?.map(Number), args.map(Number));
    ++assertions;
  }
}
for (const level of levels) await send('setLevel', [level.id, contractLevel(level)]);
await rejects(() => send('setLevel', [1, contractLevel(levels[0])]), 'LevelFrozen');
await rejects(() => send('setLevel', [1, contractLevel(levels[0])], accounts[1]), 'OwnableUnauthorizedAccount');
const seedIds = [];
for (const seed of seeds) { await send('lendLight', [4, bytes(seed.score)]); seedIds.push(await read('scoreCount')); }

for (const vector of vectors) {
  const { expected } = vector;
  const preview = () => read('previewRun', [vector.level, bytes(vector.score), bytes(vector.inputs), bytes(vector.borrowed ?? [])]);
  if (expected.status === 'win') {
    const [tick, hasItem] = await preview();
    assert.equal(tick, expected.finishTick, vector.name);
    if (expected.hasItem !== undefined) assert.equal(hasItem, expected.hasItem, vector.name);
    let borrowedId = 0n;
    if (vector.borrowed?.length) {
      const index = seeds.findIndex(seed => JSON.stringify(seed.score) === JSON.stringify(vector.borrowed));
      if (index >= 0) borrowedId = seedIds[index];
      else { await send('lendLight', [vector.level, bytes(vector.borrowed)]); borrowedId = await read('scoreCount'); }
    }
    const receipt = await send('submitRun', [vector.level, bytes(vector.score), bytes(vector.inputs), borrowedId], accounts[1]);
    gas.push({ name: vector.name, level: vector.level, finishTick: tick, gasUsed: Number(receipt.gasUsed) });
    const record = await read('getScore', [await read('scoreCount')]);
    assert.equal(record.finishTick, tick); assert.equal(record.author.toLowerCase(), accounts[1].toLowerCase());
    if (borrowedId) assert.ok((await read('getScore', [borrowedId])).borrowCount > 0);
    ++assertions;
  } else if (expected.status === 'fell') await rejects(preview, 'Fell', [expected.fellTick, expected.gapIndex]);
  else if (expected.status === 'timeup') await rejects(preview, 'TimeUp');
  else throw new Error(`Unexpected shared vector status: ${expected.status}`);
  console.log(`PASS ${vector.name}`);
}
const win = vectors.find(vector => vector.level === 1 && vector.expected.status === 'win');
const args = [1, bytes(win.score), bytes(win.inputs), 0n];
await rejects(() => send('submitRun', [1, '0x', bytes(win.inputs), 0n]), 'BadScore');
await rejects(() => send('submitRun', [1, bytes(win.score.map(() => 0)), bytes(win.inputs), 0n]), 'BadScore');
await rejects(() => send('submitRun', [1, bytes(win.score.map(() => 3)), bytes(win.inputs), 0n]), 'BadScore');
await rejects(() => send('submitRun', [2, bytes(Array.from({length: 14}, (_, i) => i % 2 + 1)), '0x', 0n]), 'BadScore');
await rejects(() => send('submitRun', [1, bytes(win.score), '0x04', 0n]), 'BadInputs');
await rejects(() => send('submitRun', [1, bytes(win.score), bytes([...win.inputs, 4]), 0n]), 'BadInputs');
await rejects(() => send('submitRun', [1, bytes(win.score), bytes(new Array(161).fill(0)), 0n]), 'BadInputs');
await rejects(() => send('submitRun', [1, bytes(win.score), bytes(win.inputs), seedIds[0]]), 'BadBorrow');
const fourth = vectors.find(vector => vector.level === 4 && vector.expected.status === 'win');
await rejects(() => send('submitRun', [4, bytes(fourth.score), bytes(fourth.inputs), 999999n]), 'BadBorrow');
await rejects(() => send('lendLight', [1, bytes(win.score)]), 'BadBorrow');
await rejects(() => read('getLevel', [6]), 'BadLevel');
await rejects(() => read('previewRun', [1, bytes(win.score), bytes(win.inputs), bytes(win.score)]), 'BadBorrow');
await rejects(() => read('previewRun', [4, bytes(fourth.score), bytes(fourth.inputs), '0x01']), 'BadScore');
await rejects(() => send('submitRun', [1, bytes(win.score.map(() => 2)), bytes(win.inputs), 0n]), 'Fell');
await rejects(() => send('submitRun', [1, bytes(win.score), '0x', 0n]), 'TimeUp');

// Ranking: equal scores retain first-submitted order, and each wallet appears once.
await send('submitRun', args, accounts[2]);
await send('submitRun', args, accounts[3]);
const [before] = await read('getBoard', [1]);
assert.ok(before.indexOf(accounts[2]) < before.indexOf(accounts[3]));
await send('submitRun', args, accounts[2]);
const [after] = await read('getBoard', [1]);
assert.deepEqual(after, before);
assert.equal(new Set(after).size, after.length);
const personal = await read('getBest', [accounts[2]]);
assert.equal(personal[0].tick, win.expected.finishTick);
assert.equal(personal.length, 5);
assert.deepEqual(await read('getPool', [4, 999999n, 100n]), [[], []]);
assert.deepEqual(await read('getPool', [4, 0n, 0n]), [[], []]);
assertions += 7;

const slower = [0, 0, 0, 0, 0, ...win.inputs];
await send('submitRun', [1, bytes(win.score), bytes(slower), 0n], accounts[6]);
assert.equal((await read('getBest', [accounts[6]]))[0].tick, win.expected.finishTick + 5);
await send('submitRun', args, accounts[6]);
assert.equal((await read('getBest', [accounts[6]]))[0].tick, win.expected.finishTick);
const [improved] = await read('getBoard', [1]);
assert.equal(improved.filter(player => player === accounts[6]).length, 1);
assertions += 3;

// A stranger proposing a wallet cannot steal attribution without that wallet's consent.
await send('authorizeAndFund', [accounts[5]], accounts[4], parseEther('0.2'));
assert.equal(await read('operatorOf', [accounts[5]]), '0x0000000000000000000000000000000000000000');
await send('submitRun', args, accounts[5]);
assert.equal((await read('getScore', [await read('scoreCount')])).author, accounts[5]);
await rejects(() => send('acceptOperator', [accounts[6]], accounts[5]), 'BadOperator');
await send('acceptOperator', [accounts[4]], accounts[5]);
await send('submitRun', args, accounts[5]);
assert.equal((await read('getScore', [await read('scoreCount')])).author, accounts[4]);
await rejects(() => send('revoke', [accounts[5]], accounts[6]), 'BadOperator');
await send('revoke', [accounts[5]], accounts[4]);
assert.equal(await read('operatorOf', [accounts[5]]), '0x0000000000000000000000000000000000000000');
assertions += 4;

for (let index = 8; index < 20; ++index) await send('submitRun', args, accounts[index]);
const [fullBoard, fullTicks] = await read('getBoard', [1]);
assert.equal(fullBoard.length, 10);
assert.equal(new Set(fullBoard).size, 10);
assert.ok(fullTicks.every(tick => tick === win.expected.finishTick));
assert.ok(!fullBoard.includes(accounts[19]));
assertions += 4;

const report = { network: 'Hardhat local EVM (Ethereum Cancun gas schedule)', chainId: 31337,
  disclaimer: 'These are NOT Monad testnet measurements. Monad cold storage/account costs differ. Estimate on Monad before submitting.',
  compiler: artifact.compilerVersion, generatedAt: new Date().toISOString(), sharedVectors: vectors.length,
  assertions, runs: gas, maximum: Math.max(...gas.map(item => item.gasUsed)) };
fs.writeFileSync(path.join(root, 'contracts/gas-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
console.log(`PASS ${vectors.length} shared vectors and ${assertions} assertions. No external network used.`);
