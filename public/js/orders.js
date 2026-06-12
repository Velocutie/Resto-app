// ═══════════════════════════════════════════════════════════════════════════
// Orders Module
// ═══════════════════════════════════════════════════════════════════════════

const Orders = {
  customers: [],
  products: [],

  async render() {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="fade-in">
        <div class="toolbar">
          <div class="search-box">
            ${App.searchIcon()}
            <input type="text" id="orderSearch" placeholder="Search by customer or product name..." />
          </div>
          <select class="filter-select" id="orderStatusFilter">
            <option value="all">All Orders</option>
            <option value="Pending">Pending</option>
            <option value="Completed">Completed</option>
          </select>
          <button class="btn btn-primary" id="addOrderBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Order
          </button>
        </div>
        <div class="table-wrapper">
          <table class="table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Customer</th>
                <th>Product</th>
                <th>Date</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Total</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="ordersBody">
              <tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-muted)">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Preload customers & products for the form
    try {
      [this.customers, this.products] = await Promise.all([
        App.api('/api/customers'),
        App.api('/api/products')
      ]);
    } catch { }

    this.loadOrders();
    this.setupEvents();
  },

  setupEvents() {
    document.getElementById('addOrderBtn').addEventListener('click', () => this.showForm());

    let timer;
    document.getElementById('orderSearch').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.loadOrders(), 300);
    });

    document.getElementById('orderStatusFilter').addEventListener('change', () => this.loadOrders());
  },

  async loadOrders() {
    const search = document.getElementById('orderSearch')?.value || '';
    const status = document.getElementById('orderStatusFilter')?.value || 'all';

    try {
      const orders = await App.api(`/api/orders?search=${encodeURIComponent(search)}&status=${status}`);
      const tbody = document.getElementById('ordersBody');

      if (orders.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><h3>No orders found</h3><p>Create your first order to get started.</p></div></td></tr>';
        return;
      }

      tbody.innerHTML = orders.map(o => `
        <tr>
          <td><strong>#${o.id}</strong></td>
          <td>${o.customer_name}</td>
          <td>${o.product_name}</td>
          <td>${o.date}</td>
          <td>${o.quantity}</td>
          <td>${App.currency(o.selling_price)}</td>
          <td><strong>${App.currency(o.total_amount)}</strong></td>
          <td>
            <span class="badge ${o.status === 'Completed' ? 'badge-success' : 'badge-warning'}">${o.status}</span>
          </td>
          <td class="actions">
            ${o.status === 'Pending' ? `
              <button class="btn btn-sm btn-success" onclick="Orders.complete(${o.id})" title="Mark Complete">
                ✓ Complete
              </button>
            ` : ''}
            <button class="btn-icon edit" title="Edit" onclick="Orders.showForm(${o.id})" ${o.status === 'Completed' ? 'disabled style="opacity:0.3;pointer-events:none"' : ''}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
          </td>
        </tr>
      `).join('');
    } catch { }
  },

  async showForm(id) {
    let order = { customer_id: '', product_id: '', quantity: 1, selling_price: 0 };

    if (id) {
      const orders = await App.api('/api/orders');
      const found = orders.find(o => o.id === id);
      if (found) order = found;
    }

    if (this.customers.length === 0 || this.products.length === 0) {
      App.toast('Please add customers and products first', 'warning');
      return;
    }

    App.openModal(id ? 'Edit Order' : 'New Order', `
      <form id="orderForm">
        <div class="form-group">
          <label>Customer *</label>
          <select class="form-control" name="customer_id" required>
            <option value="">Select customer</option>
            ${this.customers.map(c => `<option value="${c.id}" ${order.customer_id == c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>Product *</label>
          <select class="form-control" name="product_id" id="orderProduct" required>
            <option value="">Select product</option>
            ${this.products.map(p => `<option value="${p.id}" data-price="${p.selling_price}" ${order.product_id == p.id ? 'selected' : ''}>${p.name} (Stock: ${p.quantity} ${p.unit})</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Quantity *</label>
            <input class="form-control" name="quantity" id="orderQty" type="number" min="1" value="${order.quantity}" required />
          </div>
          <div class="form-group">
            <label>Selling Price (₹) *</label>
            <input class="form-control" name="selling_price" id="orderPrice" type="number" min="0" step="0.01" value="${order.selling_price}" required />
          </div>
        </div>
        <div class="form-group">
          <label>Total Amount</label>
          <div class="form-control" id="orderTotal" style="background:var(--accent-light);color:var(--accent);font-weight:700;border-color:var(--accent)">
            ${App.currency(order.quantity * order.selling_price)}
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">${id ? 'Update' : 'Create'} Order</button>
        </div>
      </form>
    `);

    // Auto-fill selling price when product changes
    const productSelect = document.getElementById('orderProduct');
    const qtyInput = document.getElementById('orderQty');
    const priceInput = document.getElementById('orderPrice');
    const totalDiv = document.getElementById('orderTotal');

    const updateTotal = () => {
      const total = Number(qtyInput.value) * Number(priceInput.value);
      totalDiv.textContent = App.currency(total);
    };

    productSelect.addEventListener('change', () => {
      const selected = productSelect.options[productSelect.selectedIndex];
      if (selected.dataset.price) {
        priceInput.value = selected.dataset.price;
        updateTotal();
      }
    });

    qtyInput.addEventListener('input', updateTotal);
    priceInput.addEventListener('input', updateTotal);

    document.getElementById('orderForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd);
      body.customer_id = Number(body.customer_id);
      body.product_id = Number(body.product_id);
      body.quantity = Number(body.quantity);
      body.selling_price = Number(body.selling_price);

      try {
        if (id) {
          await App.api(`/api/orders/${id}`, { method: 'PUT', body });
          App.toast('Order updated successfully');
        } else {
          await App.api('/api/orders', { method: 'POST', body });
          App.toast('Order created successfully');
        }
        App.closeModal();
        this.loadOrders();
      } catch { }
    });
  },

  async complete(id) {
    try {
      await App.api(`/api/orders/${id}/status`, { method: 'PATCH', body: { status: 'Completed' } });
      App.toast('Order completed — stock updated automatically', 'success');
      this.loadOrders();
    } catch { }
  }
};
