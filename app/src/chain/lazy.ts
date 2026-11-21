import type { Address } from 'viem';
import deployment from './deployment.json';
import type { SavedRun } from '../ui/storage';
import type { TransactionUpdate } from './client';

export type { Light, ChainProgress, TransactionUpdate } from './client';

// viem and the ABI are most of the bundle, and a player who never touches the chain never needs them.
// This module mirrors the surface of ./client and only fetches it on the first chain call.
type Client = typeof import('./client');

export const contractAddress = (deployment.address || null) as Address | null;
export const explorer = 'https://testnet.monadvision.com';
export let account: Address | null = null;

let client: Client | null = null;
let loading: Promise<Client> | null = null;
const connectionListeners = new Set<() => void>();

function load(): Promise<Client> {
  loading ??= import('./client').then(loaded => {
    client = loaded;
    account = loaded.account;
    loaded.onConnectionChange(() => { account = loaded.account; for (const listener of connectionListeners) listener(); });
    return loaded;
  }, error => { loading = null; throw error; });
  return loading;
}

export function warm() { load().catch(() => {}); }
export function onConnectionChange(callback: () => void) { connectionListeners.add(callback); return () => connectionListeners.delete(callback); }
export function disconnect() { client?.disconnect(); }
export function friendlyError(error: unknown) { return client ? client.friendlyError(error) : '暂时无法连接，请稍后重试。'; }
export async function connect() { return (await load()).connect(); }
export async function getPool() { return (await load()).getPool(); }
export async function getBest() { return (await load()).getBest(); }
export async function getBoard(level: number) { return (await load()).getBoard(level); }
export async function submit(run: SavedRun, update: (next: TransactionUpdate) => void) { return (await load()).submit(run, update); }
export async function lend(score: number[], update: (next: TransactionUpdate) => void) { return (await load()).lend(score, update); }
