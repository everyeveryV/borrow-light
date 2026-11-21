import fs from 'node:fs';
import path from 'node:path';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monadTestnet } from 'viem/chains';
import { compile, root } from './compile.mjs';
import { bytes, contractLevel } from './config.mjs';

// Node 20+: load optional checkout-local environment without logging any values.
try { process.loadEnvFile?.(path.join(root, '.env')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
  throw new Error('Set a testnet-only DEPLOYER_PRIVATE_KEY in your local .env. Never commit this value or send it in chat.');
}
const rpcUrl = process.env.MONAD_RPC_URL || monadTestnet.rpcUrls.default.http[0];
const account = privateKeyToAccount(privateKey);
const publicClient = createPublicClient({ chain: monadTestnet, transport: http(rpcUrl) });
const wallet = createWalletClient({ account, chain: monadTestnet, transport: http(rpcUrl) });
if (await publicClient.getChainId() !== 10143) throw new Error('Deployment is restricted to Monad testnet (10143).');
const artifact = compile();
const levels = JSON.parse(fs.readFileSync(path.join(root, 'shared/levels.json'), 'utf8'));
const seeds = JSON.parse(fs.readFileSync(path.join(root, 'shared/seeds.json'), 'utf8'));
const deploymentFile = path.join(root, 'app/src/chain/deployment.json');
let deployment = JSON.parse(fs.readFileSync(deploymentFile, 'utf8'));
let address = deployment.address;
async function receipt(hash) {
  const result = await publicClient.waitForTransactionReceipt({ hash });
  if (result.status !== 'success') throw new Error(`Transaction reverted: ${hash}`);
  // Newly updated balances/storage must settle before the next dependent transaction.
  const target = result.blockNumber + 3n;
  while (await publicClient.getBlockNumber({ cacheTime: 0 }) < target) await new Promise(resolve => setTimeout(resolve, 500));
  return result;
}
function persist() {
  // Custom RPC URLs can contain provider credentials. Never publish them into frontend config.
  deployment.rpcUrl = monadTestnet.rpcUrls.default.http[0];
  fs.writeFileSync(deploymentFile, JSON.stringify(deployment, null, 2) + '\n');
}
if (address) {
  const existingCode = await publicClient.getCode({ address });
  if (!existingCode || existingCode === '0x') throw new Error('Saved deployment address has no code on this RPC.');
  if (existingCode.toLowerCase() !== artifact.deployedBytecode.toLowerCase()) throw new Error('Saved contract bytecode differs from the current build. Refuse to configure a different contract.');
  const owner = await publicClient.readContract({ address, abi: artifact.abi, functionName: 'owner' });
  if (owner.toLowerCase() !== account.address.toLowerCase()) throw new Error('Saved contract belongs to another deployer.');
  console.log(`Resuming deployment configuration: ${address}`);
} else {
  const estimate = await publicClient.estimateGas({ account, data: artifact.bytecode });
  const result = await receipt(await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode, gas: estimate + estimate / 10n }));
  address = result.contractAddress;
  if (!address) throw new Error('Deployment receipt did not contain an address.');
  deployment = { chainId: 10143, address, rpcUrl, explorerUrl: 'https://testnet.monadvision.com',
    deployedAt: new Date().toISOString(), deploymentHash: result.transactionHash, deploymentBlock: result.blockNumber.toString(), seedIds: [], configuredLevels: [] };
  persist();
  console.log(`Deployed: ${address}`);
}
async function send(functionName, args) {
  const call = { address, abi: artifact.abi, functionName, args, account };
  const { request } = await publicClient.simulateContract(call);
  const estimate = await publicClient.estimateContractGas(call);
  return receipt(await wallet.writeContract({ ...request, gas: estimate + estimate / 10n }));
}
for (const level of levels) {
  let exists = false;
  try {
    const saved = await publicClient.readContract({ address, abi: artifact.abi, functionName: 'getLevel', args: [level.id] });
    exists = saved.beats > 0;
    if (exists) {
      const expected = contractLevel(level);
      for (const key of Object.keys(expected)) {
        if (String(saved[key]) !== String(expected[key])) throw new Error(`Level ${level.id} differs at ${key}. Rules are immutable; deploy a new contract for changed level data.`);
      }
    }
  }
  catch (error) { if (!error.message?.includes('BadLevel')) throw error; }
  if (!exists) await send('setLevel', [level.id, contractLevel(level)]);
  deployment.configuredLevels = [...new Set([...(deployment.configuredLevels ?? []), level.id])]; persist();
  console.log(`Level ${level.id} ready`);
}
// Read the public pool on resume; reusing matching entries avoids duplicate seed uploads.
const [poolIds, poolScores] = await publicClient.readContract({ address, abi: artifact.abi, functionName: 'getPool', args: [4, 0n, 100n] });
for (let index = 0; index < seeds.length; index++) {
  const seed = seeds[index];
  const packed = bytes(seed.score).padEnd(66, '0');
  const existingIndex = poolScores.findIndex(item => item.author.toLowerCase() === account.address.toLowerCase() && item.score === packed);
  let id = existingIndex >= 0 ? poolIds[existingIndex] : null;
  if (id === null) {
    const result = await send('lendLight', [4, bytes(seed.score)]);
    const { decodeEventLog } = await import('viem');
    const event = result.logs.map(log => { try { return decodeEventLog({ abi: artifact.abi, data: log.data, topics: log.topics }); } catch { return null; } }).find(event => event?.eventName === 'LightLent');
    id = event?.args.scoreId;
    if (!id) throw new Error('Missing seed LightLent event');
  }
  deployment.seedIds[index] = id.toString(); persist();
  console.log(`Seed ${seed.key} ready (score #${id})`);
}
deployment.ready = true; persist();
console.log(`Ready: ${deployment.explorerUrl}/address/${address}`);
console.log('Verify all explorers with: node contracts/scripts/verify.mjs');
