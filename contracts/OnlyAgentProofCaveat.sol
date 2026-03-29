// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

type ModeCode is bytes32;

interface ICaveatEnforcer {
    function beforeAllHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCalldata,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    ) external;

    function beforeHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCalldata,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    ) external;

    function afterHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCalldata,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    ) external;

    function afterAllHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode _mode,
        bytes calldata _executionCalldata,
        bytes32 _delegationHash,
        address _delegator,
        address _redeemer
    ) external;
}

contract OnlyAgentProofCaveat is ICaveatEnforcer {
    error InvalidSigner();
    error StaleProof();
    error WrongTarget();
    error WrongChain();

    struct Terms {
        address trustedSigner;
        uint256 maxAgeSeconds;
        address requiredTarget;
        uint256 requiredChainId;
    }

    struct Args {
        bytes32 promptHash;
        bytes32 responseHash;
        uint256 timestamp;
        address target;
        bytes signature;
    }

    function beforeHook(
        bytes calldata _terms,
        bytes calldata _args,
        ModeCode,
        bytes calldata,
        bytes32,
        address,
        address
    ) external override {
        Terms memory t = abi.decode(_terms, (Terms));
        Args memory a = abi.decode(_args, (Args));

        if (block.timestamp > a.timestamp + t.maxAgeSeconds) revert StaleProof();
        if (block.chainid != t.requiredChainId) revert WrongChain();
        if (a.target != t.requiredTarget) revert WrongTarget();

        bytes memory message = abi.encodePacked(
            _toHex(a.promptHash),
            ":",
            _toHex(a.responseHash)
        );

        bytes32 ethHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n",
                _uintToString(message.length),
                message
            )
        );

        address recovered = _recover(ethHash, a.signature);
        if (recovered != t.trustedSigner) revert InvalidSigner();
    }

    function beforeAllHook(
        bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address
    ) external override {}

    function afterHook(
        bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address
    ) external override {}

    function afterAllHook(
        bytes calldata, bytes calldata, ModeCode, bytes calldata, bytes32, address, address
    ) external override {}

    function _recover(bytes32 hash, bytes memory sig) internal pure returns (address) {
        require(sig.length == 65, "bad sig");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        return ecrecover(hash, v, r, s);
    }

    function _toHex(bytes32 data) internal pure returns (string memory) {
        bytes16 hexChars = "0123456789abcdef";
        bytes memory str = new bytes(64);
        for (uint256 i = 0; i < 32; i++) {
            str[i * 2] = hexChars[uint8(data[i] >> 4)];
            str[i * 2 + 1] = hexChars[uint8(data[i] & 0x0f)];
        }
        return string(str);
    }

    function _uintToString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 j = v;
        uint256 len;
        while (j != 0) { len++; j /= 10; }
        bytes memory b = new bytes(len);
        uint256 k = len;
        while (v != 0) { k--; b[k] = bytes1(uint8(48 + v % 10)); v /= 10; }
        return string(b);
    }
}
