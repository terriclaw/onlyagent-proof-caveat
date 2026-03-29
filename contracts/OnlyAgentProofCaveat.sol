// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICaveatEnforcer {
    function beforeHook(
        address delegator,
        bytes32 delegationHash,
        bytes calldata args,
        address redeemer,
        bytes calldata terms,
        bytes calldata executionCalldata,
        bytes32 mode
    ) external;

    function afterHook(
        address delegator,
        bytes32 delegationHash,
        bytes calldata args,
        address redeemer,
        bytes calldata terms,
        bytes calldata executionCalldata,
        bytes32 mode
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
        address,
        bytes32,
        bytes calldata args,
        address,
        bytes calldata terms,
        bytes calldata,
        bytes32
    ) external override {
        Terms memory t = abi.decode(terms, (Terms));
        Args memory a = abi.decode(args, (Args));

        if (block.chainid != t.requiredChainId) revert WrongChain();
        if (a.target != t.requiredTarget) revert WrongTarget();

        if (block.timestamp > a.timestamp + t.maxAgeSeconds) {
            revert StaleProof();
        }

        bytes memory message = _buildVeniceMessage(a.promptHash, a.responseHash);
        address signer = _recoverSigner(message, a.signature);

        if (signer != t.trustedSigner) revert InvalidSigner();
    }

    function afterHook(
        address,
        bytes32,
        bytes calldata,
        address,
        bytes calldata,
        bytes calldata,
        bytes32
    ) external override {}

    function _buildVeniceMessage(bytes32 promptHash, bytes32 responseHash)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(
            "0x",
            _toHex(promptHash),
            ":0x",
            _toHex(responseHash)
        );
    }

    function _recoverSigner(bytes memory message, bytes memory signature)
        internal
        pure
        returns (address)
    {
        bytes32 ethHash = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n",
                _uintToString(message.length),
                message
            )
        );

        (bytes32 r, bytes32 s, uint8 v) = _split(signature);
        return ecrecover(ethHash, v, r, s);
    }

    function _split(bytes memory sig)
        internal
        pure
        returns (bytes32 r, bytes32 s, uint8 v)
    {
        require(sig.length == 65, "bad sig");

        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
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
        uint256 length;

        while (j != 0) {
            length++;
            j /= 10;
        }

        bytes memory bstr = new bytes(length);
        uint256 k = length;

        while (v != 0) {
            k--;
            bstr[k] = bytes1(uint8(48 + v % 10));
            v /= 10;
        }

        return string(bstr);
    }
}
