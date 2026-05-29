#!/usr/bin/env python3
"""Convert SAP-C02 PDF question dumps into dashboard JSON import format.

Usage:
  python scripts/parse_sap_c02_pdf.py /path/to/SAP-C02.pdf --limit 10 --output reports/sap-c02-preview-10.json

Requires:
  pip install pypdf
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

try:
    from pypdf import PdfReader
except ImportError:
    print("Missing dependency: pypdf. Install with: pip install pypdf", file=sys.stderr)
    raise

QUESTION_RE = re.compile(r"Topic\s+(?P<topic>\d+)\s*Question\s*#(?P<number>\d+)", re.IGNORECASE)
ANSWER_RE = re.compile(r"Correct\s+Answer\s*:\s*(?P<answer>[A-F](?:\s*,?\s*[A-F])*)", re.IGNORECASE)
COMMUNITY_VOTE_RE = re.compile(r"Community\s+vote\s+distribution(?P<votes>.*?)(?=Topic\s+\d+\s*Question\s*#\d+|--- PAGE|$)", re.IGNORECASE | re.DOTALL)
VOTE_ITEM_RE = re.compile(r"(?P<answer>[A-F]{1,6})\s*\((?P<percent>\d+(?:\.\d+)?)%\)")
OPTION_RE = re.compile(r"(?m)(?:^|\n)\s*(?P<key>[A-F])\.\s+")


def normalize_text(text: str) -> str:
    text = text.replace("\u00a0", " ")
    text = text.replace("ﬁ", "fi").replace("ﬂ", "fl")
    # Some embedded fonts extract fi/fl ligatures as a NUL inserted between surrounding letters.
    # Dropping NUL preserves words such as Config/significantly better than guessing glyphs globally.
    text = text.replace("\x00", "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    # Remove common icon/control glyphs found in extracted ExamTopics PDFs.
    text = re.sub(r"[]", "", text)
    # Keep line boundaries, but remove excessive trailing spaces.
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    return text


def extract_pdf_text(pdf_path: Path, max_pages: Optional[int] = None) -> str:
    reader = PdfReader(str(pdf_path))
    pages = reader.pages[:max_pages] if max_pages else reader.pages
    chunks: List[str] = []
    for index, page in enumerate(pages, start=1):
        page_text = page.extract_text() or ""
        chunks.append(f"\n--- PAGE {index} ---\n{page_text}")
    return normalize_text("\n".join(chunks))


def split_question_blocks(text: str) -> List[Tuple[re.Match[str], str]]:
    matches = list(QUESTION_RE.finditer(text))
    blocks: List[Tuple[re.Match[str], str]] = []
    for i, match in enumerate(matches):
        start = match.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        blocks.append((match, text[start:end].strip()))
    return blocks


def clean_field(value: str) -> str:
    value = re.sub(r"\n{3,}", "\n\n", value.strip())
    # Join PDF-wrapped lines inside one option/stem while preserving paragraph breaks.
    value = re.sub(r"(?<!\n)\n(?!\n)", " ", value)
    value = re.sub(r"[ \t]{2,}", " ", value)
    return value.strip()


def parse_community_vote_answer(block: str) -> Optional[str]:
    match = COMMUNITY_VOTE_RE.search(block)
    if not match:
        return None
    votes = []
    for item in VOTE_ITEM_RE.finditer(match.group("votes")):
        answer = item.group("answer").upper()
        percent = float(item.group("percent"))
        votes.append((percent, answer))
    if not votes:
        return None
    votes.sort(key=lambda item: (-item[0], item[1]))
    return votes[0][1]


def parse_options(pre_answer: str) -> Tuple[str, Dict[str, str]]:
    option_matches = list(OPTION_RE.finditer(pre_answer))
    if not option_matches:
        return clean_field(pre_answer), {}

    stem = clean_field(pre_answer[: option_matches[0].start()])
    options: Dict[str, str] = {}
    for i, match in enumerate(option_matches):
        key = match.group("key").upper()
        value_start = match.end()
        value_end = option_matches[i + 1].start() if i + 1 < len(option_matches) else len(pre_answer)
        value = clean_field(pre_answer[value_start:value_end])
        if value:
            options[key] = value
    return stem, options


def parse_question(match: re.Match[str], block: str) -> Optional[dict]:
    answer_match = ANSWER_RE.search(block)
    if not answer_match:
        return None

    topic = match.group("topic")
    number = match.group("number")
    pre_answer = block[len(match.group(0)) : answer_match.start()].strip()
    correct_answer = re.sub(r"[^A-F]", "", answer_match.group("answer").upper())
    community_answer = parse_community_vote_answer(block)
    answer = community_answer or correct_answer
    stem, options = parse_options(pre_answer)

    if not stem or len(options) < 2 or not answer:
        return None

    return {
        "examCode": "SAP-C02",
        "source": "pdf",
        "sourceUrl": "local:/Users/liuzelin/Downloads/SAP-C02.pdf",
        "sourceQuestionNo": number,
        "sourceTopic": f"Topic {topic}",
        "stem": stem,
        "options": options,
        "sourceAnswer": answer,
        "explanation": f"Source answer from community vote distribution: {community_answer}" if community_answer else f"Source answer from Correct Answer: {correct_answer}",
        "tags": ["pdf-import", "examtopics"],
    }


def parse_pdf(pdf_path: Path, limit: Optional[int] = None, max_pages: Optional[int] = None) -> List[dict]:
    text = extract_pdf_text(pdf_path, max_pages=max_pages)
    items: List[dict] = []
    for match, block in split_question_blocks(text):
        item = parse_question(match, block)
        if item:
            items.append(item)
            if limit and len(items) >= limit:
                break
    return items


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--max-pages", type=int, default=None)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    items = parse_pdf(args.pdf, limit=args.limit, max_pages=args.max_pages)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"parsed={len(items)} output={args.output}")
    if items:
        print(f"first=#{items[0]['sourceQuestionNo']} options={','.join(items[0]['options'].keys())} answer={items[0]['sourceAnswer']}")
        print(f"last=#{items[-1]['sourceQuestionNo']} options={','.join(items[-1]['options'].keys())} answer={items[-1]['sourceAnswer']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
