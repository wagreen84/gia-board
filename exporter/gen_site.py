#!/usr/bin/env python3
"""Build site/data.json (public, privacy-safe) from the internal data.json.

Whitelist only. The public file keeps aggregated counts and totals plus the
existing sanitized feed (first name, product bucket, carrier, timestamp).
It never includes client names, Slack IDs, tokens, premiums, application
files, or comp-rate notes.

Period contract (already produced by the page exporter build_data.py):

  periods[]: {key, group, label, short, start, end, final, year?}
    group month        closed month, key mYYYY-MM, label is the month name
    group week         Monday-Sunday clipped to the month, key wYYYY-MM-DD
                       (the clipped start). Started weeks only.
    group monthToDate  current month total, key "month"
    group aep          key "aep", label "AEP {season year} (Oct 15–Dec 7)"
  team / byRep / carriers / crossSell also still include the legacy keys
    today, week, month, lastMonth, aep
  history.since       first day with sales. Default 2026-10-01.
  archive             {source: "google-sheets", status: not-connected|connected|error}
                      No spreadsheet id and no credentials.

Months before history.since are not published. Zero-filled 2026-01..2026-09
keys are dropped. A pre-history month that already has clients or revenue
fails the build instead of being rewritten as zero.

GG Pro / GHL pipeline counts stay only as a stale snapshot. referralAsks
are not published. This script does not read Sheets and does not write to
Slack, GHL, or any other source system.

Run from the box directory that holds data.json and sales_ledger.csv:

  python3 gen_site.py
  python3 gen_site.py /path/to/box
"""
import json, sys, csv, re, os

D = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
HISTORY_FLOOR = "2026-10-01"
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
STAMP = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$")
KEY_RE = re.compile(r"^(today|week|month|lastMonth|aep|m\d{4}-\d{2}|w\d{4}-\d{2}-\d{2})$")
GROUPS = {"month", "week", "monthToDate", "aep", "today"}
LEGACY = ("today", "week", "month", "lastMonth", "aep")
MIX_KEYS = ("MAPD", "Med Supp", "ACA", "Other")
EARLY_2026 = re.compile(r"^m2026-0[1-9]$")
FORBIDDEN = (
    re.compile(r"xox[bpa]-"),
    re.compile(r"gh[opsu]_"),
    re.compile(r"\bC0[0-9A-Z]{8,}\b"),
    re.compile(r"\bU0[0-9A-Z]{8,}\b"),
    re.compile(r"pit-"),
    re.compile(r"@"),
)
AGG_FIELDS = ("clients", "products", "revenue", "unpriced", "mix")

def num(x):
    return int(round(float(x)))

def agg(a):
    if not isinstance(a, dict) or any(k not in a for k in ("clients", "products", "revenue", "unpriced", "mix")):
        raise SystemExit("aggregate is missing clients/products/revenue/unpriced/mix")
    mix = a["mix"] if isinstance(a["mix"], dict) else {}
    if any(k not in mix for k in MIX_KEYS):
        raise SystemExit("mix is missing a product bucket")
    return {
        "clients": num(a["clients"]), "products": num(a["products"]),
        "revenue": num(a["revenue"]), "unpriced": num(a["unpriced"]),
        "mix": {k: num(mix[k]) for k in MIX_KEYS},
    }

def xs(x):
    pct = x.get("pct")
    return {"clients": int(x["clients"]), "multi": int(x["multi"]), "pct": (int(pct) if pct is not None else None)}

def first(name):
    return str(name).split()[0]

def goal_of(g):
    if g is None:
        return None
    if isinstance(g, dict):
        return num(g["weeklyRevenue"]) if g.get("weeklyRevenue") is not None else None
    return num(g)

def implied_start(p):
    key = p.get("key") or ""
    m = re.match(r"^m(\d{4})-(\d{2})$", key)
    if m:
        return "%s-%s-01" % (m.group(1), m.group(2))
    w = re.match(r"^w(\d{4}-\d{2}-\d{2})$", key)
    if w:
        return w.group(1)
    return p.get("start")

def clean_text(value, limit):
    if value is None:
        return ""
    text = str(value).replace("\n", " ").strip()
    if any(p.search(text) for p in FORBIDDEN):
        raise SystemExit("PRIVACY: period label failed the public pattern check")
    return text[:limit]

def clean_period(p, since):
    if not isinstance(p, dict):
        return None
    key = p.get("key")
    group = p.get("group")
    if not KEY_RE.match(key or "") or group not in GROUPS:
        return None
    start, end = p.get("start"), p.get("end")
    if not (isinstance(start, str) and isinstance(end, str) and DATE.match(start) and DATE.match(end)):
        return None
    if end < start:
        return None
    if group in ("month", "week", "monthToDate"):
        gate = implied_start(p) or start
        if gate < since or EARLY_2026.match(key):
            return "drop"
    if group == "aep" and end < since:
        return "drop"
    year = p.get("year")
    if not isinstance(year, int):
        hit = re.search(r"AEP\s+(\d{4})", str(p.get("label") or ""))
        year = int(hit.group(1)) if (group == "aep" and hit) else int(start[:4])
    return {
        "key": key, "group": group,
        "label": clean_text(p.get("label") or key, 80),
        "short": clean_text(p.get("short") or key, 40),
        "start": start, "end": end, "final": bool(p.get("final")), "year": year,
    }

def carriers_of(rows):
    out = []
    for row in rows or []:
        if not isinstance(row, (list, tuple)) or len(row) < 2:
            continue
        name = clean_text(row[0], 60)
        if not name:
            continue
        out.append([name, num(row[1])])
    return out[:12]

def ghl_out(g):
    if not g:
        return None
    stale = g.get("stale") is not False
    note_src = str(g.get("pipelineNote") or "")
    if "NOT REFRESHED" in note_src or "reads are off" in note_src.lower():
        stale = True
    as_of = g.get("asOf") if isinstance(g.get("asOf"), str) and STAMP.match(g["asOf"]) else None
    pipe = {}
    for rep, vals in (g.get("pipeline") or {}).items():
        vals = vals or {}
        pipe[first(rep)] = {k: num(vals.get(k) or 0) for k in ("new", "won", "lost", "closed")}
    out = {
        "weekStart": g.get("weekStart"),
        "ok": bool(g.get("ok")),
        "stale": stale,
        "pipeline": pipe,
        "referralAsks": None,
    }
    if as_of:
        out["asOf"] = as_of
    if stale:
        out["note"] = "Stale snapshot. Pipeline reads from GG Pro are off."
    return out

def sub_of(value):
    if not value or not isinstance(value, str):
        return None
    text = value.strip()
    if not text or len(text) > 40 or any(p.search(text) for p in FORBIDDEN):
        return None
    return text

def main():
    src = os.path.join(D, "data.json")
    ledger = os.path.join(D, "sales_ledger.csv")
    d = json.load(open(src))
    since = d.get("history", {}).get("since") if isinstance(d.get("history"), dict) else None
    if not (isinstance(since, str) and DATE.match(since)):
        since = HISTORY_FLOOR
    raw_periods = d.get("periods") if isinstance(d.get("periods"), list) else []
    kept, dropped = [], []
    for p in raw_periods:
        cleaned = clean_period(p, since)
        if cleaned == "drop":
            dropped.append(p.get("key"))
        elif cleaned:
            kept.append(cleaned)
    for key in dropped:
        block = (d.get("team") or {}).get(key) or {}
        if EARLY_2026.match(key or "") and (num(block.get("clients") or 0) or num(block.get("revenue") or 0)):
            raise SystemExit("HISTORY: refusing non-zero %s; sales history starts %s" % (key, since))
        if key and not EARLY_2026.match(key):
            gate = None
            for p in raw_periods:
                if p.get("key") == key:
                    gate = implied_start(p) or p.get("start")
            block_clients = num(block.get("clients") or 0) or num(block.get("revenue") or 0)
            if block_clients and gate and gate < since:
                raise SystemExit("HISTORY: refusing non-zero %s before %s" % (key, since))
    for mm in range(1, 10):
        key = "m2026-%02d" % mm
        if key in (d.get("team") or {}) and key not in dropped and not any(p["key"] == key for p in kept):
            block = d["team"][key]
            if num(block.get("clients") or 0) or num(block.get("revenue") or 0):
                raise SystemExit("HISTORY: refusing non-zero %s" % key)
            dropped.append(key)

    keys = []
    for key in list(LEGACY) + [p["key"] for p in kept]:
        if key not in keys and key not in dropped and KEY_RE.match(key):
            keys.append(key)

    def take(bucket, key, kind):
        if not isinstance(bucket, dict) or key not in bucket:
            return None
        if kind == "agg":
            return agg(bucket[key])
        if kind == "xs":
            return xs(bucket[key])
        if kind == "carriers":
            return carriers_of(bucket[key])
        raise SystemExit("unknown bucket")

    team, carriers = {}, {}
    cross_team = {}
    by_rep, cross_rep = {}, {}
    for key in keys:
        got = take(d.get("team") or {}, key, "agg")
        if got is None:
            continue
        team[key] = got
        if key in (d.get("carriers") or {}):
            carriers[key] = take(d["carriers"], key, "carriers")
        if d.get("crossSell") and key in (d["crossSell"].get("team") or {}):
            cross_team[key] = take(d["crossSell"]["team"], key, "xs")
    for rep, vals in (d.get("byRep") or {}).items():
        name = first(rep)
        by_rep[name] = {}
        for key in team:
            got = take(vals, key, "agg")
            if got is not None:
                by_rep[name][key] = got
    if d.get("crossSell"):
        for rep, vals in (d["crossSell"].get("byRep") or {}).items():
            name = first(rep)
            cross_rep[name] = {}
            for key in cross_team:
                got = take(vals, key, "xs")
                if got is not None:
                    cross_rep[name][key] = got
    periods = [p for p in kept if p["key"] in team]
    archive = d.get("archive") if isinstance(d.get("archive"), dict) else {}
    status = archive.get("status")
    if status not in ("not-connected", "connected", "error"):
        status = "not-connected"
    out = {
        "updated": d["updated"], "asOf": d["asOf"], "weekStart": d["weekStart"],
        "lastSaleTs": d.get("lastSaleTs"),
        "reps": [first(r) for r in d["reps"]],
        "goals": {first(r): goal_of(g) for r, g in (d.get("goals") or {}).items()},
        "team": team,
        "byRep": by_rep,
        "carriers": carriers,
        "streaks": {first(r): {"current": s["current"], "best": s["best"]} for r, s in (d.get("streaks") or {}).items()},
        "badges": [{"reps": [first(r) for r in b["reps"]], "badge": b["badge"], "detail": b["detail"]} for b in d.get("badges") or []],
        "crossSell": ({"team": cross_team, "byRep": cross_rep} if d.get("crossSell") else None),
        "periodLabels": {k: str(v) for k, v in (d.get("periodLabels") or {}).items()},
        "periods": periods,
        "history": {"since": since},
        "archive": {"source": "google-sheets", "status": status},
        "ghl": ghl_out(d.get("ghl")),
        "feed": [{"ts": f["ts"], "rep": first(f["rep"]), "bucket": f["bucket"], "sub": sub_of(f.get("sub")), "carrier": f["carrier"]}
                 for f in d.get("feed") or []][:15],
    }
    for mm in range(1, 10):
        key = "m2026-%02d" % mm
        if key in out["team"] or any(p["key"] == key for p in out["periods"]):
            raise SystemExit("HISTORY: refused to publish " + key)
    s = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    bad = set()
    if os.path.exists(ledger):
        for row in csv.DictReader(open(ledger)):
            for k in ("display", "first", "last"):
                v = (row.get(k) or "").strip()
                if len(v) >= 3 and v.lower() not in {x.lower() for x in out["reps"]} and re.search(r"(?<![A-Za-z])" + re.escape(v) + r"(?![A-Za-z])", s, re.I):
                    bad.add(v)
    else:
        raise SystemExit("PRIVACY: sales_ledger.csv is required so client names can be checked")
    if bad:
        raise SystemExit("PRIVACY: client name(s) found in public data: " + ", ".join(sorted(bad)))
    for pat in FORBIDDEN:
        if pat.search(s):
            raise SystemExit("PRIVACY: forbidden pattern " + pat.pattern)
    dest_dir = os.path.join(D, "site")
    os.makedirs(dest_dir, exist_ok=True)
    open(os.path.join(dest_dir, "data.json"), "w").write(s + "\n")

if __name__ == "__main__":
    main()
