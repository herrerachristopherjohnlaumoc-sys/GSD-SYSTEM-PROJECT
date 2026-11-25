const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

function findOpenPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function run() {
  // Throwaway single-node replica set (transactions need a replica set, like Atlas provides).
  const { MongoMemoryReplSet } = require('mongodb-memory-server-core');
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  const port = await findOpenPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    cwd: __dirname,
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), MONGODB_URI: mongo.getUri(), MONGODB_DB: 'gsd_test' },
    stdio: ['ignore', 'ignore', 'inherit']
  });

  async function request(route, { method = 'GET', body, cookie } = {}) {
    const response = await fetch(`${baseUrl}${route}`, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = (response.headers.get('content-type') || '').includes('application/json')
      ? await response.json()
      : null;
    return { response, data };
  }

  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const health = await fetch(`${baseUrl}/api/health`);
        if (health.ok) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'API server did not start');

    let result = await request('/api/auth/login', {
      method: 'POST', body: { username: 'gsd_admin', password: 'ChangeMe!2026' }
    });
    assert.equal(result.response.status, 200);
    const adminCookie = result.response.headers.get('set-cookie').split(';')[0];

    result = await request('/api/transactions', {
      method: 'POST', cookie: adminCookie,
      body: { type: 'PO', reference: 'PO-QA-001', itemName: 'QA TEST ITEM', category: 'Testing', unit: 'PCS', quantity: 10, unitCost: 2 }
    });
    assert.equal(result.response.status, 201);
    for (const movement of [
      { type: 'SRF', reference: 'SRF-QA-001', itemName: 'QA TEST ITEM', quantity: 4, office: 'QA' },
      { type: 'RETURN', reference: 'RS-QA-001', itemName: 'QA TEST ITEM', quantity: 2, unit: 'PCS', office: 'QA', details: { originalSrf: 'SRF-QA-001', reason: 'smoke test' } }
    ]) {
      result = await request('/api/transactions', { method: 'POST', cookie: adminCookie, body: movement });
      assert.equal(result.response.status, 201);
    }

    result = await request('/api/stock-card?item=QA%20TEST%20ITEM', { cookie: adminCookie });
    assert.deepEqual(result.data.transactions.map(row => row.balance), [10, 6, 8]);
    result = await request('/api/transactions', {
      method: 'POST', cookie: adminCookie,
      body: { type: 'SRF', reference: 'SRF-QA-002', itemName: 'QA TEST ITEM', quantity: 999, office: 'QA' }
    });
    assert.equal(result.response.status, 400);
    assert.match(result.data.error, /Insufficient stock/);
    result = await request('/api/transactions', {
      method: 'POST', cookie: adminCookie,
      body: { type: 'RETURN', reference: 'RS-QA-002', itemName: 'QA TEST ITEM', quantity: 3, unit: 'PCS', details: { originalSrf: 'SRF-QA-001' } }
    });
    assert.equal(result.response.status, 400);
    assert.match(result.data.error, /Return exceeds unused quantity/);
    result = await request('/api/transactions', {
      method: 'POST', cookie: adminCookie,
      body: { type: 'RETURN', reference: 'RS-QA-EARLY', itemName: 'QA TEST ITEM', quantity: 1, unit: 'PCS', date: '2020-01-01', details: { originalSrf: 'SRF-QA-001' } }
    });
    assert.equal(result.response.status, 400);
    assert.match(result.data.error, /earlier than the original SRF date/);

    // Stock card lookup by reference and PROD code, plus API 404/400 JSON errors.
    result = await request('/api/stock-card?item=SRF-QA-001', { cookie: adminCookie });
    assert.equal(result.response.status, 200);
    assert.equal(result.data.item.name, 'QA TEST ITEM');
    result = await request(`/api/stock-card?item=PROD${String(result.data.item.id).padStart(4, '0')}`, { cookie: adminCookie });
    assert.equal(result.response.status, 200);
    assert.equal(result.data.item.name, 'QA TEST ITEM');
    result = await request('/api/does-not-exist', { cookie: adminCookie });
    assert.equal(result.response.status, 404);
    assert.ok(result.data?.error);
    const badJsonResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid-json'
    });
    assert.equal(badJsonResponse.status, 400);
    assert.ok((await badJsonResponse.json())?.error);

    result = await request('/api/auth/reset-requests', {
      method: 'POST', body: { username: 'gsd_staff', reason: 'Integration test of controlled password reset.' }
    });
    assert.equal(result.response.status, 202);
    const requests = await request('/api/admin/reset-requests', { cookie: adminCookie });
    const resetRequest = requests.data.requests.find(row => row.username === 'gsd_staff' && row.status === 'Pending');
    assert.ok(resetRequest);
    result = await request(`/api/admin/reset-requests/${resetRequest.id}`, {
      method: 'PATCH', cookie: adminCookie, body: { status: 'Approved', password: 'TempPass!2026' }
    });
    assert.equal(result.response.status, 200);

    result = await request('/api/auth/login', {
      method: 'POST', body: { username: 'gsd_staff', password: 'TempPass!2026' }
    });
    assert.equal(result.response.status, 200);
    const staffCookie = result.response.headers.get('set-cookie').split(';')[0];
    result = await request('/api/admin/users', { cookie: staffCookie });
    assert.equal(result.response.status, 403);

    // Page guards: logged-out -> login page, Staff -> no admin pages.
    const pageRedirect = async (route, cookie) => {
      const response = await fetch(`${baseUrl}${route}`, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} });
      return response.status >= 300 && response.status < 400 ? response.headers.get('location') : response.status;
    };
    assert.equal(await pageRedirect('/inventory.html'), '/index.html');
    assert.equal(await pageRedirect('/settings.html', staffCookie), '/inventory.html');
    assert.equal(await pageRedirect('/usermanagement.html', staffCookie), '/inventory.html');
    assert.equal(await pageRedirect('/stockcard.html', staffCookie), 200);
    assert.equal(await pageRedirect('/settings.html', adminCookie), 200);

    // Type filter on recent transactions and dated movements.
    result = await request('/api/transactions?type=PO&limit=50', { cookie: adminCookie });
    assert.ok(result.data.transactions.length > 0 && result.data.transactions.every(row => row.type === 'PO'));
    result = await request('/api/transactions', {
      method: 'POST', cookie: adminCookie,
      body: { type: 'PO', reference: 'PO-QA-FUTURE', itemName: 'QA TEST ITEM', quantity: 1, date: '2999-01-01' }
    });
    assert.equal(result.response.status, 400);
    assert.match(result.data.error, /future/);
    result = await request('/api/transactions', {
      method: 'POST', cookie: adminCookie,
      body: { type: 'PO', reference: 'PO-QA-DATED', itemName: 'QA TEST ITEM', quantity: 1, date: '2026-01-15' }
    });
    assert.equal(result.response.status, 201);
    result = await request('/api/stock-card?item=QA%20TEST%20ITEM', { cookie: adminCookie });
    assert.equal(result.data.transactions[0].reference, 'PO-QA-DATED');

    // Concurrent stock-outs must never oversell (stock is 9 here: 10 - 4 + 2 + 1).
    const parallel = await Promise.all([1, 2, 3, 4, 5].map(n => request('/api/transactions', {
      method: 'POST', cookie: adminCookie,
      body: { type: 'SRF', reference: `SRF-QA-PAR-${n}`, itemName: 'QA TEST ITEM', quantity: 3, office: 'QA' }
    })));
    assert.equal(parallel.filter(r => r.response.status === 201).length, 3);
    result = await request('/api/stock-card?item=QA%20TEST%20ITEM', { cookie: adminCookie });
    assert.equal(result.data.item.quantity, 0);
    assert.equal(result.data.transactions.at(-1).balance, 0);

    result = await request('/api/admin/backup', { cookie: adminCookie });
    assert.equal(result.response.status, 200);
    assert.ok(result.data.inventory.some(item => item.name === 'QA TEST ITEM'));
    result = await request('/api/admin/users', {
      method: 'POST', cookie: adminCookie,
      body: { name: 'Temporary QA User', username: `qa_${crypto.randomUUID().slice(0, 8)}`, password: 'Temporary!2026', role: 'Staff' }
    });
    assert.equal(result.response.status, 201);
    assert.equal(result.data.user.role, 'Staff');
    const temporaryUserId = result.data.user.id;
    result = await request(`/api/admin/users/${temporaryUserId}`, { method: 'DELETE', cookie: adminCookie });
    assert.equal(result.response.status, 200);
    result = await request('/api/admin/users/abc', { method: 'PATCH', cookie: adminCookie, body: { status: 'Inactive' } });
    assert.equal(result.response.status, 400);
    result = await request('/api/admin/users/1', { method: 'DELETE', cookie: adminCookie });
    assert.equal(result.response.status, 400);
    result = await request('/api/admin/wipe', { method: 'POST', cookie: adminCookie, body: { confirmation: 'NO' } });
    assert.equal(result.response.status, 400);
    result = await request('/api/admin/wipe', { method: 'POST', cookie: adminCookie, body: { confirmation: 'WIPE' } });
    assert.equal(result.response.status, 200);
    result = await request('/api/inventory', { cookie: adminCookie });
    assert.equal(result.data.items.length, 0);

    // Logout clears session.
    result = await request('/api/auth/logout', { method: 'POST', cookie: staffCookie, body: {} });
    assert.equal(result.response.status, 200);
    result = await request('/api/auth/me', { cookie: staffCookie });
    assert.equal(result.data.user, null);

    console.log('PASS: movement balances, return limits, user lifecycle, reset approval, Staff denial, page guards, dated movements, backup, confirmed wipe, and logout');
  } finally {
    child.kill();
    if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
    await mongo.stop();
  }
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
