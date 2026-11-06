# WM AI Adaptive Client — patch 06/11/2026

This folder contains the **exact, byte-verified diff** between the user-provided cloud thin client on 04/11/2026 and the repaired two-file client archive `WM_AI_Adaptive_Client_2Files_20261106.zip`.

## IMPORTANT: version-scoped update, not an upgrade to the old `wmautofull/` tree

The repository's `wmautofull/` folder on main is the older LOCAL AI extension (`ai-engine.js` loaded by `manifest.json` and `bridge.py` on port 8421). The repaired files are for a **different** customer CLOUD extension (`cloud-ai-client.js` and `Bridge.cs`). DO NOT copy patched `content.js` into the legacy `wmautofull/` folder, and DO NOT claim it is automatically installed on customer Windows computers.

This folder deliberately stores a standalone versioned patch on main without replacing the older client. Back up the client before use. Use PAPER/testing with no live bets until end-to-end verified.

## Provenance / original file SHA-256

- `cloud-ai-client.js`: `915a60d9186d0f4a8842f78a518223b75105cb28d614be02cdae1d6366e7bbfb`
- `content.js`: `f80cd65d160a627d2baeca1c5cca5f35ad0a0d44e20645c6844d151ded2642a1`

If either original hash differs, DO NOT apply this patch to that copy. Apply to a *copy* of the matching cloud client source.

## Applying safely (requires Python 3 and Git)

1. In a **copy** of the correct CLOUD extension, place the original files `cloud-ai-client.js` and `content.js` in its root.
2. Check the two original hashes (Windows PowerShell: `Get-FileHash .\cloud-ai-client.js -Algorithm SHA256`; repeat for `content.js`).
3. Mixed line endings in the original cloud client require LF normalization before applying the diff. The script below preserves no BOM and uses UTF-8, exactly as in the verified patched archive.
4. In the root of the copy, use Python to normalize each file: `python -c "from pathlib import Path; [(lambda p: p.write_bytes(p.read_bytes().replace(b'\\r\\n', b'\\n')))(Path(n)) for n in ('cloud-ai-client.js','content.js')]"`
5. Place `adaptive-v22.patch` in the root, then run `git apply --check adaptive-v22.patch` followed by `git apply adaptive-v22.patch`.
6. Validate with `node --check cloud-ai-client.js`, `node --check content.js` and `node test_client_round_identity.js`.

## Expected patched file SHA-256

- `cloud-ai-client.js`: `b704396adcb6546b989dac6a763338d5d3ac6a8b3aaf000a08643fb0931c5806`
- `content.js`: `4037a4a007c518123a2050d894f073995848e1434ec3c045d61d393aaec08818`

Patch verified by `git apply --check` and byte-for-byte comparison against user-supplied updated client ZIP.

## Backend validation after updating matching client

On the demo admin's authenticated `/api/admin/data`, check only `predictionJournalDiagnostics`. With valid upcoming round IDs, `journal_attempts` and `journal_inserted` should increase; later verified outcomes should increment `prediction_journal.scored`; then `adaptive_weights` should acquire contexts after sufficient samples. If `missing_round_identity` keeps increasing, client metadata still mismatches.

A successful simulation does **not** prove a profitable wagering model. Review `CONFLICT` outcomes and evaluate out of sample before considering any live mode.
