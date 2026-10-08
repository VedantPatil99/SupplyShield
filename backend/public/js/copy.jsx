// Plain-language text for the whole UI, in one place so wording stays consistent.
// Technical terms are kept (as `tech`) for anyone who wants them, but shown second.

// Status words as people would say them.
const STATUS_TEXT = {
  active: 'Active', recalled: 'Recalled', expired: 'Expired', quarantined: 'Set aside',
  dispatched: 'On the way', in_transit: 'On the way', delivered: 'Delivered',
  notified: 'Not yet responded', acknowledged: 'Seen', returned: 'Returned',
  in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled',
  open: 'Needs review', reviewed: 'Reviewed', dismissed: 'Dismissed',
  high: 'High risk', medium: 'Medium risk', low: 'Low risk', none: 'OK',
};

// Who each kind of company is, in one line.
const TIER_TEXT = {
  manufacturer: { name: 'Manufacturer', plural: 'Manufacturers', does: 'makes the medicine' },
  distributor: { name: 'Distributor', plural: 'Distributors', does: 'moves it in bulk to regions' },
  wholesaler: { name: 'Wholesaler', plural: 'Wholesalers', does: 'supplies local pharmacies' },
  pharmacy: { name: 'Pharmacy', plural: 'Pharmacies', does: 'sells it to patients' },
};

// The five automatic checks. title = what a person would call it; meaning = what happened;
// why = why it might mean counterfeit or diverted medicine; tech = the name used in the code and report.
const CHECK_TEXT = {
  provenance_gap: {
    title: 'Stock from an unknown source',
    meaning: 'A company shipped this medicine without ever making it or receiving it.',
    why: 'Real stock always has a source. Medicine that appears from nowhere may be counterfeit or stolen.',
    tech: 'provenance_gap',
  },
  multi_manufacturer_batch: {
    title: 'Two makers claim the same batch',
    meaning: 'Two different manufacturers are recorded as having produced this one batch number.',
    why: 'Each batch number should belong to one maker. A copied batch number is a classic sign of counterfeiting.',
    tech: 'multi_manufacturer_batch',
  },
  duplicate_batch_fanin: {
    title: 'Same batch arrived from two suppliers at once',
    meaning: 'One company received this batch from two different suppliers within a few hours.',
    why: 'Genuine stock follows one path. Two suppliers sending the same batch at once suggests one of them is fake.',
    tech: 'duplicate_batch_fanin',
  },
  abnormal_fanout: {
    title: 'Unusually wide distribution burst',
    meaning: 'One company sent stock to far more buyers in a single day than is normal on this network.',
    why: 'Sudden mass shipping can mean stock is being dumped or diverted.',
    tech: 'abnormal_fanout',
  },
  reentrant_distribution: {
    title: 'Same batch received twice, including unverified stock',
    meaning: 'A company received this batch more than once, and at least one delivery came from an unknown source.',
    why: 'Repeat deliveries mixed with untraceable stock suggest fake units entering a genuine supply.',
    tech: 'reentrant_distribution',
  },
};

// What each role can do, used on the login page and home page.
const ROLE_INFO = {
  manufacturer: { title: 'Manufacturer', blurb: 'Register new medicine batches, ship them out, see where they went, and recall them if something is wrong.' },
  distributor: { title: 'Distributor', blurb: 'Receive stock from manufacturers, pass it on to wholesalers, and respond to recalls.' },
  wholesaler: { title: 'Wholesaler', blurb: 'Receive stock from distributors, supply pharmacies, and respond to recalls.' },
  pharmacy: { title: 'Pharmacy', blurb: 'Receive deliveries, check that medicine is genuine before selling it, and respond to recalls.' },
  regulator: { title: 'Regulator', blurb: 'Oversee the whole network: review suspicious activity, track any batch, and follow recalls.' },
  admin: { title: 'Administrator', blurb: 'Manage user accounts, check the system is healthy, and run the suspicious-activity checks.' },
};

// Short explanation shown at the top of each page.
const PAGE_HELP = {
  batches: {
    title: 'What is a batch?',
    body: 'A batch is one production run of a medicine, with its own batch number printed on every pack. Everything in this system is tracked by batch number.',
  },
  shipments: {
    title: 'How shipments work',
    body: 'Medicine moves one step at a time: manufacturer → distributor → wholesaler → pharmacy. When you send stock it leaves your stock straight away. It is added to the receiver\'s stock only when they press "Confirm received".',
  },
  inventory: {
    title: 'Your stock',
    body: 'How much of each batch you hold right now. Rows turn red when a batch is recalled or past its expiry date, so you know not to sell or ship it.',
  },
  map: {
    title: 'How to read the map',
    body: 'Medicine flows left to right: manufacturer → distributor → wholesaler → pharmacy. Each box is a company and each arrow is a delivery. Red boxes and red dashed arrows mark something suspicious. During a recall, a coloured dot on each company shows whether it has responded. Click any company to see what it received and sent.',
  },
  verify: {
    title: 'Is this medicine genuine?',
    body: 'Enter the batch number from the pack. The system follows the delivery records backwards, one step at a time. If every step leads back to the real manufacturer, the stock is genuine. If any step is missing, it could be counterfeit.',
  },
  anomalies: {
    title: 'Suspicious activity',
    body: 'The system runs five automatic checks over all delivery records and lists anything unusual here, grouped by batch. These are fixed rules, not AI. A finding is a warning to investigate, not proof of wrongdoing.',
  },
  recalls: {
    title: 'How a recall works',
    body: 'When a batch is unsafe, its maker or the regulator issues a recall. Every company that received the batch is notified automatically. Each one then marks it as seen, sets the stock aside, and returns it. The recall is complete when everyone has returned their stock.',
  },
  sync: {
    title: 'Is the system working?',
    body: 'Every action is saved in the main database (MongoDB) and copied within moments into the network map (Neo4j) used for tracking and checks. This page confirms both hold the same records and shows how fast the copying is.',
  },
  users: { title: 'User accounts', body: 'Each account belongs to one role. Company accounts are linked to one company and only see that company\'s records.' },
  audit: { title: 'Activity log', body: 'A permanent record of every change anyone made, including attempts that were refused. Entries can never be edited or deleted.' },
};

const statusText = (s) => STATUS_TEXT[s] || (s ? String(s).replace(/_/g, ' ') : '—');
const tierOf = (t) => {
  const k = (Array.isArray(t) ? t[0] : t || '').toString().toLowerCase();
  return TIER_TEXT[k] ? k : null;
};

Object.assign(window, { STATUS_TEXT, TIER_TEXT, CHECK_TEXT, ROLE_INFO, PAGE_HELP, statusText, tierOf });
