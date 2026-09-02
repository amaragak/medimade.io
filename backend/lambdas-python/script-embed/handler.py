"""
Script Lab embedding Lambda — fastembed + BAAI/bge-small-en-v1.5 (ONNX).

Actions:
  embed: { texts: string[] } -> { embeddings: number[][] }
  search: { queries, catalog, topK? } -> { results }
  embed_store: { items: [{ tagName, variantId, text }] }
    Embed texts and write vectors onto SCRIPT_SEGMENT variant records (async-friendly).
"""
from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

# Layer ships model under /opt/python/model_cache
os.environ.setdefault("FASTEMBED_CACHE_PATH", "/opt/python/model_cache")

_MODEL = None
MODEL_NAME = "BAAI/bge-small-en-v1.5"
SCRIPT_SEGMENT_PK = "SCRIPT_SEGMENT"
SCRIPT_LAB_EMBED_QUEUE_PK = "SCRIPT_LAB_EMBED_QUEUE"
SCRIPT_LAB_EMBED_QUEUE_SK = "pending"


def _embedding_for_dynamo(vec: list[float]) -> list[Decimal]:
    """DynamoDB boto3 resource rejects Python float — use Decimal."""
    return [Decimal(str(x)) for x in vec]


def _embedding_from_dynamo(raw: Any) -> list[float] | None:
    if not isinstance(raw, list) or not raw:
        return None
    out: list[float] = []
    for x in raw:
        try:
            out.append(float(x))
        except (TypeError, ValueError):
            return None
    return out if out else None


def _get_model():
    global _MODEL
    if _MODEL is None:
        # Import text path only — package __init__ also loads ImageEmbedding (needs PIL).
        from fastembed.text import TextEmbedding

        _MODEL = TextEmbedding(model_name=MODEL_NAME)
    return _MODEL


def _embed_texts(texts: list[str]) -> list[list[float]]:
    model = _get_model()
    cleaned = [(t or "").strip() or " " for t in texts]
    out: list[list[float]] = []
    for vec in model.embed(cleaned):
        out.append([float(x) for x in vec])
    return out


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return float(dot / (math.sqrt(na) * math.sqrt(nb)))


def _handle_embed(body: dict[str, Any]) -> dict[str, Any]:
    texts = body.get("texts") or []
    if not isinstance(texts, list):
        raise ValueError("texts must be a list of strings")
    strs = [str(t) for t in texts][:200]
    return {"embeddings": _embed_texts(strs), "model": MODEL_NAME, "dims": 384}


def _handle_search(body: dict[str, Any]) -> dict[str, Any]:
    queries = body.get("queries") or []
    catalog = body.get("catalog") or []
    top_k = int(body.get("topK") or 10)
    if not isinstance(queries, list) or not isinstance(catalog, list):
        raise ValueError("queries and catalog must be lists")
    q_texts = [str(q.get("text") if isinstance(q, dict) else q) for q in queries][:200]
    q_embs = _embed_texts(q_texts)

    prepared: list[tuple[dict[str, Any], list[float]]] = []
    for row in catalog:
        if not isinstance(row, dict):
            continue
        emb = row.get("embedding")
        vec = _embedding_from_dynamo(emb)
        if vec is None:
            continue
        prepared.append((row, vec))

    results = []
    for qi, qe in enumerate(q_embs):
        scored = []
        for row, ve in prepared:
            score = _cosine(qe, ve)
            scored.append((score, row))
        scored.sort(key=lambda x: x[0], reverse=True)
        matches = []
        for score, row in scored[: max(1, top_k)]:
            matches.append(
                {
                    "id": row.get("id") or row.get("variantId"),
                    "tag": row.get("tag") or row.get("tagName"),
                    "text": row.get("text"),
                    "score": round(score, 6),
                    "lengthTier": row.get("lengthTier"),
                    "direction": row.get("direction"),
                    "source": row.get("source"),
                    "approved": row.get("approved"),
                }
            )
        results.append(
            {
                "queryIndex": qi,
                "embedding": qe,
                "matches": matches,
            }
        )
    return {"results": results, "model": MODEL_NAME, "dims": 384}


def _clear_embed_pending(table_name: str, cleared: list[tuple[str, str]]) -> None:
    if not cleared:
        return
    import boto3

    ddb = boto3.resource("dynamodb").Table(table_name)
    res = ddb.get_item(
        Key={"pk": SCRIPT_LAB_EMBED_QUEUE_PK, "sk": SCRIPT_LAB_EMBED_QUEUE_SK}
    )
    item = res.get("Item")
    if not item:
        return
    pending = item.get("pendingKeys") or []
    if not isinstance(pending, list):
        return
    remove = {f"{tag}#{vid}" for tag, vid in cleared}
    next_pending = [k for k in pending if str(k) not in remove]
    if len(next_pending) == len(pending):
        return
    queued_at = item.get("queuedAt") or {}
    if isinstance(queued_at, dict):
        for key in remove:
            queued_at.pop(key, None)
    else:
        queued_at = {}
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    ddb.put_item(
        Item={
            "pk": SCRIPT_LAB_EMBED_QUEUE_PK,
            "sk": SCRIPT_LAB_EMBED_QUEUE_SK,
            "pendingKeys": next_pending,
            "queuedAt": queued_at,
            "updatedAt": now,
        }
    )


def _handle_embed_store(body: dict[str, Any]) -> dict[str, Any]:
    table_name = (os.environ.get("VOICE_ADMIN_TABLE_NAME") or "").strip()
    if not table_name:
        raise ValueError("VOICE_ADMIN_TABLE_NAME is not set")
    items = body.get("items") or []
    if not isinstance(items, list) or not items:
        return {"updated": 0, "skipped": 0}

    # Group by tag for fewer Dynamo reads/writes
    by_tag: dict[str, list[dict[str, str]]] = {}
    for raw in items[:500]:
        if not isinstance(raw, dict):
            continue
        tag = str(raw.get("tagName") or raw.get("tag") or "").strip().upper()
        vid = str(raw.get("variantId") or raw.get("id") or "").strip()
        text = str(raw.get("text") or "")
        if not tag or not vid or not text.strip():
            continue
        by_tag.setdefault(tag, []).append({"variantId": vid, "text": text})

    if not by_tag:
        return {"updated": 0, "skipped": 0}

    import boto3

    ddb = boto3.resource("dynamodb").Table(table_name)
    # Flatten texts for one embed batch (preserve order)
    flat: list[tuple[str, str, str]] = []
    for tag, rows in by_tag.items():
        for row in rows:
            flat.append((tag, row["variantId"], row["text"]))

    embeddings = _embed_texts([t for (_, _, t) in flat])
    emb_by_key = {
        (tag, vid): emb for (tag, vid, _), emb in zip(flat, embeddings) if emb
    }

    updated = 0
    skipped = 0
    cleared_pending: list[tuple[str, str]] = []
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    for tag, rows in by_tag.items():
        res = ddb.get_item(Key={"pk": SCRIPT_SEGMENT_PK, "sk": tag})
        item = res.get("Item")
        if not item:
            skipped += len(rows)
            continue
        variants = item.get("variants") or []
        if not isinstance(variants, list):
            skipped += len(rows)
            continue
        changed = False
        wanted = {r["variantId"]: emb_by_key.get((tag, r["variantId"])) for r in rows}
        for v in variants:
            if not isinstance(v, dict):
                continue
            vid = str(v.get("id") or "")
            emb = wanted.get(vid)
            if emb is None:
                continue
            v["embedding"] = _embedding_for_dynamo(emb)
            v["updatedAt"] = now
            changed = True
            updated += 1
            cleared_pending.append((tag, vid))
        if changed:
            item["variants"] = variants
            item["updatedAt"] = now
            ddb.put_item(Item=item)

    _clear_embed_pending(table_name, cleared_pending)

    return {"updated": updated, "skipped": skipped, "model": MODEL_NAME, "dims": 384}


def handler(event, _context):
    if isinstance(event, str):
        event = json.loads(event)
    body = event if isinstance(event, dict) else {}
    if "body" in body and isinstance(body["body"], str):
        body = json.loads(body["body"] or "{}")
    action = str(body.get("action") or "embed").strip().lower()
    try:
        if action == "embed":
            result = _handle_embed(body)
        elif action == "search":
            result = _handle_search(body)
        elif action in ("embed_store", "embed-store"):
            result = _handle_embed_store(body)
        else:
            return {"statusCode": 400, "body": json.dumps({"error": f"Unknown action {action}"})}
        return {"ok": True, **result}
    except Exception as e:  # noqa: BLE001 — surface to invoker
        return {"ok": False, "error": str(e)[:2000]}
