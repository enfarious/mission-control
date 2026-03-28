import {
  createWalletClient,
  createPublicClient,
  http,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { optimismSepolia } from "viem/chains";
import { RPC_URL, WORLD_ADDRESS } from "./contracts.ts";

export function createSigner() {
  const privateKey = process.env.WALLET_PRIVATE_KEY as Hex;
  if (!privateKey) {
    console.warn("[signer] No WALLET_PRIVATE_KEY set — tx signing disabled");
    return null;
  }

  const account = privateKeyToAccount(privateKey);

  const walletClient = createWalletClient({
    account,
    chain: optimismSepolia,
    transport: http(RPC_URL),
  });

  const publicClient = createPublicClient({
    chain: optimismSepolia,
    transport: http(RPC_URL),
  });

  console.log(`[signer] Wallet ready: ${account.address}`);

  return {
    address: account.address,
    walletClient,
    publicClient,

    async sendRaw(to: Address, data: Hex) {
      const hash = await walletClient.sendTransaction({
        to,
        data,
        chain: optimismSepolia,
      });
      console.log(`[signer] TX sent: ${hash}`);
      return hash;
    },
  };
}

export type Signer = NonNullable<ReturnType<typeof createSigner>>;
