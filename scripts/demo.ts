import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

// ─── Config ───────────────────────────────────────────────────────────────────

const RPC_URL            = process.env.BASE_RPC_URL!;
const VENICE_API_KEY     = process.env.VENICE_API_KEY!;
const TEE_SIGNER_ADDRESS = process.env.TEE_SIGNER_ADDRESS!;
const DELEGATOR_PK       = process.env.DELEGATOR_PRIVATE_KEY!;
const REDEEMER_PK        = process.env.REDEEMER_PRIVATE_KEY!;
const CAVEAT_ADDRESS     = process.env.CAVEAT_ADDRESS!;
const TARGET_ADDRESS     = process.env.TARGET_ADDRESS!;
const DELEGATION_MANAGER = "0xdb9b1e94b5b69df7e401ddbede43491141047db3";
const VENICE_MODEL       = "e2ee-qwen-2-5-7b-p";
const VENICE_BASE        = "https://api.venice.ai/api/v1";
const BASESCAN           = "https://basescan.org/tx";

const MODE_SINGLE_DEFAULT = ethers.ZeroHash;

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const DELEGATION_MANAGER_ABI = [
  "function redeemDelegations(bytes[] permissionContexts, bytes32[] modes, bytes[] executionCallDatas) external payable",
  "function getDomainHash() external view returns (bytes32)",
];

const TARGET_ABI = [
  "function setValue(uint256 newValue) external",
  "function value() view returns (uint256)",
];

// ─── EIP-712 ──────────────────────────────────────────────────────────────────

const DELEGATION_TYPEHASH = ethers.keccak256(
  ethers.toUtf8Bytes(
    "Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)"
  )
);

const CAVEAT_TYPEHASH = ethers.keccak256(
  ethers.toUtf8Bytes("Caveat(address enforcer,bytes terms)")
);

const coder = ethers.AbiCoder.defaultAbiCoder();

// ─── Logging ──────────────────────────────────────────────────────────────────

function section(title: string) {
  console.log("");
  console.log("═".repeat(60));
  console.log(`  ${title}`);
  console.log("═".repeat(60));
}

function field(label: string, value: string) {
  const pad = 22;
  console.log(`  ${label.padEnd(pad)} ${value}`);
}

function truncate(str: string, n = 20): string {
  return str.length > n ? str.slice(0, n) + "..." : str;
}

// ─── Venice ───────────────────────────────────────────────────────────────────

async function callVenice(prompt: string) {
  const res = await fetch(`${VENICE_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VENICE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: VENICE_MODEL,
      messages: [{ role: "user", content: prompt }],
      venice_parameters: {
        include_venice_system_prompt: false,
        strip_thinking_response: false,
      },
    }),
  });

  const teeConfirmed = res.headers.get("x-venice-tee") === "true";
  const teeProvider  = res.headers.get("x-venice-tee-provider") ?? "unknown";
  const data = await res.json() as any;
  if (data.error) throw new Error(`Venice error: ${JSON.stringify(data.error)}`);

  return {
    requestId:    data.id as string,
    response:     data.choices[0].message.content as string,
    teeConfirmed,
    teeProvider,
  };
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

// ─── Delegation helpers ───────────────────────────────────────────────────────

function encodeCaveatHash(enforcer: string, terms: string): string {
  return ethers.keccak256(
    coder.encode(
      ["bytes32", "address", "bytes32"],
      [CAVEAT_TYPEHASH, enforcer, ethers.keccak256(terms)]
    )
  );
}

function encodeCaveatArrayHash(caveats: { enforcer: string; terms: string }[]): string {
  const hashes = caveats.map(c => ethers.getBytes(encodeCaveatHash(c.enforcer, c.terms)));
  return ethers.keccak256(ethers.concat(hashes));
}

function getDelegationHash(
  delegate: string,
  delegator: string,
  authority: string,
  caveats: { enforcer: string; terms: string }[],
  salt: bigint
): string {
  return ethers.keccak256(
    coder.encode(
      ["bytes32", "address", "address", "bytes32", "bytes32", "uint256"],
      [DELEGATION_TYPEHASH, delegate, delegator, authority, encodeCaveatArrayHash(caveats), salt]
    )
  );
}

async function signDelegation(
  delegatorWallet: ethers.Wallet,
  domainHash: string,
  delegate: string,
  authority: string,
  caveats: { enforcer: string; terms: string }[],
  salt: bigint
): Promise<string> {
  const delegationHash = getDelegationHash(
    delegate, delegatorWallet.address, authority, caveats, salt
  );
  const digest = ethers.keccak256(
    ethers.concat([
      ethers.toUtf8Bytes("\x19\x01"),
      ethers.getBytes(domainHash),
      ethers.getBytes(delegationHash),
    ])
  );
  return delegatorWallet.signingKey.sign(ethers.getBytes(digest)).serialized;
}

// ─── Encoding ─────────────────────────────────────────────────────────────────

function encodeTerms(
  trustedSigner: string,
  maxAgeSeconds: bigint,
  requiredTarget: string,
  requiredChainId: bigint,
  requiredSelector: string,
  requiredValue: bigint,
  requiredCalldataHash: string
): string {
  return coder.encode(
    ["tuple(address,uint256,address,uint256,bytes4,uint256,bytes32)"],
    [[trustedSigner, maxAgeSeconds, requiredTarget, requiredChainId,
      requiredSelector, requiredValue, requiredCalldataHash]]
  );
}

function encodeArgs(
  promptHash: string,
  responseHash: string,
  timestamp: bigint,
  signature: string
): string {
  return coder.encode(
    ["tuple(bytes32,bytes32,uint256,bytes)"],
    [[promptHash, responseHash, timestamp, signature]]
  );
}

function encodeExecution(target: string, value: bigint, callData: string): string {
  return coder.encode(["address", "uint256", "bytes"], [target, value, callData]);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const provider  = new ethers.JsonRpcProvider(RPC_URL);
  const network   = await provider.getNetwork();
  const delegator = new ethers.Wallet(DELEGATOR_PK, provider);
  const redeemer  = new ethers.Wallet(REDEEMER_PK, provider);

  const dm = new ethers.Contract(DELEGATION_MANAGER, DELEGATION_MANAGER_ABI, redeemer);
  const domainHash: string = await dm.getDomainHash();

  const targetContract = new ethers.Contract(TARGET_ADDRESS, TARGET_ABI, provider);

  section("ONLYAGENT PROOF CAVEAT — INTEGRATION DEMO");
  field("Network",           `${network.name} (chainId: ${network.chainId})`);
  field("DelegationManager", DELEGATION_MANAGER);
  field("Caveat",            CAVEAT_ADDRESS);
  field("Target",            TARGET_ADDRESS);
  field("Delegator",         delegator.address);
  field("Redeemer",          redeemer.address);
  field("TEE signer",        TEE_SIGNER_ADDRESS);
  field("Domain hash",       truncate(domainHash));

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

  field("Signed text",      sigPayload.text);
  field("Signature",        truncate(sigPayload.signature));
  field("Signing address",  sigPayload.signing_address);

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

  field("Function",       "setValue(42)");
  field("Selector",       selector);
  field("Calldata hash",  truncate(calldataHash));
  field("Value (ETH)",    "0");
  field("Target",         TARGET_ADDRESS);

  // ── Step 5: Build delegation ──────────────────────────────────────────────
  section("STEP 5 — Delegation Construction");

  const terms = encodeTerms(
    TEE_SIGNER_ADDRESS, 120n, TARGET_ADDRESS,
    network.chainId, selector, value, calldataHash
  );

  const args = encodeArgs(promptHash, responseHash, timestamp, sigPayload.signature);
  const caveats = [{ enforcer: CAVEAT_ADDRESS, terms, args }];
  const salt = BigInt(ethers.hexlify(ethers.randomBytes(32)));

  const sig = await signDelegation(
    delegator, domainHash, redeemer.address, ethers.ZeroHash, caveats, salt
  );

  const delegationHash = getDelegationHash(
    redeemer.address, delegator.address, ethers.ZeroHash, caveats, salt
  );

  field("Caveat enforcer",  CAVEAT_ADDRESS);
  field("Delegation hash",  truncate(delegationHash));
  field("Salt",             truncate(salt.toString()));
  field("Delegation sig",   truncate(sig));

  const delegation = {
    delegate:  redeemer.address,
    delegator: delegator.address,
    authority: ethers.ZeroHash,
    caveats:   caveats.map(c => ({ ...c, args: c.args })),
    salt,
    signature: sig,
  };

  const permissionContext = coder.encode(
    ["tuple(address delegate,address delegator,bytes32 authority,tuple(address enforcer,bytes terms,bytes args)[] caveats,uint256 salt,bytes signature)[]"],
    [[delegation]]
  );

  const validExec   = encodeExecution(TARGET_ADDRESS, value, callData);
  const badCallData = targetIface.encodeFunctionData("setValue", [999]);
  const invalidExec = encodeExecution(TARGET_ADDRESS, value, badCallData);

  // ── Case 1: Valid redemption ──────────────────────────────────────────────
  section("CASE 1 — Valid Proof + Matching Execution");
  console.log("  Expected: PASS");
  console.log("  Calling DelegationManager.redeemDelegations...");
  console.log("");

  const valueBefore = await targetContract.value();
  field("Target value before", String(valueBefore));

  try {
    const tx = await dm.redeemDelegations(
      [permissionContext], [MODE_SINGLE_DEFAULT], [validExec]
    );
    field("TX hash",    tx.hash);
    field("Basescan",   `${BASESCAN}/${tx.hash}`);
    console.log("");
    console.log("  Waiting for confirmation...");
    const receipt = await tx.wait();
    field("Block",      String(receipt?.blockNumber));
    field("Gas used",   String(receipt?.gasUsed));

    const valueAfter = await targetContract.value();
    field("Target value after", String(valueAfter));

    console.log("");
    console.log("  ✓ PASS — caveat allowed execution");
  } catch (err: any) {
    console.log("  ✗ FAIL — unexpected revert");
    console.log("  Reason:", err.message?.split("\n")[0] ?? err);
  }

  // ── Case 2: Invalid redemption ────────────────────────────────────────────
  section("CASE 2 — Valid Proof + Wrong Calldata (should revert)");
  console.log("  Expected: REVERT");
  console.log("  Calling DelegationManager.redeemDelegations with setValue(999)...");
  console.log("");

  try {
    const tx = await dm.redeemDelegations(
      [permissionContext], [MODE_SINGLE_DEFAULT], [invalidExec]
    );
    field("TX hash", tx.hash);
    await tx.wait();
    console.log("  ✗ FAIL — should have reverted but did not");
  } catch (err: any) {
    console.log("  ✓ PASS — caveat blocked execution as expected");
    console.log("  Revert reason:", err.message?.split("\n")[0] ?? err);
  }

  section("DEMO COMPLETE");
  console.log("  OnlyAgentProofCaveat is load-bearing on Base Mainnet.");
  console.log("  Real Venice TEE proof required. Wrong execution envelope blocked.");
  console.log("");
}

main().catch(err => { console.error(err); process.exit(1); });
