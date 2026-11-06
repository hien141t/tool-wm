#!/usr/bin/env python3
r"""Apply Adaptive v22 to the *matching CLOUD extension*; never to legacy wmautofull.

Windows: py -3 apply_adaptive_client.py "C:\path\to\the\cloud-extension"
Testing only; turn AUTO CƯỢC off separately.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import re
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
    result = subprocess.run(argv, cwd=str(cwd), capture_output=True, text=True)
    if result.returncode:
        details = (result.stderr or result.stdout or '').strip()
        raise RuntimeError(f"{argv[0]} failed (exit {result.returncode}): {details[:2500]}")


def apply_unified_patch(files: dict[str, bytes], patch_bytes: bytes) -> dict[str, bytes]:
    """Apply verified UTF-8 unified diff without platform-specific Git EOL handling."""
    patch_lines = patch_bytes.replace(b"\r\n", b"\n").splitlines(keepends=True)
    output = {}
    pos = 0
    while pos < len(patch_lines):
        header = patch_lines[pos]
        if not header.startswith(b"--- a/"):
            raise ValueError(f"Invalid patch header at line {pos + 1}")
        name = header[len(b"--- a/"):].strip().decode("utf-8")
        if name not in FILES or name in output or pos + 1 >= len(patch_lines):
            raise ValueError(f"Unexpected or duplicate patch target: {name}")
        if patch_lines[pos + 1] != b"+++ b/" + name.encode("utf-8") + b"\n":
            raise ValueError(f"Patch target mismatch for {name}")
        source = files[name].replace(b"\r\n", b"\n").splitlines(keepends=True)
        pos += 2
        cursor = 0
        result = []
        saw_hunk = False
        while pos < len(patch_lines) and patch_lines[pos].startswith(b"@@ "):
            saw_hunk = True
            m = re.match(rb"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", patch_lines[pos])
            if not m:
                raise ValueError(f"Invalid hunk header in {name}: {patch_lines[pos]!r}")
            old_start = int(m.group(1))
            old_count = int(m.group(2)) if m.group(2) is not None else 1
            new_start = int(m.group(3))
            new_count = int(m.group(4)) if m.group(4) is not None else 1
            expected_cursor = old_start - 1 if old_start else 0
            if expected_cursor < cursor or expected_cursor > len(source):
                raise ValueError(f"Out-of-order patch hunk in {name}")
            result.extend(source[cursor:expected_cursor])
            cursor = expected_cursor
            if new_start != len(result) + (1 if new_count else 0):
                raise ValueError(f"Unexpected destination line in {name}: {new_start}")
            pos += 1
            consumed = produced = 0
            while pos < len(patch_lines):
                line = patch_lines[pos]
                if line.startswith((b"@@ ", b"--- a/")):
                    break
                if not line or line[:1] not in (b" ", b"-", b"+"):
                    raise ValueError(f"Unsupported unified diff syntax in {name} line {pos + 1}")
                marker, body = line[:1], line[1:]
                if marker in (b" ", b"-"):
                    if cursor >= len(source) or source[cursor] != body:
                        raise ValueError(f"Patch context mismatch in {name}, source line {cursor + 1}")
                    cursor += 1
                    consumed += 1
                if marker in (b" ", b"+"):
                    result.append(body)
                    produced += 1
                pos += 1
            if consumed != old_count or produced != new_count:
                raise ValueError(f"Patch line count mismatch in {name}: {consumed}/{old_count}, {produced}/{new_count}")
        if not saw_hunk:
            raise ValueError(f"Patch has no hunks for {name}")
        result.extend(source[cursor:])
        output[name] = b"".join(result)
    if set(output) != set(FILES):
        raise ValueError("Patch does not modify exactly the expected two files")
    return output

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
    if not shutil.which("node"):
        raise RuntimeError("Node.js is required for JavaScript syntax and smoke tests")

    # Test in isolation before changing either file in the extension directory.
    with tempfile.TemporaryDirectory(prefix="wm-adaptive-") as temp:
        stage = Path(temp)
        for name in FILES:
            (stage / name).write_bytes(sources[name].replace(b"\r\n", b"\n"))
        shutil.copy2(test, stage / test.name)
        # Apply line-by-line in Python to avoid Git for Windows core.autocrlf.
        patched = apply_unified_patch(sources, patch.read_bytes())
        for name in FILES:
            (stage / name).write_bytes(patched[name])
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
