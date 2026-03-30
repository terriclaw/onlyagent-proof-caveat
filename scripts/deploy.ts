import { ethers } from "ethers";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();

const RPC_URL       = process.env.BASE_RPC_URL!;
const DEPLOYER_PK   = process.env.DEPLOYER_PRIVATE_KEY!;

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const deployer = new ethers.Wallet(DEPLOYER_PK, provider);

  console.log("Deploying from:", deployer.address);
  const balance = await provider.getBalance(deployer.address);
  console.log("Balance:       ", ethers.formatEther(balance), "ETH");
  console.log("");

  // Read artifacts
  const caveatArtifact = JSON.parse(
    fs.readFileSync("artifacts/contracts/OnlyAgentProofCaveat.sol/OnlyAgentProofCaveat.json", "utf8")
  );
  const targetArtifact = JSON.parse(
    fs.readFileSync("artifacts/contracts/DemoTarget.sol/DemoTarget.json", "utf8")
  );

  // Deploy OnlyAgentProofCaveat
  console.log("Deploying OnlyAgentProofCaveat...");
  const caveatFactory = new ethers.ContractFactory(
    caveatArtifact.abi, caveatArtifact.bytecode, deployer
  );
  const caveat = await caveatFactory.deploy();
  await caveat.waitForDeployment();
  const caveatAddress = await caveat.getAddress();
  console.log("OnlyAgentProofCaveat:", caveatAddress);

  // Deploy DemoTarget
  console.log("Deploying DemoTarget...");
  const targetFactory = new ethers.ContractFactory(
    targetArtifact.abi, targetArtifact.bytecode, deployer
  );
  const target = await targetFactory.deploy();
  await target.waitForDeployment();
  const targetAddress = await target.getAddress();
  console.log("DemoTarget:          ", targetAddress);

  console.log("");
  console.log("=== Add these to your .env ===");
  console.log(`CAVEAT_ADDRESS=${caveatAddress}`);
  console.log(`TARGET_ADDRESS=${targetAddress}`);
}

main().catch(err => { console.error(err); process.exit(1); });
