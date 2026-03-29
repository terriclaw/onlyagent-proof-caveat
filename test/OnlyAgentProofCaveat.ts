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
      ["tuple(address trustedSigner,uint256 maxAgeSeconds,address requiredTarget,uint256 requiredChainId)"],
      [[trustedSigner.address, 120, target, chainId]]
    );

    const args = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(bytes32 promptHash,bytes32 responseHash,uint256 timestamp,address target,bytes signature)"],
      [[promptHash, responseHash, now, target, signature]]
    );

    return { terms, args };
  }

  it("passes with a valid proof", async function () {
    const { ethers, caveat, trustedSigner, deployer } = await deployFixture();
    const net = await ethers.provider.getNetwork();

    const { terms, args } = await buildValidInputs(
      ethers,
      trustedSigner,
      deployer.address,
      net.chainId
    );

    await caveat.beforeHook(
      terms,
      args,
      ethers.ZeroHash,
      "0x",
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
      ["tuple(address trustedSigner,uint256 maxAgeSeconds,address requiredTarget,uint256 requiredChainId)"],
      [[trustedSigner.address, 120, deployer.address, net.chainId]]
    );

    const args = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(bytes32 promptHash,bytes32 responseHash,uint256 timestamp,address target,bytes signature)"],
      [[promptHash, responseHash, now, deployer.address, badSignature]]
    );

    await expect(
      caveat.beforeHook(
        terms,
        args,
        ethers.ZeroHash,
        "0x",
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
      ["tuple(address trustedSigner,uint256 maxAgeSeconds,address requiredTarget,uint256 requiredChainId)"],
      [[trustedSigner.address, 120, deployer.address, net.chainId]]
    );

    const args = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(bytes32 promptHash,bytes32 responseHash,uint256 timestamp,address target,bytes signature)"],
      [[promptHash, responseHash, 1, deployer.address, signature]]
    );

    await expect(
      caveat.beforeHook(
        terms,
        args,
        ethers.ZeroHash,
        "0x",
        ethers.ZeroHash,
        ethers.ZeroAddress,
        ethers.ZeroAddress
      )
    ).to.be.revertedWithCustomError(caveat, "StaleProof");
  });

  it("reverts on wrong target", async function () {
    const { ethers, caveat, trustedSigner, deployer, other } = await deployFixture();
    const net = await ethers.provider.getNetwork();

    const { args } = await buildValidInputs(
      ethers,
      trustedSigner,
      other.address,
      net.chainId
    );

    const mismatchedTerms = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address trustedSigner,uint256 maxAgeSeconds,address requiredTarget,uint256 requiredChainId)"],
      [[trustedSigner.address, 120, deployer.address, net.chainId]]
    );

    await expect(
      caveat.beforeHook(
        mismatchedTerms,
        args,
        ethers.ZeroHash,
        "0x",
        ethers.ZeroHash,
        ethers.ZeroAddress,
        ethers.ZeroAddress
      )
    ).to.be.revertedWithCustomError(caveat, "WrongTarget");
  });

  it("reverts on wrong chain", async function () {
    const { ethers, caveat, trustedSigner, deployer } = await deployFixture();
    const net = await ethers.provider.getNetwork();

    const { args } = await buildValidInputs(
      ethers,
      trustedSigner,
      deployer.address,
      net.chainId
    );

    const wrongChainTerms = ethers.AbiCoder.defaultAbiCoder().encode(
      ["tuple(address trustedSigner,uint256 maxAgeSeconds,address requiredTarget,uint256 requiredChainId)"],
      [[trustedSigner.address, 120, deployer.address, net.chainId + 1n]]
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
});
