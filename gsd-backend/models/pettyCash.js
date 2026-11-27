const { col, nextId, timestamp } = require('../db');

const PETTY_CASH_STATUSES = ['Pending', 'Cash Released', 'Returned', 'Replenished', 'Cancelled'];

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizePettyCashItems(rawItems, badRequest) {
  if (!Array.isArray(rawItems) || !rawItems.length) {
    throw badRequest('Add at least one item to the request.');
  }
  if (rawItems.length > 25) {
    throw badRequest('Maximum of 25 items per request.');
  }
  return rawItems.map((entry, index) => {
    const particulars = typeof entry?.particulars === 'string' ? entry.particulars.trim() : '';
    if (!particulars || particulars.length > 250) {
      throw badRequest(`Item #${index + 1} particulars must be between 1 and 250 characters.`);
    }
    const qty = Number(entry?.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw badRequest(`Item #${index + 1} quantity must be greater than zero.`);
    }
    const amount = entry?.amount === '' || entry?.amount == null ? 0 : Number(entry.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw badRequest(`Item #${index + 1} amount cannot be negative.`);
    }
    const lineTotal = roundMoney(qty * amount);
    return { particulars, qty, amount: roundMoney(amount), line_total: lineTotal };
  });
}

async function createPettyCashRequest({ requestor, requestDate, supplier, purpose, items, paymentReceived, notes }, session) {
  const id = await nextId('petty_cash_requests', session);
  const compactDate = requestDate.replace(/-/g, '');
  const requestNo = `PC-${compactDate}-${String(id).padStart(4, '0')}`;
  const totalAmount = roundMoney(items.reduce((sum, item) => sum + item.line_total, 0));
  const paid = roundMoney(paymentReceived);
  const doc = {
    id,
    request_no: requestNo,
    requestor,
    request_date: requestDate,
    supplier,
    purpose,
    items,
    total_amount: totalAmount,
    payment_received: paid,
    status: paid > 0 ? 'Cash Released' : 'Pending',
    replenished: false,
    returned_at: null,
    notes: notes || '',
    created_at: timestamp(),
    updated_at: timestamp(),
    updated_by: null
  };
  await col.pettyCash.insertOne(doc, session ? { session } : undefined);
  return doc;
}

module.exports = {
  PETTY_CASH_STATUSES,
  roundMoney,
  normalizePettyCashItems,
  createPettyCashRequest
};
