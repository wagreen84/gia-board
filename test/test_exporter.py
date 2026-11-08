#!/usr/bin/env python3
"""Public exporter: periods pass through, early months do not, private fields do not."""
import json, os, shutil, subprocess, sys, tempfile, unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "exporter", "gen_site.py")
PUBLIC = json.load(open(os.path.join(ROOT, "data.json")))
LEGACY = json.load(open(os.path.join(ROOT, "test", "legacy-public.json")))

FORBIDDEN_KEYS = {
    "client", "premium", "basis", "file", "token", "slack", "email", "phone",
    "comp", "daily", "unpricedItems", "rate2026", "quoted", "fileFlags", "noteText",
}

def walk_keys(node, found):
    if isinstance(node, dict):
        for k, v in node.items():
            found.add(k)
            walk_keys(v, found)
    elif isinstance(node, list):
        for v in node:
            walk_keys(v, found)

def internal_from_public():
    src = json.loads(json.dumps(PUBLIC))
    src["reps"] = ["Bill Green", "Jen Pledger", "Ashley Stensrud"]
    src["goals"] = {r: {"weeklyRevenue": src["goals"][r.split()[0]]} for r in src["reps"]}
    def rename(bucket):
        return {r: bucket[r.split()[0]] for r in src["reps"]}
    src["byRep"] = rename(src["byRep"])
    src["streaks"] = rename(src["streaks"])
    src["crossSell"]["byRep"] = rename(src["crossSell"]["byRep"])
    src["ghl"]["pipeline"] = rename(src["ghl"]["pipeline"])
    src["ghl"]["pipelineNote"] = "NOT REFRESHED: cached from 2026-11-06 17:15 ET; GG Pro/GHL reads are off."
    src["ghl"]["referralNote"] = "no data"
    src["ghl"]["referralAsks"] = {"Bill Green": {"today": 1, "week": 2, "month": 3}}
    src["comp"] = {"mapdNew": 725, "mapdChange": 363, "mapd2026": 696}
    src["daily"] = {"Bill Green": {"2026-11-06": 4}}
    src["fileFlags"] = [{"file": "secret.pdf", "client": "Zelda Quill", "token": "xoxb-test-token"}]
    src["feed"] = [{
        "ts": "2026-11-06 17:59", "rep": "Jen Pledger", "client": "Zelda Quill",
        "bucket": "MAPD", "sub": None, "carrier": "Aetna", "note": "premium 149.51 slack U0123ABCDEF",
        "revenue": 149.51,
    }] + src["feed"][1:]
    src["badges"] = [{
        "reps": ["Bill Green"], "badge": "Goal crusher", "detail": "Hit the $5,000 weekly goal",
    }]
    # Invented January zeros plus one real-looking early month that must fail a separate case.
    src["periods"].insert(0, {
        "key": "m2026-01", "group": "month", "label": "January", "short": "Jan",
        "start": "2026-01-01", "end": "2026-01-31", "final": True, "year": 2026,
    })
    zero = {"clients": 0, "products": 0, "revenue": 0, "unpriced": 0, "mix": {"MAPD": 0, "Med Supp": 0, "ACA": 0, "Other": 0},
            "priced": 0, "needsPremium": 0, "client": "Zelda Quill"}
    src["team"]["m2026-01"] = zero
    for rep in src["reps"]:
        src["byRep"][rep]["m2026-01"] = dict(zero)
    return src

def write_box(src, ledger_rows):
    d = tempfile.mkdtemp(prefix="gia-export-")
    json.dump(src, open(os.path.join(d, "data.json"), "w"))
    with open(os.path.join(d, "sales_ledger.csv"), "w") as f:
        f.write("display,first,last\n")
        for row in ledger_rows:
            f.write(",".join(row) + "\n")
    return d

def run(box):
    proc = subprocess.run([sys.executable, SCRIPT, box], capture_output=True, text=True)
    return proc

class ExporterTests(unittest.TestCase):
    def test_pass_through_strips_private_fields_and_early_zeros(self):
        box = write_box(internal_from_public(), [("Zelda Quill", "Zelda", "Quill"), ("Esther Karanja", "Esther", "Karanja")])
        try:
            proc = run(box)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            out = json.load(open(os.path.join(box, "site", "data.json")))
            self.assertEqual(out["team"]["lastMonth"]["clients"], 137)
            self.assertEqual(out["team"]["lastMonth"]["revenue"], 64236)
            self.assertEqual(out["team"]["m2026-10"]["revenue"], 64236)
            self.assertEqual(out["team"]["m2026-10"]["clients"], 137)
            self.assertEqual(out["team"]["aep"]["revenue"], LEGACY["team"]["aep"]["revenue"])
            self.assertEqual(out["team"]["week"]["clients"], 38)
            self.assertNotIn("m2026-01", out["team"])
            self.assertFalse(any(p["key"] == "m2026-01" for p in out["periods"]))
            self.assertEqual(out["reps"], ["Bill", "Jen", "Ashley"])
            self.assertEqual(out["goals"]["Bill"], 5000)
            self.assertTrue(out["ghl"]["stale"])
            self.assertIsNone(out["ghl"]["referralAsks"])
            self.assertNotIn("pipelineNote", out["ghl"])
            self.assertEqual(out["feed"][0]["rep"], "Jen")
            self.assertNotIn("client", out["feed"][0])
            self.assertEqual(out["history"]["since"], "2026-10-01")
            self.assertEqual(out["archive"], {"source": "google-sheets", "status": "not-connected"})
            blob = json.dumps(out)
            for secret in ("Zelda", "Quill", "Karanja", "xoxb-", "U0123ABCDEF", "149.51", "secret.pdf", "Esther"):
                self.assertNotIn(secret, blob)
            keys = set()
            walk_keys(out, keys)
            self.assertTrue(FORBIDDEN_KEYS.isdisjoint(keys), FORBIDDEN_KEYS & keys)
            for agg in out["team"].values():
                self.assertEqual(set(agg), {"clients", "products", "revenue", "unpriced", "mix"})
        finally:
            shutil.rmtree(box)

    def test_nonzero_january_refuses_the_build(self):
        src = internal_from_public()
        src["team"]["m2026-01"]["clients"] = 4
        src["team"]["m2026-01"]["revenue"] = 100
        box = write_box(src, [("Zelda Quill", "Zelda", "Quill")])
        try:
            proc = run(box)
            self.assertNotEqual(proc.returncode, 0)
            self.assertIn("m2026-01", proc.stderr + str(proc.returncode))
            self.assertFalse(os.path.exists(os.path.join(box, "site", "data.json")))
        finally:
            shutil.rmtree(box)

    def test_legacy_source_without_periods_still_publishes_the_five_buckets(self):
        src = json.loads(json.dumps(LEGACY))
        src["goals"] = {r: {"weeklyRevenue": src["goals"][r]} for r in src["reps"]}
        box = write_box(src, [("Zelda Quill", "Zelda", "Quill")])
        try:
            proc = run(box)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            out = json.load(open(os.path.join(box, "site", "data.json")))
            self.assertEqual(set(out["team"]), {"today", "week", "month", "lastMonth", "aep"})
            self.assertEqual(out["team"]["lastMonth"]["revenue"], 64236)
            self.assertEqual(out["periods"], [])
            self.assertEqual(out["history"]["since"], "2026-10-01")
            self.assertTrue(out["ghl"]["stale"])
        finally:
            shutil.rmtree(box)

if __name__ == "__main__":
    unittest.main()
