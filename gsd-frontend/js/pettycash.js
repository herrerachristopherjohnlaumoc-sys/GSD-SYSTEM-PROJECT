(() => {
  if (document.body?.dataset?.page !== 'pettycash') return;

  const linkEl = document.getElementById('pcPublicLink');
  const copyBtn = document.getElementById('copyPublicLinkBtn');
  const searchInput = document.getElementById('pcSearchInput');
  const statusFilter = document.getElementById('pcStatusFilter');
  const countBadge = document.getElementById('pcCountBadge');
  const tbody = document.getElementById('pcTableBody');

  const editModal = document.getElementById('pcEditModal');
  const editForm = document.getElementById('pcEditForm');
  const returnModal = document.getElementById('pcReturnModal');
  const returnForm = document.getElementById('pcReturnForm');
  const replenishCheck = document.getElementById('pcReplenishCheck');
  const replenishFields = document.getElementById('pcReplenishFields');

  const publicUrl = `${window.location.origin}/request.html`;
  if (linkEl) linkEl.textContent = publicUrl;

  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      gsdToast('Request link copied to clipboard.');
    } catch {
      gsdToast(publicUrl);
    }
  });

  const formatPeso = value => `\u20B1${Number(value || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

  const statusClass = status => ({
    'Pending': 'pc-status-pending',
    'Cash Released': 'pc-status-released',
    'Returned': 'pc-status-returned',
    'Replenished': 'pc-status-replenished',
    'Cancelled': 'pc-status-cancelled'
  }[status] || 'pc-status-pending');

  let requests = [];

  const renderTable = () => {
    const q = searchInput?.value.trim().toLowerCase() || '';
    const status = statusFilter?.value || '';
    const visible = requests.filter(req => {
      const itemText = (req.items || []).map(item => item.particulars).join(' ');
      const text = `${req.request_no} ${req.requestor} ${req.supplier} ${req.purpose} ${itemText}`.toLowerCase();
      return (!q || text.includes(q)) && (!status || req.status === status);
    });
    if (countBadge) {
      countBadge.textContent = `${visible.length} ${visible.length === 1 ? 'request' : 'requests'}`;
    }
    if (!visible.length) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:24px;color:#5a6d62;">No petty cash requests found.</td></tr>';
      return;
    }
    tbody.innerHTML = visible.map(req => `
      <tr>
        <td><strong>${gsdEscape(req.request_no)}</strong></td>
        <td>${gsdDisplayDate(req.request_date)}</td>
        <td>${gsdEscape(req.requestor)}</td>
        <td>
          <strong>${gsdEscape(req.supplier)}</strong><br />
          <small style="color:#5a6d62;">${gsdEscape(req.purpose)}</small>
        </td>
        <td>
          <ul class="pc-items-summary">
            ${(req.items || []).map(item => `<li>${gsdEscape(item.particulars)} (${gsdFormatNumber(item.qty)} &times; ${formatPeso(item.amount)})</li>`).join('')}
          </ul>
        </td>
        <td><strong>${formatPeso(req.total_amount)}</strong></td>
        <td>${formatPeso(req.payment_received)}</td>
        <td><span class="pc-status-badge ${statusClass(req.status)}">${gsdEscape(req.status)}</span></td>
        <td>
          <div class="pc-actions">
            <button type="button" class="pc-act-btn" data-action="edit" data-id="${req.id}">Update</button>
            ${!req.replenished ? `<button type="button" class="pc-act-btn" data-action="return" data-id="${req.id}">Confirm Return</button>` : ''}
            <button type="button" class="pc-act-btn" data-action="print" data-id="${req.id}">Print</button>
            <button type="button" class="pc-act-btn danger" data-action="delete" data-id="${req.id}">Delete</button>
          </div>
        </td>
      </tr>`).join('');
  };

  const loadRequests = async () => {
    const data = await gsdRequest('/petty-cash');
    requests = data.requests || [];
    renderTable();
  };

  const populatePrintSlip = req => {
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('ppcNo', req.request_no);
    set('ppcDate', gsdDisplayDate(req.request_date));
    set('ppcRequestor', req.requestor);
    set('ppcSupplier', req.supplier);
    set('ppcPurpose', req.purpose);
    set('ppcStatus', req.status);
    set('ppcTotal', formatPeso(req.total_amount));
    set('ppcPaid', formatPeso(req.payment_received));
    set('ppcSignRequestor', req.requestor);
    const body = document.getElementById('ppcItemsBody');
    if (body) {
      body.innerHTML = (req.items || []).map((item, idx) => `
        <tr>
          <td style="border:1px solid #374151;padding:6px 8px;text-align:center;">${idx + 1}</td>
          <td style="border:1px solid #374151;padding:6px 8px;">${gsdEscape(item.particulars)}</td>
          <td style="border:1px solid #374151;padding:6px 8px;text-align:center;">${gsdFormatNumber(item.qty)}</td>
          <td style="border:1px solid #374151;padding:6px 8px;text-align:right;">${formatPeso(item.amount)}</td>
          <td style="border:1px solid #374151;padding:6px 8px;text-align:right;">${formatPeso(item.line_total)}</td>
        </tr>`).join('');
    }
  };

  tbody?.addEventListener('click', async event => {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;
    const req = requests.find(item => item.id === Number(btn.dataset.id));
    if (!req) return;

    if (btn.dataset.action === 'edit') {
      document.getElementById('pcEditId').value = req.id;
      document.getElementById('pcEditStatus').value = req.status === 'Replenished' ? 'Returned' : req.status;
      document.getElementById('pcEditPayment').value = req.payment_received ?? 0;
      document.getElementById('pcEditNotes').value = req.notes || '';
      editModal?.classList.add('open');
    } else if (btn.dataset.action === 'return') {
      document.getElementById('pcReturnId').value = req.id;
      document.getElementById('pcReturnDesc').textContent = `Request ${req.request_no} (${req.requestor} • ${(req.items || []).length} item(s))`;
      document.getElementById('pcReplenishDate').value = gsdToday();
      replenishCheck.checked = true;
      replenishFields.hidden = false;
      returnModal?.classList.add('open');
    } else if (btn.dataset.action === 'print') {
      populatePrintSlip(req);
      window.print();
    } else if (btn.dataset.action === 'delete') {
      const ok = await gsdShowDialog({
        title: 'Delete Petty Cash Request?',
        message: `Delete ${req.request_no} from ${req.requestor}? This cannot be undone.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        danger: true
      });
      if (!ok) return;
      try {
        await gsdRequest(`/petty-cash/${req.id}`, { method: 'DELETE' });
        gsdToast('Petty cash request deleted.');
        await loadRequests();
      } catch (error) {
        gsdToast(error.message, true);
      }
    }
  });

  replenishCheck?.addEventListener('change', () => {
    replenishFields.hidden = !replenishCheck.checked;
  });

  document.getElementById('cancelPcEditBtn')?.addEventListener('click', () => editModal?.classList.remove('open'));
  document.getElementById('cancelPcReturnBtn')?.addEventListener('click', () => returnModal?.classList.remove('open'));

  editForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const id = document.getElementById('pcEditId').value;
    try {
      await gsdRequest(`/petty-cash/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: document.getElementById('pcEditStatus').value,
          payment_received: document.getElementById('pcEditPayment').value,
          notes: document.getElementById('pcEditNotes').value
        })
      });
      editModal?.classList.remove('open');
      gsdToast('Petty cash request updated.');
      await loadRequests();
    } catch (error) {
      gsdToast(error.message, true);
    }
  });

  returnForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const id = document.getElementById('pcReturnId').value;
    const replenish = Boolean(replenishCheck?.checked);
    try {
      await gsdRequest(`/petty-cash/${id}/confirm-return`, {
        method: 'POST',
        body: JSON.stringify({
          replenish,
          category: document.getElementById('pcReplenishCategory').value,
          unit: document.getElementById('pcReplenishUnit').value,
          date: document.getElementById('pcReplenishDate').value
        })
      });
      returnModal?.classList.remove('open');
      gsdToast(replenish ? 'Return confirmed and Inventory replenished.' : 'Return confirmed.');
      await loadRequests();
    } catch (error) {
      gsdToast(error.message, true);
    }
  });

  searchInput?.addEventListener('input', renderTable);
  statusFilter?.addEventListener('change', renderTable);

  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
      loadRequests().catch(error => gsdToast(error.message, true));
    }, 150);
  });
})();
