import { createPublicClient, createWalletClient, custom, http, toHex, hexToBytes, BaseError, type Address, type Hash, type EIP1193Provider } from 'viem';
import { monadTestnet } from 'viem/chains';
import { borrowLightAbi } from './abi';
import deployment from './deployment.json';
import type { SavedRun } from '../ui/storage';
import { levels, simulate } from '../game/sim';

declare global { interface Window { ethereum?: EIP1193Provider & { on?: (name: string, callback: (...args: unknown[]) => void) => void } } }
export const publicClient = createPublicClient({ chain: monadTestnet, transport: http(import.meta.env.VITE_MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz', { timeout: 12_000, retryCount: 1 }), pollingInterval: 1200 });
export const contractAddress = (deployment.address || null) as Address | null;
export const explorer = 'https://testnet.monadvision.com';
export interface Light { id: string; author: string; score: number[]; borrowCount: number; seedKey?: string; label?: string }
export interface ChainProgress { level: number; tick: number; stars: number }
export interface TransactionUpdate { status: 'checking' | 'signing' | 'broadcast' | 'confirmed'; hash?: Hash; block?: string; elapsed?: number }
export let account: Address | null = null;
let connectionVersion = 0;
let wallet: ReturnType<typeof createWalletClient> | null = null;
const connectionListeners = new Set<() => void>();
export function onConnectionChange(callback: () => void) { connectionListeners.add(callback); return () => connectionListeners.delete(callback); }
function notifyConnection() { for (const listener of connectionListeners) listener(); }
export async function connect() {
  if (!window.ethereum) throw new Error('请在装有 MetaMask、Rabby 等钱包的浏览器中打开。现在仍可完整离线游玩。');
  const provider = window.ethereum;
  await provider.request({ method: 'eth_requestAccounts' });
  const chainId = await provider.request({ method: 'eth_chainId' });
  if (chainId !== '0x279f') {
    try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x279f' }] }); }
    catch (error) {
      if ((error as { code?: number }).code !== 4902) throw error;
      await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x279f', chainName: 'Monad Testnet', nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 }, rpcUrls: ['https://testnet-rpc.monad.xyz'], blockExplorerUrls: [explorer] }] });
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x279f' }] });
    }
  }
  if (await provider.request({ method: 'eth_chainId' }) !== '0x279f') throw new Error('请先切换到 Monad 测试网。');
  wallet = createWalletClient({ chain: monadTestnet, transport: custom(provider) });
  account = (await wallet.getAddresses())[0] || null;
  connectionVersion++;
  notifyConnection();
  return account;
}
export function disconnect() { account = null; wallet = null; connectionVersion++; notifyConnection(); }
if (window.ethereum?.on) {
  window.ethereum.on('accountsChanged', () => disconnect());
  window.ethereum.on('chainChanged', () => disconnect());
}
function configured(): Address {
  if (!contractAddress) throw new Error('合约尚未部署，成绩已保存在本机。部署后可从这里继续上链。');
  return contractAddress;
}
export function friendlyError(error: unknown) {
  if (error instanceof BaseError) {
    const data = error.walk() as { data?: { errorName?: string }; code?: number };
    const code = data.data?.errorName;
    if (code === 'Fell') return '合约重放发现这一局落水了，请重新过桥。';
    if (code === 'TimeUp') return '合约重放发现这一局未能在灯谱结束前抵达。';
    if (code === 'BadBorrow') return '这束借光未在本合约登记，请重新选择链上灯谱。';
    if (code === 'BadScore') return '灯谱不符合本关的长度或灯油限制。';
    if (/reject|denied/i.test(error.shortMessage)) return '你取消了钱包确认。本地成绩已保存，可以稍后重试。';
    if (/insufficient/i.test(error.shortMessage)) return '测试 MON 不足，请补充测试币后重试。';
    return error.shortMessage;
  }
  return error instanceof Error ? error.message : '暂时无法连接，请稍后重试。';
}
export async function getPool(): Promise<Light[]> {
  const [ids, items] = await publicClient.readContract({ address: configured(), abi: borrowLightAbi, functionName: 'getPool', args: [4, 0n, 60n], blockTag: 'latest' });
  return items.map((item, i) => ({ id: ids[i].toString(), author: item.author, score: Array.from(hexToBytes(item.score)).slice(0, levels[3].beats), borrowCount: Number(item.borrowCount) }));
}
export async function getBest(): Promise<ChainProgress[]> {
  if (!account) return [];
  const entries = await publicClient.readContract({ address: configured(), abi: borrowLightAbi, functionName: 'getBest', args: [account], blockTag: 'latest' });
  return entries.map((entry, i) => ({ level: i + 1, tick: Number(entry.tick), stars: Number(entry.stars) })).filter((p) => p.tick > 0);
}
export async function getBoard(level: number) {
  const address = configured();
  const [authors, ticks, stars] = await publicClient.readContract({ address, abi: borrowLightAbi, functionName: 'getBoard', args: [level], blockTag: 'latest' });
  const lightGiven = await Promise.all(authors.map((author) => publicClient.readContract({ address, abi: borrowLightAbi, functionName: 'lightGiven', args: [author], blockTag: 'latest' })));
  return authors.map((author, i) => ({ author, tick: Number(ticks[i]), stars: Number(stars[i]), lightGiven: Number(lightGiven[i]) }));
}
export async function submit(run: SavedRun, update: (next: TransactionUpdate) => void) {
  const level = levels.find((l) => l.id === run.level)!;
  const result = simulate(level, run.score, run.inputs, run.borrowed);
  if (result.status !== 'win' || result.finishTick !== run.finishTick) throw new Error('本地重放未通过，请重新完成这一关。');
  const address = configured();
  if (!wallet || !account) await connect();
  const caller = account!;
  const version = connectionVersion;
  let borrowedId = BigInt(run.borrowedId || '0');
  if (level.borrowable && borrowedId === 0n) {
    const available = await getPool();
    const match = available.find((item) => item.score.join(',') === run.borrowed.join(','));
    if (!match) throw new Error('这束离线灯谱还没有写入链上，请在借光面板选择一束链上灯谱，再次过桥。');
    borrowedId = BigInt(match.id);
  }
  const args = [run.level, toHex(Uint8Array.from(run.score)), toHex(Uint8Array.from(run.inputs)), borrowedId] as const;
  update({ status: 'checking' });
  const call = { address, abi: borrowLightAbi, functionName: 'submitRun' as const, args, account: caller };
  await publicClient.simulateContract(call);
  const estimate = await publicClient.estimateContractGas(call);
  if (version !== connectionVersion || caller !== account) throw new Error('钱包已切换，请重新点击上链。');
  update({ status: 'signing' });
  const hash = await wallet!.writeContract({ ...call, chain: monadTestnet, gas: (estimate * 110n + 99n) / 100n });
  const start = performance.now();
  update({ status: 'broadcast', hash });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== 'success') throw new Error('交易执行失败，本地成绩仍已保存。');
  const next: TransactionUpdate = { status: 'confirmed', hash, block: receipt.blockNumber.toString(), elapsed: (performance.now() - start) / 1000 };
  update(next);
  return next;
}
export async function lend(score: number[], update: (next: TransactionUpdate) => void) {
  const address = configured();
  if (!wallet || !account) await connect();
  const call = { address, abi: borrowLightAbi, functionName: 'lendLight' as const, args: [4, toHex(Uint8Array.from(score))] as const, account: account! };
  update({ status: 'checking' });
  await publicClient.simulateContract(call);
  const estimate = await publicClient.estimateContractGas(call);
  update({ status: 'signing' });
  const hash = await wallet!.writeContract({ ...call, chain: monadTestnet, gas: (estimate * 110n + 99n) / 100n });
  const start = performance.now();
  update({ status: 'broadcast', hash });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (receipt.status !== 'success') throw new Error('发布未成功，请稍后重试。');
  update({ status: 'confirmed', hash, block: String(receipt.blockNumber), elapsed: (performance.now() - start) / 1000 });
}
