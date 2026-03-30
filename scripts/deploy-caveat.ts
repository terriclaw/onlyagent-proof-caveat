import { ethers } from "ethers";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config();

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.BASE_RPC_URL!);
  const deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, provider);

  const artifact = JSON.parse(
    fs.readFileSync("artifacts/contracts/OnlyAgentProofCaveat.sol/OnlyAgentProofCaveat.json", "utf8")
  );

  console.log("Deploying OnlyAgentProofCaveat (ERC-7579 packed format)...");
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log("OnlyAgentProofCaveat:", address);
  console.log(`\nUpdate .env:\nCAVEAT_ADDRESS=${address}`);
}

main().catch(err => { console.error(err); process.exit(1); });
