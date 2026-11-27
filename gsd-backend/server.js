const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { col, connect, ping, close, nextId, withTransaction, hashPassword, verifyPassword, timestamp } = require('./db');

const app = express();
const loginAttempts = new Map();
const frontendDirectory = path.join(__dirname, '..', 'gsd-frontend');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const sessionCookie = 'gsd_session';
const sessionHours = 8;
const production = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
app.set('trust proxy', 1); // Render (and most hosts) terminate HTTPS at a proxy; needed for req.ip / secure cookies.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const badRequest = message => new HttpError(400, message);

// Wraps async handlers so thrown errors become JSON responses instead of unhandled rejections.
const route = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(error => {
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
  if (error?.code === 11000) return res.status(409).json({ error: 'A duplicate record already exists. Please refresh and try again.' });
  console.error(error);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});

const noId = { projection: { _id: 0 } };
const strip = ({ _id, name_key, username_key, reference_key, password_hash, ...rest }) => rest;

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    status: user.status,
    must_change_password: Boolean(user.must_change_password)
  };
}

function parseCookies(header = '') {
  if (!header) return {};
  return Object.fromEntries(header.split(';').map(part => part.trim().split(/=(.*)/s).slice(0, 2)).filter(([key]) => key));
}

function sessionCookieHeader(req, value, maxAgeSeconds) {
  const secure = req.secure || (production && !['localhost', '127.0.0.1'].includes(req.hostname));
  return `${sessionCookie}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}

const tokenHash = token => crypto.createHash('sha256').update(token).digest('base64url');

async function sessionUser(req) {
  const token = parseCookies(req.headers.cookie)[sessionCookie];
  if (!token) return null;
  const session = await col.sessions.findOne({ _id: tokenHash(token), expires_at: { $gt: new Date() } });
  if (!session) return null;
  const user = await col.users.findOne({ id: session.user_id, status: 'Active' });
  if (!user) await col.sessions.deleteOne({ _id: session._id });
  return user ? { user, sessionId: session._id } : null;
}

const requireUser = route(async (req, res, next) => {
  const found = await sessionUser(req);
  if (!found) return res.status(401).json({ error: 'Please sign in to continue.' });
  req.user = found.user;
  req.sessionId = found.sessionId;
  next();
});

function requireAdmin(req, res, next) {
  if (req.user.role !== 'Admin') return res.status(403).json({ error: 'Administrator access is required.' });
  next();
}

function validateText(value, label, maxLength = 180) {
  const text = String(value ?? '').trim();
  if (!text || text.length > maxLength) throw badRequest(`${label} is required and must be ${maxLength} characters or fewer.`);
  return text;
}

function validatePassword(value, message = 'Password must be between 10 and 200 characters.') {
  if (typeof value !== 'string' || !value.trim() || value.length < 10 || value.length > 200) {
    throw badRequest(message);
  }
  return value;
}

function parsePositiveId(raw, label = 'ID') {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest(`Invalid ${label}.`);
  return id;
}

function pruneLoginAttempts(now) {
  if (loginAttempts.size <= 500) return;
  for (const [ip, entry] of loginAttempts) {
    if (now - entry.startedAt >= 60_000) loginAttempts.delete(ip);
  }
}

function dateValue(value) {
  const date = value ? String(value) : new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw badRequest('Enter a valid transaction date.');
  }
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (date > tomorrow) throw badRequest('Transaction date cannot be in the future.');
  return date;
}

const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Only known return-slip fields are stored, as bounded strings.
function cleanDetails(details) {
  const allowed = ['originalSrf', 'returningOffice', 'location', 'department', 'resender', 'receiver', 'reason', 'remarks'];
  const source = details && typeof details === 'object' ? details : {};
  return Object.fromEntries(allowed.filter(key => source[key] != null).map(key => [key, String(source[key]).trim().slice(0, 500)]));
}

async function userNames(ids) {
  const unique = [...new Set(ids.filter(id => id != null))];
  const users = unique.length ? await col.users.find({ id: { $in: unique } }, { projection: { id: 1, name: 1 } }).toArray() : [];
  return new Map(users.map(user => [user.id, user.name]));
}

// ---------- Auth ----------

app.post('/api/auth/login', route(async (req, res) => {
  const now = Date.now();
  pruneLoginAttempts(now);
  const attempt = loginAttempts.get(req.ip);
  if (attempt && now - attempt.startedAt < 60_000 && attempt.count >= 10) {
    return res.status(429).json({ error: 'Too many sign-in attempts. Try again in one minute.' });
  }
  const username = String(req.body?.username || '').trim();
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const user = username && password && password.length <= 500
    ? await col.users.findOne({ username_key: username.toLowerCase() })
    : null;
  if (!user || user.status !== 'Active' || !verifyPassword(password, user.password_hash)) {
    if (!attempt || now - attempt.startedAt >= 60_000) loginAttempts.set(req.ip, { startedAt: now, count: 1 });
    else attempt.count += 1;
    return res.status(401).json({ error: 'Username or password is incorrect.' });
  }
  loginAttempts.delete(req.ip);
  const token = crypto.randomBytes(32).toString('base64url');
  await col.sessions.insertOne({ _id: tokenHash(token), user_id: user.id, expires_at: new Date(now + sessionHours * 3600 * 1000) });
  res.setHeader('Set-Cookie', sessionCookieHeader(req, token, sessionHours * 3600));
  res.json({ user: publicUser(user) });
}));

app.post('/api/auth/logout', route(async (req, res) => {
  const found = await sessionUser(req);
  if (found) await col.sessions.deleteOne({ _id: found.sessionId });
  res.setHeader('Set-Cookie', sessionCookieHeader(req, '', 0));
  res.json({ ok: true });
}));

app.get('/api/auth/me', route(async (req, res) => {
  const found = await sessionUser(req);
  res.json({ user: found ? publicUser(found.user) : null });
}));

app.post('/api/auth/change-password', requireUser, route(async (req, res) => {
  const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
  if (!currentPassword || !verifyPassword(currentPassword, req.user.password_hash)) {
    throw badRequest('Current (temporary) password is incorrect.');
  }
  if (!newPassword.trim() || newPassword.length < 4 || newPassword.length > 200) {
    throw badRequest('New password must be at least 4 characters.');
  }
  if (newPassword === currentPassword) {
    throw badRequest('New password must be different from your temporary password.');
  }
  await col.users.updateOne(
    { id: req.user.id },
    { $set: { password_hash: hashPassword(newPassword), must_change_password: false } }
  );
  res.json({ user: publicUser(await col.users.findOne({ id: req.user.id })) });
}));

app.post('/api/auth/reset-requests', route(async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const reason = String(req.body?.reason || '').trim();
  if (!username || username.length > 80 || reason.length < 10 || reason.length > 1000) {
    return res.status(400).json({ error: 'Enter your username and a reason of at least 10 characters.' });
  }
  const user = await col.users.findOne({ username_key: username.toLowerCase(), status: 'Active' });
  if (user) {
    await col.resetRequests.insertOne({
      id: await nextId('password_reset_requests'), username: user.username, reason, status: 'Pending',
      reviewer_id: null, reviewer_name: null, created_at: timestamp(), reviewed_at: null
    });
  }
  res.status(202).json({ message: 'If the account is active, the reset request has been sent to an administrator.' });
}));

// ---------- Inventory & movements ----------

async function getDefaultReorderPoint(session) {
  const doc = await col.meta.findOne({ _id: 'settings' }, session ? { session } : undefined);
  return Number.isFinite(Number(doc?.default_reorder_point)) && Number(doc.default_reorder_point) >= 0
    ? Number(doc.default_reorder_point)
    : 7;
}

app.get('/api/inventory', requireUser, route(async (req, res) => {
  const [items, defaultReorderPoint] = await Promise.all([
    col.items.find({}, noId).sort({ name_key: 1 }).toArray(),
    getDefaultReorderPoint()
  ]);
  const firsts = await col.transactions.aggregate([
    { $sort: { id: 1 } },
    { $group: { _id: '$item_id', actor_id: { $first: '$actor_id' }, actor_name: { $first: '$actor_name' } } }
  ]).toArray();
  const firstByItem = new Map(firsts.map(row => [row._id, row]));
  const names = await userNames(firsts.map(row => row.actor_id));
  res.json({
    default_reorder_point: defaultReorderPoint,
    items: items.map(item => {
      const first = firstByItem.get(item.id);
      return { ...strip(item), created_by: (first && (names.get(first.actor_id) || first.actor_name)) || 'System' };
    })
  });
}));

app.get('/api/settings/threshold', requireUser, route(async (req, res) => {
  res.json({ default_reorder_point: await getDefaultReorderPoint() });
}));

app.put('/api/settings/threshold', requireUser, route(async (req, res) => {
  const body = req.body || {};
  const threshold = Number(body.default_reorder_point);
  if (!Number.isInteger(threshold) || threshold < 0) {
    throw badRequest('Default low stock threshold must be a whole number (0 or greater).');
  }
  const applyToAll = Boolean(body.apply_to_all);
  await withTransaction(async session => {
    await col.meta.updateOne(
      { _id: 'settings' },
      { $set: { default_reorder_point: threshold, updated_at: timestamp() } },
      { upsert: true, session }
    );
    if (applyToAll) {
      await col.items.updateMany(
        {},
        { $set: { reorder_point: threshold, custom_reorder_point: false } },
        { session }
      );
    } else {
      await col.items.updateMany(
        { custom_reorder_point: { $ne: true } },
        { $set: { reorder_point: threshold } },
        { session }
      );
    }
  });
  res.json({ ok: true, default_reorder_point: threshold, applied_to_all: applyToAll });
}));

app.patch('/api/inventory/:id', requireUser, route(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'item ID');
  const existing = await col.items.findOne({ id });
  if (!existing) return res.status(404).json({ error: 'Inventory item not found.' });
  const body = req.body || {};
  const name = body.name !== undefined ? validateText(body.name, 'Product name') : existing.name;
  const category = body.category !== undefined ? validateText(body.category, 'Category', 120) : existing.category;
  const unit = body.unit !== undefined ? validateText(body.unit, 'Unit', 60) : existing.unit;
  let reorderPoint = existing.reorder_point;
  let customReorderPoint = Boolean(existing.custom_reorder_point);
  if (body.reorder_point !== undefined && body.reorder_point !== '') {
    reorderPoint = Number(body.reorder_point);
    if (!Number.isFinite(reorderPoint) || reorderPoint < 0) throw badRequest('Low stock threshold cannot be negative.');
    customReorderPoint = true;
  }
  const nameKey = name.toLowerCase();
  if (nameKey !== existing.name_key && await col.items.findOne({ name_key: nameKey, id: { $ne: id } })) {
    throw badRequest('Another inventory item already uses that product name.');
  }
  try {
    await col.items.updateOne({ id }, { $set: { name, name_key: nameKey, category, unit, reorder_point: reorderPoint, custom_reorder_point: customReorderPoint } });
  } catch (error) {
    if (error.code === 11000) throw badRequest('Another inventory item already uses that product name.');
    throw error;
  }
  res.json({ item: strip(await col.items.findOne({ id })) });
}));

app.delete('/api/inventory/:id', requireUser, route(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'item ID');
  const existing = await col.items.findOne({ id });
  if (!existing) return res.status(404).json({ error: 'Inventory item not found.' });
  await withTransaction(async session => {
    await col.transactions.deleteMany({ item_id: id }, { session });
    await col.items.deleteOne({ id }, { session });
  });
  res.json({ ok: true });
}));

app.get('/api/transactions', requireUser, route(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 500);
  const filter = ['PO', 'SRF', 'RETURN', 'OPENING'].includes(req.query.type) ? { type: req.query.type } : {};
  const rows = await col.transactions.find(filter, noId).sort({ occurred_on: -1, id: -1 }).limit(limit).toArray();
  const items = await col.items.find({ id: { $in: [...new Set(rows.map(row => row.item_id))] } }, noId).toArray();
  const itemById = new Map(items.map(item => [item.id, item]));
  const names = await userNames(rows.map(row => row.actor_id));
  res.json({ transactions: rows.map(row => ({
    ...strip(row),
    item_name: itemById.get(row.item_id)?.name ?? '(deleted item)',
    unit: itemById.get(row.item_id)?.unit ?? row.metadata?.unit ?? '',
    actor_name: names.get(row.actor_id) || row.actor_name || null
  })) });
}));

app.post('/api/transactions', requireUser, route(async (req, res) => {
  const body = req.body || {};
  const { type } = body;
  if (!['PO', 'SRF', 'RETURN'].includes(type)) throw badRequest('Choose a valid movement type.');
  const reference = validateText(body.reference, 'Reference', 100);
  const itemName = validateText(body.itemName, 'Item name');
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) throw badRequest('Quantity must be greater than zero.');
  const occurredOn = dateValue(body.date);
  const unitCost = body.unitCost === '' || body.unitCost == null ? null : Number(body.unitCost);
  if (unitCost != null && (!Number.isFinite(unitCost) || unitCost < 0)) throw badRequest('Unit cost cannot be negative.');
  const office = body.office ? validateText(body.office, 'Office', 120) : null;
  const details = cleanDetails(body.details);
  const notes = String(body.notes || '').trim().slice(0, 1000);

  const result = await withTransaction(async session => {
    let item = await col.items.findOne({ name_key: itemName.toLowerCase() }, { session });
    if (!item && type !== 'PO') throw badRequest('This item is not in inventory yet.');
    if (!item) {
      const defaultReorderPoint = await getDefaultReorderPoint(session);
      item = {
        id: await nextId('inventory_items', session), name: itemName, name_key: itemName.toLowerCase(),
        category: validateText(body.category, 'Category', 120), unit: validateText(body.unit, 'Unit', 40).toUpperCase(),
        quantity: 0, reorder_point: defaultReorderPoint, custom_reorder_point: false, created_at: timestamp()
      };
      await col.items.insertOne(item, { session });
    }
    if (type === 'RETURN') {
      const originalSrf = validateText(details.originalSrf, 'Original SRF reference', 100);
      const issues = await col.transactions.find({ item_id: item.id, type: 'SRF', reference_key: originalSrf.toLowerCase() }, { session }).toArray();
      if (!issues.length) throw badRequest('The original SRF was not found for this item.');
      const earliestIssueDate = issues.reduce((earliest, row) => (!earliest || row.occurred_on < earliest ? row.occurred_on : earliest), '');
      if (occurredOn < earliestIssueDate) throw badRequest('Return date cannot be earlier than the original SRF date.');
      const issued = issues.reduce((sum, row) => sum + Number(row.quantity), 0);
      const returns = await col.transactions.find({ item_id: item.id, type: 'RETURN' }, { session }).toArray();
      const returned = returns
        .filter(row => String(row.metadata?.originalSrf || '').toLowerCase() === originalSrf.toLowerCase())
        .reduce((sum, row) => sum + Number(row.quantity), 0);
      const remaining = issued - returned;
      if (quantity > remaining) throw badRequest(`Return exceeds unused quantity on the SRF. Returnable: ${remaining} ${item.unit}.`);
    }
    if (type === 'PO') {
      const category = body.category && String(body.category).trim() ? validateText(body.category, 'Category', 120) : item.category;
      const unit = body.unit && String(body.unit).trim() ? validateText(body.unit, 'Unit', 40).toUpperCase() : item.unit;
      await col.items.updateOne({ id: item.id }, { $set: { category, unit }, $inc: { quantity } }, { session });
    } else if (type === 'SRF') {
      // Conditional update: only succeeds when enough stock exists, so stock can never go negative.
      const updated = await col.items.updateOne({ id: item.id, quantity: { $gte: quantity } }, { $inc: { quantity: -quantity } }, { session });
      if (!updated.modifiedCount) throw badRequest(`Insufficient stock. Available: ${item.quantity} ${item.unit}.`);
    } else {
      await col.items.updateOne({ id: item.id }, { $inc: { quantity } }, { session });
    }
    const transactionId = await nextId('transactions', session);
    const movementUnit = body.unit && String(body.unit).trim() ? String(body.unit).trim().toUpperCase().slice(0, 40) : item.unit;
    await col.transactions.insertOne({
      id: transactionId, item_id: item.id, type, reference, reference_key: reference.toLowerCase(), occurred_on: occurredOn,
      quantity, unit_cost: unitCost, office, notes, metadata: { ...details, unit: movementUnit },
      actor_id: req.user.id, actor_name: req.user.name, created_at: timestamp()
    }, { session });
    const updatedItem = await col.items.findOne({ id: item.id }, { session, ...noId });
    return { transactionId, item: strip(updatedItem) };
  });
  res.status(201).json(result);
}));

app.post('/api/return-slips', requireUser, route(async (req, res) => {
  const body = req.body || {};
  const reference = validateText(body.reference, 'Reference', 100);
  const occurredOn = dateValue(body.date);
  const office = body.office ? validateText(body.office, 'Office', 120) : null;
  const details = cleanDetails(body.details);
  const originalSrf = validateText(details.originalSrf, 'Original SRF reference', 100);
  const notes = String(body.notes || details.reason || '').trim().slice(0, 1000);
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length < 1 || rawItems.length > 4) {
    throw badRequest('A return slip must have between 1 and 4 items.');
  }

  const normalizedItems = rawItems.map((entry, idx) => {
    const itemName = validateText(entry?.itemName, `Item #${idx + 1} name`);
    const quantity = Number(entry?.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw badRequest(`Item #${idx + 1} quantity must be greater than zero.`);
    }
    const unit = entry?.unit && String(entry.unit).trim()
      ? validateText(entry.unit, `Item #${idx + 1} unit`, 40).toUpperCase()
      : '';
    const remarks = entry?.remarks != null ? String(entry.remarks).trim().slice(0, 500) : '';
    return { itemName, quantity, unit, remarks };
  });

  const created = await withTransaction(async session => {
    const srfExists = await col.transactions.findOne(
      { type: 'SRF', reference_key: originalSrf.toLowerCase() },
      { session, projection: { _id: 1 } }
    );
    if (!srfExists) {
      throw badRequest(`Original SRF "${originalSrf}" was not found.`);
    }

    const pendingByItemId = new Map();
    const results = [];

    for (const entry of normalizedItems) {
      const item = await col.items.findOne({ name_key: entry.itemName.toLowerCase() }, { session });
      if (!item) throw badRequest(`"${entry.itemName}" is not in inventory yet.`);

      const issues = await col.transactions.find(
        { item_id: item.id, type: 'SRF', reference_key: originalSrf.toLowerCase() },
        { session }
      ).toArray();

      if (issues.length) {
        const earliestIssueDate = issues.reduce(
          (earliest, row) => (!earliest || row.occurred_on < earliest ? row.occurred_on : earliest),
          ''
        );
        if (occurredOn < earliestIssueDate) {
          throw badRequest(`Return date cannot be earlier than the original SRF date for "${item.name}".`);
        }

        const issued = issues.reduce((sum, row) => sum + Number(row.quantity), 0);
        const returns = await col.transactions.find({ item_id: item.id, type: 'RETURN' }, { session }).toArray();
        const alreadyReturned = returns
          .filter(row => String(row.metadata?.originalSrf || '').toLowerCase() === originalSrf.toLowerCase())
          .reduce((sum, row) => sum + Number(row.quantity), 0);
        const pendingQty = pendingByItemId.get(item.id) || 0;
        const remaining = issued - alreadyReturned - pendingQty;
        if (entry.quantity > remaining) {
          throw badRequest(`Return for "${item.name}" exceeds unused quantity on ${originalSrf}. Returnable: ${Math.max(0, remaining)} ${item.unit}.`);
        }
        pendingByItemId.set(item.id, pendingQty + entry.quantity);
      }

      await col.items.updateOne({ id: item.id }, { $inc: { quantity: entry.quantity } }, { session });
      const transactionId = await nextId('transactions', session);
      const movementUnit = entry.unit || item.unit;
      await col.transactions.insertOne({
        id: transactionId,
        item_id: item.id,
        type: 'RETURN',
        reference,
        reference_key: reference.toLowerCase(),
        occurred_on: occurredOn,
        quantity: entry.quantity,
        unit_cost: null,
        office,
        notes,
        metadata: { ...details, remarks: entry.remarks || details.reason || '', unit: movementUnit },
        actor_id: req.user.id,
        actor_name: req.user.name,
        created_at: timestamp()
      }, { session });
      results.push({ transactionId, itemId: item.id, itemName: item.name, quantity: entry.quantity, unit: movementUnit });
    }
    return results;
  });

  res.status(201).json({ reference, items: created });
}));

app.delete('/api/return-slips/:reference', requireUser, route(async (req, res) => {
  const reference = validateText(req.params.reference, 'Return slip reference', 100);
  const rows = await col.transactions.find(
    { type: 'RETURN', reference_key: reference.toLowerCase() },
    noId
  ).toArray();
  if (!rows.length) return res.status(404).json({ error: 'Return slip not found.' });

  await withTransaction(async session => {
    for (const txn of rows) {
      await col.items.updateOne({ id: txn.item_id }, { $inc: { quantity: -txn.quantity } }, { session });
    }
    await col.transactions.deleteMany({ type: 'RETURN', reference_key: reference.toLowerCase() }, { session });
  });
  res.json({ ok: true, deleted: rows.length });
}));

app.delete('/api/transactions/:id', requireUser, route(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'transaction ID');
  const txn = await col.transactions.findOne({ id }, noId);
  if (!txn) return res.status(404).json({ error: 'Transaction not found.' });
  await withTransaction(async session => {
    // RETURN transactions added stock back; reversing one removes that quantity again.
    if (txn.type === 'RETURN') {
      await col.items.updateOne({ id: txn.item_id }, { $inc: { quantity: -txn.quantity } }, { session });
    }
    await col.transactions.deleteOne({ id }, { session });
  });
  res.json({ ok: true });
}));

app.get('/api/stock-card', requireUser, route(async (req, res) => {
  const query = String(req.query.item || '').trim();
  const queryLower = query.toLowerCase();
  const filter = query ? { name_key: { $regex: escapeRegex(queryLower) } } : {};
  let items = await col.items.find(filter, noId).sort({ name_key: 1 }).toArray();
  if (query && !items.length) {
    const codeMatch = query.match(/^PROD0*(\d+)$/i);
    if (codeMatch) {
      items = await col.items.find({ id: Number(codeMatch[1]) }, noId).toArray();
    }
    if (!items.length) {
      const refMatches = await col.transactions.find({ reference_key: { $regex: escapeRegex(queryLower) } }, noId).sort({ occurred_on: -1, id: -1 }).limit(20).toArray();
      const refItemIds = [...new Set(refMatches.map(row => row.item_id))];
      if (refItemIds.length) {
        items = await col.items.find({ id: { $in: refItemIds } }, noId).sort({ name_key: 1 }).toArray();
      }
    }
  }
  const item = items.find(row => row.name_key === queryLower) || items[0] || null;
  if (!item) return res.json({ item: null, transactions: [], matches: [] });
  const rows = await col.transactions.find({ item_id: item.id }, noId).sort({ occurred_on: 1, id: 1 }).toArray();
  const names = await userNames(rows.map(row => row.actor_id));
  let balance = 0;
  const transactions = rows.map(row => {
    balance += row.type === 'SRF' ? -Number(row.quantity) : Number(row.quantity);
    return { ...strip(row), actor_name: names.get(row.actor_id) || row.actor_name || null, balance, metadata: row.metadata || {} };
  });
  res.json({ item: strip(item), transactions, matches: items.map(({ id, name }) => ({ id, name })) });
}));

// ---------- Admin: users & reset requests ----------

const activeAdminCount = () => col.users.countDocuments({ role: 'Admin', status: 'Active' });

app.get('/api/admin/users', requireUser, requireAdmin, route(async (req, res) => {
  const users = await col.users.find({}, { projection: { _id: 0, id: 1, name: 1, username: 1, role: 1, status: 1, created_at: 1 } }).sort({ id: 1 }).toArray();
  res.json({ users });
}));

app.post('/api/admin/users', requireUser, requireAdmin, route(async (req, res) => {
  const name = validateText(req.body?.name, 'Name', 120);
  const username = validateText(req.body?.username, 'Username', 80);
  const password = validatePassword(req.body?.password);
  const role = req.body?.role;
  if (!['Admin', 'Staff'].includes(role)) throw badRequest('Role must be Admin or Staff.');
  if (await col.users.findOne({ username_key: username.toLowerCase() })) throw badRequest('That username is already in use.');
  const user = {
    id: await nextId('users'), name, username, username_key: username.toLowerCase(),
    password_hash: hashPassword(password), role, status: 'Active', created_at: timestamp()
  };
  try {
    await col.users.insertOne(user);
  } catch (error) {
    if (error.code === 11000) throw badRequest('That username is already in use.');
    throw error;
  }
  res.status(201).json({ user: publicUser(user) });
}));

app.patch('/api/admin/users/:id', requireUser, requireAdmin, route(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'user ID');
  const user = await col.users.findOne({ id });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const { role, status, password } = req.body || {};
  if (role && !['Admin', 'Staff'].includes(role)) throw badRequest('Role must be Admin or Staff.');
  if (status && !['Active', 'Inactive'].includes(status)) throw badRequest('Status must be Active or Inactive.');
  const validPassword = password !== undefined && password !== '' ? validatePassword(password) : null;
  if (user.id === req.user.id && status === 'Inactive') throw badRequest('You cannot deactivate your own account.');
  if (user.role === 'Admin' && user.status === 'Active' && (role === 'Staff' || status === 'Inactive') && await activeAdminCount() <= 1) {
    throw badRequest('At least one active administrator must remain.');
  }
  const changes = {};
  if (role) changes.role = role;
  if (status) changes.status = status;
  if (validPassword) {
    changes.password_hash = hashPassword(validPassword);
    changes.must_change_password = true;
  }
  if (Object.keys(changes).length) await col.users.updateOne({ id }, { $set: changes });
  // A password change or deactivation signs the user out everywhere (except the admin's own current session).
  if (validPassword || status === 'Inactive') await col.sessions.deleteMany({ user_id: id, _id: { $ne: req.sessionId } });
  res.json({ user: publicUser(await col.users.findOne({ id })) });
}));

app.delete('/api/admin/users/:id', requireUser, requireAdmin, route(async (req, res) => {
  const id = parsePositiveId(req.params.id, 'user ID');
  const user = await col.users.findOne({ id });
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (id === req.user.id) throw badRequest('You cannot delete your own account.');
  if (user.role === 'Admin' && user.status === 'Active' && await activeAdminCount() <= 1) {
    throw badRequest('At least one active administrator must remain.');
  }
  await col.users.deleteOne({ id });
  await col.sessions.deleteMany({ user_id: id });
  res.json({ ok: true }); // Movement history keeps the stored actor_name for the audit trail.
}));

app.get('/api/admin/reset-requests', requireUser, requireAdmin, route(async (req, res) => {
  const requests = await col.resetRequests.find({}, noId).sort({ created_at: -1, id: -1 }).toArray();
  res.json({ requests });
}));

app.patch('/api/admin/reset-requests/:id', requireUser, requireAdmin, route(async (req, res) => {
  const status = req.body?.status;
  if (!['Approved', 'Declined'].includes(status)) throw badRequest('Choose Approved or Declined.');
  const requestId = parsePositiveId(req.params.id, 'request ID');
  const request = await col.resetRequests.findOne({ id: requestId, status: 'Pending' });
  if (!request) return res.status(404).json({ error: 'Pending request not found.' });
  let account = null;
  let passwordHash = null;
  if (status === 'Approved') {
    const password = validatePassword(req.body?.password, 'Provide a temporary password between 10 and 200 characters.');
    account = await col.users.findOne({ username_key: request.username.toLowerCase(), status: 'Active' });
    if (!account) throw badRequest('The account is no longer active.');
    passwordHash = hashPassword(password);
  }
  await withTransaction(async session => {
    if (account) {
      await col.users.updateOne({ id: account.id }, { $set: { password_hash: passwordHash, must_change_password: true } }, { session });
      await col.sessions.deleteMany({ user_id: account.id }, { session });
    }
    await col.resetRequests.updateOne({ id: requestId, status: 'Pending' }, {
      $set: { status, reviewer_id: req.user.id, reviewer_name: req.user.name, reviewed_at: timestamp() }
    }, { session });
  });
  res.json({ ok: true });
}));

// ---------- Admin: backup & wipe ----------

app.get('/api/admin/backup', requireUser, requireAdmin, route(async (req, res) => {
  const all = async (collection, sort = { id: 1 }) => (await collection.find({}, noId).sort(sort).toArray()).map(strip);
  const backup = {
    exportedAt: new Date().toISOString(),
    inventory: await all(col.items),
    transactions: await all(col.transactions),
    users: await all(col.users),
    passwordResetRequests: await all(col.resetRequests)
  };
  res.setHeader('Content-Disposition', `attachment; filename="gsd-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(backup);
}));

app.post('/api/admin/wipe', requireUser, requireAdmin, route(async (req, res) => {
  if (req.body?.confirmation !== 'WIPE') throw badRequest('Type WIPE to confirm.');
  await withTransaction(async session => {
    await col.transactions.deleteMany({}, { session });
    await col.items.deleteMany({}, { session });
    await col.resetRequests.deleteMany({}, { session });
  });
  res.json({ ok: true });
}));

app.get('/api/health', route(async (req, res) => {
  await ping();
  res.json({ ok: true });
}));

app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found.' });
});

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ error: 'Invalid JSON request body.' });
  }
  console.error(error);
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.' });
});

// ---------- Pages ----------

// Server-side page guard: logged-out users only see the login page, Staff never receive admin pages.
const protectedPages = new Set(['inventory.html', 'purchaseorder.html', 'stockout.html', 'stockcard.html', 'returnslip.html', 'settings.html', 'usermanagement.html']);
const adminPages = new Set(['settings.html', 'usermanagement.html']);
app.use(route(async (req, res, next) => {
  const page = req.path.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (!protectedPages.has(page)) return next();
  const found = await sessionUser(req);
  if (!found) return res.redirect('/index.html');
  if (adminPages.has(page) && found.user.role !== 'Admin') return res.redirect('/inventory.html');
  res.setHeader('Cache-Control', 'no-store');
  next();
}));
app.use(express.static(frontendDirectory));
app.get('*', (req, res) => res.sendFile(path.join(frontendDirectory, 'index.html')));

connect().then(() => {
  const server = app.listen(port, host, () => {
    console.log(`GSD Inventory System listening on http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    if (!production) console.log('Demo accounts: gsd_admin / ChangeMe!2026 and gsd_staff / StaffPass!2026');
  });
  const shutdown = () => server.close(() => close().finally(() => process.exit(0)));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}).catch(error => {
  console.error('Failed to start:', error.message);
  process.exit(1);
});
