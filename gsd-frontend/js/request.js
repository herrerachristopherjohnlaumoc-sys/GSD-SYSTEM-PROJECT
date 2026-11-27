(() => {
  const form = document.getElementById('pettyCashPublicForm');
  const formCard = document.getElementById('requestFormCard');
  const successCard = document.getElementById('requestSuccessCard');
  const itemsContainer = document.getElementById('reqItemsContainer');
  const addItemBtn = document.getElementById('addReqItemBtn');
  const dateInput = document.getElementById('reqDate');
  const grandTotalEl = document.getElementById('reqGrandTotal');
  const errorEl = document.getElementById('reqFormError');
  const submitBtn = document.getElementById('reqSubmitBtn');

  const todayIso = () => {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
  };

  const formatPeso = value => `\u20B1${Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);

  const setError = (msg = '') => {
    errorEl.textContent = msg;
    errorEl.hidden = !msg;
  };

  const updateTotals = () => {
    let grand = 0;
    itemsContainer.querySelectorAll('.req-item-row').forEach((row, index) => {
      const idxEl = row.querySelector('.req-item-index');
      if (idxEl) idxEl.textContent = `Item ${index + 1}`;
      const removeBtn = row.querySelector('.req-item-remove');
      if (removeBtn) removeBtn.hidden = itemsContainer.children.length <= 1;

      const qty = Number(row.querySelector('.req-item-qty')?.value) || 0;
      const amount = Number(row.querySelector('.req-item-amount')?.value) || 0;
      const lineTotal = Math.round(qty * amount * 100) / 100;
      grand += lineTotal;
      const lineEl = row.querySelector('.req-line-total strong');
      if (lineEl) lineEl.textContent = formatPeso(lineTotal);
    });
    grandTotalEl.textContent = formatPeso(grand);
  };

  const addItemRow = () => {
    if (itemsContainer.children.length >= 25) return;
    const row = document.createElement('div');
    row.className = 'req-item-row';
    row.innerHTML = `
      <div class="req-item-row-top">
        <span class="req-item-index">Item</span>
        <button type="button" class="req-item-remove">Remove</button>
      </div>
      <div class="req-item-grid">
        <div class="req-field span-2" style="margin-bottom:0;">
          <label>Particulars *</label>
          <input type="text" class="req-item-particulars" placeholder="Item description / specification" required maxlength="250" />
        </div>
        <div class="req-field" style="margin-bottom:0;">
          <label>Qty *</label>
          <input type="number" class="req-item-qty" min="1" step="1" placeholder="1" required />
        </div>
        <div class="req-field" style="margin-bottom:0;">
          <label>Unit Amount (&#8369;) *</label>
          <input type="number" class="req-item-amount" min="0" step="0.01" placeholder="0.00" required />
        </div>
      </div>
      <div class="req-line-total">
        <span>Line Total</span>
        <strong>&#8369;0.00</strong>
      </div>`;

    row.querySelectorAll('.req-item-qty, .req-item-amount').forEach(input => {
      input.addEventListener('input', updateTotals);
    });
    row.querySelector('.req-item-remove').addEventListener('click', () => {
      if (itemsContainer.children.length <= 1) return;
      row.remove();
      updateTotals();
    });
    itemsContainer.appendChild(row);
    updateTotals();
  };

  const resetForm = () => {
    form.reset();
    if (dateInput) {
      dateInput.value = todayIso();
      dateInput.max = todayIso();
    }
    itemsContainer.replaceChildren();
    addItemRow();
    setError('');
  };

  resetForm();
  addItemBtn.addEventListener('click', addItemRow);
  form.addEventListener('input', () => setError(''));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    setError('');
    const items = [...itemsContainer.querySelectorAll('.req-item-row')].map(row => ({
      particulars: row.querySelector('.req-item-particulars').value.trim(),
      qty: Number(row.querySelector('.req-item-qty').value),
      amount: Number(row.querySelector('.req-item-amount').value)
    }));
    const payload = {
      requestor: document.getElementById('reqRequestor').value.trim(),
      date: dateInput.value || todayIso(),
      supplier: document.getElementById('reqSupplier').value.trim(),
      purpose: document.getElementById('reqPurpose').value.trim(),
      items,
      payment_received: Number(document.getElementById('reqPaymentReceived').value || 0)
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    try {
      const response = await fetch('/api/petty-cash/public', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not submit request.');

      const req = data.request;
      document.getElementById('reqConfirmNo').textContent = req.request_no;
      document.getElementById('reqConfirmSummary').innerHTML = `
        <div><dt>Requestor</dt><dd>${escapeHtml(req.requestor)}</dd></div>
        <div><dt>Supplier</dt><dd>${escapeHtml(req.supplier)}</dd></div>
        <div><dt>Items</dt><dd>${req.items.length} item(s)</dd></div>
        <div><dt>Grand Total</dt><dd>${formatPeso(req.total_amount)}</dd></div>
        <div><dt>Payment Received</dt><dd>${formatPeso(req.payment_received)}</dd></div>
        <div><dt>Status</dt><dd>${escapeHtml(req.status)}</dd></div>`;
      formCard.hidden = true;
      successCard.hidden = false;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      setError(error.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Petty Cash Request';
    }
  });

  document.getElementById('submitAnotherBtn').addEventListener('click', () => {
    resetForm();
    successCard.hidden = true;
    formCard.hidden = false;
  });
})();
