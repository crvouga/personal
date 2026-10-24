#!/usr/bin/env python3
"""Run isolated provider contracts concurrently without sharing writable caches."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import threading


ROOT = Path(__file__).resolve().parents[1]


def run_contracts(names, root=ROOT, workers=3):
    if not names or workers < 1:
        raise ValueError("select contracts and a positive worker count")
    for name in names:
        if not name.replace("-", "").isalnum() or not (root / "tests" / f"{name}.py").is_file():
            raise ValueError(f"unknown contract: {name}")
    source = os.environ.get("TF_PLUGIN_CACHE_DIR")
    shared = Path(source).resolve() if source else None
    failed = []
    caches = []
    local = threading.local()
    with tempfile.TemporaryDirectory(prefix="tofu-contract-workers-") as directory:
        def execute(name):
            if not hasattr(local, "cache"):
                local.cache = Path(tempfile.mkdtemp(prefix="providers-", dir=directory))
                if shared and shared.is_dir():
                    shutil.copytree(shared, local.cache, dirs_exist_ok=True)
                caches.append(local.cache)
            env = {**os.environ, "TF_PLUGIN_CACHE_DIR": str(local.cache)}
            env.pop("TF_DATA_DIR", None)
            return subprocess.run([sys.executable, str(root / "tests" / f"{name}.py")],
                                  cwd=root, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            pending = {pool.submit(execute, name): name for name in names}
            for future in as_completed(pending):
                name = pending[future]
                try:
                    result = future.result()
                    print(f"\n--- OpenTofu contract {name} ---\n{result.stdout}", flush=True)
                    if result.returncode:
                        failed.append(name)
                except Exception as error:
                    print(f"{name}: {error}", file=sys.stderr, flush=True)
                    failed.append(name)
        # Only provider binaries are merged, after all workers have stopped.
        # No state, plans, credentials, backend metadata or tfvars are cached.
        if shared and not failed:
            shared.mkdir(parents=True, exist_ok=True)
            for cache in caches:
                for path in cache.rglob("*"):
                    if path.is_file():
                        target = shared / path.relative_to(cache)
                        if not target.exists():
                            target.parent.mkdir(parents=True, exist_ok=True)
                            shutil.copy2(path, target)
    if failed:
        print(f"FAILED OpenTofu contracts: {', '.join(sorted(failed))}", file=sys.stderr, flush=True)
    return int(bool(failed))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("contracts", nargs="+")
    parser.add_argument("--workers", type=int, default=3)
    args = parser.parse_args()
    sys.exit(run_contracts(args.contracts, workers=args.workers))
