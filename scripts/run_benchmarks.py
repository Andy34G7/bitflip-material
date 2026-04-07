from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import subprocess
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean
from typing import Dict, List


DATASETS: Dict[str, bytes] = {
    "small_repetitive": ("ABRACADABRA " * 300).encode("utf-8"),
    "text_mixed": (
        "Lossless compression must preserve every byte. "
        "This benchmark mixes repeated and unique patterns. "
    ).encode("utf-8")
    * 200,
    "json_like": (
        "{\"id\":7,\"active\":true,\"roles\":[\"reader\",\"admin\"]}\n"
    ).encode("utf-8")
    * 300,
}


@dataclass
class SubmissionConfig:
    name: str
    repo: str
    branch: str
    module: str
    class_name: str


def load_submissions(path: Path) -> List[SubmissionConfig]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    rows: List[SubmissionConfig] = []
    for item in raw:
        rows.append(
            SubmissionConfig(
                name=item["name"],
                repo=item["repo"],
                branch=item.get("branch", "main"),
                module=item.get("module", "compressor.py"),
                class_name=item.get("class", "Compressor"),
            )
        )
    return rows


def clone_repo(repo_url: str, branch: str, target: Path) -> None:
    subprocess.run(
        [
            "git",
            "clone",
            "--depth",
            "1",
            "--branch",
            branch,
            repo_url,
            str(target),
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )


def load_compressor(repo_dir: Path, module_rel: str, class_name: str):
    module_path = repo_dir / module_rel
    if not module_path.exists():
        raise FileNotFoundError(f"Missing module: {module_rel}")

    spec = importlib.util.spec_from_file_location("submission_module", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load module from {module_rel}")

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    klass = getattr(module, class_name, None)
    if klass is None:
        raise AttributeError(f"Missing class '{class_name}' in {module_rel}")

    instance = klass()
    if not hasattr(instance, "compress") or not hasattr(instance, "decompress"):
        raise TypeError("Compressor must define compress(data) and decompress(blob)")

    return instance


def evaluate(submission: SubmissionConfig) -> dict:
    with tempfile.TemporaryDirectory(prefix="submission-repo-") as tmp:
        repo_dir = Path(tmp) / "repo"

        try:
            clone_repo(submission.repo, submission.branch, repo_dir)
            compressor = load_compressor(repo_dir, submission.module, submission.class_name)
        except Exception as exc:
            return {
                "name": submission.name,
                "status": "error",
                "error": f"setup failed: {exc}",
                "avg_ratio": None,
                "avg_runtime_ms": None,
                "results": [],
            }

        per_dataset = []
        for ds_name, raw in DATASETS.items():
            started = time.perf_counter()
            try:
                compressed = compressor.compress(raw)
                restored = compressor.decompress(compressed)
            except Exception as exc:
                return {
                    "name": submission.name,
                    "status": "error",
                    "error": f"runtime failed on {ds_name}: {exc}",
                    "avg_ratio": None,
                    "avg_runtime_ms": None,
                    "results": per_dataset,
                }

            elapsed_ms = (time.perf_counter() - started) * 1000.0
            if restored != raw:
                return {
                    "name": submission.name,
                    "status": "error",
                    "error": f"lossless check failed on {ds_name}",
                    "avg_ratio": None,
                    "avg_runtime_ms": None,
                    "results": per_dataset,
                }

            raw_size = len(raw)
            compressed_size = len(compressed)
            ratio = compressed_size / raw_size if raw_size else 1.0

            per_dataset.append(
                {
                    "dataset": ds_name,
                    "raw_size": raw_size,
                    "compressed_size": compressed_size,
                    "ratio": round(ratio, 6),
                    "runtime_ms": round(elapsed_ms, 3),
                }
            )

        avg_ratio = round(mean([r["ratio"] for r in per_dataset]), 6)
        avg_runtime = round(mean([r["runtime_ms"] for r in per_dataset]), 3)

        return {
            "name": submission.name,
            "status": "ok",
            "error": "",
            "avg_ratio": avg_ratio,
            "avg_runtime_ms": avg_runtime,
            "results": per_dataset,
        }


def rank_rows(rows: List[dict]) -> List[dict]:
    ok_rows = [r for r in rows if r["status"] == "ok"]
    bad_rows = [r for r in rows if r["status"] != "ok"]

    # Primary key: compression ratio, tie-breaker: runtime.
    ok_rows.sort(key=lambda r: (r["avg_ratio"], r["avg_runtime_ms"]))

    ranked = []
    for i, row in enumerate(ok_rows, start=1):
        ranked.append({**row, "rank": i})
    for row in bad_rows:
        ranked.append({**row, "rank": None})

    return ranked


def write_output(out_path: Path, rows: List[dict]) -> None:
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "metric": "lower avg_ratio is better; avg_runtime_ms is tie-breaker",
        "datasets": list(DATASETS.keys()),
        "leaderboard": rank_rows(rows),
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run compressor benchmarks from repository submissions")
    parser.add_argument("--submissions", default="submissions.json", help="Path to submissions manifest")
    parser.add_argument("--out", default="docs/leaderboard.json", help="Leaderboard output path")
    parser.add_argument(
        "--mirror-root",
        default="leaderboard.json",
        help="Optional second output path for root copy",
    )
    args = parser.parse_args()

    submissions = load_submissions(Path(args.submissions))
    rows = [evaluate(s) for s in submissions]

    out = Path(args.out)
    write_output(out, rows)

    mirror = Path(args.mirror_root)
    if mirror:
        shutil.copyfile(out, mirror)

    print(f"Wrote leaderboard for {len(submissions)} submissions to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
