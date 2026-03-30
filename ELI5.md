# OnlyAgentProofCaveat — ELI5

## What is a delegation?

MetaMask lets you sign transactions. Delegations let you sign a permission slip that says:

> "I allow someone else to make transactions on my behalf — but only under specific conditions."

The conditions are enforced by a **caveat enforcer** — a smart contract that acts as a bouncer. Before any delegated transaction goes through, the bouncer checks the rules.

## What does this caveat do?

This caveat is a bouncer that says:

> "I will only let this transaction through if someone can prove an AI actually ran — and the transaction matches the constraints tied to that proof."

Specifically it checks:

1. **Did a Venice AI actually run?** — verified by a TEE signature (a cryptographic proof from inside a secure computer chip)
2. **Is the proof fresh?** — not older than X seconds
3. **Is this the right blockchain?** — chain ID must match
4. **Is this going to the right contract?** — target address must match
5. **Is this calling the right function?** — function selector must match
6. **Is the right amount of ETH being sent?** — value must match
7. **Is the exact calldata correct?** — full payload hash must match

If any of those fail, the transaction is blocked. All of them must pass.

**Important:** the AI does NOT sign the transaction itself.

The AI only signs `(promptHash, responseHash)`.
The caveat is what ties that proof to this exact transaction.

## Why does it matter?

Before this, there was no way to say:

> "This transaction was authorized by an AI agent that actually ran inside a secure enclave."

Now there is — and it works at the wallet/delegation layer, meaning any contract can benefit from it without being modified.

## How does it fit with OnlyAgent?

| | OnlyAgent | OnlyAgentProofCaveat |
|---|---|---|
| Where it runs | Inside the target contract | At the wallet/delegation layer |
| What it protects | A specific contract function | Any delegated transaction |
| Requires contract modification | Yes | No |

## The full picture
```
Venice AI runs inside a secure enclave (TEE)
↓
Signs a proof: "I processed this prompt and produced this response"
↓
Agent decides to submit a transaction
↓
Transaction goes through MetaMask delegation system
↓
OnlyAgentProofCaveat checks:
  ✓ valid TEE proof
  ✓ proof is fresh
  ✓ correct chain
  ✓ correct target contract
  ✓ correct function
  ✓ correct ETH value
  ✓ correct calldata
↓
Transaction executes (or gets blocked)
```

That's it. The caveat is the bridge between "an AI thought about this" and "this exact transaction is allowed to go through."
