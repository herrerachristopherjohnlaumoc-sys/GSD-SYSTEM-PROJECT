const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');

// MongoDB persistence. Works with MongoDB Atlas (or any replica set — multi-document
// transactions are used so a stock change and its audit row are always written together).
//
// Collections (numeric `id` fields are kept so URLs/labels like PROD0001 and USR0001 stay stable):
//   users                    { id, name, username, username_key, password_hash, role, status, created_at }
//   inventory_items          { id, name, name_key, category, unit, quantity, reorder_point, created_at }
//   transactions             { id, item_id, type, reference, reference_key, occurred_on, quantity, unit_cost,
//                              office, notes, metadata, actor_id, actor_name, created_at }
//   password_reset_requests  { id, username, reason, status, reviewer_id, reviewer_name, created_at, reviewed_at }
//   sessions                 { _id: sha256(token), user_id, expires_at }  (TTL index removes expired sessions)
//   counters                 { _id: collection name, seq }
//   app_meta                 { _id: key, value }

const client = process.env.MONGODB_URI
  ? new MongoClient(process.env.MONGODB_URI, {
      appName: 'gsd-inventory',
      serverSelectionTimeoutMS: 10000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10
    })
  : null;
if (client) {
  client.on('error', error => console.error('MongoDB client error:', error.message));
}
const col = {};
let activeDb = null;

function timestamp(date = new Date()) {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('base64url')}:${derived.toString('base64url')}`;
}

function verifyPassword(password, storedHash) {
  try {
    const [saltText, hashText] = String(storedHash || '').split(':');
    if (!saltText || !hashText) return false;
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(hashText, 'base64url');
    if (!salt.length || !expected.length) return false;
    const actual = crypto.scryptSync(password, salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

async function nextId(name, session) {
  const counter = await col.counters.findOneAndUpdate(
    { _id: name }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session }
  );
  return counter.seq;
}

// Runs fn(session) inside a MongoDB transaction; everything commits or nothing does.
async function withTransaction(fn) {
  const session = client.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await fn(session); });
    return result;
  } finally {
    await session.endSession();
  }
}

async function seed() {
  const production = process.env.NODE_ENV === 'production';
  if (await col.users.countDocuments() === 0) {
    if (production && (!process.env.GSD_ADMIN_PASSWORD || !process.env.GSD_STAFF_PASSWORD)) {
      throw new Error('Set GSD_ADMIN_PASSWORD and GSD_STAFF_PASSWORD before first production startup.');
    }
    const accounts = [
      ['GSD Administrator', 'gsd_admin', process.env.GSD_ADMIN_PASSWORD || 'ChangeMe!2026', 'Admin'],
      ['GSD Staff', 'gsd_staff', process.env.GSD_STAFF_PASSWORD || 'StaffPass!2026', 'Staff']
    ];
    for (const [name, username, password, role] of accounts) {
      await col.users.insertOne({
        id: await nextId('users'), name, username, username_key: username.toLowerCase(),
        password_hash: hashPassword(password), role, status: 'Active', created_at: timestamp()
      });
    }
  }

  // Demo items only for local development (or when GSD_SEED_DEMO=true), never silently in production.
  const wantDemo = process.env.GSD_SEED_DEMO ? process.env.GSD_SEED_DEMO === 'true' : !production;
  if (!wantDemo || await col.meta.findOne({ _id: 'demo_seeded' })) return;
  const admin = await col.users.findOne({ username_key: 'gsd_admin' });
  const addItem = async (name, category, unit) => {
    const item = { id: await nextId('inventory_items'), name, name_key: name.toLowerCase(), category, unit, quantity: 0, reorder_point: 7, created_at: timestamp() };
    await col.items.insertOne(item);
    return item.id;
  };
  const move = async (itemId, type, reference, date, quantity, office = null, notes = null) => {
    await col.transactions.insertOne({
      id: await nextId('transactions'), item_id: itemId, type, reference, reference_key: reference.toLowerCase(),
      occurred_on: date, quantity, unit_cost: null, office, notes, metadata: {},
      actor_id: admin?.id ?? null, actor_name: admin?.name ?? null, created_at: timestamp()
    });
    await col.items.updateOne({ id: itemId }, { $inc: { quantity: type === 'SRF' ? -quantity : quantity } });
  };
  const vinyl = await addItem('VINYL TILES (WOOD LOOK)', 'Construction Materials', 'PCS');
  await move(vinyl, 'PO', 'PO-2026-001', '2026-05-28', 1400, null, 'Initial demo purchase order');
  await move(vinyl, 'SRF', 'SRF-817', '2026-05-29', 330, 'OCBS');
  await move(vinyl, 'SRF', 'SRF-831', '2026-06-02', 330, 'OCBS');
  await move(vinyl, 'SRF', 'SRF-838', '2026-06-03', 220, 'OCBS');
  await move(vinyl, 'SRF', 'SRF-842', '2026-06-04', 440, 'OCBS');
  await move(vinyl, 'SRF', 'SRF-854', '2026-06-08', 49, 'OCBS');
  await move(vinyl, 'RETURN', 'RS-2026-001', '2026-06-09', 20, 'OCBS', 'Unused materials returned');
  const cement = await addItem('Portland Cement (40kg)', 'Cement & Concrete', 'BAGS');
  await move(cement, 'OPENING', 'OPEN-2026-001', '2026-01-11', 10);
  await col.meta.insertOne({ _id: 'demo_seeded', value: 'true' });
}

async function connect() {
  if (!client) {
    throw new Error('Set MONGODB_URI to your MongoDB connection string (for example your MongoDB Atlas SRV URI).');
  }
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'gsd');
  activeDb = db;
  Object.assign(col, {
    users: db.collection('users'),
    items: db.collection('inventory_items'),
    transactions: db.collection('transactions'),
    resetRequests: db.collection('password_reset_requests'),
    sessions: db.collection('sessions'),
    counters: db.collection('counters'),
    meta: db.collection('app_meta')
  });
  await Promise.all([
    col.users.createIndex({ id: 1 }, { unique: true }),
    col.users.createIndex({ username_key: 1 }, { unique: true }),
    col.items.createIndex({ id: 1 }, { unique: true }),
    col.items.createIndex({ name_key: 1 }, { unique: true }),
    col.transactions.createIndex({ id: 1 }, { unique: true }),
    col.transactions.createIndex({ item_id: 1, occurred_on: 1, id: 1 }),
    col.transactions.createIndex({ type: 1, occurred_on: -1, id: -1 }),
    col.transactions.createIndex({ reference_key: 1 }),
    col.resetRequests.createIndex({ id: 1 }, { unique: true }),
    col.resetRequests.createIndex({ status: 1, created_at: -1, id: -1 }),
    col.sessions.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 }),
    col.sessions.createIndex({ user_id: 1 }),
    ...['users', 'inventory_items', 'transactions', 'password_reset_requests'].map(name =>
      col.counters.updateOne({ _id: name }, { $setOnInsert: { seq: 0 } }, { upsert: true })
    )
  ]);
  await seed();
  return db;
}

async function ping() {
  if (!activeDb) throw new Error('Database is not connected.');
  await activeDb.command({ ping: 1 });
}

async function close() {
  if (client) await client.close();
}

module.exports = { client, col, connect, ping, close, nextId, withTransaction, hashPassword, verifyPassword, timestamp };
