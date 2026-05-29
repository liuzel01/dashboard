#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, List


def extract_json_array(raw: str) -> list[dict[str, Any]]:
    raw = raw.strip()
    try:
        data = json.loads(raw)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for key in ("response", "text", "content", "output"):
                if isinstance(data.get(key), str):
                    return extract_json_array(data[key])
            for value in data.values():
                if isinstance(value, list):
                    return value
    except Exception:
        pass

    text = re.sub(r"^```(?:json)?\s*", "", raw)
    text = re.sub(r"\s*```$", "", text)
    match = re.search(r"\[.*\]", text, flags=re.S)
    if not match:
        raise ValueError(f"No JSON array found in Gemini output: {raw[:500]}")
    return json.loads(match.group(0))


def build_prompt(batch: list[dict[str, Any]]) -> str:
    return """You are translating AWS Certified Solutions Architect - Professional SAP-C02 practice questions for personal study.

Task: Translate the JSON array from English to Simplified Chinese and output ONLY valid JSON array. No markdown, no comments.

Rules:
- Preserve all JSON keys and array length.
- Translate only: stem, options values.
- Do NOT translate AWS service names/product names/acronyms: Amazon Route 53, VPC, AWS Transit Gateway, API Gateway, Lambda, DynamoDB, ALB, Aurora, SCP, OU, AWS Config, CloudFront, S3, IAM, etc.
- Keep option keys A/B/C/D/E/F unchanged.
- Keep sourceAnswer unchanged.
- Change source to "pdf-zh".
- Keep sourceQuestionNo/sourceTopic/sourceUrl unchanged.
- Keep explanation unchanged.
- Set tags to ["pdf-import", "examtopics", "zh"].
- Preserve technical precision; prefer natural Chinese but leave AWS architecture terminology clear.
- Fix obvious PDF extraction artifacts while translating when context is clear, e.g. "Cong" means "AWS Config" in AWS Config context, "congure/congured" means "configure/configured", "trac" means "traffic", "les" means "files", "eet" means "fleet".
- Return strict JSON parseable by JSON.parse.

Input JSON:
""" + json.dumps(batch, ensure_ascii=False, indent=2)


def validate_batch(src: list[dict[str, Any]], out: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(src) != len(out):
        raise ValueError(f"batch length mismatch: src={len(src)} out={len(out)}")
    normalized = []
    for src_item, out_item in zip(src, out):
        item = dict(src_item)
        item.update(out_item)
        item["source"] = "pdf-zh"
        item["sourceAnswer"] = src_item["sourceAnswer"]
        item["sourceQuestionNo"] = src_item["sourceQuestionNo"]
        item["sourceTopic"] = src_item["sourceTopic"]
        item["sourceUrl"] = src_item.get("sourceUrl")
        item["explanation"] = src_item.get("explanation")
        item["tags"] = ["pdf-import", "examtopics", "zh"]
        if not isinstance(item.get("options"), dict) or set(item["options"].keys()) != set(src_item["options"].keys()):
            raise ValueError(f"options keys mismatch for #{src_item['sourceQuestionNo']}")
        if not isinstance(item.get("stem"), str) or not item["stem"].strip():
            raise ValueError(f"empty stem for #{src_item['sourceQuestionNo']}")
        normalized.append(item)
    return normalized


def run_gemini(prompt: str, model: str | None, timeout: int) -> str:
    cmd = ["gemini", "--output-format", "json"]
    if model:
        cmd.extend(["--model", model])
    cmd.append(prompt)
    proc = subprocess.run(cmd, text=True, capture_output=True, timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(f"gemini failed rc={proc.returncode}\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}")
    return proc.stdout


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="reports/sap-c02-import-all.json")
    ap.add_argument("--output", default="reports/sap-c02-zh-import-all.json")
    ap.add_argument("--batch-size", type=int, default=10)
    ap.add_argument("--model", default=None)
    ap.add_argument("--timeout", type=int, default=180)
    ap.add_argument("--resume", action="store_true")
    args = ap.parse_args()

    src_path = Path(args.input)
    out_path = Path(args.output)
    batch_dir = out_path.parent / "sap-c02-zh-gemini-batches"
    batch_dir.mkdir(parents=True, exist_ok=True)

    items = json.loads(src_path.read_text(encoding="utf-8"))
    translated: list[dict[str, Any]] = []
    total_batches = (len(items) + args.batch_size - 1) // args.batch_size

    for idx in range(0, len(items), args.batch_size):
        part = idx // args.batch_size + 1
        batch = items[idx : idx + args.batch_size]
        first = batch[0]["sourceQuestionNo"]
        last = batch[-1]["sourceQuestionNo"]
        batch_path = batch_dir / f"batch-{part:03d}-{first}-{last}.json"

        if args.resume and batch_path.exists():
            out_batch = json.loads(batch_path.read_text(encoding="utf-8"))
            print(f"[{part}/{total_batches}] reuse {batch_path}", flush=True)
        else:
            print(f"[{part}/{total_batches}] translating #{first}-#{last}", flush=True)
            prompt = build_prompt(batch)
            last_error = None
            for attempt in range(1, 4):
                try:
                    raw = run_gemini(prompt, args.model, args.timeout)
                    out_batch = validate_batch(batch, extract_json_array(raw))
                    batch_path.write_text(json.dumps(out_batch, ensure_ascii=False, indent=2), encoding="utf-8")
                    break
                except Exception as exc:
                    last_error = exc
                    print(f"  attempt {attempt} failed: {exc}", file=sys.stderr, flush=True)
                    time.sleep(2 * attempt)
            else:
                raise RuntimeError(f"batch {part} failed after retries: {last_error}")
        translated.extend(out_batch)
        out_path.write_text(json.dumps(translated, ensure_ascii=False, indent=2), encoding="utf-8")

    # compact chunks for dashboard import
    chunk_dir = out_path.parent / "sap-c02-zh-import-chunks-compact"
    chunk_dir.mkdir(parents=True, exist_ok=True)
    for old in chunk_dir.glob("sap-c02-zh-import-*.json"):
        old.unlink()
    for idx in range(0, len(translated), 50):
        chunk = translated[idx : idx + 50]
        part = idx // 50 + 1
        path = chunk_dir / f"sap-c02-zh-import-{part:02d}-{chunk[0]['sourceQuestionNo']}-{chunk[-1]['sourceQuestionNo']}.json"
        path.write_text(json.dumps(chunk, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    print(json.dumps({"items": len(translated), "output": str(out_path), "chunks": str(chunk_dir)}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
