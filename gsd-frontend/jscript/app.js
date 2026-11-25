const GSD_API = '/api';
const GSD_PAGE_SIZE = 10;

async function gsdRequest(path, options = {}) {
  const response = await fetch(`${GSD_API}${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(payload?.error || 'The request could not be completed.');
  return payload;
}

function gsdEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function gsdToast(message, isError = false) {
  let toast = document.getElementById('toast') || document.getElementById('toastBanner');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  clearTimeout(gsdToast.timer);
  gsdToast.timer = setTimeout(() => toast.classList.remove('show'), 3200);
}

// Asks the admin for a new password in a modal (masked input, min length, confirmation field).
// Resolves to the password, or null when cancelled.
function gsdPromptPassword(title, message) {
  const dialog = document.createElement('dialog');
  dialog.className = 'gsd-dialog';
  dialog.innerHTML = `
    <div class="gsd-dialog-mark" aria-hidden="true">GSD</div>
    <h2 class="gsd-dialog-title"></h2>
    <p class="gsd-dialog-message"></p>
    <form method="dialog" class="gsd-dialog-form">
      <label>New password<input type="password" name="password" minlength="10" maxlength="200" required autocomplete="new-password"></label>
      <label>Confirm password<input type="password" name="confirm" minlength="10" maxlength="200" required autocomplete="new-password"></label>
      <p class="gsd-dialog-error" role="alert"></p>
      <div class="gsd-dialog-actions">
        <button type="button" class="gsd-dialog-button secondary" value="cancel">Cancel</button>
        <button type="submit" class="gsd-dialog-button primary">Set password</button>
      </div>
    </form>`;
  dialog.querySelector('.gsd-dialog-title').textContent = title;
  dialog.querySelector('.gsd-dialog-message').textContent = message;
  document.body.appendChild(dialog);
  const form = dialog.querySelector('form');
  const error = dialog.querySelector('.gsd-dialog-error');
  return new Promise(resolve => {
    let result = null;
    dialog.querySelector('button[value="cancel"]').addEventListener('click', () => dialog.close());
    form.addEventListener('submit', event => {
      if (!form.password.value.trim()) {
        event.preventDefault();
        error.textContent = 'Password cannot be blank spaces.';
        return;
      }
      if (form.password.value !== form.confirm.value) {
        event.preventDefault();
        error.textContent = 'The passwords do not match.';
        return;
      }
      result = form.password.value;
    });
    dialog.addEventListener('close', () => { dialog.remove(); resolve(result); }, { once: true });
    dialog.showModal();
    form.password.focus();
  });
}

function gsdShowDialog({ title, message, confirmLabel = 'OK', cancelLabel = null, danger = false }) {
  let dialog = document.getElementById('gsdMessageDialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'gsdMessageDialog';
    dialog.className = 'gsd-dialog';
    dialog.innerHTML = `
      <div class="gsd-dialog-mark" aria-hidden="true">GSD</div>
      <h2 class="gsd-dialog-title"></h2>
      <p class="gsd-dialog-message"></p>
      <div class="gsd-dialog-actions"></div>`;
    document.body.appendChild(dialog);
    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close('cancel');
    });
  }

  dialog.querySelector('.gsd-dialog-title').textContent = title;
  dialog.querySelector('.gsd-dialog-message').textContent = message;
  const actions = dialog.querySelector('.gsd-dialog-actions');
  actions.replaceChildren();

  if (cancelLabel) {
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'gsd-dialog-button secondary';
    cancelButton.textContent = cancelLabel;
    cancelButton.addEventListener('click', () => dialog.close('cancel'));
    actions.appendChild(cancelButton);
  }

  const confirmButton = document.createElement('button');
  confirmButton.type = 'button';
  confirmButton.className = `gsd-dialog-button${danger ? ' danger' : ' primary'}`;
  confirmButton.textContent = confirmLabel;
  confirmButton.addEventListener('click', () => dialog.close('confirm'));
  actions.appendChild(confirmButton);

  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
    confirmButton.focus();
  });
}

function gsdToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function gsdDisplayDate(value) {
  if (!value) return '';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-GB');
}

function gsdFormatNumber(value) {
  return Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function gsdDaysBetween(earlierDate, laterDate) {
  const first = new Date(`${String(earlierDate || '').slice(0, 10)}T00:00:00Z`);
  const second = new Date(`${String(laterDate || '').slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(first.getTime()) || Number.isNaN(second.getTime())) return null;
  const diff = Math.round((second.getTime() - first.getTime()) / (1000 * 60 * 60 * 24));
  return diff >= 0 ? diff : 0;
}

function gsdEnsurePagination(id, afterElement) {
  let pagination = document.getElementById(id);
  if (!pagination && afterElement) {
    pagination = document.createElement('nav');
    pagination.id = id;
    pagination.className = 'gsd-pagination';
    pagination.setAttribute('aria-label', 'Table pagination');
    afterElement.insertAdjacentElement('afterend', pagination);
  }
  return pagination;
}

function gsdRenderPagination(container, totalRows, currentPage, onPageChange) {
  if (!container) return 1;
  const pageCount = Math.max(1, Math.ceil(totalRows / GSD_PAGE_SIZE));
  const page = Math.min(Math.max(currentPage, 1), pageCount);
  const firstRow = totalRows ? (page - 1) * GSD_PAGE_SIZE + 1 : 0;
  const lastRow = Math.min(page * GSD_PAGE_SIZE, totalRows);
  const summary = document.createElement('span');
  summary.className = 'gsd-pagination-summary';
  summary.setAttribute('aria-live', 'polite');
  summary.textContent = totalRows ? `Showing ${firstRow}-${lastRow} of ${totalRows}` : 'No rows to display';

  const controls = document.createElement('div');
  controls.className = 'gsd-pagination-controls';
  const previous = document.createElement('button');
  previous.type = 'button';
  previous.className = 'gsd-page-button';
  previous.textContent = 'Previous';
  previous.disabled = page <= 1;
  previous.addEventListener('click', () => onPageChange(page - 1));

  const pageLabel = document.createElement('span');
  pageLabel.className = 'gsd-page-label';
  pageLabel.textContent = `Page ${page} of ${pageCount}`;

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'gsd-page-button';
  next.textContent = 'Next';
  next.disabled = page >= pageCount;
  next.addEventListener('click', () => onPageChange(page + 1));

  controls.append(previous, pageLabel, next);
  container.replaceChildren(summary, controls);
  container.hidden = false;
  return page;
}

function gsdDownloadCsv(filename, rows) {
  const csv = '\uFEFF' + rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function gsdSetUser(user) {
  document.querySelectorAll('#headerUserName, .user-name').forEach(element => {
    element.textContent = user.name.toUpperCase();
  });
  document.querySelectorAll('#headerUserRole, .user-role').forEach(element => {
    element.textContent = user.role.toUpperCase();
  });
  if (user.role !== 'Admin') {
    document.querySelectorAll('a[href="settings.html"], a[href="usermanagement.html"]').forEach(link => {
      link.closest('.nav-item')?.remove();
    });
  }
}

function gsdBindLogout() {
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    const confirmed = await gsdShowDialog({
      title: 'Confirm log out?',
      message: 'You will be signed out of the GSD Inventory Management System.',
      confirmLabel: 'Yes, log out',
      cancelLabel: 'No, stay',
      danger: true
    });
    if (!confirmed) return;
    try { await gsdRequest('/auth/logout', { method: 'POST', body: '{}' }); } catch {}
    window.location.replace('index.html');
  });
}

async function gsdInitialize() {
  if (location.protocol === 'file:') {
    const style = document.createElement('style');
    style.textContent = `
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; box-sizing: border-box; background: #f4f7f5; color: #1e293b; font: 16px/1.5 'Segoe UI', sans-serif; }
      .server-required { width: min(100%, 560px); padding: 32px; border-left: 5px solid #266b47; background: #fff; box-shadow: 0 12px 32px rgba(0,0,0,.08); }
      .server-required h1 { margin: 0 0 12px; font-size: 24px; }
      .server-required p { margin: 0 0 16px; }
      .server-required code { display: block; margin: 12px 0; padding: 12px; overflow-wrap: anywhere; background: #f3f4f6; }
      .server-required a { color: #1f583a; font-weight: 700; }
    `;
    const panel = document.createElement('main');
    panel.className = 'server-required';
    panel.innerHTML = '<h1>Start the GSD server to sign in</h1><p>This page was opened directly from a file. Login and inventory data require the application server, so the browser cannot reach the API from this address.</p><p>From the workspace folder, run:</p><code>cd gsd-backend<br>npm.cmd start</code><p>Then open <a href="http://localhost:3000">http://localhost:3000</a>.</p>';
    document.head.replaceChildren(style);
    document.body.replaceChildren(panel);
    return;
  }
  const page = location.pathname.split('/').pop() || 'index.html';
  const protectedPage = page !== 'index.html';
  let user = null;
  try {
    const result = await gsdRequest('/auth/me');
    user = result.user;
  } catch {
    if (protectedPage) {
      window.location.replace('index.html');
      return;
    }
  }

  if (protectedPage && !user) {
    window.location.replace('index.html');
    return;
  }
  if (protectedPage && user.must_change_password) {
    window.location.replace('index.html');
    return;
  }
  if (protectedPage && user.role !== 'Admin' && ['settings.html', 'usermanagement.html'].includes(page)) {
    window.location.replace('inventory.html');
    return;
  }
  if (page === 'index.html' && user && !user.must_change_password) {
    window.location.replace('inventory.html');
    return;
  }
  if (user && !user.must_change_password) {
    gsdSetUser(user);
    gsdBindLogout();
  }

  if (page === 'index.html') gsdLoginPage(user?.must_change_password ? user : null);
  if (page === 'inventory.html') await gsdInventoryPage();
  if (page === 'purchaseorder.html') await gsdPurchaseOrderPage();
  if (page === 'stockout.html') await gsdStockOutPage();
  if (page === 'returnslip.html') await gsdReturnPage();
  if (page === 'stockcard.html') await gsdStockCardPage();
  if (page === 'settings.html') gsdSettingsPage();
  if (page === 'usermanagement.html') await gsdUserManagementPage(user);
}

function gsdLoginPage(pendingUser = null) {
  const form = document.getElementById('loginForm');
  const resetForm = document.getElementById('resetRequestForm');
  const loginPanel = document.getElementById('loginPanel');
  const resetLink = document.getElementById('forgotPasswordLink');
  const forceModal = document.getElementById('forcePasswordModal');
  const forceForm = document.getElementById('forcePasswordForm');
  const forceError = document.getElementById('forcePasswordError');

  const openForcePasswordModal = () => {
    forceForm?.reset();
    if (forceError) forceError.textContent = '';
    forceModal?.classList.add('open');
    document.getElementById('forceCurrentPassword')?.focus();
  };

  if (pendingUser?.must_change_password) {
    openForcePasswordModal();
  }

  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const { user } = await gsdRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: form.username.value, password: form.password.value })
      });
      if (user.must_change_password) {
        openForcePasswordModal();
        return;
      }
      await gsdShowDialog({
        title: 'Welcome',
        message: `Welcome ${user.username}`,
        confirmLabel: 'Continue'
      });
      window.location.assign('inventory.html');
    } catch (error) {
      gsdToast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  forceForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (forceError) forceError.textContent = '';
    const currentPassword = document.getElementById('forceCurrentPassword').value;
    const newPassword = document.getElementById('forceNewPassword').value;
    const confirmPassword = document.getElementById('forceConfirmPassword').value;
    if (!currentPassword) {
      if (forceError) forceError.textContent = 'Enter your current temporary password.';
      return;
    }
    if (!newPassword.trim() || newPassword.length < 4) {
      if (forceError) forceError.textContent = 'New password must be at least 4 characters.';
      return;
    }
    if (newPassword !== confirmPassword) {
      if (forceError) forceError.textContent = 'New passwords do not match.';
      return;
    }
    if (newPassword === currentPassword) {
      if (forceError) forceError.textContent = 'New password must be different from your temporary password.';
      return;
    }
    const button = forceForm.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const { user } = await gsdRequest('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword })
      });
      forceModal?.classList.remove('open');
      await gsdShowDialog({
        title: 'Password Updated',
        message: `Welcome ${user.username}. Your new password has been saved.`,
        confirmLabel: 'Continue'
      });
      window.location.assign('inventory.html');
    } catch (error) {
      if (forceError) forceError.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  resetLink?.addEventListener('click', event => {
    event.preventDefault();
    const showReset = !loginPanel.hidden;
    loginPanel.hidden = showReset;
    resetForm.hidden = !showReset;
    resetLink.textContent = showReset ? 'Back to sign in' : 'Forgot Password?';
    if (showReset) document.getElementById('resetUsername')?.focus();
    else document.getElementById('username')?.focus();
  });
  resetForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = resetForm.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(resetForm));
      const result = await gsdRequest('/auth/reset-requests', { method: 'POST', body: JSON.stringify(body) });
      gsdToast(result.message);
      resetForm.reset();
      loginPanel.hidden = false;
      resetForm.hidden = true;
      resetLink.textContent = 'Forgot Password?';
    } catch (error) {
      gsdToast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  document.querySelectorAll('.toggle-password').forEach(toggle => {
    toggle.addEventListener('click', () => {
      const targetId = toggle.dataset.target || 'password';
      const input = document.getElementById(targetId);
      if (!input) return;
      const svg = toggle.querySelector('svg');
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', String(reveal));
      if (svg) {
        svg.innerHTML = reveal
          ? '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" y1="2" x2="22" y2="22"/>'
          : '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>';
      }
    });
  });
}

async function gsdGetInventory() {
  return (await gsdRequest('/inventory')).items;
}

function gsdProductOptions(items) {
  return items.map(item => `<option value="${gsdEscape(item.name)}"></option>`).join('');
}

async function gsdInventoryPage() {
  let items = await gsdGetInventory();
  const tbody = document.getElementById('inventoryTableBody');
  const queryInput = document.getElementById('searchInput');
  const categorySelect = document.getElementById('categoryFilter');
  const monthSelect = document.getElementById('monthFilter');
  const printSubtitle = document.getElementById('printReportSubtitle');
  const editModal = document.getElementById('editProductModal');
  const editForm = document.getElementById('editProductForm');
  const monthKey = item => String(item.created_at || '').slice(0, 7);

  const syncMetaAndFilters = () => {
    const lowStock = items.filter(item => Number(item.quantity) <= Number(item.reorder_point)).length;
    const totalCount = document.getElementById('totalProductsKpi');
    if (totalCount) totalCount.textContent = items.length;
    const lowCount = document.getElementById('lowStockKpi');
    if (lowCount) lowCount.textContent = lowStock;
    const prevCategory = categorySelect?.value || 'All Categories';
    const categories = [...new Set(items.map(item => item.category))].sort();
    if (categorySelect) {
      categorySelect.innerHTML = '<option value="All Categories">All Categories</option>' + categories.map(value => `<option value="${gsdEscape(value)}">${gsdEscape(value)}</option>`).join('');
      categorySelect.value = categories.includes(prevCategory) ? prevCategory : 'All Categories';
    }
    const prevMonth = monthSelect?.value || 'All Months';
    if (monthSelect) {
      const months = [...new Set(items.map(monthKey).filter(Boolean))].sort().reverse();
      monthSelect.innerHTML = '<option value="All Months">All Months</option>' + months.map(value => {
        const label = new Date(`${value}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        return `<option value="${gsdEscape(value)}">${gsdEscape(label)}</option>`;
      }).join('');
      monthSelect.value = months.includes(prevMonth) ? prevMonth : 'All Months';
    }
  };
  syncMetaAndFilters();

  let currentPage = 1;
  const pagination = gsdEnsurePagination('inventoryPagination', document.querySelector('.table-layout'));
  const getVisible = () => {
    const query = queryInput?.value.trim().toLowerCase() || '';
    const category = categorySelect?.value || 'All Categories';
    const month = monthSelect?.value || 'All Months';
    return items.filter(item => (!query || `${item.name} ${item.category} ${item.created_by} PROD${String(item.id).padStart(4, '0')}`.toLowerCase().includes(query))
      && (category === 'All Categories' || item.category === category)
      && (month === 'All Months' || monthKey(item) === month));
  };
  const render = (printAll = false) => {
    const visible = getVisible();
    const category = categorySelect?.value || 'All Categories';
    const monthLabel = monthSelect?.selectedOptions?.[0]?.textContent || 'All Months';
    if (printSubtitle) printSubtitle.textContent = `${category.toUpperCase()} • ${monthLabel.toUpperCase()}`;

    const pageCount = Math.max(1, Math.ceil(visible.length / GSD_PAGE_SIZE));
    currentPage = Math.min(currentPage, pageCount);
    const pageItems = printAll ? visible : visible.slice((currentPage - 1) * GSD_PAGE_SIZE, currentPage * GSD_PAGE_SIZE);
    tbody.innerHTML = pageItems.length ? pageItems.map(item => `
      <tr>
        <td>PROD${String(item.id).padStart(4, '0')}</td>
        <td>${gsdEscape(item.created_by)}</td>
        <td><a class="product-link" href="stockcard.html?item=${encodeURIComponent(item.name)}" title="View Stock Card">${gsdEscape(item.name)}</a></td>
        <td>${gsdEscape(item.category)}</td>
        <td>${gsdFormatNumber(item.quantity)}</td>
        <td>${gsdEscape(item.unit)}</td>
        <td><span class="badge ${Number(item.quantity) <= Number(item.reorder_point) ? 'badge-lowstock' : 'badge-instock'}">${Number(item.quantity) <= Number(item.reorder_point) ? 'Low Stock' : 'In Stock'}</span></td>
        <td>${gsdDisplayDate(item.created_at)}</td>
        <td class="inv-actions-cell"><div class="action-icons">
          <button type="button" class="icon-btn icon-only" data-action="edit" data-id="${item.id}" title="Edit product" aria-label="Edit ${gsdEscape(item.name)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 20h9"></path>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
            </svg>
          </button>
          <button type="button" class="icon-btn icon-only delete-btn" data-action="delete" data-id="${item.id}" title="Delete product" aria-label="Delete ${gsdEscape(item.name)}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div></td>
      </tr>`).join('') : '<tr><td colspan="9" style="text-align:center;padding:24px;color:#68786f;">No inventory items match the current filters.</td></tr>';
    currentPage = gsdRenderPagination(pagination, visible.length, currentPage, page => {
      currentPage = page;
      render();
    });
  };

  const closeEditModal = () => editModal?.classList.remove('open');
  document.getElementById('cancelEditProductBtn')?.addEventListener('click', closeEditModal);
  editModal?.addEventListener('click', event => { if (event.target === editModal) closeEditModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && editModal?.classList.contains('open')) closeEditModal(); });

  editForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const id = document.getElementById('editProductId').value;
    const submitBtn = editForm.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    try {
      await gsdRequest(`/inventory/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: document.getElementById('editProductName').value,
          category: document.getElementById('editProductCategory').value,
          unit: document.getElementById('editProductUnit').value,
          reorder_point: document.getElementById('editProductReorderPoint').value
        })
      });
      closeEditModal();
      items = await gsdGetInventory();
      syncMetaAndFilters();
      render();
      gsdToast('Product updated.');
    } catch (error) {
      gsdToast(error.message, true);
    } finally {
      submitBtn.disabled = false;
    }
  });

  tbody.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const item = items.find(row => row.id === Number(button.dataset.id));
    if (!item) return;
    if (button.dataset.action === 'edit') {
      document.getElementById('editProductId').value = item.id;
      document.getElementById('editProductName').value = item.name;
      document.getElementById('editProductCategory').value = item.category;
      document.getElementById('editProductUnit').value = item.unit;
      document.getElementById('editProductReorderPoint').value = item.reorder_point ?? 7;
      editModal?.classList.add('open');
      document.getElementById('editProductName')?.focus();
    } else if (button.dataset.action === 'delete') {
      const confirmed = await gsdShowDialog({
        title: 'Delete product?',
        message: `Delete "${item.name}" and its transaction history? This cannot be undone.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        danger: true
      });
      if (!confirmed) return;
      try {
        await gsdRequest(`/inventory/${item.id}`, { method: 'DELETE' });
        items = await gsdGetInventory();
        syncMetaAndFilters();
        render();
        gsdToast('Product deleted.');
      } catch (error) {
        gsdToast(error.message, true);
      }
    }
  });

  queryInput?.addEventListener('input', () => { currentPage = 1; render(); });
  categorySelect?.addEventListener('change', () => { currentPage = 1; render(); });
  monthSelect?.addEventListener('change', () => { currentPage = 1; render(); });
  window.addEventListener('beforeprint', () => render(true));
  window.addEventListener('afterprint', () => render(false));
  document.getElementById('printBtn')?.addEventListener('click', () => window.print());
  document.getElementById('exportCsvBtn')?.addEventListener('click', () => {
    const visible = getVisible();
    gsdDownloadCsv('gsd-inventory.csv', [
      ['Item ID', 'Added By', 'Item', 'Category', 'Quantity', 'Unit', 'Status', 'Reorder Point', 'Date Added'],
      ...visible.map(item => [
        `PROD${String(item.id).padStart(4, '0')}`,
        item.created_by,
        item.name,
        item.category,
        item.quantity,
        item.unit,
        Number(item.quantity) <= Number(item.reorder_point) ? 'Low Stock' : 'In Stock',
        item.reorder_point,
        gsdDisplayDate(item.created_at)
      ])
    ]);
  });
  render();
}

function gsdWireClear(form, button, onClear) {
  button?.addEventListener('click', () => {
    form?.reset();
    if (onClear) onClear();
  });
}

// Transaction date field: defaults to today (also after form.reset()) and cannot be in the future.
function gsdDateField() {
  const input = document.getElementById('txnDateInput');
  if (input) {
    input.max = gsdToday();
    input.defaultValue = gsdToday();
    input.value = gsdToday();
  }
  return () => input?.value || gsdToday();
}

async function gsdPurchaseOrderPage() {
  const form = document.getElementById('purchaseOrderForm');
  const txnDate = gsdDateField();
  let inventory = await gsdGetInventory();
  const input = document.getElementById('productNameInput');
  const list = document.getElementById('productSuggestions');
  list.innerHTML = gsdProductOptions(inventory);
  const fillProductDefaults = () => {
    const item = inventory.find(row => row.name.toLowerCase() === input.value.trim().toLowerCase());
    if (item) {
      document.getElementById('categoryInput').value = item.category;
      document.getElementById('unitInput').value = item.unit;
    }
  };
  input.addEventListener('input', fillProductDefaults);
  input.addEventListener('change', fillProductDefaults);
  const updateTotal = () => {
    const quantity = Number(document.getElementById('quantityInput').value);
    const costRaw = document.getElementById('unitCostInput').value;
    const cost = Number(costRaw);
    document.getElementById('totalCostInput').value = quantity > 0 && costRaw !== '' && cost >= 0 ? (quantity * cost).toFixed(2) : '';
  };
  document.getElementById('quantityInput').addEventListener('input', updateTotal);
  document.getElementById('unitCostInput').addEventListener('input', updateTotal);
  gsdWireClear(form, document.getElementById('clearFormBtn'), () => {
    document.getElementById('totalCostInput').value = '';
    document.getElementById('referenceInput').focus();
  });
  document.getElementById('clearRecentBtn')?.addEventListener('click', () => {
    document.getElementById('recentPoContainer').innerHTML = '<p class="empty-state">Recent transactions remain in the audit history.</p>';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    const body = {
      type: 'PO', reference: document.getElementById('referenceInput').value,
      itemName: input.value, category: document.getElementById('categoryInput').value,
      unit: document.getElementById('unitInput').value, quantity: document.getElementById('quantityInput').value,
      unitCost: document.getElementById('unitCostInput').value, date: txnDate()
    };
    try {
      await gsdRequest('/transactions', { method: 'POST', body: JSON.stringify(body) });
      gsdToast('Purchase order recorded and stock updated.');
      form.reset();
      updateTotal();
      await gsdRenderRecent('PO', 'recentPoContainer');
      inventory = await gsdGetInventory();
      list.innerHTML = gsdProductOptions(inventory);
    } catch (error) {
      gsdToast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  await gsdRenderRecent('PO', 'recentPoContainer');
}

async function gsdStockOutPage() {
  const form = document.getElementById('stockOutForm');
  const txnDate = gsdDateField();
  let inventory = await gsdGetInventory();
  const datalist = document.getElementById('inventoryProductList');
  datalist.innerHTML = gsdProductOptions(inventory);
  const product = document.getElementById('productDeductInput');
  const quantity = document.getElementById('quantityDeductInput');
  const cost = document.getElementById('unitCostInput');
  const hint = document.getElementById('availableStockHint');
  const update = () => {
    const item = inventory.find(row => row.name.toLowerCase() === product.value.trim().toLowerCase());
    if (item) {
      const requested = Number(quantity.value) || 0;
      const insufficient = Number(item.quantity) <= 0 || requested > Number(item.quantity);
      hint.textContent = `Available: ${gsdFormatNumber(item.quantity)} ${item.unit}`;
      hint.classList.toggle('error', insufficient);
      document.getElementById('unitInput').value = item.unit;
    } else {
      hint.textContent = '';
      hint.classList.remove('error');
      document.getElementById('unitInput').value = '';
    }
    const qtyVal = Number(quantity.value);
    const costVal = Number(cost.value);
    document.getElementById('totalBalanceValueInput').value = qtyVal > 0 && cost.value !== '' && costVal >= 0 ? (qtyVal * costVal).toFixed(2) : '';
  };
  [product, quantity, cost].forEach(input => input.addEventListener('input', update));
  gsdWireClear(form, document.getElementById('clearFormBtn'), () => {
    update();
    document.getElementById('srfReferenceInput').focus();
  });
  document.getElementById('clearRecentBtn')?.addEventListener('click', () => {
    document.getElementById('recentStockOutContainer').innerHTML = '<p class="empty-state">Recent transactions remain in the audit history.</p>';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await gsdRequest('/transactions', { method: 'POST', body: JSON.stringify({
        type: 'SRF', reference: document.getElementById('srfReferenceInput').value,
        itemName: product.value, quantity: quantity.value, unit: document.getElementById('unitInput').value,
        unitCost: cost.value, office: document.getElementById('officeInput').value, date: txnDate()
      }) });
      gsdToast('SRF recorded and stock deducted.');
      form.reset();
      inventory = await gsdGetInventory();
      datalist.innerHTML = gsdProductOptions(inventory);
      update();
      await gsdRenderRecent('SRF', 'recentStockOutContainer');
    } catch (error) {
      gsdToast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  await gsdRenderRecent('SRF', 'recentStockOutContainer');
}

async function gsdReturnPage() {
  const form = document.getElementById('returnSlipForm');
  const txnDate = gsdDateField();
  let inventory = await gsdGetInventory();
  document.getElementById('returnProductList').innerHTML = gsdProductOptions(inventory);
  const srfInput = document.getElementById('originalSrfInput');
  const product = document.getElementById('productNameInput');
  const officeInput = document.getElementById('returningOfficeInput');
  const unitInput = document.getElementById('unitInput');
  const archiveContainer = document.getElementById('recentSlipContainer');
  const archiveSearch = document.getElementById('archiveSearchInput');
  const archiveDate = document.getElementById('archiveDateFilter');
  const archiveBadge = document.getElementById('archiveCountBadge');
  let archiveRows = [];

  const syncSrfSuggestions = async () => {
    const srfRows = (await gsdRequest('/transactions?type=SRF&limit=500')).transactions;
    const uniqueRefs = [...new Set(srfRows.map(row => row.reference).filter(Boolean))];
    document.getElementById('srfReferenceList').innerHTML = uniqueRefs
      .map(ref => `<option value="${gsdEscape(ref)}"></option>`).join('');
    return srfRows;
  };
  let srfRows = await syncSrfSuggestions();

  const fillFromSrf = () => {
    const ref = srfInput.value.trim().toLowerCase();
    if (!ref) return;
    const match = srfRows.find(row => String(row.reference || '').toLowerCase() === ref);
    if (match) {
      if (match.item_name && !product.value.trim()) product.value = match.item_name;
      if (match.office && !officeInput.value.trim()) officeInput.value = match.office;
      if (match.unit && !unitInput.value.trim()) unitInput.value = match.unit;
    }
  };
  srfInput.addEventListener('input', fillFromSrf);
  srfInput.addEventListener('change', fillFromSrf);

  const fillUnitFromProduct = () => {
    const item = inventory.find(row => row.name.toLowerCase() === product.value.trim().toLowerCase());
    if (item) unitInput.value = item.unit;
  };
  product.addEventListener('input', fillUnitFromProduct);
  product.addEventListener('change', fillUnitFromProduct);

  const parseMeta = row => {
    if (row.metadata && typeof row.metadata === 'object') return row.metadata;
    try { return JSON.parse(row.metadata || '{}'); } catch { return {}; }
  };

  const renderArchive = () => {
    if (!archiveContainer) return;
    const query = archiveSearch?.value.trim().toLowerCase() || '';
    const dateFilter = archiveDate?.value || '';
    const filtered = archiveRows.filter(row => {
      const details = parseMeta(row);
      const text = `${row.reference} ${row.item_name} ${row.office || ''} ${details.location || ''} ${details.originalSrf || ''} ${row.actor_name || ''}`.toLowerCase();
      return (!query || text.includes(query)) && (!dateFilter || String(row.occurred_on || '').slice(0, 10) === dateFilter);
    });
    if (archiveBadge) {
      archiveBadge.textContent = `${filtered.length} ${filtered.length === 1 ? 'record' : 'records'}`;
    }
    if (!filtered.length) {
      archiveContainer.innerHTML = '<p class="empty-state">No return slip records match the current filter.</p>';
      return;
    }
    const groups = new Map();
    filtered.forEach(row => {
      const key = String(row.occurred_on || '').slice(0, 10) || 'Undated';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    archiveContainer.innerHTML = [...groups.entries()].map(([dateKey, entries]) => `
      <section class="archive-date-group">
        <div class="archive-date-header">
          <span>${gsdEscape(dateKey === 'Undated' ? 'Undated' : gsdDisplayDate(dateKey))}</span>
          <span class="archive-date-count">${entries.length} ${entries.length === 1 ? 'slip' : 'slips'}</span>
        </div>
        ${entries.map(row => {
          const details = parseMeta(row);
          const officeLabel = row.office || details.returningOffice || '';
          return `
            <article class="archive-entry-card">
              <div class="archive-entry-body">
                <div class="recent-entry-ref">${gsdEscape(row.reference)}</div>
                <div class="recent-entry-product">${gsdEscape(row.item_name)}</div>
                <div class="recent-entry-meta">${gsdFormatNumber(row.quantity)} ${gsdEscape(row.unit)} &middot; ${gsdDisplayDate(row.occurred_on)}</div>
                ${officeLabel ? `<div class="recent-entry-office">Office: ${gsdEscape(officeLabel)}</div>` : ''}
                <small class="recent-entry-actor">Recorded by ${gsdEscape(row.actor_name || 'System')}</small>
              </div>
              <button type="button" class="archive-print-btn" data-action="print-slip" data-id="${row.id}" title="Print Return Slip ${gsdEscape(row.reference)}" aria-label="Print Return Slip ${gsdEscape(row.reference)}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="6 9 6 2 18 2 18 9"></polyline>
                  <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                  <rect x="6" y="14" width="12" height="8"></rect>
                </svg>
                Print
              </button>
            </article>`;
        }).join('')}
      </section>`).join('');
  };

  const loadArchive = async () => {
    archiveRows = (await gsdRequest('/transactions?type=RETURN&limit=500')).transactions;
    renderArchive();
  };

  archiveSearch?.addEventListener('input', renderArchive);
  archiveDate?.addEventListener('change', renderArchive);
  document.getElementById('clearArchiveFilterBtn')?.addEventListener('click', () => {
    if (archiveSearch) archiveSearch.value = '';
    if (archiveDate) archiveDate.value = '';
    renderArchive();
  });

  archiveContainer?.addEventListener('click', event => {
    const button = event.target.closest('button[data-action="print-slip"]');
    if (!button) return;
    const record = archiveRows.find(row => row.id === Number(button.dataset.id));
    if (!record) return;
    const details = parseMeta(record);
    gsdUpdatePrintSlip({
      ...details,
      reference: record.reference,
      itemNo: record.item_id ? `PROD${String(record.item_id).padStart(4, '0')}` : '1',
      itemName: record.item_name,
      quantity: record.quantity,
      unit: record.unit,
      date: record.occurred_on,
      reason: details.reason || record.notes || '-'
    });
    window.print();
  });

  gsdWireClear(form, document.getElementById('clearFormBtn'), () => srfInput.focus());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    const reference = `RS-${gsdToday().replace(/-/g, '')}-${String(Date.now()).slice(-6)}`;
    const details = {
      originalSrf: srfInput.value,
      returningOffice: officeInput.value,
      location: document.getElementById('locationInput').value,
      resender: document.getElementById('resenderInput').value,
      receiver: document.getElementById('receiverInput').value,
      reason: document.getElementById('reasonInput').value
    };
    const date = txnDate();
    try {
      const matchedItem = inventory.find(row => row.name.toLowerCase() === product.value.trim().toLowerCase());
      await gsdRequest('/transactions', { method: 'POST', body: JSON.stringify({
        type: 'RETURN', reference, itemName: product.value, quantity: document.getElementById('quantityReturnInput').value,
        unit: unitInput.value, office: details.returningOffice, notes: details.reason, details, date
      }) });
      gsdUpdatePrintSlip({
        ...details,
        reference,
        itemNo: matchedItem ? `PROD${String(matchedItem.id).padStart(4, '0')}` : '1',
        itemName: product.value,
        quantity: document.getElementById('quantityReturnInput').value,
        unit: unitInput.value,
        date
      });
      gsdToast('Return slip recorded and added to archive.');
      form.reset();
      inventory = await gsdGetInventory();
      document.getElementById('returnProductList').innerHTML = gsdProductOptions(inventory);
      srfRows = await syncSrfSuggestions();
      await loadArchive();
    } catch (error) {
      gsdToast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  await loadArchive();
  if (archiveRows[0]) {
    const latest = archiveRows[0];
    const details = parseMeta(latest);
    gsdUpdatePrintSlip({
      ...details,
      reference: latest.reference,
      itemNo: latest.item_id ? `PROD${String(latest.item_id).padStart(4, '0')}` : '1',
      itemName: latest.item_name,
      quantity: latest.quantity,
      unit: latest.unit,
      date: latest.occurred_on
    });
  } else {
    gsdUpdatePrintSlip({ reference: '-', itemNo: '1', itemName: '-', quantity: 0, unit: '', date: '' });
  }
}

function gsdUpdatePrintSlip(data) {
  const slip = {
    originalSrf: '-', returningOffice: '-', location: '-', resender: '-', receiver: '-', reason: '-', itemNo: '1',
    ...data
  };
  const refText = slip.returningOffice && slip.returningOffice !== '-'
    ? `${slip.originalSrf} (${slip.returningOffice})`
    : slip.originalSrf;
  const qtyText = slip.quantity ? `${gsdFormatNumber(slip.quantity)} ${slip.unit}`.trim() : '-';
  const values = {
    psSlipNo: slip.reference,
    psRefNo: refText,
    psDate: gsdDisplayDate(slip.date) || '-',
    psLocation: slip.location || slip.returningOffice || '-',
    psItemNo: slip.itemNo || '1',
    psItemDesc: slip.itemName,
    psQty: slip.quantity ? gsdFormatNumber(slip.quantity) : '-',
    psUnit: slip.unit || '-',
    psRemarks: slip.reason,
    psTotalItems: slip.quantity ? 'TOTAL ITEMS: 1' : 'TOTAL ITEMS: 0',
    psTotalQty: `TOTAL QUANTITY RETURNED: ${qtyText}`,
    psReasonBody: slip.reason,
    psSignResender: String(slip.resender || '-').toUpperCase(),
    psSignReceiver: String(slip.receiver || '-').toUpperCase()
  };
  Object.entries(values).forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
  });
}

async function gsdRenderRecent(type, targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  const { transactions: rows } = await gsdRequest(`/transactions?type=${type}&limit=20`);
  if (!rows.length) {
    target.innerHTML = '<p class="empty-state">No transactions recorded yet.</p>';
    return;
  }
  target.innerHTML = rows.map(row => `
    <article class="recent-entry-card">
      <div class="recent-entry-ref">${gsdEscape(row.reference)}</div>
      <div class="recent-entry-product">${gsdEscape(row.item_name)}</div>
      <div class="recent-entry-meta">${gsdFormatNumber(row.quantity)} ${gsdEscape(row.unit)} &middot; ${gsdDisplayDate(row.occurred_on)}</div>
      ${row.office ? `<div class="recent-entry-office">Office: ${gsdEscape(row.office)}</div>` : ''}
      <small class="recent-entry-actor">${gsdEscape(row.actor_name || 'System')}</small>
    </article>`).join('');
}

async function gsdStockCardPage() {
  const search = document.getElementById('stockCardSearch');
  const datalist = document.getElementById('stockCardItemList');
  const allItems = await gsdGetInventory();
  datalist.innerHTML = gsdProductOptions(allItems);
  let current = null;
  let ledgerPage = 1;
  const set = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };

  const clearCardMeta = () => {
    ['metaItemName', 'metaUnit', 'metaDescription', 'metaStockNo',
     'pscItemName', 'pscUnit', 'pscDescription', 'pscStockNo'].forEach(id => set(id, '-'));
    ['poCount', 'srfCount', 'totalReceived', 'totalIssued'].forEach(id => set(id, '0'));
  };

  const render = async (query = search.value.trim()) => {
    const result = await gsdRequest(`/stock-card?item=${encodeURIComponent(query)}`);
    current = result;
    const { item, transactions } = result;
    const body = document.getElementById('stockCardBody');
    const printBody = document.getElementById('pscLedgerBody');
    const pagination = gsdEnsurePagination('stockCardPagination', body.closest('.table-wrapper'));
    if (!item) {
      clearCardMeta();
      body.innerHTML = '<tr><td colspan="7" class="empty-ledger">No matching inventory item.</td></tr>';
      printBody.innerHTML = body.innerHTML;
      gsdRenderPagination(pagination, 0, 1, () => {});
      return;
    }
    if (!search.value.trim()) search.value = item.name;
    const received = transactions.filter(row => row.type !== 'SRF').reduce((sum, row) => sum + Number(row.quantity), 0);
    const issued = transactions.filter(row => row.type === 'SRF').reduce((sum, row) => sum + Number(row.quantity), 0);

    let lastIssueDate = null;
    const enriched = transactions.map(row => {
      let days = '-';
      if (row.type === 'SRF') {
        const diff = lastIssueDate ? gsdDaysBetween(lastIssueDate, row.occurred_on) : null;
        days = diff === null ? '-' : String(diff);
        lastIssueDate = row.occurred_on;
      }
      return { ...row, days };
    });

    const formatRow = row => {
      const receipt = row.type === 'SRF' ? '-' : gsdFormatNumber(row.quantity);
      const issue = row.type === 'SRF' ? gsdFormatNumber(row.quantity) : '-';
      const label = row.type === 'PO' ? 'PO' : row.type === 'SRF' ? 'SRF' : row.type === 'RETURN' ? 'Return' : 'Opening';
      return `<tr><td>${gsdDisplayDate(row.occurred_on)}</td><td>${gsdEscape(row.reference)} <small>${label}</small></td><td>${receipt}</td><td>${issue}</td><td>${gsdEscape(row.office || '-')}</td><td><strong>${gsdFormatNumber(row.balance)}</strong></td><td>${row.days}</td></tr>`;
    };

    const pageCount = Math.max(1, Math.ceil(enriched.length / GSD_PAGE_SIZE));
    ledgerPage = Math.min(ledgerPage, pageCount);
    const pageRows = enriched.slice((ledgerPage - 1) * GSD_PAGE_SIZE, ledgerPage * GSD_PAGE_SIZE);
    body.innerHTML = enriched.length
      ? pageRows.map(formatRow).join('')
      : '<tr><td colspan="7" class="empty-ledger">No movements recorded.</td></tr>';
    printBody.innerHTML = enriched.length
      ? enriched.map(formatRow).join('')
      : '<tr><td colspan="7" class="empty-ledger">No movements recorded.</td></tr>';
    ledgerPage = gsdRenderPagination(pagination, enriched.length, ledgerPage, page => {
      ledgerPage = page;
      render(query);
    });
    const unitLabel = item.unit;
    set('metaItemName', item.name); set('metaUnit', unitLabel);
    set('metaDescription', item.category); set('metaStockNo', `PROD${String(item.id).padStart(4, '0')}`);
    set('pscItemName', item.name); set('pscUnit', unitLabel);
    set('pscDescription', item.category); set('pscStockNo', `PROD${String(item.id).padStart(4, '0')}`);
    set('poCount', transactions.filter(row => row.type === 'PO').length);
    set('srfCount', transactions.filter(row => row.type === 'SRF').length);
    set('totalReceived', gsdFormatNumber(received)); set('totalIssued', gsdFormatNumber(issued));
  };

  let searchTimer;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    ledgerPage = 1;
    searchTimer = setTimeout(() => render().catch(error => gsdToast(error.message, true)), 180);
  });
  search.addEventListener('change', () => { ledgerPage = 1; render().catch(error => gsdToast(error.message, true)); });
  search.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); ledgerPage = 1; render().catch(error => gsdToast(error.message, true)); }
  });
  document.getElementById('printBtn')?.addEventListener('click', () => {
    if (!current?.item) {
      gsdToast('Select an item with a stock card before printing.', true);
      return;
    }
    window.print();
  });
  document.getElementById('exportCsvBtn')?.addEventListener('click', () => {
    if (!current?.item) {
      gsdToast('Select an item to export.', true);
      return;
    }
    gsdDownloadCsv(`gsd-stock-card-${current.item.name.replace(/[^a-zA-Z0-9-_]+/g, '_')}.csv`, [
      ['Date', 'Reference', 'Type', 'Receipt', 'Issue', 'Office', 'Balance'],
      ...current.transactions.map(row => [row.occurred_on, row.reference, row.type, row.type === 'SRF' ? '' : row.quantity, row.type === 'SRF' ? row.quantity : '', row.office, row.balance])
    ]);
  });
  const paramItem = new URLSearchParams(location.search).get('item');
  if (paramItem) search.value = paramItem;
  await render(search.value.trim());
}

function gsdSettingsPage() {
  const modal = document.getElementById('wipeModal');
  const downloadBtn = document.getElementById('downloadBackupBtn');
  downloadBtn?.addEventListener('click', async () => {
    downloadBtn.disabled = true;
    try {
      const response = await fetch(`${GSD_API}/admin/backup`, { credentials: 'same-origin' });
      if (!response.ok) {
        const payload = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() : null;
        throw new Error(payload?.error || 'Failed to download backup.');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match ? match[1] : `gsd-backup-${gsdToday()}.json`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      gsdToast('Backup downloaded.');
    } catch (error) {
      gsdToast(error.message, true);
    } finally {
      downloadBtn.disabled = false;
    }
  });
  document.getElementById('openWipeModalBtn')?.addEventListener('click', () => {
    const input = document.getElementById('wipeConfirmInput');
    input.value = '';
    modal.classList.add('open');
    input.focus();
  });
  const closeModal = () => modal?.classList.remove('open');
  document.getElementById('cancelWipeBtn')?.addEventListener('click', closeModal);
  modal?.addEventListener('click', event => { if (event.target === modal) closeModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && modal?.classList.contains('open')) closeModal(); });
  const confirmBtn = document.getElementById('confirmWipeBtn');
  confirmBtn?.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    try {
      await gsdRequest('/admin/wipe', { method: 'POST', body: JSON.stringify({ confirmation: document.getElementById('wipeConfirmInput').value.trim() }) });
      closeModal();
      gsdToast('Inventory and transaction data were removed. User accounts remain intact.');
    } catch (error) {
      gsdToast(error.message, true);
    } finally {
      confirmBtn.disabled = false;
    }
  });
}

function gsdGenerateTempPassword(length = 12) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%^&*_-+=';
  const all = upper + lower + digits + symbols;
  const pick = chars => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return chars[buf[0] % chars.length];
  };
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < length) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const j = buf[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

async function gsdUserManagementPage(currentUser) {
  const table = document.getElementById('usersTableBody');
  const search = document.getElementById('userSearchInput');
  const form = document.getElementById('userForm');
  const modal = document.getElementById('userModal');
  const resetModal = document.getElementById('passwordResetModal');
  const resetSubtitle = document.getElementById('resetModalSubtitle');
  const resetPasswordBox = document.getElementById('resetTempPasswordBox');
  const passField = document.getElementById('userPassword');
  const roleSelect = document.getElementById('userRoleSelect');
  let users = [];
  let currentPage = 1;
  let lastGeneratedPassword = '';
  const pagination = gsdEnsurePagination('usersPagination', table.closest('.table-card'));

  if (roleSelect) roleSelect.innerHTML = '<option value="Staff" selected>Staff</option><option value="Admin">Admin</option>';
  document.getElementById('userModalTitle').textContent = 'Create User Account';
  document.getElementById('editUserIndex')?.remove();
  document.getElementById('userStatusSelect')?.closest('.modal-field')?.remove();
  const requestsWrap = document.getElementById('resetRequestsWrap');
  const closeResetModal = () => {
    lastGeneratedPassword = '';
    if (resetPasswordBox) resetPasswordBox.textContent = '-';
    resetModal?.classList.remove('open');
  };
  document.getElementById('closeResetModalBtn')?.addEventListener('click', closeResetModal);
  resetModal?.addEventListener('click', event => { if (event.target === resetModal) closeResetModal(); });
  document.getElementById('copyTempPasswordBtn')?.addEventListener('click', async () => {
    if (!lastGeneratedPassword) return;
    try {
      await navigator.clipboard.writeText(lastGeneratedPassword);
      gsdToast('Temporary password copied to clipboard.');
    } catch {
      const range = document.createRange();
      range.selectNodeContents(resetPasswordBox);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('copy');
      gsdToast('Temporary password copied to clipboard.');
    }
  });

  const renderUsers = () => {
    const query = search.value.trim().toLowerCase();
    const visible = users.filter(user => `${user.name} ${user.username} ${user.role} USR${String(user.id).padStart(4, '0')}`.toLowerCase().includes(query));
    const pageCount = Math.max(1, Math.ceil(visible.length / GSD_PAGE_SIZE));
    currentPage = Math.min(currentPage, pageCount);
    const pageUsers = visible.slice((currentPage - 1) * GSD_PAGE_SIZE, currentPage * GSD_PAGE_SIZE);
    table.innerHTML = pageUsers.length ? pageUsers.map(user => `<tr>
      <td>USR${String(user.id).padStart(4, '0')}</td><td class="user-name-cell">${gsdEscape(user.name)}</td>
      <td>${gsdEscape(user.username)}</td><td>${gsdEscape(user.role)}</td><td><span class="status-pill ${user.status === 'Active' ? 'active-status' : 'inactive-status'}">${gsdEscape(user.status)}</span></td>
      <td class="actions-cell"><div class="action-icons">
        <button type="button" class="icon-btn icon-only" data-action="password" data-id="${user.id}" title="Reset password" aria-label="Reset password for ${gsdEscape(user.username)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
          </svg>
        </button>
        <button type="button" class="icon-btn icon-only" data-action="toggle" data-id="${user.id}" title="${user.status === 'Active' ? 'Deactivate account' : 'Activate account'}" aria-label="${user.status === 'Active' ? 'Deactivate' : 'Activate'} ${gsdEscape(user.username)}">
          ${user.status === 'Active'
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>'}
        </button>
        ${user.id !== currentUser.id ? `<button type="button" class="icon-btn icon-only delete-btn" data-action="delete" data-id="${user.id}" title="Delete user" aria-label="Delete ${gsdEscape(user.username)}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            <line x1="10" y1="11" x2="10" y2="17"></line>
            <line x1="14" y1="11" x2="14" y2="17"></line>
          </svg>
        </button>` : ''}
      </div></td></tr>`).join('') : '<tr><td colspan="6" style="text-align:center;padding:24px;color:#68786f;">No matching user accounts.</td></tr>';
    currentPage = gsdRenderPagination(pagination, visible.length, currentPage, page => {
      currentPage = page;
      renderUsers();
    });
    document.getElementById('activeUsersKpi').textContent = users.filter(user => user.status === 'Active').length;
    document.getElementById('totalUsersKpi').textContent = users.length;
  };
  const refresh = async () => {
    users = (await gsdRequest('/admin/users')).users;
    renderUsers();
  };
  document.getElementById('createUserBtn')?.addEventListener('click', () => {
    form.reset();
    roleSelect.value = 'Staff';
    modal.classList.add('open');
    document.getElementById('userFullName').focus();
  });
  const closeUserModal = () => modal?.classList.remove('open');
  document.getElementById('cancelUserModalBtn')?.addEventListener('click', closeUserModal);
  modal?.addEventListener('click', event => { if (event.target === modal) closeUserModal(); });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (modal?.classList.contains('open')) closeUserModal();
    if (resetModal?.classList.contains('open')) closeResetModal();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      await gsdRequest('/admin/users', { method: 'POST', body: JSON.stringify({
        name: document.getElementById('userFullName').value,
        username: document.getElementById('userAccountName').value,
        password: passField.value,
        role: roleSelect.value
      }) });
      closeUserModal();
      gsdToast('User account created.');
      await refresh();
    } catch (error) {
      gsdToast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  search.addEventListener('input', () => { currentPage = 1; renderUsers(); });
  table.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const target = users.find(user => user.id === Number(button.dataset.id));
    if (!target) return;
    try {
      if (button.dataset.action === 'password') {
        const confirmed = await gsdShowDialog({
          title: 'Confirm Password Reset',
          message: `Reset password for ${target.username}? A new temporary password will be generated and their current password will stop working.`,
          confirmLabel: 'Reset Password',
          cancelLabel: 'Cancel'
        });
        if (!confirmed) return;
        const tempPassword = gsdGenerateTempPassword(12);
        await gsdRequest(`/admin/users/${target.id}`, { method: 'PATCH', body: JSON.stringify({ password: tempPassword }) });
        lastGeneratedPassword = tempPassword;
        if (resetSubtitle) resetSubtitle.textContent = `Temporary password for ${target.username}`;
        if (resetPasswordBox) resetPasswordBox.textContent = tempPassword;
        resetModal?.classList.add('open');
      } else if (button.dataset.action === 'toggle') {
        await gsdRequest(`/admin/users/${target.id}`, { method: 'PATCH', body: JSON.stringify({ status: target.status === 'Active' ? 'Inactive' : 'Active' }) });
        gsdToast(`Account ${target.status === 'Active' ? 'deactivated' : 'activated'}.`);
      } else if (button.dataset.action === 'delete' && await gsdShowDialog({
        title: 'Delete user account?', message: `Delete ${target.username}? This cannot be undone.`,
        confirmLabel: 'Delete', cancelLabel: 'Cancel', danger: true
      })) {
        await gsdRequest(`/admin/users/${target.id}`, { method: 'DELETE' });
        gsdToast('User account deleted.');
      } else return;
      await refresh();
    } catch (error) { gsdToast(error.message, true); }
  });
  await refresh();
  if (requestsWrap) {
    let requestPage = 1;
    const renderRequests = async (targetPage = requestPage) => {
      const { requests } = await gsdRequest('/admin/reset-requests');
      const pageCount = Math.max(1, Math.ceil(requests.length / GSD_PAGE_SIZE));
      requestPage = Math.min(Math.max(targetPage, 1), pageCount);
      const pageRequests = requests.slice((requestPage - 1) * GSD_PAGE_SIZE, requestPage * GSD_PAGE_SIZE);
      requestsWrap.innerHTML = `<h2>Password Reset Requests</h2><table class="users-table reset-requests-table"><thead><tr><th>Username</th><th>Reason</th><th>Submitted</th><th>Status</th><th>Actions</th></tr></thead><tbody>${requests.length ? pageRequests.map(request => `<tr>
        <td>${gsdEscape(request.username)}</td><td>${gsdEscape(request.reason)}</td><td>${gsdEscape(request.created_at)}</td><td>${gsdEscape(request.status)}</td><td>${request.status === 'Pending' ? `<div class="action-icons"><button type="button" class="icon-btn" data-reset-action="approve" data-id="${request.id}">Approve &amp; reset</button><button type="button" class="icon-btn delete-btn" data-reset-action="decline" data-id="${request.id}">Decline</button></div>` : gsdEscape(request.reviewer_name || '-')}</td>
      </tr>`).join('') : '<tr class="empty-state"><td colspan="5">No password reset requests.</td></tr>'}</tbody></table>`;
      const requestPagination = gsdEnsurePagination('resetRequestsPagination', requestsWrap.querySelector('.reset-requests-table'));
      requestPage = gsdRenderPagination(requestPagination, requests.length, requestPage, page => renderRequests(page).catch(err => gsdToast(err.message, true)));
    };
    if (requestsWrap.dataset.bound !== 'true') requestsWrap.addEventListener('click', async event => {
      const button = event.target.closest('button[data-reset-action]');
      if (!button) return;
      const status = button.dataset.resetAction === 'approve' ? 'Approved' : 'Declined';
      const body = { status };
      if (status === 'Approved') {
        body.password = await gsdPromptPassword('Approve reset request', 'Assign a temporary password (at least 10 characters) and share it with the user securely.');
        if (body.password === null) return;
      }
      try {
        await gsdRequest(`/admin/reset-requests/${button.dataset.id}`, { method: 'PATCH', body: JSON.stringify(body) });
        gsdToast(`Request ${status.toLowerCase()}.`);
        await renderRequests(requestPage);
      } catch (error) { gsdToast(error.message, true); }
    });
    requestsWrap.dataset.bound = 'true';
    await renderRequests();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  gsdInitialize().catch(error => gsdToast(error.message, true));
});
