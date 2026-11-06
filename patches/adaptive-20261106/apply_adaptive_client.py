#!/usr/bin/env python3
"""Apply Adaptive v22 to the *matching CLOUD extension*; never to legacy wmautofull.

Windows: py -3 apply_adaptive_client.py "C:\path\to\the\cloud-extension"
Testing only; turn AUTO CƯỢC off separately.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

FILES = ("cloud-ai-client.js", "content.js")
ORIGINAL = {
    "cloud-ai-client.js": "915a60d9186d0f4a8842f78a518223b75105cb28d614be02cdae1d6366e7bbfb",
    "content.js": "f80cd65d160a627d2baeca1c5cca5f35ad0a0d44e20645c6844d151ded2642a1",
}
PATCHED = {
    "cloud-ai-client.js": "b704396adcb6546b989dac6a763338d5d3ac6a8b3aaf000a08643fb0931c5806",
    "content.js": "4037a4a007c518123a2050d894f073995848e1434ec3c045d61d393aaec08818",
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def command(argv: list[str], cwd: Path) -> None:
    subprocess.run(argv, cwd=str(cwd), check=True, capture_output=True, text=True)


def main() -> int:
    p = argparse.ArgumentParser(description="Upgrade a matching WM Cloud Client test copy")
    p.add_argument("extension_dir", type=Path, help="Path to unpacked Cloud Client extension")
    p.add_argument("--check-only", action="store_true", help="Check source hashes without changing files")
    args = p.parse_args()
    root = args.extension_dir.expanduser().resolve()
    patch_dir = Path(__file__).resolve().parent
    patch = patch_dir / "adaptive-v22.patch"
    test = patch_dir / "test_client_round_identity.js"
    if not root.is_dir() or not patch.is_file() or not test.is_file():
        raise ValueError("Missing extension directory or the patch/test files")
    if not (root / "manifest.json").is_file():
        raise ValueError("This folder is not an unpacked Chrome extension (manifest.json missing)")
    import json
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8-sig"))
    load_order = [script for item in manifest.get("content_scripts", []) for script in item.get("js", [])]
    if not ({"cloud-ai-client.js", "content.js"} <= set(load_order)):
        raise ValueError("Manifest does not load the required Cloud Client scripts; NOT the compatible version")
    sources = {name: (root / name).read_bytes() for name in FILES}
    current = {name: sha256(data) for name, data in sources.items()}
    if all(current[name] == PATCHED[name] for name in FILES):
        print("ALREADY PATCHED: both scripts match the expected SHA-256")
        return 0
    wrong = [name for name in FILES if current[name] != ORIGINAL[name]]
    if wrong:
        raise ValueError("Source checksum mismatch (no files changed): " + ", ".join(wrong))
    print("PASS: both original checksums match the version-locked Cloud Client")
    if args.check_only:
        return 0
    if not shutil.which("git"):
        raise RuntimeError("Git is required to apply the verified patch")
    if not shutil.which("node"):
        raise RuntimeError("Node.js is required for JavaScript syntax and smoke tests")

    # Test in isolation before changing either file in the extension directory.
    with tempfile.TemporaryDirectory(prefix="wm-adaptive-") as temp:
        stage = Path(temp)
        for name in FILES:
            (stage / name).write_bytes(sources[name].replace(b"\r\n", b"\n"))
        shutil.copy2(test, stage / test.name)
        command(["git", "apply", "--check", str(patch)], stage)
        command(["git", "apply", str(patch)], stage)
        for name in FILES:
            if sha256((stage / name).read_bytes()) != PATCHED[name]:
                raise RuntimeError(f"Unexpected patched checksum for {name}; aborted")
            command(["node", "--check", name], stage)
        command(["node", test.name], stage)
        print("PASS: patched SHA-256, Node syntax and round-ID smoke test")

        backup = root / (".backup-adaptive-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
        if backup.exists():
            raise RuntimeError("Backup directory already exists; no files changed")
        backup.mkdir()
        for name in FILES:
            (backup / name).write_bytes(sources[name])
        replaced = []
        try:
            for name in FILES:
                shutil.copyfile(stage / name, root / name)
                replaced.append(name)
            for name in FILES:
                if sha256((root / name).read_bytes()) != PATCHED[name]:
                    raise RuntimeError(f"Post-copy hash mismatch for {name}")
        except BaseException:
            for name in replaced:
                shutil.copyfile(backup / name, root / name)
            raise
        print(f"UPGRADE OK — backup: {backup}")
        print("Chrome: chrome://extensions > Reload this extension; then F5 the WM page")
        print("Keep AUTO CƯỢC OFF; check journal_inserted and scored with PAPER-only data")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, ValueError, OSError, subprocess.CalledProcessError) as e:
        print(f"UPGRADE BLOCKED: {e}", file=sys.stderr)
        sys.exit(1)
