import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const DELEGATION_MANAGER_ABI = [
  "function redeemDelegations(bytes[] permissionContexts, bytes32[] modes, bytes[] executionCallDatas) external payable",
  "function getDomainHash() external view returns (bytes32)",
];

const TARGET_ABI = [
  "function setValue(uint256 newValue) external",
];

const RPC_URL               = process.env.BASE_RPC_URL!;
const DELEGATOR_PK          = process.env.DELEGATOR_PRIVATE_KEY!;
const REDEEMER_PK           = process.env.REDEEMER_PRIVATE_KEY!;
const VENICE_SIGNER_PK      = process.env.VENICE_SIGNER_PRIVATE_KEY!;
const CAVEAT_ADDRESS        = process.env.CAVEAT_ADDRESS!;
const TARGET_ADDRESS        = process.env.TARGET_ADDRESS!;
const DELEGATION_MANAGER    = "0xdb9b1e94b5b69df7e401ddbede43491141047db3";

// SingleDefault: CALLTYPE_SINGLE (0x00) + EXECTYPE_DEFAULT (0x00) + zeroes
const MODE_SINGLE_DEFAULT = ethers.ZeroHash;

const DELEGATION_TYPEHASH = ethers.keccak256(
  ethers.toUtf8Bytes(
    "Delegation(address delegate,address delegator,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms)"
  )
);

const CAVEAT_TYPEHASH = ethers.keccak256(
  ethers.toUtf8Bytes("Caveat(address enforcer,bytes terms)")
);

const coder = ethers.AbiCoder.defaultAbiCoder();

function buildVeniceMessage(promptHash: string, responseHash: string): string {
  const p = promptHash.toLowerCase().replace("0x", "");
  const r = responseHash.toLowerCase().replace("0x", "");
  return `${p}:${r}`;
}

function encodeCaveatPacketHash(enforcer: string, terms: string): string {
  return ethers.keccak256(
    coder.encode(
      ["bytes32", "address", "bytes32"],
      [CAVEAT_TYPEHASH, enforcer, ethers.keccak256(terms)]
    )
  );
}

function encodeCaveatArrayHash(caveats: { enforcer: string; terms: string }[]): string {
  const hashes = caveats.map(c => encodeCaveatPacketHash(c.enforcer, c.terms));
  return ethers.keccak256(ethers.concat(hashes.map(h => ethers.getBytes(h))));
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
      [
        DELEGATION_TYPEHASH,
        delegate,
        delegator,
        authority,
        encodeCaveatArrayHash(caveats),
        salt,
      ]
    )
  );
}

async function signDelegation(
  delegator: ethers.Wallet,
  domainHash: string,
  delegate: string,
  authority: string,
  caveats: { enforcer: string; terms: string }[],
  salt: bigint
): Promise<string> {
  const delegationHash = getDelegationHash(
    delegate,
    delegator.address,
    authority,
    caveats,
    salt
  );

  const digest = ethers.keccak256(
    ethers.concat([
      ethers.toUtf8Bytes("\x19\x01"),
      ethers.getBytes(domainHash),
      ethers.getBytes(delegationHash),
    ])
  );

  return delegator.signingKey.sign(ethers.getBytes(digest)).serialized;
}

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
    [[trustedSigner, maxAgeSeconds, requiredTarget, requiredChainId, requiredSelector, requiredValue, requiredCalldataHash]]
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

async function main() {
  const provider   = new ethers.JsonRpcProvider(RPC_URL);
  const network    = await provider.getNetwork();
  const delegator  = new ethers.Wallet(DELEGATOR_PK, provider);
  const redeemer   = new ethers.Wallet(REDEEMER_PK, provider);
  const veniceSigner = new ethers.Wallet(VENICE_SIGNER_PK, provider);

  const dm = new ethers.Contract(DELEGATION_MANAGER, DELEGATION_MANAGER_ABI, redeemer);
  const domainHash: string = await dm.getDomainHash();

  const targetIface = new ethers.Interface(TARGET_ABI);
  const callData    = targetIface.encodeFunctionData("setValue", [42]);
  const selector    = callData.slice(0, 10);
  const calldataHash = ethers.keccak256(callData);
  const value       = 0n;

  const promptHash   = ethers.keccak256(ethers.toUtf8Bytes("Should delegated execution be allowed?"));
  const responseHash = ethers.keccak256(ethers.toUtf8Bytes("YES"));
  const timestamp    = BigInt(Math.floor(Date.now() / 1000));
  const veniceMsg    = buildVeniceMessage(promptHash, responseHash);
  const proofSig     = await veniceSigner.signMessage(veniceMsg);

  const terms = encodeTerms(
    veniceSigner.address, 120n, TARGET_ADDRESS,
    network.chainId, selector, value, calldataHash
  );

  const args = encodeArgs(promptHash, responseHash, timestamp, proofSig);

  const caveats = [{ enforcer: CAVEAT_ADDRESS, terms, args }];
  const salt    = BigInt(ethers.hexlify(ethers.randomBytes(32)));

  const sig = await signDelegation(
    delegator, domainHash, redeemer.address,
    ethers.ZeroHash, caveats, salt
  );

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

  console.log("=== OnlyAgentProofCaveat Integration Demo ===");
  console.log("Network:          ", network.name, `(${network.chainId})`);
  console.log("Delegator:        ", delegator.address);
  console.log("Redeemer:         ", redeemer.address);
  console.log("Venice signer:    ", veniceSigner.address);
  console.log("DelegationManager:", DELEGATION_MANAGER);
  console.log("Caveat:           ", CAVEAT_ADDRESS);
  console.log("Target:           ", TARGET_ADDRESS);
  console.log("");

  console.log("=== CASE 1: valid proof + matching execution ===");
  try {
    const tx = await dm.redeemDelegations(
      [permissionContext], [MODE_SINGLE_DEFAULT], [validExec]
    );
    console.log("TX submitted:", tx.hash);
    const receipt = await tx.wait();
    console.log("SUCCESS in block:", receipt?.blockNumber);
  } catch (err: any) {
    console.error("UNEXPECTED FAILURE:", err.message ?? err);
  }

  console.log("");
  console.log("=== CASE 2: valid proof + wrong calldata (should revert) ===");
  try {
    const tx = await dm.redeemDelegations(
      [permissionContext], [MODE_SINGLE_DEFAULT], [invalidExec]
    );
    console.log("UNEXPECTED SUCCESS:", tx.hash);
    await tx.wait();
  } catch (err: any) {
    console.log("REVERTED as expected.");
    console.log("Reason:", err.message?.split("\n")[0] ?? err);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
