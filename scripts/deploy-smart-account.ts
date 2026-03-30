import { createPublicClient, createWalletClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { Implementation, toMetaMaskSmartAccount, createInfuraBundlerClient } from "@metamask/smart-accounts-kit";
import * as dotenv from "dotenv";
dotenv.config();

const RPC_URL      = process.env.BASE_RPC_URL!;
const DELEGATOR_PK = process.env.DELEGATOR_PRIVATE_KEY! as `0x${string}`;
const INFURA_KEY   = process.env.INFURA_API_KEY!;

function section(title: string) {
  console.log("");
  console.log("═".repeat(60));
  console.log(`  ${title}`);
  console.log("═".repeat(60));
}

function field(label: string, value: string) {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

async function main() {
  const publicClient = createPublicClient({ chain: base, transport: http(RPC_URL) });

  const delegatorOwner = privateKeyToAccount(DELEGATOR_PK);

  section("DEPLOYING SMART ACCOUNT (HybridDeleGator)");

  const smartAccount = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [delegatorOwner.address, [], [], []],
    deploySalt: "0x",
    signer: { account: delegatorOwner },
  });

  field("Smart account address", smartAccount.address);
  field("Owner EOA",             delegatorOwner.address);

  // Check if already deployed
  const code = await publicClient.getCode({ address: smartAccount.address as `0x${string}` });
  if (code && code !== "0x") {
    console.log("\n  ✓ Smart account already deployed. Nothing to do.");
    console.log(`\n  Add to .env:\n  SMART_ACCOUNT_ADDRESS=${smartAccount.address}`);
    return;
  }

  console.log("\n  Not deployed yet. Deploying via bundler...");

  const bundlerClient = createInfuraBundlerClient({
    chain: base,
    transport: http(`https://base-mainnet.infura.io/v3/${INFURA_KEY}`),
  });

  // Send a no-op UserOp to deploy the account
  const userOpHash = await bundlerClient.sendUserOperation({
    account: smartAccount,
    calls: [{
      to: smartAccount.address as `0x${string}`,
      data: "0x",
      value: 0n,
    }],
  });

  field("UserOp hash", userOpHash);
  console.log("\n  Waiting for receipt...");

  const receipt = await bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
  field("TX hash",  receipt.receipt.transactionHash);
  field("Block",    String(receipt.receipt.blockNumber));
  field("Success",  String(receipt.success));

  console.log(`\n  ✓ Smart account deployed!`);
  console.log(`\n  Add to .env:\n  SMART_ACCOUNT_ADDRESS=${smartAccount.address}`);
}

main().catch(err => { console.error(err); process.exit(1); });
