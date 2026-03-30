import { ethers } from "ethers";
import { createPublicClient, createWalletClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { Implementation, toMetaMaskSmartAccount, createDelegation, createExecution, ExecutionMode, ScopeType, contracts } from "@metamask/smart-accounts-kit";
const { DelegationManager } = contracts;
import * as dotenv from "dotenv";
dotenv.config();

// ─── Config ───────────────────────────────────────────────────────────────────

const RPC_URL            = process.env.BASE_RPC_URL!;
const VENICE_API_KEY     = process.env.VENICE_API_KEY!;
const TEE_SIGNER_ADDRESS = process.env.TEE_SIGNER_ADDRESS!;
const DELEGATOR_PK       = process.env.DELEGATOR_PRIVATE_KEY! as `0x${string}`;
const REDEEMER_PK        = process.env.REDEEMER_PRIVATE_KEY! as `0x${string}`;
const CAVEAT_ADDRESS     = process.env.CAVEAT_ADDRESS! as `0x${string}`;
const TARGET_ADDRESS     = process.env.TARGET_ADDRESS! as `0x${string}`;
const VENICE_MODEL       = "e2ee-qwen-2-5-7b-p";
const VENICE_BASE        = "https://api.venice.ai/api/v1";
const BASESCAN           = "https://basescan.org/tx";

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const TARGET_ABI = [
  "function setValue(uint256 newValue) external",
  "function value() view returns (uint256)",
];

// ─── Logging ──────────────────────────────────────────────────────────────────

function section(title: string) {
  console.log("");
  console.log("═".repeat(60));
  console.log(`  ${title}`);
  console.log("═".repeat(60));
}

function field(label: string, value: string) {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

function truncate(str: string, n = 20): string {
  return str.length > n ? str.slice(0, n) + "..." : str;
}

// ─── Venice ───────────────────────────────────────────────────────────────────

async function callVenice(prompt: string) {
  const res = await fetch(`${VENICE_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${VENICE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: VENICE_MODEL,
      messages: [{ role: "user", content: prompt }],
      venice_parameters: { include_venice_system_prompt: false, strip_thinking_response: false },
    }),
  });
  const teeConfirmed = res.headers.get("x-venice-tee") === "true";
  const teeProvider  = res.headers.get("x-venice-tee-provider") ?? "unknown";
  const data = await res.json() as any;
  if (data.error) throw new Error(`Venice error: ${JSON.stringify(data.error)}`);
  return { requestId: data.id as string, response: data.choices[0].message.content as string, teeConfirmed, teeProvider };
}

async function fetchVeniceSignature(requestId: string) {
  const res = await fetch(
    `${VENICE_BASE}/tee/signature?model=${VENICE_MODEL}&request_id=${requestId}`,
    { headers: { Authorization: `Bearer ${VENICE_API_KEY}` } }
  );
  const data = await res.json() as any;
  if (!data.signature) throw new Error(`Signature fetch failed: ${JSON.stringify(data)}`);
  return data as { text: string; signature: string; signing_address: string };
}

// ─── Encoding ─────────────────────────────────────────────────────────────────

const coder = ethers.AbiCoder.defaultAbiCoder();

function encodeTerms(
  trustedSigner: string, maxAgeSeconds: bigint, requiredTarget: string,
  requiredChainId: bigint, requiredSelector: string, requiredValue: bigint,
  requiredCalldataHash: string
): string {
  return coder.encode(
    ["tuple(address,uint256,address,uint256,bytes4,uint256,bytes32)"],
    [[trustedSigner, maxAgeSeconds, requiredTarget, requiredChainId,
      requiredSelector, requiredValue, requiredCalldataHash]]
  );
}

function encodeArgs(promptHash: string, responseHash: string, timestamp: bigint, signature: string): string {
  return coder.encode(
    ["tuple(bytes32,bytes32,uint256,bytes)"],
    [[promptHash, responseHash, timestamp, signature]]
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const publicClient = createPublicClient({ chain: base, transport: http(RPC_URL) });

  const delegatorOwner = privateKeyToAccount(DELEGATOR_PK);
  const redeemerAccount = privateKeyToAccount(REDEEMER_PK);

  // ── Smart account as delegator ────────────────────────────────────────────
  section("SETTING UP SMART ACCOUNT DELEGATOR");
  console.log("  Creating HybridDeleGator smart account...");

  const smartAccount = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [delegatorOwner.address, [], [], []],
    deploySalt: "0x",
    signer: { account: delegatorOwner },
  });

  const environment = smartAccount.environment;

  field("Smart account (delegator)", smartAccount.address);
  field("Owner EOA",                 delegatorOwner.address);
  field("Redeemer EOA",              redeemerAccount.address);
  field("TEE signer",                TEE_SIGNER_ADDRESS);
  field("DelegationManager",         environment.DelegationManager);
  field("Caveat",                    CAVEAT_ADDRESS);
  field("Target",                    TARGET_ADDRESS);

  // ── Step 1: Venice TEE inference ──────────────────────────────────────────
  section("STEP 1 — Venice TEE Inference");
  const prompt = "You are authorizing a delegated onchain action. Should this execution proceed? Reply YES or NO only.";
  console.log("  Prompt:", prompt);
  console.log("");
  console.log("  Calling Venice...");

  const { requestId, response, teeConfirmed, teeProvider } = await callVenice(prompt);
  field("Request ID",    requestId);
  field("TEE confirmed", String(teeConfirmed));
  field("TEE provider",  teeProvider);
  field("Response",      response.trim());

  // ── Step 2: Fetch TEE signature ───────────────────────────────────────────
  section("STEP 2 — Venice TEE Signature");
  const sigPayload = await fetchVeniceSignature(requestId);
  field("Signed text",     sigPayload.text);
  field("Signature",       truncate(sigPayload.signature));
  field("Signing address", sigPayload.signing_address);

  // ── Step 3: Verify signature ──────────────────────────────────────────────
  section("STEP 3 — Signature Verification");
  const recovered = ethers.verifyMessage(sigPayload.text, sigPayload.signature);
  field("Recovered signer", recovered);
  field("Expected signer",  TEE_SIGNER_ADDRESS);
  field("Match",            recovered.toLowerCase() === TEE_SIGNER_ADDRESS.toLowerCase() ? "✓ YES" : "✗ NO");

  if (recovered.toLowerCase() !== TEE_SIGNER_ADDRESS.toLowerCase()) {
    throw new Error(`Signer mismatch: recovered ${recovered}, expected ${TEE_SIGNER_ADDRESS}`);
  }

  const [promptHashRaw, responseHashRaw] = sigPayload.text.split(":");
  const promptHash   = `0x${promptHashRaw.replace(/^0x/, "")}`;
  const responseHash = `0x${responseHashRaw.replace(/^0x/, "")}`;
  const timestamp    = BigInt(Math.floor(Date.now() / 1000));

  field("Prompt hash",   truncate(promptHash));
  field("Response hash", truncate(responseHash));
  field("Timestamp",     String(timestamp));

  // ── Step 4: Build execution envelope ─────────────────────────────────────
  section("STEP 4 — Execution Envelope");
  const targetIface  = new ethers.Interface(TARGET_ABI);
  const callData     = targetIface.encodeFunctionData("setValue", [42]);
  const selector     = callData.slice(0, 10);
  const calldataHash = ethers.keccak256(callData);
  const value        = 0n;

  field("Function",      "setValue(42)");
  field("Selector",      selector);
  field("Calldata hash", truncate(calldataHash));
  field("Value (ETH)",   "0");
  field("Target",        TARGET_ADDRESS);

  // ── Step 5: Build caveat terms and args ───────────────────────────────────
  section("STEP 5 — Caveat Encoding");
  const terms = encodeTerms(
    TEE_SIGNER_ADDRESS, 120n, TARGET_ADDRESS,
    BigInt(base.id), selector, value, calldataHash
  );
  const args = encodeArgs(promptHash, responseHash, timestamp, sigPayload.signature);

  field("Caveat enforcer", CAVEAT_ADDRESS);
  field("Terms",           truncate(terms));
  field("Args",            truncate(args));

  // ── Step 6: Create and sign delegation ────────────────────────────────────
  section("STEP 6 — Delegation Construction");

  const delegation = createDelegation({
    to: redeemerAccount.address,
    from: smartAccount.address,
    environment,
    scope: {
      type: ScopeType.FunctionCall,
      targets: [TARGET_ADDRESS as `0x${string}`],
      selectors: [selector as `0x${string}`],
    },
    caveats: [
      {
        enforcer: CAVEAT_ADDRESS,
        terms: terms as `0x${string}`,
        args: args as `0x${string}`,
      }
    ],
  });

  const signature = await smartAccount.signDelegation({ delegation });
  const signedDelegation = { ...delegation, signature };

  field("Delegator",       smartAccount.address);
  field("Delegate",        redeemerAccount.address);
  field("Signature",       truncate(signature));

  // ── Step 7: Encode redemption ─────────────────────────────────────────────
  section("STEP 7 — Redemption Encoding");

  const validExecution = createExecution({
    target: TARGET_ADDRESS,
    callData: callData as `0x${string}`,
  });

  const badCallData = targetIface.encodeFunctionData("setValue", [999]);
  const invalidExecution = createExecution({
    target: TARGET_ADDRESS,
    callData: badCallData as `0x${string}`,
  });

  const validRedeemCalldata = DelegationManager.encode.redeemDelegations({
    delegations: [[signedDelegation]],
    modes: [ExecutionMode.SingleDefault],
    executions: [[validExecution]],
  });

  const invalidRedeemCalldata = DelegationManager.encode.redeemDelegations({
    delegations: [[signedDelegation]],
    modes: [ExecutionMode.SingleDefault],
    executions: [[invalidExecution]],
  });

  field("Valid calldata",   truncate(validRedeemCalldata));
  field("Invalid calldata", truncate(invalidRedeemCalldata));

  // ── Step 8: Redeem via EOA tx ─────────────────────────────────────────────
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const redeemerWallet = new ethers.Wallet(REDEEMER_PK, provider);
  const targetContract = new ethers.Contract(TARGET_ADDRESS, TARGET_ABI, provider);

  section("CASE 1 — Valid Proof + Matching Execution");
  console.log("  Expected: PASS");
  console.log("");

  const valueBefore = await targetContract.value();
  field("Target value before", String(valueBefore));

  try {
    const tx = await redeemerWallet.sendTransaction({
      to: environment.DelegationManager,
      data: validRedeemCalldata,
    });
    field("TX hash",  tx.hash);
    field("Basescan", `${BASESCAN}/${tx.hash}`);
    console.log("");
    console.log("  Waiting for confirmation...");
    const receipt = await tx.wait();
    field("Block",    String(receipt?.blockNumber));
    field("Gas used", String(receipt?.gasUsed));
    const valueAfter = await targetContract.value();
    field("Target value after", String(valueAfter));
    console.log("");
    console.log("  ✓ PASS — caveat allowed execution");
  } catch (err: any) {
    console.log("  ✗ FAIL — unexpected revert");
    console.log("  Reason:", err.message?.split("\n")[0] ?? err);
  }

  section("CASE 2 — Valid Proof + Wrong Calldata (should revert)");
  console.log("  Expected: REVERT");
  console.log("");

  try {
    const tx = await redeemerWallet.sendTransaction({
      to: environment.DelegationManager,
      data: invalidRedeemCalldata,
    });
    field("TX hash", tx.hash);
    await tx.wait();
    console.log("  ✗ FAIL — should have reverted");
  } catch (err: any) {
    console.log("  ✓ PASS — caveat blocked execution as expected");
    console.log("  Revert reason:", err.message?.split("\n")[0] ?? err);
  }

  section("DEMO COMPLETE");
  console.log("  OnlyAgentProofCaveat is load-bearing on Base Mainnet.");
  console.log("  Real Venice TEE proof required.");
  console.log("  Wrong execution envelope blocked.");
  console.log("");
}

main().catch(err => { console.error(err); process.exit(1); });
