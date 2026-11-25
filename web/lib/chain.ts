import { Contract, JsonRpcProvider, Wallet } from "ethers";
import deployment from "./deployment.json";

export const EXPLORER = deployment.chainId === 97 ? "https://testnet.bscscan.com" : "http://localhost (local chain, no explorer)";

export function isDeployed() {
  return Boolean(deployment.vault && deployment.stable);
}

function need(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in .env.local`);
  return v;
}

let provider: JsonRpcProvider | null = null;
export function getProvider() {
  provider ??= new JsonRpcProvider(process.env.BSC_TESTNET_RPC || "https://bsc-testnet-rpc.publicnode.com", deployment.chainId, {
    staticNetwork: true,
  });
  return provider;
}

export const wallets = {
  agent: () => new Wallet(need("AGENT_PRIVATE_KEY"), getProvider()),
  oracle: () => new Wallet(need("ORACLE_PRIVATE_KEY"), getProvider()),
  tourist: () => new Wallet(need("TOURIST_DEMO_PRIVATE_KEY"), getProvider()),
};

export function vault(runner: Wallet | JsonRpcProvider = getProvider()) {
  return new Contract(deployment.vault, deployment.vaultAbi, runner);
}
export function stable(runner: Wallet | JsonRpcProvider = getProvider()) {
  return new Contract(deployment.stable, deployment.stableAbi, runner);
}

export const STATUS = ["None", "Advanced", "Settled", "Defaulted"] as const;

export async function readClaim(id: number) {
  const c = await vault().getClaim(id);
  return {
    id,
    tourist: c.tourist as string,
    refundAmount: c.refundAmount.toString(),
    advanceAmount: c.advanceAmount.toString(),
    feeAmount: c.feeAmount.toString(),
    refundThb: c.refundThb.toString(),
    usdPerThb: c.usdPerThb.toString(),
    departureDeadline: Number(c.departureDeadline),
    createdAt: Number(c.createdAt),
    status: STATUS[Number(c.status)],
    refundAttested: c.refundAttested as boolean,
    receiptHash: c.receiptHash as string,
    storeName: c.storeName as string,
    proofURI: c.proofURI as string,
  };
}

/** Human-readable revert reason from an ethers error. */
export function chainError(e: unknown): string {
  const err = e as { revert?: { name?: string; args?: unknown[] }; shortMessage?: string; message?: string };
  if (err?.revert?.name) return `${err.revert.name}(${(err.revert.args ?? []).join(", ")})`;
  return err?.shortMessage || err?.message || String(e);
}
