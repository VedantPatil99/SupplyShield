// Shared enums and ID patterns (single source of truth for validation).
const ENTITY_TYPES = ['manufacturer', 'distributor', 'wholesaler', 'pharmacy'];
const ROLES = [...ENTITY_TYPES, 'regulator', 'admin'];
// Whitelist mapping entity_type -> Neo4j label. Labels cannot be query parameters, so only these are ever interpolated.
const LABEL_BY_TYPE = { manufacturer: 'Manufacturer', distributor: 'Distributor', wholesaler: 'Wholesaler', pharmacy: 'Pharmacy' };
const TYPE_BY_LABEL = Object.fromEntries(Object.entries(LABEL_BY_TYPE).map(([k, v]) => [v, k]));
// Supply-chain tier order: stock only moves downstream.
const TIER = { manufacturer: 0, distributor: 1, wholesaler: 2, pharmacy: 3 };

const BATCH_STATUS = ['active', 'recalled', 'expired', 'quarantined'];
const SHIPMENT_STATUS = ['dispatched', 'in_transit', 'delivered'];
const RECALL_STATUS = ['in_progress', 'completed', 'cancelled'];
const RECALL_CLASSES = ['Class I', 'Class II', 'Class III'];
const AFFECTED_STATUS = ['notified', 'acknowledged', 'quarantined', 'returned'];
const INVENTORY_RECALL_STATUS = ['none', 'quarantined', 'returned'];
const TXN_TYPES = ['ownership_transfer', 'quality_check', 'recall_action'];
const ANOMALY_TYPES = ['duplicate_batch_fanin', 'multi_manufacturer_batch', 'reentrant_distribution', 'abnormal_fanout', 'provenance_gap'];
const ANOMALY_STATUS = ['open', 'reviewed', 'dismissed'];
const SEVERITY = ['low', 'medium', 'high'];

const ID = {
  entity: /^(MFG|DIST|WHS|PHARM)-[A-Z]{2}-\d{5}$/,
  batch: /^BATCH-\d{4}-[0-9A-F]{6}$/,
  shipment: /^SHIP-[0-9A-F]{6}$/,
  recall: /^RECALL-\d{4}-[0-9A-F]{6}$/,
};

module.exports = {
  ENTITY_TYPES, ROLES, LABEL_BY_TYPE, TYPE_BY_LABEL, TIER, BATCH_STATUS, SHIPMENT_STATUS, RECALL_STATUS,
  RECALL_CLASSES, AFFECTED_STATUS, INVENTORY_RECALL_STATUS, TXN_TYPES, ANOMALY_TYPES, ANOMALY_STATUS, SEVERITY, ID,
};
