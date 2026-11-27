const express = require('express');
const { col, nextId, withTransaction, timestamp } = require('../db');
const {
  PETTY_CASH_STATUSES,
  roundMoney,
  normalizePettyCashItems,
  createPettyCashRequest
} = require('../models/pettyCash');

function createPettyCashRouter({
  route,
  requireUser,
  requirePettyCashAccess,
  validateText,
  dateValue,
  parsePositiveId,
  badRequest,
  getDefaultReorderPoint
}) {
  const router = express.Router();
  const noId = { projection: { _id: 0 } };

  // Public submission endpoint (no login required — opened via QR code / direct link).
  router.post('/public', route(async (req, res) => {
    const body = req.body || {};
    const requestor = validateText(body.requestor, 'Requestor', 120);
    const requestDate = dateValue(body.date);
    const supplier = validateText(body.supplier, 'Supplier', 150);
    const purpose = validateText(body.purpose, 'Purpose', 500);
    const items = normalizePettyCashItems(body.items, badRequest);
    const paymentRaw = body.payment_received === '' || body.payment_received == null ? 0 : Number(body.payment_received);
    if (!Number.isFinite(paymentRaw) || paymentRaw < 0) {
      throw badRequest('Payment received cannot be negative.');
    }
    const notes = body.notes ? String(body.notes).trim().slice(0, 500) : '';
    const created = await createPettyCashRequest({
      requestor,
      requestDate,
      supplier,
      purpose,
      items,
      paymentReceived: paymentRaw,
      notes
    });
    const { _id, ...clean } = created;
    res.status(201).json({ request: clean });
  }));

  // Protected internal queue & search (Admin and Petty Cash roles).
  router.get('/', requireUser, requirePettyCashAccess, route(async (req, res) => {
    const filter = {};
    if (PETTY_CASH_STATUSES.includes(req.query.status)) {
      filter.status = req.query.status;
    }
    const rows = await col.pettyCash.find(filter, noId).sort({ request_date: -1, id: -1 }).limit(500).toArray();
    const q = String(req.query.q || '').trim().toLowerCase();
    const filtered = q
      ? rows.filter(row => {
          const itemText = (row.items || []).map(item => item.particulars).join(' ');
          return `${row.request_no} ${row.requestor} ${row.supplier} ${row.purpose} ${itemText}`.toLowerCase().includes(q);
        })
      : rows;
    res.json({ requests: filtered });
  }));

  router.patch('/:id', requireUser, requirePettyCashAccess, route(async (req, res) => {
    const id = parsePositiveId(req.params.id, 'petty cash request ID');
    const existing = await col.pettyCash.findOne({ id }, noId);
    if (!existing) return res.status(404).json({ error: 'Petty cash request not found.' });

    const body = req.body || {};
    const changes = { updated_at: timestamp(), updated_by: req.user.name };
    if (body.status !== undefined) {
      if (!PETTY_CASH_STATUSES.includes(body.status)) {
        throw badRequest('Invalid petty cash request status.');
      }
      changes.status = body.status;
      if (body.status === 'Returned' && !existing.returned_at) {
        changes.returned_at = timestamp();
      }
    }
    if (body.payment_received !== undefined && body.payment_received !== '') {
      const paid = Number(body.payment_received);
      if (!Number.isFinite(paid) || paid < 0) throw badRequest('Payment received cannot be negative.');
      changes.payment_received = roundMoney(paid);
    }
    if (body.notes !== undefined) {
      changes.notes = String(body.notes || '').trim().slice(0, 500);
    }
    await col.pettyCash.updateOne({ id }, { $set: changes });
    const updated = await col.pettyCash.findOne({ id }, noId);
    res.json({ request: updated });
  }));

  // Confirm return of items to GSD and optionally replenish Inventory + Stock Card.
  router.post('/:id/confirm-return', requireUser, requirePettyCashAccess, route(async (req, res) => {
    const id = parsePositiveId(req.params.id, 'petty cash request ID');
    const existing = await col.pettyCash.findOne({ id }, noId);
    if (!existing) return res.status(404).json({ error: 'Petty cash request not found.' });

    const body = req.body || {};
    const replenish = Boolean(body.replenish);
    const notes = body.notes !== undefined ? String(body.notes || '').trim().slice(0, 500) : existing.notes;
    const defaultCategory = body.category ? validateText(body.category, 'Category', 120) : 'Petty Cash Supplies';
    const defaultUnit = body.unit ? validateText(body.unit, 'Unit', 40).toUpperCase() : 'PCS';
    const occurredOn = dateValue(body.date);

    if (replenish && existing.replenished) {
      throw badRequest('This request has already been replenished to inventory.');
    }

    const updated = await withTransaction(async session => {
      if (replenish) {
        const defaultReorderPoint = await getDefaultReorderPoint(session);
        const replenishItems = Array.isArray(body.items) && body.items.length
          ? body.items
          : existing.items;

        for (const entry of replenishItems) {
          const itemName = validateText(entry?.particulars || entry?.itemName, 'Item name');
          const qty = Number(entry?.qty ?? entry?.quantity);
          if (!Number.isFinite(qty) || qty <= 0) {
            throw badRequest(`Quantity for "${itemName}" must be greater than zero.`);
          }
          const category = entry?.category ? validateText(entry.category, 'Category', 120) : defaultCategory;
          const unit = entry?.unit ? validateText(entry.unit, 'Unit', 40).toUpperCase() : defaultUnit;
          const unitCost = entry?.amount != null && Number.isFinite(Number(entry.amount)) ? Number(entry.amount) : null;

          let item = await col.items.findOne({ name_key: itemName.toLowerCase() }, { session });
          if (!item) {
            item = {
              id: await nextId('inventory_items', session),
              name: itemName,
              name_key: itemName.toLowerCase(),
              category,
              unit,
              quantity: 0,
              reorder_point: defaultReorderPoint,
              custom_reorder_point: false,
              created_at: timestamp()
            };
            await col.items.insertOne(item, { session });
          }

          await col.items.updateOne(
            { id: item.id },
            { $inc: { quantity: qty } },
            { session }
          );

          const txnId = await nextId('transactions', session);
          await col.transactions.insertOne({
            id: txnId,
            item_id: item.id,
            type: 'PO',
            reference: existing.request_no,
            reference_key: existing.request_no.toLowerCase(),
            occurred_on: occurredOn,
            quantity: qty,
            unit_cost: unitCost,
            office: existing.requestor,
            notes: `Petty cash replenishment (${existing.supplier})`,
            metadata: { source: 'petty_cash', request_id: existing.id, supplier: existing.supplier, unit },
            actor_id: req.user.id,
            actor_name: req.user.name,
            created_at: timestamp()
          }, { session });
        }
      }

      const nextStatus = replenish ? 'Replenished' : 'Returned';
      await col.pettyCash.updateOne(
        { id },
        {
          $set: {
            status: nextStatus,
            replenished: existing.replenished || replenish,
            returned_at: existing.returned_at || timestamp(),
            notes: notes || '',
            updated_at: timestamp(),
            updated_by: req.user.name
          }
        },
        { session }
      );
      return col.pettyCash.findOne({ id }, { session, ...noId });
    });

    res.json({ request: updated });
  }));

  router.delete('/:id', requireUser, requirePettyCashAccess, route(async (req, res) => {
    const id = parsePositiveId(req.params.id, 'petty cash request ID');
    const existing = await col.pettyCash.findOne({ id }, noId);
    if (!existing) return res.status(404).json({ error: 'Petty cash request not found.' });
    await col.pettyCash.deleteOne({ id });
    res.json({ ok: true });
  }));

  return router;
}

module.exports = createPettyCashRouter;
