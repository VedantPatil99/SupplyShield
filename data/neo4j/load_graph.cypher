// SupplyShield -- Neo4j bulk graph load script
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
