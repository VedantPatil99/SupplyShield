#!/usr/bin/env python3
"""
Sanity-checks that the planted anomalies in the generated dataset are
actually detectable by logic equivalent to the Cypher detectors in
SupplyShield_HANDOFF.md section 8. This doesn't require a live Neo4j
instance -- it re-implements the same graph logic directly over the CSV
files as a verification step.

Revised 2026-10-06:
  * abnormal_fanout uses a rolling window (the planted burst crosses midnight)
  * new provenance_gap detector (sender never produced or received the batch)
  * reentrant_distribution narrowed to repeat receipts involving a
    provenance gap and not already a fan-in hit (10 organic repeats exist)
"""
import csv
import json
import os
from collections import Counter, defaultdict
from datetime import datetime, timedelta

FANIN_WINDOW_HOURS = 6
# Works both from the original zip layout (dataset/neo4j) and the repo's data/ (neo4j/)
_HERE = os.path.dirname(os.path.abspath(__file__))
NEO4J_DIR = next(d for d in (os.path.join(_HERE, "dataset", "neo4j"), os.path.join(_HERE, "neo4j")) if os.path.isdir(d))
FANOUT_WINDOW_HOURS = 24
FANOUT_MULTIPLIER = 3


def parse_ts(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ")


with open(os.path.join(NEO4J_DIR, "batches.csv")) as f:
    batches = list(csv.DictReader(f))
with open(os.path.join(NEO4J_DIR, "shipments.csv")) as f:
    shipments = sorted(csv.DictReader(f), key=lambda s: s["dispatch_timestamp"])

print(f"Loaded {len(batches)} batch rows (incl. planted duplicate), {len(shipments)} shipment rows\n")

found = []  # (type, batch_id, discriminator)

# --- [1] multi_manufacturer_batch ---
mfg_by_batch = defaultdict(set)
for b in batches:
    mfg_by_batch[b["batch_id"]].add(b["manufacturer_id"])
print("[1] multi_manufacturer_batch:")
for bid, mfgs in mfg_by_batch.items():
    if len(mfgs) > 1:
        print(f"    FOUND: {bid} produced by {sorted(mfgs)}")
        found.append(("multi_manufacturer_batch", bid, ",".join(sorted(mfgs))))

# --- [2] duplicate_batch_fanin: same batch, same receiver, different
#     senders, dispatched within FANIN_WINDOW_HOURS ---
by_batch_receiver = defaultdict(list)
for s in shipments:
    by_batch_receiver[(s["batch_id"], s["to_entity_id"])].append(s)

print(f"\n[2] duplicate_batch_fanin (senders differ, <{FANIN_WINDOW_HOURS}h apart):")
fanin_pairs = set()
for (bid, receiver), ships in by_batch_receiver.items():
    for i in range(len(ships)):
        for j in range(i + 1, len(ships)):
            s1, s2 = ships[i], ships[j]
            if s1["from_entity_id"] == s2["from_entity_id"]:
                continue
            dt = abs((parse_ts(s1["dispatch_timestamp"]) - parse_ts(s2["dispatch_timestamp"])).total_seconds()) / 3600
            if dt < FANIN_WINDOW_HOURS and (bid, receiver) not in fanin_pairs:
                fanin_pairs.add((bid, receiver))
                print(f"    FOUND: batch={bid} receiver={receiver} senders={s1['from_entity_id']}/{s2['from_entity_id']} gap={dt:.1f}h")
                found.append(("duplicate_batch_fanin", bid, receiver))

# --- [3] abnormal_fanout: rolling-window distinct receivers per sender,
#     vs. baseline = network-average distinct receivers per sender per day ---
receivers_by_sender_day = defaultdict(set)
for s in shipments:
    receivers_by_sender_day[(s["from_entity_id"], s["dispatch_timestamp"][:10])].add(s["to_entity_id"])
baseline = sum(len(v) for v in receivers_by_sender_day.values()) / len(receivers_by_sender_day)
threshold = max(baseline * FANOUT_MULTIPLIER, 5)

by_sender = defaultdict(list)
for s in shipments:
    by_sender[s["from_entity_id"]].append(s)
best = {}
for sender, ships in by_sender.items():
    for s in ships:
        t0 = parse_ts(s["dispatch_timestamp"])
        window = [x for x in ships if t0 <= parse_ts(x["dispatch_timestamp"]) < t0 + timedelta(hours=FANOUT_WINDOW_HOURS)]
        n = len({x["to_entity_id"] for x in window})
        if n > best.get(sender, (0,))[0]:
            best[sender] = (n, s["dispatch_timestamp"], window)

print(f"\n[3] abnormal_fanout (rolling {FANOUT_WINDOW_HOURS}h, baseline={baseline:.2f}/day, threshold={threshold:.2f}):")
for sender, (n, start, window) in sorted(best.items(), key=lambda x: -x[1][0]):
    if n > threshold:
        dominant = Counter(x["batch_id"] for x in window).most_common(1)[0][0]
        print(f"    FOUND: sender={sender} window_start={start} distinct_receivers={n} batch={dominant}")
        found.append(("abnormal_fanout", dominant, sender))
runner_up = sorted((v[0] for v in best.values()), reverse=True)[1]
print(f"    (next-highest sender reaches {runner_up})")

# --- [5] provenance_gap: sender is not the producer and never received the
#     batch before dispatching it (run before [4], which depends on it) ---
producers = mfg_by_batch
gap_ships = []
for s in shipments:
    sender = s["from_entity_id"]
    if sender in producers[s["batch_id"]]:
        continue
    received_before = any(x["dispatch_timestamp"] < s["dispatch_timestamp"]
                          for x in by_batch_receiver[(s["batch_id"], sender)])
    if not received_before:
        gap_ships.append(s)
gap_ids = {s["shipment_id"] for s in gap_ships}
print(f"\n[5] provenance_gap ({len(gap_ships)} shipments):")
for (bid, sender), n in Counter((s["batch_id"], s["from_entity_id"]) for s in gap_ships).items():
    print(f"    FOUND: batch={bid} sender={sender} shipments={n}")
    found.append(("provenance_gap", bid, sender))

# --- [4] reentrant_distribution: repeat receipt of the same batch involving
#     a provenance-gap shipment, and not already a fan-in hit ---
print("\n[4] reentrant_distribution (repeat receipt + provenance gap, not fan-in):")
naive = 0
for (bid, receiver), ships in by_batch_receiver.items():
    if len(ships) < 2:
        continue
    naive += 1
    ts = [parse_ts(x["dispatch_timestamp"]) for x in ships]
    spread_h = (max(ts) - min(ts)).total_seconds() / 3600
    if spread_h >= FANIN_WINDOW_HOURS and any(x["shipment_id"] in gap_ids for x in ships):
        print(f"    FOUND: batch={bid} receiver={receiver} shipments={[x['shipment_id'] for x in ships]}")
        found.append(("reentrant_distribution", bid, receiver))
print(f"    (naive same-batch/same-receiver rule would flag {naive})")

# --- Compare with manifest ---
with open("anomalies_manifest.json") as f:
    manifest = json.load(f)
print(f"\nTotal anomaly docs: {len(found)}")
print("Planted anomalies:")
ok = True
for a in manifest["planted_anomalies"]:
    hit = any(t == a["type"] and b == a["batch_id"] for t, b, _ in found)
    ok &= hit
    print(f"    {'PASS' if hit else 'FAIL'}  {a['type']}: {a['batch_id']}")
planted = {a["batch_id"] for a in manifest["planted_anomalies"]}
stray = [f for f in found if f[1] not in planted]
print(f"Findings outside planted batches: {len(stray)} {stray if stray else ''}")
raise SystemExit(0 if ok and not stray else 1)
