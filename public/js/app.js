const app = document.querySelector('#app');
const toastStack = document.querySelector('#toastStack');
const socket = window.io ? window.io() : null;

const state = {
  view: 'customer',
  bootstrap: null,
  qr: null,
  menu: { categories: [], items: [] },
  cart: [],
  currentOrder: null,
  auth: {
    admin: null,
    kitchen: null,
    waiter: null
  },
  staffOrders: [],
  waiterRequests: [],
  dashboard: null,
  tables: [],
  search: '',
  categoryId: 'all',
  diet: 'all'
};

const statusFlow = ['received', 'accepted', 'preparing', 'ready', 'delivered'];
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

document.addEventListener('DOMContentLoaded', init);

async function init() {
  wireShell();
  state.bootstrap = await api('/api/bootstrap');
  const pathToken = location.pathname.startsWith('/t/') ? decodeURIComponent(location.pathname.slice(3)) : null;
  await resolveQr(pathToken || state.bootstrap.demoTableToken);
  connectSocket();
  await loadMenu();
  render();
}

function wireShell() {
  document.querySelectorAll('.role-tab').forEach((button) => {
    button.addEventListener('click', () => {
      state.view = button.dataset.view;
      document.querySelectorAll('.role-tab').forEach((tab) => tab.classList.toggle('active', tab === button));
      render();
      if (state.view === 'admin') loadAdmin();
      if (state.view === 'kitchen') loadStaffOrders('kitchen');
      if (state.view === 'waiter') loadWaiter();
    });
  });

  document.querySelector('#themeToggle').addEventListener('click', () => {
    const html = document.documentElement;
    html.dataset.theme = html.dataset.theme === 'dark' ? 'light' : 'dark';
  });
}

function connectSocket() {
  if (!socket || !state.qr) return;
  socket.emit('join:restaurant', { restaurantId: state.qr.restaurant.id });
  socket.on('order:created', handleOrderEvent);
  socket.on('order:updated', handleOrderEvent);
  socket.on('order:ready', (order) => {
    handleOrderEvent(order);
    if (state.view === 'waiter') toast(`Order ${order.order_number} is ready for table ${order.table_label}.`);
  });
  socket.on('request:updated', () => {
    if (state.view === 'waiter') loadWaiter();
  });
}

function joinRole(role) {
  if (socket && state.qr) socket.emit('join:role', { restaurantId: state.qr.restaurant.id, role });
}

function handleOrderEvent(order) {
  if (state.currentOrder && state.currentOrder.id === order.id) {
    state.currentOrder = order;
    render();
  }
  const index = state.staffOrders.findIndex((item) => item.id === order.id);
  if (index >= 0) state.staffOrders[index] = order;
  if (index === -1 && state.view !== 'customer') state.staffOrders.unshift(order);
  if (state.view !== 'customer') render();
}

async function resolveQr(token) {
  state.qr = await api(`/api/qr/resolve?token=${encodeURIComponent(token)}`);
}

async function loadMenu() {
  const query = new URLSearchParams({
    restaurantId: state.qr.restaurant.id,
    search: state.search,
    categoryId: state.categoryId,
    diet: state.diet
  });
  state.menu = await api(`/api/menu?${query}`);
}

async function loadAdmin() {
  if (!state.auth.admin) return render();
  state.dashboard = await authed('/api/admin/dashboard', 'admin');
  state.tables = await authed('/api/admin/tables', 'admin');
  await loadMenu();
  render();
}

async function loadStaffOrders(role) {
  if (!state.auth[role]) return render();
  joinRole(role);
  const status = role === 'kitchen' ? 'all' : 'ready';
  state.staffOrders = await authed(`/api/orders?status=${status}`, role);
  render();
}

async function loadWaiter() {
  if (!state.auth.waiter) return render();
  joinRole('waiter');
  const [orders, requests] = await Promise.all([
    authed('/api/orders?status=ready', 'waiter'),
    authed('/api/waiter/requests', 'waiter')
  ]);
  state.staffOrders = orders;
  state.waiterRequests = requests;
  render();
}

function render() {
  if (!state.qr) {
    app.innerHTML = '<section class="empty">Loading Resto App...</section>';
    return;
  }

  if (state.view === 'customer') renderCustomer();
  if (state.view === 'admin') renderAdmin();
  if (state.view === 'kitchen') renderKitchen();
  if (state.view === 'waiter') renderWaiter();
}

function renderCustomer() {
  const restaurant = state.qr.restaurant;
  app.innerHTML = `
    <section class="hero-band">
      <div class="restaurant-hero">
        <img src="${escapeHtml(restaurant.logo_url)}" alt="${escapeHtml(restaurant.name)}">
        <div class="hero-copy">
          <h2>${escapeHtml(restaurant.name)}</h2>
          <p>${escapeHtml(restaurant.tagline)} Table ${escapeHtml(state.qr.table.label)}</p>
        </div>
      </div>
      <div class="panel">
        <h2>Table ${escapeHtml(state.qr.table.label)}</h2>
        <p class="muted">Guest ordering is active. Phone OTP and profile history are wired as future-ready auth paths.</p>
        <div class="chip-row">
          ${['Need Water', 'Need Spoon', 'Need Bill', 'Call Waiter'].map((type) => `
            <button class="chip" data-request="${type}">${type}</button>
          `).join('')}
        </div>
        ${state.currentOrder ? renderTimeline(state.currentOrder) : ''}
      </div>
    </section>

    <section class="customer-grid">
      <div>
        ${renderMenuToolbar()}
        <div class="menu-grid">
          ${state.menu.items.map(renderMenuItem).join('') || '<div class="empty">No menu items match your filters.</div>'}
        </div>
      </div>
      ${renderCart()}
    </section>
  `;

  app.querySelector('#menuSearch').addEventListener('input', debounce(async (event) => {
    state.search = event.target.value;
    await loadMenu();
    render();
  }, 250));
  app.querySelector('#categoryFilter').addEventListener('change', async (event) => {
    state.categoryId = event.target.value;
    await loadMenu();
    render();
  });
  app.querySelector('#dietFilter').addEventListener('change', async (event) => {
    state.diet = event.target.value;
    await loadMenu();
    render();
  });
  app.querySelectorAll('[data-add]').forEach((button) => {
    button.addEventListener('click', () => addToCart(Number(button.dataset.add)));
  });
  app.querySelectorAll('[data-cart-plus]').forEach((button) => {
    button.addEventListener('click', () => updateCart(Number(button.dataset.cartPlus), 1));
  });
  app.querySelectorAll('[data-cart-minus]').forEach((button) => {
    button.addEventListener('click', () => updateCart(Number(button.dataset.cartMinus), -1));
  });
  app.querySelector('#placeOrder')?.addEventListener('click', placeOrder);
  app.querySelectorAll('[data-request]').forEach((button) => {
    button.addEventListener('click', () => createCustomerRequest(button.dataset.request));
  });
}

function renderMenuToolbar() {
  return `
    <div class="toolbar">
      <input class="input" id="menuSearch" value="${escapeHtml(state.search)}" placeholder="Search dishes, ingredients">
      <select class="select" id="categoryFilter">
        <option value="all">All categories</option>
        ${state.menu.categories.map((category) => `
          <option value="${category.id}" ${String(category.id) === String(state.categoryId) ? 'selected' : ''}>${escapeHtml(category.name)}</option>
        `).join('')}
      </select>
      <select class="select" id="dietFilter">
        <option value="all">Veg and non-veg</option>
        <option value="veg" ${state.diet === 'veg' ? 'selected' : ''}>Veg</option>
        <option value="non_veg" ${state.diet === 'non_veg' ? 'selected' : ''}>Non-veg</option>
      </select>
    </div>
  `;
}

function renderMenuItem(item) {
  return `
    <article class="menu-card">
      <img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.name)}">
      <div class="menu-body">
        <div class="menu-title">
          <h3>${escapeHtml(item.name)}</h3>
          <span class="price">${money.format(item.price)}</span>
        </div>
        <p class="muted">${escapeHtml(item.description)}</p>
        <p class="diet ${item.diet_type}">${item.diet_type === 'veg' ? 'Veg' : 'Non-veg'} · ${escapeHtml(item.category_name)}</p>
        <div class="action-row">
          <button class="btn primary" data-add="${item.id}" ${item.is_available ? '' : 'disabled'}>Add</button>
          <span class="muted">${item.prep_minutes} min</span>
        </div>
      </div>
    </article>
  `;
}

function renderCart() {
  const totals = cartTotals();
  return `
    <aside class="cart-panel">
      <h2>Cart</h2>
      ${state.cart.length ? state.cart.map((item) => `
        <div class="cart-item">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <p class="muted">${money.format(item.price)} each</p>
          </div>
          <div class="qty">
            <button data-cart-minus="${item.id}" aria-label="Decrease">-</button>
            <span>${item.quantity}</span>
            <button data-cart-plus="${item.id}" aria-label="Increase">+</button>
          </div>
        </div>
      `).join('') : '<div class="empty">Your cart is ready when you are.</div>'}
      <label class="muted" for="orderNotes">Order notes</label>
      <textarea class="textarea" id="orderNotes" placeholder="Less spicy, allergy notes, birthday plating..."></textarea>
      <div class="bill-row"><span>Subtotal</span><strong>${money.format(totals.subtotal)}</strong></div>
      <div class="bill-row"><span>GST (${state.qr.restaurant.gst_rate}%)</span><strong>${money.format(totals.gst)}</strong></div>
      <div class="bill-row bill-total"><span>Total</span><strong>${money.format(totals.total)}</strong></div>
      <button class="btn primary" id="placeOrder" ${state.cart.length ? '' : 'disabled'}>Place order</button>
    </aside>
  `;
}

function renderTimeline(order) {
  const currentIndex = statusFlow.indexOf(order.status);
  return `
    <div class="timeline">
      <div class="order-head">
        <strong>${escapeHtml(order.order_number)}</strong>
        <span class="status-badge ${order.status}">${escapeHtml(order.status)}</span>
      </div>
      ${statusFlow.map((status, index) => `
        <div class="status-step ${index <= currentIndex ? 'done' : ''}">
          <span class="status-dot"></span>
          <span>${title(status)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderAdmin() {
  if (!state.auth.admin) {
    app.innerHTML = renderLogin('admin');
    wireLogin('admin');
    return;
  }

  app.innerHTML = `
    <section class="dashboard-grid">
      ${metric('Today Orders', state.dashboard?.todays_orders || 0)}
      ${metric('Revenue', money.format(state.dashboard?.revenue || 0))}
      ${metric('Active Tables', state.dashboard?.active_tables || 0)}
      ${metric('Pending Orders', state.dashboard?.pending_orders || 0)}
    </section>
    <section class="hero-band">
      <div class="panel">
        <h2>Menu Management</h2>
        <form class="form-grid" id="menuForm">
          <input class="input" name="name" placeholder="Item name" required>
          <input class="input" name="price" placeholder="Price" type="number" step="0.01" required>
          <select class="select" name="categoryId" required>
            ${state.menu.categories.map((category) => `<option value="${category.id}">${escapeHtml(category.name)}</option>`).join('')}
          </select>
          <select class="select" name="dietType">
            <option value="veg">Veg</option>
            <option value="non_veg">Non-veg</option>
          </select>
          <input class="input" name="imageUrl" placeholder="Image URL">
          <input class="input" name="prepMinutes" placeholder="Prep minutes" type="number" value="15">
          <textarea class="textarea" name="description" placeholder="Description"></textarea>
          <textarea class="textarea" name="ingredients" placeholder="Ingredients"></textarea>
          <button class="btn primary" type="submit">Add item</button>
        </form>
      </div>
      <div class="panel">
        <h2>Tables and QR</h2>
        <form class="action-row" id="tableForm">
          <input class="input" name="label" placeholder="T9" required>
          <input class="input" name="seats" type="number" value="4" min="1">
          <button class="btn blue" type="submit">Add table</button>
        </form>
        <div class="table-list">
          ${state.tables.map((table) => `
            <div class="row-item">
              <div><strong>${escapeHtml(table.label)}</strong><p class="muted">${table.seats} seats · ${escapeHtml(table.status)}</p></div>
              <a class="btn ghost" href="${table.qr_url}" target="_blank">QR link</a>
            </div>
          `).join('')}
        </div>
      </div>
    </section>
    <section class="panel">
      <h2>Current Menu</h2>
      <div class="menu-admin-list">
        ${state.menu.items.map((item) => `
          <div class="row-item">
            <div><strong>${escapeHtml(item.name)}</strong><p class="muted">${escapeHtml(item.category_name)} · ${money.format(item.price)}</p></div>
            <button class="btn danger" data-delete-menu="${item.id}">Delete</button>
          </div>
        `).join('')}
      </div>
    </section>
  `;

  app.querySelector('#menuForm').addEventListener('submit', addMenuItem);
  app.querySelector('#tableForm').addEventListener('submit', addTable);
  app.querySelectorAll('[data-delete-menu]').forEach((button) => {
    button.addEventListener('click', () => deleteMenuItem(Number(button.dataset.deleteMenu)));
  });
}

function renderKitchen() {
  if (!state.auth.kitchen) {
    app.innerHTML = renderLogin('kitchen');
    wireLogin('kitchen');
    return;
  }

  const activeOrders = state.staffOrders.filter((order) => !['delivered', 'cancelled'].includes(order.status));
  app.innerHTML = `
    <section class="panel">
      <h2>Kitchen Orders</h2>
      <div class="staff-grid">
        ${activeOrders.map((order) => renderOrderCard(order, 'kitchen')).join('') || '<div class="empty">No active kitchen orders.</div>'}
      </div>
    </section>
  `;
  wireOrderActions('kitchen');
}

function renderWaiter() {
  if (!state.auth.waiter) {
    app.innerHTML = renderLogin('waiter');
    wireLogin('waiter');
    return;
  }

  app.innerHTML = `
    <section class="hero-band">
      <div class="panel">
        <h2>Ready Orders</h2>
        <div class="staff-grid">
          ${state.staffOrders.map((order) => renderOrderCard(order, 'waiter')).join('') || '<div class="empty">No food waiting for delivery.</div>'}
        </div>
      </div>
      <div class="panel">
        <h2>Customer Requests</h2>
        <div class="table-list">
          ${state.waiterRequests.map((request) => `
            <div class="row-item">
              <div>
                <strong>${escapeHtml(request.type)}</strong>
                <p class="muted">Table ${escapeHtml(request.table_label)} ${request.note ? '· ' + escapeHtml(request.note) : ''}</p>
              </div>
              <button class="btn primary" data-resolve-request="${request.id}">Resolve</button>
            </div>
          `).join('') || '<div class="empty">No open requests.</div>'}
        </div>
      </div>
    </section>
  `;
  wireOrderActions('waiter');
  app.querySelectorAll('[data-resolve-request]').forEach((button) => {
    button.addEventListener('click', () => resolveRequest(Number(button.dataset.resolveRequest)));
  });
}

function renderOrderCard(order, role) {
  const nextActions = role === 'kitchen'
    ? { received: 'accepted', accepted: 'preparing', preparing: 'ready' }
    : { ready: 'delivered' };
  const next = nextActions[order.status];
  return `
    <article class="order-card">
      <div class="order-head">
        <div>
          <strong>${escapeHtml(order.order_number)}</strong>
          <p class="muted">Table ${escapeHtml(order.table_label)} · ${escapeHtml(order.guest_name)}</p>
        </div>
        <span class="status-badge ${order.status}">${escapeHtml(order.status)}</span>
      </div>
      ${order.items.map((item) => `
        <p><strong>${item.quantity}x</strong> ${escapeHtml(item.item_name)} ${item.special_instructions ? '<span class="muted">· ' + escapeHtml(item.special_instructions) + '</span>' : ''}</p>
      `).join('')}
      <div class="action-row">
        ${next ? `<button class="btn primary" data-order-status="${order.id}:${next}">${title(next)}</button>` : ''}
      </div>
    </article>
  `;
}

function renderLogin(role) {
  const demo = state.bootstrap.demoStaff[role];
  return `
    <section class="login-panel">
      <h2>${title(role)} Login</h2>
      <p class="muted">Demo credentials are available for Phase 1 verification.</p>
      <form class="form-grid" id="loginForm">
        <input class="input" name="phone" value="${demo.phone}" placeholder="Phone" required>
        <input class="input" name="password" value="${demo.password}" placeholder="Password" type="password" required>
        <button class="btn primary" type="submit">Login</button>
      </form>
    </section>
  `;
}

function wireLogin(role) {
  app.querySelector('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    state.auth[role] = await api('/api/auth/login', { method: 'POST', body: form });
    toast(`${title(role)} signed in.`);
    if (role === 'admin') await loadAdmin();
    if (role === 'kitchen') await loadStaffOrders(role);
    if (role === 'waiter') await loadWaiter();
  });
}

function wireOrderActions(role) {
  app.querySelectorAll('[data-order-status]').forEach((button) => {
    button.addEventListener('click', async () => {
      const [id, status] = button.dataset.orderStatus.split(':');
      const updated = await authed(`/api/orders/${id}/status`, role, {
        method: 'PATCH',
        body: { status }
      });
      handleOrderEvent(updated);
      toast(`Order moved to ${status}.`);
      if (role === 'waiter') await loadWaiter();
    });
  });
}

async function placeOrder() {
  const notes = app.querySelector('#orderNotes').value;
  const body = {
    tableToken: state.qr.table.qr_token,
    guestName: 'Guest',
    notes,
    items: state.cart.map((item) => ({
      menuItemId: item.id,
      quantity: item.quantity,
      specialInstructions: ''
    }))
  };
  state.currentOrder = await api('/api/orders', { method: 'POST', body });
  state.cart = [];
  socket?.emit('join:order', { orderId: state.currentOrder.id });
  toast(`Order ${state.currentOrder.order_number} placed.`);
  render();
}

async function createCustomerRequest(type) {
  const request = await api('/api/customer-requests', {
    method: 'POST',
    body: {
      tableToken: state.qr.table.qr_token,
      orderId: state.currentOrder?.id || null,
      type
    }
  });
  toast(`${request.type} sent to waiter.`);
}

async function addMenuItem(event) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget));
  body.price = Number(body.price);
  body.prepMinutes = Number(body.prepMinutes || 15);
  await authed('/api/admin/menu-items', 'admin', { method: 'POST', body });
  event.currentTarget.reset();
  toast('Menu item added.');
  await loadAdmin();
}

async function deleteMenuItem(id) {
  await authed(`/api/admin/menu-items/${id}`, 'admin', { method: 'DELETE' });
  toast('Menu item deleted.');
  await loadAdmin();
}

async function addTable(event) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.currentTarget));
  body.seats = Number(body.seats || 4);
  await authed('/api/admin/tables', 'admin', { method: 'POST', body });
  event.currentTarget.reset();
  toast('Table created.');
  await loadAdmin();
}

async function resolveRequest(id) {
  await authed(`/api/waiter/requests/${id}/resolve`, 'waiter', { method: 'PATCH' });
  toast('Request resolved.');
  await loadWaiter();
}

function addToCart(id) {
  const item = state.menu.items.find((entry) => entry.id === id);
  const existing = state.cart.find((entry) => entry.id === id);
  if (existing) existing.quantity += 1;
  else state.cart.push({ id: item.id, name: item.name, price: item.price, quantity: 1 });
  render();
}

function updateCart(id, delta) {
  const item = state.cart.find((entry) => entry.id === id);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) state.cart = state.cart.filter((entry) => entry.id !== id);
  render();
}

function cartTotals() {
  const subtotal = round(state.cart.reduce((sum, item) => sum + item.price * item.quantity, 0));
  const gst = round(subtotal * (state.qr.restaurant.gst_rate / 100));
  return { subtotal, gst, total: round(subtotal + gst) };
}

function metric(label, value) {
  return `<div class="metric"><span class="muted">${label}</span><strong>${value}</strong></div>`;
}

async function authed(url, role, options = {}) {
  const session = state.auth[role];
  if (!session) throw new Error(`${role} is not signed in.`);
  return api(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${session.token}`
    }
  });
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    toast(data.error || 'Request failed.');
    throw new Error(data.error || 'Request failed.');
  }
  return data;
}

function toast(message) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  toastStack.appendChild(node);
  setTimeout(() => node.remove(), 3600);
}

function title(value) {
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function round(value) {
  return Math.round(Number(value) * 100) / 100;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function debounce(callback, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => callback(...args), wait);
  };
}
