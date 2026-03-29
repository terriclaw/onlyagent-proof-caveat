import { expect } from "chai";
import { network } from "hardhat";

describe("OnlyAgentProofCaveat", function () {
  async function deployFixture() {
    const { ethers } = await network.connect();

    const Caveat = await ethers.getContractFactory("OnlyAgentProofCaveat");
    const caveat = await Caveat.deploy();
    await caveat.waitForDeployment();

    const [deployer, trustedSigner, other] = await ethers.getSigners();

    return { ethers, caveat, deployer, trustedSigner, other };
  }

  function buildVeniceMessage(promptHash: string, responseHash: string): string {
    const p = promptHash.toLowerCase().replace("0x", "");
    const r = responseHash.toLowerCase().replace("0x", "");
    return `${p}:${r}`;
  }

  async function buildValidInputs(
    ethers: any,
    trustedSigner: any,
    target: string,
    chainId: bigint
  ) {
    const now = Math.floor(Date.now() / 1000);

    const promptHash = ethers.keccak256(ethers.toUtf8Bytes("prompt"));
    const responseHash = ethers.keccak256(ethers.toUtf8Bytes("response"));

    const message = buildVeniceMessage(promptHash, responseHash);
    const signature = await trustedSigner.signMessage(message);

    const terms = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address trustedSigner,uint256 maxAgeSeconds,address requiredTarget,uint256 requiredChainId,bytes4 requiredSelector)"],
      [[trustedSigner.address, 120, target, chainId, "0xa9059cbb"]]
    );

    const selectorCalldata = "0xa9059cbb" + "0".repeat(64);
    const executionCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "bytes"],
      [target, 0, selectorCalldata]
    );

    const args = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(bytes32 promptHash,bytes32 responseHash,uint256 timestamp,bytes signature)"],
      [[promptHash, responseHash, now, signature]]
    );

    return { terms, args, executionCalldata };
  }

  it("passes with a valid proof", async function () {
    const { ethers, caveat, trustedSigner, deployer } = await deployFixture();
    const net = await ethers.provider.getNetwork();

    const { terms, args, executionCalldata } = await buildValidInputs(
      ethers,
      trustedSigner,
      deployer.address,
      net.chainId
    );

    await caveat.beforeHook(
      terms,
      args,
      ethers.ZeroHash,
      executionCalldata,
      ethers.ZeroHash,
      ethers.ZeroAddress,
      ethers.ZeroAddress
    );
  });

  it("reverts on wrong signer", async function () {
    const { ethers, caveat, trustedSigner, other, deployer } = await deployFixture();
    const net = await ethers.provider.getNetwork();
    const now = Math.floor(Date.now() / 1000);

    const promptHash = ethers.keccak256(ethers.toUtf8Bytes("prompt"));
    const responseHash = ethers.keccak256(ethers.toUtf8Bytes("response"));
    const message = buildVeniceMessage(promptHash, responseHash);

    const badSignature = await other.signMessage(message);

    const terms = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address trustedSigner,uint256 maxAgeSeconds,address requiredTarget,uint256 requiredChainId,bytes4 requiredSelector)"],
      [[trustedSigner.address, 120, deployer.address, net.chainId, "0xa9059cbb"]]
    );

    const args = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(bytes32 promptHash,bytes32 responseHash,uint256 timestamp,bytes signature)"],
      [[promptHash, responseHash, now, badSignature]]
    );

    const execCalldata1 = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "bytes"],
      [deployer.address, 0, "0xa9059cbb" + "0".repeat(64)]
    );

    await expect(
      caveat.beforeHook(
        terms,
        args,
        ethers.ZeroHash,
        execCalldata1,
        ethers.ZeroHash,
        ethers.ZeroAddress,
        ethers.ZeroAddress
      )
    ).to.be.revertedWithCustomError(caveat, "InvalidSigner");
  });

  it("reverts on stale proof", async function () {
    const { ethers, caveat, trustedSigner, deployer } = await deployFixture();
    const net = await ethers.provider.getNetwork();

    const promptHash = ethers.keccak256(ethers.toUtf8Bytes("prompt"));
    const responseHash = ethers.keccak256(ethers.toUtf8Bytes("response"));
    const message = buildVeniceMessage(promptHash, responseHash);
    const signature = await trustedSigner.signMessage(message);

    const terms = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address trustedSigner,uint256 maxAgeSeconds,address requiredTarget,uint256 requiredChainId,bytes4 requiredSelector)"],
      [[trustedSigner.address, 120, deployer.address, net.chainId, "0xa9059cbb"]]
    );

    const args = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(bytes32 promptHash,bytes32 responseHash,uint256 timestamp,bytes signature)"],
      [[promptHash, responseHash, 1, signature]]
    );

    const execCalldata2 = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "bytes"],
      [deployer.address, 0, "0xa9059cbb" + "0".repeat(64)]
    );

    await expect(
      caveat.beforeHook(
        terms,
        args,
        ethers.ZeroHash,
        execCalldata2,
        ethers.ZeroHash,
        ethers.ZeroAddress,
        ethers.ZeroAddress
      )
    ).to.be.revertedWithCustomError(caveat, "StaleProof");
  });

  it("reverts on wrong target", async function () {
    const { ethers, caveat, trustedSigner, deployer, other } = await deployFixture();
    const net = await ethers.provider.getNetwork();

    const { args, executionCalldata } = await buildValidInputs(
      ethers,
      trustedSigner,
      other.address,
      net.chainId
    );

    const mismatchedTerms = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address trustedSigner,uint256 maxAgeSeconds,address requiredTarget,uint256 requiredChainId,bytes4 requiredSelector)"],
      [[trustedSigner.address, 120, deployer.address, net.chainId, "0xa9059cbb"]]
    );

    await expect(
      caveat.beforeHook(
        mismatchedTerms,
        args,
        ethers.ZeroHash,
        executionCalldata,
        ethers.ZeroHash,
        ethers.ZeroAddress,
        ethers.ZeroAddress
      )
    ).to.be.revertedWithCustomError(caveat, "WrongTarget");
  });

  it("reverts on wrong chain", async function () {
    const { ethers, caveat, trustedSigner, deployer } = await deployFixture();
    const net = await ethers.provider.getNetwork();

    const { args, executionCalldata } = await buildValidInputs(
      ethers,
      trustedSigner,
      deployer.address,
      net.chainId
    );

    const wrongChainTerms = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address trustedSigner,uint256 maxAgeSeconds,address requiredTarget,uint256 requiredChainId,bytes4 requiredSelector)"],
      [[trustedSigner.address, 120, deployer.address, net.chainId + 1n, "0xa9059cbb"]]
    );

    await expect(
      caveat.beforeHook(
        wrongChainTerms,
        args,
        ethers.ZeroHash,
        "0x",
        ethers.ZeroHash,
        ethers.ZeroAddress,
        ethers.ZeroAddress
      )
    ).to.be.revertedWithCustomError(caveat, "WrongChain");
  });

  it("reverts on wrong selector", async function () {
    const { ethers, caveat, trustedSigner, deployer } = await deployFixture();
    const net = await ethers.provider.getNetwork();

    const { args } = await buildValidInputs(
      ethers,
      trustedSigner,
      deployer.address,
      net.chainId
    );

    const wrongSelectorTerms = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address trustedSigner,uint256 maxAgeSeconds,address requiredTarget,uint256 requiredChainId,bytes4 requiredSelector)"],
      [[trustedSigner.address, 120, deployer.address, net.chainId, "0xdeadbeef"]]
    );

    const execCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "bytes"],
      [deployer.address, 0, "0xa9059cbb" + "0".repeat(64)]
    );

    await expect(
      caveat.beforeHook(
        wrongSelectorTerms,
        args,
        ethers.ZeroHash,
        execCalldata,
        ethers.ZeroHash,
        ethers.ZeroAddress,
        ethers.ZeroAddress
      )
    ).to.be.revertedWithCustomError(caveat, "WrongSelector");
  });

  it("reverts on calldata too short", async function () {
    const { ethers, caveat, trustedSigner, deployer } = await deployFixture();
    const net = await ethers.provider.getNetwork();

    const { args } = await buildValidInputs(
      ethers,
      trustedSigner,
      deployer.address,
      net.chainId
    );

    const terms = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address trustedSigner,uint256 maxAgeSeconds,address requiredTarget,uint256 requiredChainId,bytes4 requiredSelector)"],
      [[trustedSigner.address, 120, deployer.address, net.chainId, "0xa9059cbb"]]
    );

    const execCalldata = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "bytes"],
      [deployer.address, 0, "0x"]
    );

    await expect(
      caveat.beforeHook(
        terms,
        args,
        ethers.ZeroHash,
        execCalldata,
        ethers.ZeroHash,
        ethers.ZeroAddress,
        ethers.ZeroAddress
      )
    ).to.be.revertedWithCustomError(caveat, "CalldataTooShort");
  });});
