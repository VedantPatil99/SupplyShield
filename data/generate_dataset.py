#!/usr/bin/env python3
"""
SupplyShield synthetic dataset generator.

Generates a realistic pharmaceutical supply-chain dataset matching the
MongoDB collection schemas and Neo4j graph schema defined in the
SupplyShield proposal (Chapter 4 / Section 4). Produces:

  dataset/reference/entities.json      -- manufacturers, distributors,
                                           wholesalers, pharmacies
  dataset/mongodb/batches.json
  dataset/mongodb/shipments.json
  dataset/mongodb/inventory.json
  dataset/mongodb/transactions.json
  dataset/mongodb/recalls.json
  dataset/mongodb/users_seed.json      -- demo login accounts (PLAINTEXT
                                           passwords -- hash before insert)
  dataset/neo4j/entities.csv
  dataset/neo4j/batches.csv
  dataset/neo4j/shipments.csv
  dataset/neo4j/recalls.csv
  dataset/neo4j/recall_affected.csv
  dataset/neo4j/load_graph.cypher      -- ready-to-run LOAD CSV script

  anomalies_manifest.json              -- exact IDs of intentionally
                                           planted anomalies, for demoing
                                           the counterfeit-detection engine

Run:  python3 generate_dataset.py
Reproducible: fixed random seed (42). Change SEED / the *_COUNT constants
below to scale the dataset up or down.
"""

import json
import csv
import os
import random
import uuid
from datetime import datetime, timedelta

# ---------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------
SEED = 42
random.seed(SEED)

N_MANUFACTURERS = 15
N_DISTRIBUTORS = 25
N_WHOLESALERS = 35
N_PHARMACIES = 60
N_BATCHES = 500
N_RECALLS = 10

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dataset")
TODAY = datetime(2026, 8, 25)
EARLIEST_MANUFACTURE = TODAY - timedelta(days=560)  # ~18 months back

CITIES = [
    ("Hyderabad", "IN"), ("Chennai", "IN"), ("Bengaluru", "IN"), ("Mumbai", "IN"),
    ("Delhi", "IN"), ("Pune", "IN"), ("Kolkata", "IN"), ("Ahmedabad", "IN"),
    ("Jaipur", "IN"), ("Lucknow", "IN"), ("Coimbatore", "IN"), ("Vellore", "IN"),
    ("Nagpur", "IN"), ("Indore", "IN"), ("Bhopal", "IN"), ("Surat", "IN"),
    ("Kochi", "IN"), ("Visakhapatnam", "IN"), ("Patna", "IN"), ("Chandigarh", "IN"),
]

MANUFACTURER_NAMES = [
    "Aarav Life Sciences", "Sunrise Pharmaceuticals", "Meridian Biotech",
    "Vertex Formulations", "Crescent Pharma", "Nova Therapeutics",
    "Silverline Drugs", "Pinnacle Biosciences", "Everest Pharmaceuticals",
    "Solaris Life Sciences", "Zenith Formulations", "Trident Pharma",
    "Orbit Biosciences", "Cascade Therapeutics", "Meadow Pharma",
]
DISTRIBUTOR_NAMES = [
    "National Drug Distributors", "MedLine Distribution", "PharmaLink Distributors",
    "CarePath Distribution", "Unity Pharma Distribution", "Continental Drug Distributors",
    "Sterling Pharma Logistics", "Horizon Distribution Network", "Metro Drug Distributors",
    "Prime Pharma Supply", "Anchor Distribution Co.", "Beacon Pharma Distributors",
    "Frontier Drug Distribution", "Summit Pharma Logistics", "Coastal Distributors",
    "Redwood Drug Distribution", "Vantage Pharma Distributors", "Keystone Distribution",
    "Ridgeline Pharma Supply", "Elevate Distributors", "Northstar Drug Distribution",
    "Bluewave Pharma Distributors", "Ironclad Distribution Co.", "Highland Drug Distributors",
    "Meridian Distribution Network",
]
WHOLESALER_NAMES = [
    "City Wholesale Pharma", "Regional Drug Wholesalers", "Union Pharma Wholesale",
    "Gateway Wholesale Drugs", "Central Pharma Traders", "Everstock Wholesale Pharma",
    "Landmark Drug Wholesalers", "Riverside Pharma Wholesale", "Capital Drug Traders",
    "Harborview Wholesale Pharma", "Greenfield Drug Wholesalers", "Oakridge Pharma Traders",
    "Westgate Wholesale Drugs", "Eastline Pharma Wholesale", "Millbrook Drug Traders",
    "Fairview Wholesale Pharma", "Stonebridge Drug Wholesalers", "Clearwater Pharma Traders",
    "Brookfield Wholesale Drugs", "Lakeside Pharma Wholesale", "Hillcrest Drug Traders",
    "Parkside Wholesale Pharma", "Southgate Drug Wholesalers", "Northfield Pharma Traders",
    "Wellspring Wholesale Drugs", "Ashford Pharma Wholesale", "Kingsley Drug Traders",
    "Dunmore Wholesale Pharma", "Fernwood Drug Wholesalers", "Glenmoor Pharma Traders",
    "Harrowgate Wholesale Drugs", "Ivywood Pharma Wholesale", "Juniper Drug Traders",
    "Kestrel Wholesale Pharma", "Larkspur Drug Wholesalers",
]
PHARMACY_NAMES = [
    "HealthPlus Pharmacy", "MediCare Chemist", "CityCare Pharmacy", "WellLife Pharmacy",
    "GreenCross Chemist", "TrustCare Pharmacy", "LifeLine Pharmacy", "CarePoint Chemist",
    "VitalCare Pharmacy", "PrimeHealth Pharmacy", "SunCare Chemist", "MedTrust Pharmacy",
    "FamilyCare Pharmacy", "QuickCare Chemist", "HealthFirst Pharmacy", "MediPlus Chemist",
    "CareWell Pharmacy", "TrueCare Chemist", "NeighborCare Pharmacy", "SwiftCare Chemist",
]

DRUG_CATALOG = [
    ("Amoxicillin 500mg Capsules", "AMX500-CAP", False),
    ("Paracetamol 650mg Tablets", "PCM650-TAB", False),
    ("Metformin 500mg Tablets", "MET500-TAB", False),
    ("Azithromycin 250mg Tablets", "AZI250-TAB", False),
    ("Ibuprofen 400mg Tablets", "IBU400-TAB", False),
    ("Cetirizine 10mg Tablets", "CET10-TAB", False),
    ("Omeprazole 20mg Capsules", "OMP20-CAP", False),
    ("Amlodipine 5mg Tablets", "AML5-TAB", False),
    ("Atorvastatin 10mg Tablets", "ATV10-TAB", False),
    ("Losartan 50mg Tablets", "LOS50-TAB", False),
    ("Insulin Glargine Injection", "INS-GLA-INJ", True),
    ("Ciprofloxacin 500mg Tablets", "CIP500-TAB", False),
    ("Doxycycline 100mg Capsules", "DOX100-CAP", False),
    ("Salbutamol Inhaler 100mcg", "SAL100-INH", True),
    ("Hepatitis B Vaccine", "HEPB-VAC", True),
    ("Oral Rehydration Salts Sachets", "ORS-SACH", False),
]

RECALL_REASONS = [
    "Contamination detected in retained sample during routine QC audit",
    "Sub-potent active ingredient identified in stability testing",
    "Packaging defect risking loss of sterility",
    "Incorrect dosage strength printed on labelling",
    "Foreign particulate matter found in a subset of units",
    "Adverse event reports exceeding expected threshold",
    "Deviation from Good Manufacturing Practice (GMP) identified at plant",
]

# ---------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------
def short_id():
    return uuid.uuid4().hex[:6].upper()

def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

def date_only(dt):
    return dt.strftime("%Y-%m-%d")

def rand_dt_between(start, end):
    delta = end - start
    seconds = random.randint(0, max(int(delta.total_seconds()), 1))
    return start + timedelta(seconds=seconds)

# ---------------------------------------------------------------
# 1. ENTITIES (manufacturers, distributors, wholesalers, pharmacies)
# ---------------------------------------------------------------
def make_entities():
    entities = []

    def build(prefix, names, entity_type, count):
        out = []
        for i in range(count):
            city, country = random.choice(CITIES)
            name = names[i % len(names)]
            if i >= len(names):
                name = f"{name} ({['North','South','East','West','Central'][i % 5]})"
            out.append({
                "entity_id": f"{prefix}-IN-{i+1:05d}",
                "name": name,
                "entity_type": entity_type,
                "city": city,
                "country": country,
                "license_number": f"LIC-{entity_type[:3].upper()}-{100000 + i}",
            })
        return out

    entities += build("MFG", MANUFACTURER_NAMES, "manufacturer", N_MANUFACTURERS)
    entities += build("DIST", DISTRIBUTOR_NAMES, "distributor", N_DISTRIBUTORS)
    entities += build("WHS", WHOLESALER_NAMES, "wholesaler", N_WHOLESALERS)
    entities += build("PHARM", PHARMACY_NAMES, "pharmacy", N_PHARMACIES)
    return entities


entities = make_entities()
manufacturers = [e for e in entities if e["entity_type"] == "manufacturer"]
distributors = [e for e in entities if e["entity_type"] == "distributor"]
wholesalers = [e for e in entities if e["entity_type"] == "wholesaler"]
pharmacies = [e for e in entities if e["entity_type"] == "pharmacy"]
entity_by_id = {e["entity_id"]: e for e in entities}

# ---------------------------------------------------------------
# 2. BATCHES
# ---------------------------------------------------------------
batches = []
batch_ids = []
for i in range(N_BATCHES):
    mfg = random.choice(manufacturers)
    drug_name, drug_code, cold_chain = random.choice(DRUG_CATALOG)
    manu_date = rand_dt_between(EARLIEST_MANUFACTURE, TODAY - timedelta(days=14))
    shelf_months = random.choice([18, 24, 30, 36])
    expiry_date = manu_date + timedelta(days=30 * shelf_months)
    batch_id = f"BATCH-{manu_date.year}-{short_id()}"
    batch_ids.append(batch_id)
    batches.append({
        "_id": batch_id,
        "product_name": drug_name,
        "product_code": drug_code,
        "manufacturer_id": mfg["entity_id"],
        "manufacture_date": date_only(manu_date),
        "expiry_date": date_only(expiry_date),
        "quantity_produced": random.randint(10, 500) * 1000,
        "unit": "units",
        "storage_conditions": {
            "temperature_range_c": [2, 8] if cold_chain else [15, 25],
            "requires_cold_chain": cold_chain,
        },
        "regulatory": {
            "approval_number": f"CDSCO-{manu_date.year}-{drug_code[:3]}-{random.randint(1000,9999)}",
            "country_of_origin": "IN",
        },
        "quality_control": {
            "qc_passed": random.random() > 0.03,
            "qc_certificate_id": f"QC-CERT-{short_id()}",
        },
        "status": "active",
        "created_at": iso(manu_date + timedelta(hours=2)),
        "updated_at": iso(manu_date + timedelta(hours=2)),
        "_manu_date_obj": manu_date,  # internal use only, stripped before export
    })

batch_by_id = {b["_id"]: b for b in batches}

# ---------------------------------------------------------------
# 3. SHIPMENT CHAINS (manufacturer -> distributor(s) -> wholesaler(s) -> pharmacy(s))
#    + derived inventory + transactions
# ---------------------------------------------------------------
shipments = []
transactions = []
inventory_by_key = {}  # (entity_id, batch_id) -> record

def upsert_inventory(entity, batch_id, delta_qty, ts):
    key = (entity["entity_id"], batch_id)
    rec = inventory_by_key.get(key)
    if rec is None:
        rec = {
            "_id": f"INV-{entity['entity_id'].replace('-', '')}-{batch_id.replace('-', '')}",
            "entity_id": entity["entity_id"],
            "entity_type": entity["entity_type"],
            "batch_id": batch_id,
            "quantity_on_hand": 0,
            "location": {"city": entity["city"], "country": entity["country"]},
            "recall_status": "none",
            "last_updated": iso(ts),
        }
        inventory_by_key[key] = rec
    rec["quantity_on_hand"] = max(0, rec["quantity_on_hand"] + delta_qty)
    rec["last_updated"] = iso(ts)

def make_shipment(batch, from_e, to_e, quantity, dispatch_dt, delivered=True):
    sid = f"SHIP-{short_id()}"
    arrival = dispatch_dt + timedelta(days=random.randint(1, 4), hours=random.randint(0, 12))
    status = "delivered" if delivered else random.choice(["dispatched", "in_transit"])
    shipment = {
        "_id": sid,
        "batch_id": batch["_id"],
        "quantity": quantity,
        "from_entity": {"entity_id": from_e["entity_id"], "entity_type": from_e["entity_type"], "city": from_e["city"]},
        "to_entity": {"entity_id": to_e["entity_id"], "entity_type": to_e["entity_type"], "city": to_e["city"]},
        "dispatch_timestamp": iso(dispatch_dt),
        "actual_arrival": iso(arrival) if status == "delivered" else None,
        "transport_mode": random.choice(["road", "road", "road", "air"]),
        "tracking_number": f"TRK-{short_id()}",
        "status": status,
        "created_at": iso(dispatch_dt),
        "updated_at": iso(arrival if status == "delivered" else dispatch_dt),
    }
    shipments.append(shipment)

    txn = {
        "_id": f"TXN-{short_id()}",
        "type": "ownership_transfer",
        "batch_id": batch["_id"],
        "shipment_id": sid,
        "from_entity_id": from_e["entity_id"],
        "to_entity_id": to_e["entity_id"],
        "quantity": quantity,
        "timestamp": iso(arrival if status == "delivered" else dispatch_dt),
        "verified_by": f"{to_e['entity_id']}-USER-01",
        "signature_hash": uuid.uuid4().hex[:12],
    }
    transactions.append(txn)

    if status == "delivered":
        upsert_inventory(from_e, batch["_id"], -quantity, arrival) if from_e["entity_type"] != "manufacturer" else None
        upsert_inventory(to_e, batch["_id"], quantity, arrival)

    return shipment, arrival if status == "delivered" else dispatch_dt

# Track downstream reach per batch for recall computation later
batch_downstream = {b["_id"]: set() for b in batches}

for batch in batches:
    manu_date = batch["_manu_date_obj"]
    qty_total = batch["quantity_produced"]
    is_recent = (TODAY - manu_date).days < 10  # very recent batches may still be in transit

    # Manufacturer -> 1..2 distributors
    n_dist = random.choices([1, 2], weights=[0.6, 0.4])[0]
    chosen_dists = random.sample(distributors, n_dist)
    remaining = qty_total
    dispatch_base = manu_date + timedelta(days=random.randint(1, 5))

    for idx, dist in enumerate(chosen_dists):
        portion = remaining // (n_dist - idx) if idx < n_dist - 1 else remaining
        remaining -= portion
        dispatch_dt = dispatch_base + timedelta(hours=random.randint(0, 48))
        delivered = not (is_recent and random.random() < 0.3)
        ship, arrived_at = make_shipment(batch, entity_by_id[batch["manufacturer_id"]], dist, portion, dispatch_dt, delivered)
        if delivered:
            batch_downstream[batch["_id"]].add(dist["entity_id"])

        if not delivered:
            continue

        # Distributor -> 1 wholesaler
        n_whs = 1
        chosen_whs = random.sample(wholesalers, n_whs)
        rem2 = portion
        for j, whs in enumerate(chosen_whs):
            portion2 = rem2 // (n_whs - j) if j < n_whs - 1 else rem2
            rem2 -= portion2
            d2 = arrived_at + timedelta(days=random.randint(1, 6))
            delivered2 = not (is_recent and random.random() < 0.3)
            ship2, arrived_at2 = make_shipment(batch, dist, whs, portion2, d2, delivered2)
            if delivered2:
                batch_downstream[batch["_id"]].add(whs["entity_id"])
            if not delivered2:
                continue

            # Wholesaler -> 1..3 pharmacies
            n_ph = random.choices([1, 2, 3], weights=[0.4, 0.4, 0.2])[0]
            chosen_ph = random.sample(pharmacies, n_ph)
            rem3 = portion2
            for k, ph in enumerate(chosen_ph):
                portion3 = max(1, rem3 // (n_ph - k)) if k < n_ph - 1 else max(1, rem3)
                rem3 -= portion3
                d3 = arrived_at2 + timedelta(days=random.randint(1, 5))
                delivered3 = not (is_recent and random.random() < 0.4)
                ship3, arrived_at3 = make_shipment(batch, whs, ph, portion3, d3, delivered3)
                if delivered3:
                    batch_downstream[batch["_id"]].add(ph["entity_id"])

# ---------------------------------------------------------------
# 4. INTENTIONALLY PLANTED ANOMALIES (for demoing FR-5 / the anomaly engine)
# ---------------------------------------------------------------
anomalies_manifest = {"seed": SEED, "generated_at": iso(TODAY), "planted_anomalies": []}

# (a) multi_manufacturer_batch: same batch_id "produced" by two manufacturers
victim_batch = random.choice(batches[:400])
other_mfg = random.choice([m for m in manufacturers if m["entity_id"] != victim_batch["manufacturer_id"]])
clone_batch = dict(victim_batch)
clone_batch["manufacturer_id"] = other_mfg["entity_id"]
clone_batch["_id"] = victim_batch["_id"]  # SAME batch_id -- this is the anomaly
clone_batch["created_at"] = iso(victim_batch["_manu_date_obj"] + timedelta(days=3))
clone_batch["updated_at"] = clone_batch["created_at"]
# represented as a duplicate PRODUCED edge via an extra shipment-less transaction record
transactions.append({
    "_id": f"TXN-{short_id()}",
    "type": "quality_check",
    "batch_id": victim_batch["_id"],
    "shipment_id": None,
    "from_entity_id": other_mfg["entity_id"],
    "to_entity_id": other_mfg["entity_id"],
    "quantity": 0,
    "timestamp": iso(victim_batch["_manu_date_obj"] + timedelta(days=3)),
    "verified_by": f"{other_mfg['entity_id']}-USER-01",
    "signature_hash": uuid.uuid4().hex[:12],
})
anomalies_manifest["planted_anomalies"].append({
    "type": "multi_manufacturer_batch",
    "batch_id": victim_batch["_id"],
    "detail": f"Batch {victim_batch['_id']} is legitimately produced by {victim_batch['manufacturer_id']} "
              f"but a second PRODUCED relationship from {other_mfg['entity_id']} has been planted "
              f"(via an extra Neo4j edge created from the anomaly-seed transaction). Detect with the "
              f"'multi-manufacturer batch' Cypher query.",
})

# (b) duplicate_batch_fanin: two different senders ship the SAME batch into the
#     same receiving wholesaler within a 6-hour window
fanin_batch = random.choice(batches[400:480])
whs_target = random.choice(wholesalers)
sender1, sender2 = random.sample(distributors, 2)
base_t = fanin_batch["_manu_date_obj"] + timedelta(days=20)
s1, _ = make_shipment(fanin_batch, sender1, whs_target, 5000, base_t, delivered=True)
s2, _ = make_shipment(fanin_batch, sender2, whs_target, 4200, base_t + timedelta(hours=3), delivered=True)
anomalies_manifest["planted_anomalies"].append({
    "type": "duplicate_batch_fanin",
    "batch_id": fanin_batch["_id"],
    "detail": f"Batch {fanin_batch['_id']} shipped into {whs_target['entity_id']} from two different "
              f"senders ({sender1['entity_id']} and {sender2['entity_id']}) only 3 hours apart "
              f"(shipments {s1['_id']} and {s2['_id']}). Detect with the duplicate-batch fan-in Cypher "
              f"query (Listing 4.8 in the proposal).",
})

# (c) abnormal_fanout: one distributor ships to an unusually large number of
#     distinct wholesalers (network average is ~1-2 per shipment event)
fanout_dist = distributors[0]
fanout_batch = random.choice(batches[480:495])
t0 = fanout_batch["_manu_date_obj"] + timedelta(days=10)
targets = random.sample(wholesalers, min(18, len(wholesalers)))
for idx, whs in enumerate(targets):
    make_shipment(fanout_batch, fanout_dist, whs, 300, t0 + timedelta(hours=idx), delivered=True)
anomalies_manifest["planted_anomalies"].append({
    "type": "abnormal_fanout",
    "batch_id": fanout_batch["_id"],
    "detail": f"Distributor {fanout_dist['entity_id']} ships batch {fanout_batch['_id']} to "
              f"{len(targets)} distinct wholesalers in rapid succession, far above the network "
              f"average out-degree. Detect with the abnormal fan-out heuristic.",
})

# (d) reentrant_distribution: the same pharmacy receives the same batch twice
#     via two different upstream wholesalers
reentrant_batch = random.choice(batches[495:500])
ph_target = random.choice(pharmacies)
whs1, whs2 = random.sample(wholesalers, 2)
t1 = reentrant_batch["_manu_date_obj"] + timedelta(days=25)
make_shipment(reentrant_batch, whs1, ph_target, 800, t1, delivered=True)
make_shipment(reentrant_batch, whs2, ph_target, 650, t1 + timedelta(days=1), delivered=True)
anomalies_manifest["planted_anomalies"].append({
    "type": "reentrant_distribution",
    "batch_id": reentrant_batch["_id"],
    "detail": f"Pharmacy {ph_target['entity_id']} receives batch {reentrant_batch['_id']} twice, "
              f"once from {whs1['entity_id']} and once from {whs2['entity_id']}, a day apart. "
              f"Detect with the re-entrant / repeat-receipt Cypher query.",
})

# ---------------------------------------------------------------
# 5. RECALLS
# ---------------------------------------------------------------
recalls = []
recall_candidates = random.sample([b for b in batches if len(batch_downstream[b["_id"]]) >= 3], N_RECALLS)
for batch in recall_candidates:
    batch["status"] = "recalled"
    mfg_id = batch["manufacturer_id"]
    initiated = batch["_manu_date_obj"] + timedelta(days=random.randint(30, 90))
    if initiated > TODAY:
        initiated = TODAY - timedelta(days=random.randint(1, 20))
    recall_id = f"RECALL-{initiated.year}-{short_id()}"
    affected = []
    for ent_id in batch_downstream[batch["_id"]]:
        ent = entity_by_id[ent_id]
        status = random.choices(
            ["notified", "acknowledged", "quarantined", "returned"],
            weights=[0.15, 0.25, 0.35, 0.25],
        )[0]
        affected.append({
            "entity_id": ent_id,
            "entity_type": [ent["entity_type"].capitalize()],
            "status": status,
            "updated_at": iso(initiated + timedelta(days=random.randint(0, 10))),
        })
    recalls.append({
        "_id": recall_id,
        "batch_ids": [batch["_id"]],
        "initiated_by": mfg_id,
        "reason": random.choice(RECALL_REASONS),
        "recall_class": random.choices(["Class I", "Class II", "Class III"], weights=[0.15, 0.55, 0.30])[0],
        "affected_entities": affected,
        "status": random.choices(["in_progress", "completed"], weights=[0.4, 0.6])[0],
        "initiated_at": iso(initiated),
        "updated_at": iso(initiated + timedelta(days=random.randint(0, 12))),
    })

# ---------------------------------------------------------------
# 6. DEMO USER ACCOUNTS (plaintext -- hash before inserting into MongoDB)
# ---------------------------------------------------------------
users_seed = [
    {"username": "admin", "password": "Admin@123", "role": "admin", "entity_id": None, "display_name": "Platform Administrator"},
    {"username": "regulator1", "password": "Regulator@123", "role": "regulator", "entity_id": None, "display_name": "CDSCO Regulatory Auditor"},
    {"username": "mfg_aarav", "password": "Mfg@12345", "role": "manufacturer", "entity_id": manufacturers[0]["entity_id"], "display_name": manufacturers[0]["name"]},
    {"username": "dist_national", "password": "Dist@12345", "role": "distributor", "entity_id": distributors[0]["entity_id"], "display_name": distributors[0]["name"]},
    {"username": "whs_city", "password": "Whs@12345", "role": "wholesaler", "entity_id": wholesalers[0]["entity_id"], "display_name": wholesalers[0]["name"]},
    {"username": "pharm_healthplus", "password": "Pharm@12345", "role": "pharmacy", "entity_id": pharmacies[0]["entity_id"], "display_name": pharmacies[0]["name"]},
]

# ---------------------------------------------------------------
# CLEANUP internal fields before export
# ---------------------------------------------------------------
for b in batches:
    b.pop("_manu_date_obj", None)

# ---------------------------------------------------------------
# WRITE MONGODB JSON FILES
# ---------------------------------------------------------------
os.makedirs(os.path.join(OUT_DIR, "reference"), exist_ok=True)
os.makedirs(os.path.join(OUT_DIR, "mongodb"), exist_ok=True)
os.makedirs(os.path.join(OUT_DIR, "neo4j"), exist_ok=True)

def dump(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

dump(os.path.join(OUT_DIR, "reference", "entities.json"), entities)
dump(os.path.join(OUT_DIR, "mongodb", "batches.json"), batches)
dump(os.path.join(OUT_DIR, "mongodb", "shipments.json"), shipments)
dump(os.path.join(OUT_DIR, "mongodb", "inventory.json"), list(inventory_by_key.values()))
dump(os.path.join(OUT_DIR, "mongodb", "transactions.json"), transactions)
dump(os.path.join(OUT_DIR, "mongodb", "recalls.json"), recalls)
dump(os.path.join(OUT_DIR, "mongodb", "users_seed.json"), users_seed)
dump(os.path.join(os.path.dirname(OUT_DIR), "anomalies_manifest.json"), anomalies_manifest)

# ---------------------------------------------------------------
# WRITE NEO4J CSV FILES
# ---------------------------------------------------------------
with open(os.path.join(OUT_DIR, "neo4j", "entities.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["entity_id", "name", "entity_type", "city", "country", "license_number"])
    for e in entities:
        w.writerow([e["entity_id"], e["name"], e["entity_type"], e["city"], e["country"], e["license_number"]])

with open(os.path.join(OUT_DIR, "neo4j", "batches.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["batch_id", "product_name", "manufacturer_id", "manufacture_date", "expiry_date", "status"])
    for b in batches:
        w.writerow([b["_id"], b["product_name"], b["manufacturer_id"], b["manufacture_date"], b["expiry_date"], b["status"]])
    # planted multi-manufacturer anomaly row (second PRODUCED edge, same batch_id)
    w.writerow([clone_batch["_id"], clone_batch["product_name"], clone_batch["manufacturer_id"],
                clone_batch["manufacture_date"], clone_batch["expiry_date"], "active"])

with open(os.path.join(OUT_DIR, "neo4j", "shipments.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["shipment_id", "batch_id", "quantity", "from_entity_id", "to_entity_id",
                "dispatch_timestamp", "status"])
    for s in shipments:
        w.writerow([s["_id"], s["batch_id"], s["quantity"], s["from_entity"]["entity_id"],
                    s["to_entity"]["entity_id"], s["dispatch_timestamp"], s["status"]])

with open(os.path.join(OUT_DIR, "neo4j", "recalls.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["recall_id", "batch_id", "reason", "recall_class", "initiated_at", "status"])
    for r in recalls:
        for bid in r["batch_ids"]:
            w.writerow([r["_id"], bid, r["reason"], r["recall_class"], r["initiated_at"], r["status"]])

with open(os.path.join(OUT_DIR, "neo4j", "recall_affected.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["recall_id", "entity_id", "status"])
    for r in recalls:
        for a in r["affected_entities"]:
            w.writerow([r["_id"], a["entity_id"], a["status"]])

# ---------------------------------------------------------------
# WRITE load_graph.cypher
# ---------------------------------------------------------------
cypher = """// SupplyShield -- Neo4j bulk graph load script
// Run with: cypher-shell -u neo4j -p <password> -f load_graph.cypher
// or paste into Neo4j Browser. Requires the neo4j/import/ CSV files from
// this dataset to be placed in Neo4j's import directory (the docker-compose
// setup mounts ./neo4j-import there automatically).

// --- Constraints (idempotent) ---
CREATE CONSTRAINT manufacturer_id IF NOT EXISTS FOR (n:Manufacturer) REQUIRE n.entity_id IS UNIQUE;
CREATE CONSTRAINT distributor_id IF NOT EXISTS FOR (n:Distributor) REQUIRE n.entity_id IS UNIQUE;
CREATE CONSTRAINT wholesaler_id IF NOT EXISTS FOR (n:Wholesaler) REQUIRE n.entity_id IS UNIQUE;
CREATE CONSTRAINT pharmacy_id IF NOT EXISTS FOR (n:Pharmacy) REQUIRE n.entity_id IS UNIQUE;
CREATE CONSTRAINT batch_id IF NOT EXISTS FOR (n:Batch) REQUIRE n.batch_id IS UNIQUE;
CREATE CONSTRAINT shipment_id IF NOT EXISTS FOR (n:Shipment) REQUIRE n.shipment_id IS UNIQUE;
CREATE CONSTRAINT recall_id IF NOT EXISTS FOR (n:Recall) REQUIRE n.recall_id IS UNIQUE;

// --- Entities (Manufacturer / Distributor / Wholesaler / Pharmacy) ---
LOAD CSV WITH HEADERS FROM 'file:///entities.csv' AS row
CALL {
  WITH row
  FOREACH (_ IN CASE WHEN row.entity_type = 'manufacturer' THEN [1] ELSE [] END |
    MERGE (n:Manufacturer {entity_id: row.entity_id})
    SET n.name = row.name, n.city = row.city, n.country = row.country, n.license_number = row.license_number)
  FOREACH (_ IN CASE WHEN row.entity_type = 'distributor' THEN [1] ELSE [] END |
    MERGE (n:Distributor {entity_id: row.entity_id})
    SET n.name = row.name, n.city = row.city, n.country = row.country, n.license_number = row.license_number)
  FOREACH (_ IN CASE WHEN row.entity_type = 'wholesaler' THEN [1] ELSE [] END |
    MERGE (n:Wholesaler {entity_id: row.entity_id})
    SET n.name = row.name, n.city = row.city, n.country = row.country, n.license_number = row.license_number)
  FOREACH (_ IN CASE WHEN row.entity_type = 'pharmacy' THEN [1] ELSE [] END |
    MERGE (n:Pharmacy {entity_id: row.entity_id})
    SET n.name = row.name, n.city = row.city, n.country = row.country, n.license_number = row.license_number)
} IN TRANSACTIONS OF 500 ROWS;

// --- Batches + PRODUCED relationship ---
// NOTE: batches.csv intentionally contains one duplicate batch_id row
// (the planted multi_manufacturer_batch anomaly) -- this is expected.
LOAD CSV WITH HEADERS FROM 'file:///batches.csv' AS row
CALL {
  WITH row
  MERGE (b:Batch {batch_id: row.batch_id})
  SET b.product_name = row.product_name,
      b.manufacture_date = row.manufacture_date,
      b.expiry_date = row.expiry_date,
      b.status = row.status
  WITH b, row
  MATCH (m {entity_id: row.manufacturer_id})
  WHERE m:Manufacturer
  MERGE (m)-[:PRODUCED]->(b)
} IN TRANSACTIONS OF 500 ROWS;

// --- Shipments + PART_OF / FROM / TO relationships ---
LOAD CSV WITH HEADERS FROM 'file:///shipments.csv' AS row
CALL {
  WITH row
  MATCH (b:Batch {batch_id: row.batch_id})
  MERGE (s:Shipment {shipment_id: row.shipment_id})
  SET s.dispatch_timestamp = row.dispatch_timestamp,
      s.quantity = toInteger(row.quantity),
      s.status = row.status
  MERGE (b)-[:PART_OF]->(s)
  WITH s, row
  MATCH (sender {entity_id: row.from_entity_id})
  MATCH (receiver {entity_id: row.to_entity_id})
  MERGE (s)-[:FROM]->(sender)
  MERGE (s)-[:TO]->(receiver)
} IN TRANSACTIONS OF 500 ROWS;

// --- Recalls + AFFECTS relationship ---
LOAD CSV WITH HEADERS FROM 'file:///recalls.csv' AS row
CALL {
  WITH row
  MERGE (r:Recall {recall_id: row.recall_id})
  SET r.reason = row.reason, r.recall_class = row.recall_class,
      r.initiated_at = row.initiated_at, r.status = row.status
  WITH r, row
  MATCH (b:Batch {batch_id: row.batch_id})
  MERGE (r)-[:AFFECTS]->(b)
} IN TRANSACTIONS OF 100 ROWS;

// --- Recall NOTIFIED relationships ---
LOAD CSV WITH HEADERS FROM 'file:///recall_affected.csv' AS row
CALL {
  WITH row
  MATCH (r:Recall {recall_id: row.recall_id})
  MATCH (e {entity_id: row.entity_id})
  MERGE (r)-[n:NOTIFIED]->(e)
  SET n.status = row.status
} IN TRANSACTIONS OF 500 ROWS;
"""
with open(os.path.join(OUT_DIR, "neo4j", "load_graph.cypher"), "w", encoding="utf-8") as f:
    f.write(cypher)

# ---------------------------------------------------------------
# SUMMARY
# ---------------------------------------------------------------
print("Dataset generated:")
print(f"  Entities:      {len(entities)} ({N_MANUFACTURERS} mfg, {N_DISTRIBUTORS} dist, {N_WHOLESALERS} whs, {N_PHARMACIES} pharm)")
print(f"  Batches:       {len(batches)}")
print(f"  Shipments:     {len(shipments)}")
print(f"  Inventory:     {len(inventory_by_key)}")
print(f"  Transactions:  {len(transactions)}")
print(f"  Recalls:       {len(recalls)}")
print(f"  Users (demo):  {len(users_seed)}")
print(f"  Planted anomalies: {len(anomalies_manifest['planted_anomalies'])}")
