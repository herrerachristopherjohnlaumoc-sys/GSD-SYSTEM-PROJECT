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

const GSD_OFFICE_ALIASES = [
  { abbr: 'HR', full: 'Human Resources', aliases: ['hr', 'hrm', 'hrmo', 'human resources', 'human resources management', 'human resources management office'] },
  { abbr: 'HRM', full: 'Human Resources Management', aliases: ['hr', 'hrm', 'hrmo', 'human resources', 'human resources management'] },
  { abbr: 'HRMO', full: 'Human Resources Management Office', aliases: ['hr', 'hrm', 'hrmo', 'human resources management office'] },
  { abbr: 'OCBS', full: 'Office of the Chief of Budget Services', aliases: ['ocbs', 'office of the chief of budget services'] },
  { abbr: 'GSD', full: 'General Service Division', aliases: ['gsd', 'general service division', 'general services division'] },
  { abbr: 'ADMIN', full: 'Administrative Department', aliases: ['admin', 'administrative department', 'administration'] },
  { abbr: 'ACCOUNTING', full: 'Accounting Division', aliases: ['accounting', 'accounting division', 'acctg'] },
  { abbr: 'REGISTRAR', full: 'Office of the Registrar', aliases: ['registrar', 'office of the registrar'] },
  { abbr: 'FAD', full: 'Financial and Administrative Division', aliases: ['fad', 'financial and administrative division'] },
  { abbr: 'OP', full: 'Office of the President', aliases: ['op', 'office of the president'] }
];

function gsdNormalizeOffice(value) {
  const clean = String(value || '').trim().toLowerCase();
  if (!clean) return '';
  const match = GSD_OFFICE_ALIASES.find(entry => entry.aliases.includes(clean));
  return match ? match.abbr.toLowerCase() : clean;
}

function gsdOfficeSuggestionsList(extraValues = []) {
  const seen = new Set();
  const list = [];
  const add = val => {
    const clean = String(val || '').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push(clean);
  };
  extraValues.forEach(add);
  GSD_OFFICE_ALIASES.forEach(entry => {
    add(entry.abbr);
    add(entry.full);
  });
  return list;
}

function gsdReadHistory(key) {
  try {
    const raw = localStorage.getItem(`gsd_history_${key}`);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(v => String(v).trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function gsdSaveHistory(key, value) {
  const clean = String(value || '').trim();
  if (!clean) return;
  const existing = gsdReadHistory(key).filter(item => item.toLowerCase() !== clean.toLowerCase());
  const next = [clean, ...existing].slice(0, 25);
  try {
    localStorage.setItem(`gsd_history_${key}`, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
}

function gsdPopulateDatalist(datalistId, values) {
  const el = document.getElementById(datalistId);
  if (!el) return;
  const seen = new Set();
  const unique = [];
  values.forEach(val => {
    const clean = String(val || '').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(clean);
  });
  el.innerHTML = unique.map(val => `<option value="${gsdEscape(val)}"></option>`).join('');
}

async function gsdPurchaseOrderPage() {
  const form = document.getElementById('purchaseOrderForm');
  const txnDate = gsdDateField();
  let inventory = await gsdGetInventory();
  const input = document.getElementById('productNameInput');
  const list = document.getElementById('productSuggestions');
  const syncPoSuggestions = async () => {
    list.innerHTML = gsdProductOptions(inventory);
    const { transactions } = await gsdRequest('/transactions?type=PO&limit=200').catch(() => ({ transactions: [] }));
    gsdPopulateDatalist('referenceSuggestions', [
      ...gsdReadHistory('po_reference'),
      ...transactions.map(row => row.reference)
    ]);
    gsdPopulateDatalist('categorySuggestions', [
      ...gsdReadHistory('category'),
      ...inventory.map(row => row.category),
      'Construction Materials', 'Electrical Supplies', 'Plumbing Supplies', 'Office Supplies', 'Janitorial Supplies', 'Hardware & Tools'
    ]);
    gsdPopulateDatalist('unitSuggestions', [
      ...gsdReadHistory('unit'),
      ...inventory.map(row => row.unit),
      'PCS', 'BOX', 'SET', 'ROLL', 'BAG', 'GALLON', 'METER'
    ]);
  };
  await syncPoSuggestions();
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
      gsdSaveHistory('po_reference', body.reference);
      gsdSaveHistory('category', body.category);
      gsdSaveHistory('unit', body.unit);
      gsdToast('Purchase order recorded and stock updated.');
      form.reset();
      updateTotal();
      await gsdRenderRecent('PO', 'recentPoContainer');
      inventory = await gsdGetInventory();
      await syncPoSuggestions();
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
  const syncSrfSuggestions = async () => {
    datalist.innerHTML = gsdProductOptions(inventory);
    const { transactions } = await gsdRequest('/transactions?type=SRF&limit=200').catch(() => ({ transactions: [] }));
    gsdPopulateDatalist('srfReferenceSuggestions', [
      ...gsdReadHistory('srf_reference'),
      ...transactions.map(row => row.reference)
    ]);
    gsdPopulateDatalist('officeSuggestions', gsdOfficeSuggestionsList([
      ...gsdReadHistory('office'),
      ...transactions.map(row => row.office)
    ]));
    gsdPopulateDatalist('unitSuggestions', [
      ...gsdReadHistory('unit'),
      ...inventory.map(row => row.unit),
      'ROLLS', 'PCS', 'BAGS', 'BOX', 'SET', 'GALLON', 'METER'
    ]);
  };
  await syncSrfSuggestions();
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
    const srfRef = document.getElementById('srfReferenceInput').value;
    const officeVal = document.getElementById('officeInput').value;
    const unitVal = document.getElementById('unitInput').value;
    try {
      await gsdRequest('/transactions', { method: 'POST', body: JSON.stringify({
        type: 'SRF', reference: srfRef,
        itemName: product.value, quantity: quantity.value, unit: unitVal,
        unitCost: cost.value, office: officeVal, date: txnDate()
      }) });
      gsdSaveHistory('srf_reference', srfRef);
      gsdSaveHistory('office', officeVal);
      gsdSaveHistory('unit', unitVal);
      gsdToast('SRF recorded and stock deducted.');
      form.reset();
      inventory = await gsdGetInventory();
      await syncSrfSuggestions();
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
  const officeInput = document.getElementById('returningOfficeInput');
  const conditionSelect = document.getElementById('conditionSelect');
  const itemsContainer = document.getElementById('returnItemsContainer');
  const addItemBtn = document.getElementById('addReturnItemBtn');
  const limitNote = document.getElementById('returnItemsLimitNote');
  const archiveContainer = document.getElementById('recentSlipContainer');
  const archiveSearch = document.getElementById('archiveSearchInput');
  const archiveDate = document.getElementById('archiveDateFilter');
  const archiveBadge = document.getElementById('archiveCountBadge');
  const MAX_RETURN_ITEMS = 4;
  let archiveRows = [];
  let groupedSlips = [];
  let lastSelectedCondition = '';

  const syncReturnSuggestions = () => {
    gsdPopulateDatalist('officeList', gsdOfficeSuggestionsList([
      ...gsdReadHistory('office'),
      ...archiveRows.map(row => row.office)
    ]));
    gsdPopulateDatalist('locationList', [
      ...gsdReadHistory('return_location'),
      ...archiveRows.map(row => row.metadata?.location)
    ]);
    gsdPopulateDatalist('resenderList', [
      ...gsdReadHistory('return_resender'),
      ...archiveRows.map(row => row.metadata?.resender)
    ]);
    gsdPopulateDatalist('receiverList', [
      ...gsdReadHistory('return_receiver'),
      ...archiveRows.map(row => row.metadata?.receiver)
    ]);
    gsdPopulateDatalist('reasonList', [
      ...gsdReadHistory('return_reason'),
      ...archiveRows.map(row => row.metadata?.reason || row.notes)
    ]);
    gsdPopulateDatalist('unitList', [
      ...gsdReadHistory('unit'),
      ...inventory.map(item => item.unit),
      'PCS', 'ROLLS', 'BAGS', 'BOX', 'SET'
    ]);
  };
  syncReturnSuggestions();

  conditionSelect?.addEventListener('change', () => {
    const chosen = conditionSelect.value;
    itemsContainer.querySelectorAll('.return-item-remarks').forEach(input => {
      const currentVal = input.value.trim();
      if (!currentVal || (lastSelectedCondition && currentVal === lastSelectedCondition)) {
        input.value = chosen;
      }
    });
    lastSelectedCondition = chosen;
  });

  const syncSrfSuggestions = async () => {
    const srfRows = (await gsdRequest('/transactions?type=SRF&limit=500')).transactions;
    const uniqueRefs = [...new Set(srfRows.map(row => row.reference).filter(Boolean))];
    document.getElementById('srfReferenceList').innerHTML = uniqueRefs
      .map(ref => `<option value="${gsdEscape(ref)}"></option>`).join('');
    return srfRows;
  };
  let srfRows = await syncSrfSuggestions();

  const syncItemRowsState = () => {
    const rows = [...itemsContainer.querySelectorAll('.return-item-row')];
    rows.forEach((row, idx) => {
      const badge = row.querySelector('.return-item-badge');
      if (badge) badge.textContent = `Item ${idx + 1}`;
      const removeBtn = row.querySelector('.return-item-remove-btn');
      if (removeBtn) removeBtn.hidden = rows.length <= 1;
    });
    const atMax = rows.length >= MAX_RETURN_ITEMS;
    if (addItemBtn) addItemBtn.disabled = atMax;
    if (limitNote) {
      limitNote.textContent = atMax
        ? 'Maximum 4 items reached (4-row Return Slip)'
        : `${rows.length} of ${MAX_RETURN_ITEMS} items`;
      limitNote.classList.toggle('is-max', atMax);
    }
  };

  const createItemRow = (prefill = {}) => {
    const row = document.createElement('div');
    row.className = 'return-item-row';
    row.innerHTML = `
      <div class="return-item-row-head">
        <span class="return-item-badge">Item</span>
        <button type="button" class="return-item-remove-btn" aria-label="Remove item row">Remove</button>
      </div>
      <div class="return-item-grid">
        <div class="span-2">
          <label class="form-label">PRODUCT NAME (SEARCH OR SELECT)</label>
          <input type="text" class="pill-input return-item-name" list="returnProductList" placeholder="Type item name to return..." required />
        </div>
        <div>
          <label class="form-label">QUANTITY TO RETURN</label>
          <input type="number" class="pill-input return-item-qty" min="1" step="1" placeholder="Enter unused quantity" required />
        </div>
        <div>
          <label class="form-label">UNIT</label>
          <input type="text" class="pill-input return-item-unit" list="unitList" placeholder="e.g. PCS, ROLLS" required />
        </div>
        <div class="span-2">
          <label class="form-label">ITEM REMARKS (OPTIONAL)</label>
          <input type="text" class="pill-input return-item-remarks" placeholder="Optional item-specific remarks..." />
        </div>
      </div>`;
    const nameInput = row.querySelector('.return-item-name');
    const qtyInput = row.querySelector('.return-item-qty');
    const unitInput = row.querySelector('.return-item-unit');
    const remarksInput = row.querySelector('.return-item-remarks');
    if (prefill.itemName) nameInput.value = prefill.itemName;
    if (prefill.quantity) qtyInput.value = prefill.quantity;
    if (prefill.unit) unitInput.value = prefill.unit;
    if (prefill.remarks != null) remarksInput.value = prefill.remarks;
    else if (conditionSelect?.value) remarksInput.value = conditionSelect.value;

    const fillUnit = () => {
      const matched = inventory.find(item => item.name.toLowerCase() === nameInput.value.trim().toLowerCase());
      if (matched) unitInput.value = matched.unit;
    };
    nameInput.addEventListener('input', fillUnit);
    nameInput.addEventListener('change', fillUnit);

    row.querySelector('.return-item-remove-btn').addEventListener('click', () => {
      if (itemsContainer.querySelectorAll('.return-item-row').length <= 1) return;
      row.remove();
      syncItemRowsState();
    });

    itemsContainer.appendChild(row);
    syncItemRowsState();
    return row;
  };

  const resetItemRows = () => {
    itemsContainer.replaceChildren();
    createItemRow();
  };

  resetItemRows();

  addItemBtn?.addEventListener('click', () => {
    if (itemsContainer.querySelectorAll('.return-item-row').length >= MAX_RETURN_ITEMS) return;
    const row = createItemRow();
    row.querySelector('.return-item-name')?.focus();
  });

  const fillFromSrf = () => {
    const ref = srfInput.value.trim().toLowerCase();
    if (!ref) return;
    const match = srfRows.find(row => String(row.reference || '').toLowerCase() === ref);
    if (match) {
      if (match.office && !officeInput.value.trim()) officeInput.value = match.office;
      const firstRow = itemsContainer.querySelector('.return-item-row');
      const firstProduct = firstRow?.querySelector('.return-item-name');
      const firstUnit = firstRow?.querySelector('.return-item-unit');
      if (match.item_name && firstProduct && !firstProduct.value.trim()) firstProduct.value = match.item_name;
      if (match.unit && firstUnit && !firstUnit.value.trim()) firstUnit.value = match.unit;
    }
  };
  srfInput.addEventListener('input', fillFromSrf);
  srfInput.addEventListener('change', fillFromSrf);

  const parseMeta = row => {
    if (row.metadata && typeof row.metadata === 'object') return row.metadata;
    try { return JSON.parse(row.metadata || '{}'); } catch { return {}; }
  };

  const groupArchiveSlips = rows => {
    const slipMap = new Map();
    rows.forEach(row => {
      const refKey = String(row.reference || `ROW-${row.id}`).toLowerCase();
      const details = parseMeta(row);
      if (!slipMap.has(refKey)) {
        slipMap.set(refKey, {
          reference: row.reference,
          occurred_on: row.occurred_on,
          office: row.office || details.returningOffice || '',
          actor_name: row.actor_name || 'System',
          details,
          notes: row.notes || '',
          items: []
        });
      }
      slipMap.get(refKey).items.push({
        id: row.id,
        itemNo: row.item_id ? `PROD${String(row.item_id).padStart(4, '0')}` : '1',
        itemName: row.item_name,
        quantity: Number(row.quantity) || 0,
        unit: row.unit || '',
        remarks: details.remarks || details.reason || row.notes || ''
      });
    });
    return [...slipMap.values()];
  };

  const renderArchive = () => {
    if (!archiveContainer) return;
    const query = archiveSearch?.value.trim().toLowerCase() || '';
    const dateFilter = archiveDate?.value || '';
    const filtered = groupedSlips.filter(slip => {
      const itemText = slip.items.map(item => `${item.itemName} ${item.remarks}`).join(' ');
      const text = `${slip.reference} ${itemText} ${slip.office} ${slip.details.location || ''} ${slip.details.originalSrf || ''} ${slip.actor_name}`.toLowerCase();
      return (!query || text.includes(query)) && (!dateFilter || String(slip.occurred_on || '').slice(0, 10) === dateFilter);
    });
    if (archiveBadge) {
      archiveBadge.textContent = `${filtered.length} ${filtered.length === 1 ? 'record' : 'records'}`;
    }
    if (!filtered.length) {
      archiveContainer.innerHTML = '<p class="empty-state">No return slip records match the current filter.</p>';
      return;
    }
    const groups = new Map();
    filtered.forEach(slip => {
      const key = String(slip.occurred_on || '').slice(0, 10) || 'Undated';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(slip);
    });
    archiveContainer.innerHTML = [...groups.entries()].map(([dateKey, entries]) => `
      <section class="archive-date-group">
        <div class="archive-date-header">
          <span>${gsdEscape(dateKey === 'Undated' ? 'Undated' : gsdDisplayDate(dateKey))}</span>
          <span class="archive-date-count">${entries.length} ${entries.length === 1 ? 'slip' : 'slips'}</span>
        </div>
        ${entries.map(slip => {
          const totalsText = gsdFormatUnitTotals(slip.items);
          const itemHeading = slip.items.length === 1
            ? gsdEscape(slip.items[0].itemName)
            : `${slip.items.length} Returned Items`;
          const itemsListHtml = slip.items.length > 1
            ? `<ul class="archive-items-list">${slip.items.map(item => `<li>${gsdEscape(item.itemName)} &mdash; ${gsdFormatNumber(item.quantity)} ${gsdEscape(item.unit)}</li>`).join('')}</ul>`
            : '';
          return `
            <article class="archive-entry-card">
              <div class="archive-entry-body">
                <div class="recent-entry-ref">${gsdEscape(slip.reference)}</div>
                <div class="recent-entry-product">${itemHeading}</div>
                ${itemsListHtml}
                <div class="recent-entry-meta">${gsdEscape(totalsText)} &middot; ${gsdDisplayDate(slip.occurred_on)}</div>
                ${slip.office ? `<div class="recent-entry-office">Office: ${gsdEscape(slip.office)}</div>` : ''}
                <small class="recent-entry-actor">Recorded by ${gsdEscape(slip.actor_name)}</small>
              </div>
              <div class="archive-entry-actions">
                <button type="button" class="archive-print-btn" data-action="print-slip" data-ref="${gsdEscape(slip.reference)}" title="Print Return Slip ${gsdEscape(slip.reference)}" aria-label="Print Return Slip ${gsdEscape(slip.reference)}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="6 9 6 2 18 2 18 9"></polyline>
                    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                    <rect x="6" y="14" width="12" height="8"></rect>
                  </svg>
                  Print
                </button>
                <button type="button" class="archive-delete-btn" data-action="delete-slip" data-ref="${gsdEscape(slip.reference)}" title="Delete Return Slip ${gsdEscape(slip.reference)}" aria-label="Delete Return Slip ${gsdEscape(slip.reference)}">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
                    <path d="M10 11v6"></path>
                    <path d="M14 11v6"></path>
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
                  </svg>
                  Delete
                </button>
              </div>
            </article>`;
        }).join('')}
      </section>`).join('');
  };

  const loadArchive = async () => {
    archiveRows = (await gsdRequest('/transactions?type=RETURN&limit=500')).transactions;
    groupedSlips = groupArchiveSlips(archiveRows);
    syncReturnSuggestions();
    renderArchive();
  };

  archiveSearch?.addEventListener('input', renderArchive);
  archiveDate?.addEventListener('change', renderArchive);
  document.getElementById('clearArchiveFilterBtn')?.addEventListener('click', () => {
    if (archiveSearch) archiveSearch.value = '';
    if (archiveDate) archiveDate.value = '';
    renderArchive();
  });

  archiveContainer?.addEventListener('click', async event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const slip = groupedSlips.find(entry => entry.reference === button.dataset.ref);
    if (!slip) return;

    if (button.dataset.action === 'print-slip') {
      gsdUpdatePrintSlip({
        ...slip.details,
        reference: slip.reference,
        date: slip.occurred_on,
        reason: slip.details.reason || slip.notes || '-',
        items: slip.items
      });
      window.print();
    } else if (button.dataset.action === 'delete-slip') {
      const summary = `${slip.items.length} ${slip.items.length === 1 ? 'item' : 'items'} (${gsdFormatUnitTotals(slip.items)})`;
      if (!confirm(`Delete return slip ${slip.reference}?\n\nThis will reverse the restocked quantity for ${summary} and cannot be undone.`)) return;
      button.disabled = true;
      try {
        await gsdRequest(`/return-slips/${encodeURIComponent(slip.reference)}`, { method: 'DELETE' });
        gsdToast('Return slip deleted and stock adjusted.');
        inventory = await gsdGetInventory();
        document.getElementById('returnProductList').innerHTML = gsdProductOptions(inventory);
        await loadArchive();
      } catch (error) {
        gsdToast(error.message, true);
        button.disabled = false;
      }
    }
  });

  const errorBanner = document.getElementById('returnSlipError');
  const setFormError = (message = '') => {
    if (!errorBanner) return;
    errorBanner.textContent = message;
    errorBanner.hidden = !message;
  };

  form.addEventListener('input', () => setFormError(''));
  gsdWireClear(form, document.getElementById('clearFormBtn'), () => {
    setFormError('');
    resetItemRows();
    srfInput.focus();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    setFormError('');
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    const reference = `RS-${gsdToday().replace(/-/g, '')}-${String(Date.now()).slice(-6)}`;
    const details = {
      originalSrf: srfInput.value.trim(),
      returningOffice: officeInput.value.trim(),
      location: document.getElementById('locationInput').value.trim(),
      resender: document.getElementById('resenderInput').value.trim(),
      receiver: document.getElementById('receiverInput').value.trim(),
      reason: document.getElementById('reasonInput').value.trim()
    };
    const items = [...itemsContainer.querySelectorAll('.return-item-row')].map(row => ({
      itemName: row.querySelector('.return-item-name').value.trim(),
      quantity: Number(row.querySelector('.return-item-qty').value),
      unit: row.querySelector('.return-item-unit').value.trim(),
      remarks: row.querySelector('.return-item-remarks').value.trim()
    }));
    const date = txnDate();
    try {
      const created = await gsdRequest('/return-slips', {
        method: 'POST',
        body: JSON.stringify({
          reference,
          date,
          office: details.returningOffice,
          notes: details.reason,
          details,
          items
        })
      });
      const printItems = (created.items || []).map((entry, idx) => ({
        itemNo: entry.itemId ? `PROD${String(entry.itemId).padStart(4, '0')}` : String(idx + 1),
        itemName: entry.itemName,
        quantity: entry.quantity,
        unit: entry.unit,
        remarks: items[idx]?.remarks || ''
      }));
      gsdSaveHistory('office', details.returningOffice);
      gsdSaveHistory('return_location', details.location);
      gsdSaveHistory('return_resender', details.resender);
      gsdSaveHistory('return_receiver', details.receiver);
      gsdSaveHistory('return_reason', details.reason);
      items.forEach(item => gsdSaveHistory('unit', item.unit));
      gsdUpdatePrintSlip({ ...details, reference, date, items: printItems });
      gsdToast('Return slip recorded and added to archive.');
      form.reset();
      lastSelectedCondition = '';
      resetItemRows();
      inventory = await gsdGetInventory();
      document.getElementById('returnProductList').innerHTML = gsdProductOptions(inventory);
      srfRows = await syncSrfSuggestions();
      await loadArchive();
    } catch (error) {
      console.error('Return slip submission failed:', error.message);
      setFormError(error.message);
      gsdToast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });

  await loadArchive();
  if (groupedSlips[0]) {
    const latest = groupedSlips[0];
    gsdUpdatePrintSlip({
      ...latest.details,
      reference: latest.reference,
      date: latest.occurred_on,
      reason: latest.details.reason || latest.notes || '-',
      items: latest.items
    });
  } else {
    gsdUpdatePrintSlip({ reference: '-', date: '', items: [] });
  }
}

function gsdFormatUnitTotals(items) {
  if (!Array.isArray(items) || !items.length) return '-';
  const byUnit = new Map();
  items.forEach(item => {
    const qty = Number(item.quantity) || 0;
    if (qty <= 0) return;
    const unit = String(item.unit || '').trim().toUpperCase();
    byUnit.set(unit, (byUnit.get(unit) || 0) + qty);
  });
  if (!byUnit.size) return '-';
  return [...byUnit.entries()]
    .map(([unit, qty]) => `${gsdFormatNumber(qty)}${unit ? ` ${unit}` : ''}`)
    .join(', ');
}

function gsdUpdatePrintSlip(data) {
  const slip = {
    originalSrf: '-', returningOffice: '-', location: '-', resender: '-', receiver: '-', reason: '-',
    ...data
  };
  const items = Array.isArray(slip.items)
    ? slip.items.slice(0, 4)
    : (slip.itemName && slip.itemName !== '-' ? [{
        itemNo: slip.itemNo || '1',
        itemName: slip.itemName,
        quantity: slip.quantity,
        unit: slip.unit,
        remarks: slip.reason
      }] : []);
  const refText = slip.returningOffice && slip.returningOffice !== '-'
    ? `${slip.originalSrf} (${slip.returningOffice})`
    : slip.originalSrf;
  const qtyText = gsdFormatUnitTotals(items);
  const itemsBody = document.getElementById('psItemsBody');
  if (itemsBody) {
    const rowsHtml = [];
    for (let i = 0; i < 4; i += 1) {
      const entry = items[i];
      if (entry) {
        rowsHtml.push(`
          <tr>
            <td style="border:1px solid #374151;padding:8px 9px;height:30px;text-align:center;">${gsdEscape(entry.itemNo || String(i + 1))}</td>
            <td style="border:1px solid #374151;padding:8px 9px;height:30px;">${gsdEscape(entry.itemName || '-')}</td>
            <td style="border:1px solid #374151;padding:8px 9px;height:30px;text-align:center;">${entry.quantity ? gsdFormatNumber(entry.quantity) : '-'}</td>
            <td style="border:1px solid #374151;padding:8px 9px;height:30px;text-align:center;">${gsdEscape(entry.unit || '-')}</td>
            <td style="border:1px solid #374151;padding:8px 9px;height:30px;">${gsdEscape(entry.remarks || '')}</td>
          </tr>`);
      } else {
        rowsHtml.push('<tr><td style="border:1px solid #374151;height:28px;"></td><td style="border:1px solid #374151;"></td><td style="border:1px solid #374151;"></td><td style="border:1px solid #374151;"></td><td style="border:1px solid #374151;"></td></tr>');
      }
    }
    itemsBody.innerHTML = rowsHtml.join('');
  }
  const values = {
    psSlipNo: slip.reference,
    psRefNo: refText,
    psDate: gsdDisplayDate(slip.date) || '-',
    psLocation: slip.location || slip.returningOffice || '-',
    psTotalItems: `TOTAL ITEMS: ${items.length}`,
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
  const dropdown = document.getElementById('stockCardDropdown');
  const allItems = await gsdGetInventory();
  let current = null;
  let ledgerPage = 1;
  const set = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };

  const renderDropdown = (filterText = '') => {
    if (!dropdown) return;
    const query = String(filterText || '').trim().toLowerCase();
    const matches = allItems.filter(item => {
      if (!query) return true;
      const code = `PROD${String(item.id).padStart(4, '0')}`.toLowerCase();
      return item.name.toLowerCase().includes(query) ||
        String(item.category || '').toLowerCase().includes(query) ||
        code.includes(query);
    });
    if (!matches.length) {
      dropdown.innerHTML = '<div class="stockcard-dropdown-empty">No matching products. Press Enter to search by reference.</div>';
      return;
    }
    dropdown.innerHTML = matches.map(item => `
      <button type="button" class="stockcard-dropdown-item" role="option" data-item-name="${gsdEscape(item.name)}">
        <span class="stockcard-dropdown-name">${gsdEscape(item.name)}</span>
        <span class="stockcard-dropdown-meta">${gsdFormatNumber(item.quantity)} ${gsdEscape(item.unit)}</span>
      </button>`).join('');
  };

  const openDropdown = (showAll = false) => {
    if (!dropdown) return;
    renderDropdown(showAll ? '' : search.value);
    dropdown.hidden = false;
    search?.setAttribute('aria-expanded', 'true');
  };

  const closeDropdown = () => {
    if (!dropdown) return;
    dropdown.hidden = true;
    search?.setAttribute('aria-expanded', 'false');
  };

  search?.addEventListener('focus', () => openDropdown(true));
  search?.addEventListener('click', () => openDropdown(true));
  dropdown?.addEventListener('mousedown', event => {
    const option = event.target.closest('.stockcard-dropdown-item');
    if (!option) return;
    event.preventDefault();
    search.value = option.dataset.itemName || '';
    ledgerPage = 1;
    closeDropdown();
    render(search.value.trim()).catch(error => gsdToast(error.message, true));
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.search-box-wrap')) closeDropdown();
  });

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
      body.innerHTML = '<tr><td colspan="6" class="empty-ledger">No matching inventory item.</td></tr>';
      printBody.innerHTML = body.innerHTML;
      gsdRenderPagination(pagination, 0, 1, () => {});
      return;
    }
    if (!search.value.trim()) search.value = item.name;
    const received = transactions.filter(row => row.type !== 'SRF').reduce((sum, row) => sum + Number(row.quantity), 0);
    const issued = transactions.filter(row => row.type === 'SRF').reduce((sum, row) => sum + Number(row.quantity), 0);

    const formatRow = row => {
      const receipt = row.type === 'SRF' ? '-' : gsdFormatNumber(row.quantity);
      const issue = row.type === 'SRF' ? gsdFormatNumber(row.quantity) : '-';
      return `<tr><td>${gsdDisplayDate(row.occurred_on)}</td><td>${gsdEscape(row.reference || '-')}</td><td>${receipt}</td><td>${issue}</td><td>${gsdEscape(row.office || '-')}</td><td><strong>${gsdFormatNumber(row.balance)}</strong></td></tr>`;
    };

    const pageCount = Math.max(1, Math.ceil(transactions.length / GSD_PAGE_SIZE));
    ledgerPage = Math.min(ledgerPage, pageCount);
    const pageRows = transactions.slice((ledgerPage - 1) * GSD_PAGE_SIZE, ledgerPage * GSD_PAGE_SIZE);
    body.innerHTML = transactions.length
      ? pageRows.map(formatRow).join('')
      : '<tr><td colspan="6" class="empty-ledger">No movements recorded.</td></tr>';
    printBody.innerHTML = transactions.length
      ? transactions.map(formatRow).join('')
      : '<tr><td colspan="6" class="empty-ledger">No movements recorded.</td></tr>';
    ledgerPage = gsdRenderPagination(pagination, transactions.length, ledgerPage, page => {
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
    openDropdown(false);
    searchTimer = setTimeout(() => render().catch(error => gsdToast(error.message, true)), 180);
  });
  search.addEventListener('change', () => { ledgerPage = 1; render().catch(error => gsdToast(error.message, true)); });
  search.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeDropdown(); return; }
    if (event.key === 'Enter') { event.preventDefault(); closeDropdown(); ledgerPage = 1; render().catch(error => gsdToast(error.message, true)); }
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
