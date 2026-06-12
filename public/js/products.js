// ═══════════════════════════════════════════════════════════════════════════
// Products Module
// ═══════════════════════════════════════════════════════════════════════════

const Products = {
  async render() {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="fade-in">
        <div class="toolbar">
          <div class="search-box">
            ${App.searchIcon()}
            <input type="text" id="productSearch" placeholder="Search products by name or SKU..." />
          </div>
          <select class="filter-select" id="productFilter">
            <option value="all">All Products</option>
            <option value="in-stock">In Stock</option>
            <option value="low-stock">Low Stock</option>
            <option value="out-of-stock">Out of Stock</option>
          </select>
          <button class="btn btn-primary" id="addProductBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Product
          </button>
        </div>
        <div class="table-wrapper">
          <table class="table" id="productsTable">
            <thead>
              <tr>
                <th>ID</th>
                <th>Product Name</th>
                <th>SKU</th>
                <th>Quantity</th>
                <th>Unit</th>
                <th>Cost Price</th>
                <th>Selling Price</th>
                <th>Reorder Lvl</th>
                <th>Date Added</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="productsBody">
              <tr><td colspan="10" style="text-align:center;padding:40px;color:var(--text-muted)">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    this.loadProducts();
    this.setupEvents();
  },

  setupEvents() {
    document.getElementById('addProductBtn').addEventListener('click', () => this.showForm());

    let searchTimer;
    document.getElementById('productSearch').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => this.loadProducts(), 300);
    });

    document.getElementById('productFilter').addEventListener('change', () => this.loadProducts());
  },

  async loadProducts() {
    const search = document.getElementById('productSearch')?.value || '';
    const filter = document.getElementById('productFilter')?.value || 'all';

    try {
      const products = await App.api(`/api/products?search=${encodeURIComponent(search)}&filter=${filter}`);
      const tbody = document.getElementById('productsBody');

      if (products.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10"><div class="empty-state"><h3>No products found</h3><p>Try a different search or add a new product.</p></div></td></tr>';
        return;
      }

      tbody.innerHTML = products.map(p => {
        const isLow = p.quantity <= p.reorder_level;
        return `
          <tr class="${isLow ? 'low-stock' : ''}">
            <td>#${p.id}</td>
            <td><strong>${p.name}</strong></td>
            <td>${p.sku || '—'}</td>
            <td>
              ${p.quantity}
              ${isLow ? `<span class="stock-warning">${App.warningIcon()} ${p.quantity === 0 ? 'Out' : 'Low'}</span>` : ''}
            </td>
            <td>${p.unit}</td>
            <td>${App.currency(p.cost_price)}</td>
            <td>${App.currency(p.selling_price)}</td>
            <td>${p.reorder_level}</td>
            <td>${p.date_added}</td>
            <td class="actions">
              <button class="btn-icon stock-in" title="Stock In" onclick="Products.stockAdjust(${p.id}, 'in')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="12 19 12 5"/><polyline points="5 12 12 5 19 12"/></svg>
              </button>
              <button class="btn-icon stock-out" title="Stock Out" onclick="Products.stockAdjust(${p.id}, 'out')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="12 5 12 19"/><polyline points="19 12 12 19 5 12"/></svg>
              </button>
              <button class="btn-icon edit" title="Edit" onclick="Products.showForm(${p.id})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn-icon delete" title="Delete" onclick="Products.remove(${p.id})">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
              </button>
            </td>
          </tr>
        `;
      }).join('');
    } catch {
      // Error already toasted by App.api
    }
  },

  async showForm(id) {
    let product = { name: '', sku: '', quantity: 0, unit: 'Pieces', cost_price: 0, selling_price: 0, reorder_level: 10 };

    if (id) {
      const products = await App.api('/api/products');
      product = products.find(p => p.id === id) || product;
    }

    const units = ['Pieces', 'Kg', 'Liters', 'Bags', 'Boxes', 'Meters', 'Dozens', 'Packs', 'Cartons', 'Bottles'];

    App.openModal(id ? 'Edit Product' : 'Add Product', `
      <form id="productForm">
        <div class="form-group">
          <label>Product Name *</label>
          <input class="form-control" name="name" value="${product.name}" required placeholder="Enter product name" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>SKU</label>
            <input class="form-control" name="sku" value="${product.sku}" placeholder="Optional" />
          </div>
          <div class="form-group">
            <label>Unit</label>
            <select class="form-control" name="unit">
              ${units.map(u => `<option value="${u}" ${product.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Quantity</label>
            <input class="form-control" name="quantity" type="number" min="0" value="${product.quantity}" />
          </div>
          <div class="form-group">
            <label>Reorder Level</label>
            <input class="form-control" name="reorder_level" type="number" min="0" value="${product.reorder_level}" />
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Cost Price (₹)</label>
            <input class="form-control" name="cost_price" type="number" min="0" step="0.01" value="${product.cost_price}" />
          </div>
          <div class="form-group">
            <label>Selling Price (₹)</label>
            <input class="form-control" name="selling_price" type="number" min="0" step="0.01" value="${product.selling_price}" />
          </div>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">${id ? 'Update' : 'Add'} Product</button>
        </div>
      </form>
    `);

    document.getElementById('productForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd);
      body.quantity = Number(body.quantity);
      body.cost_price = Number(body.cost_price);
      body.selling_price = Number(body.selling_price);
      body.reorder_level = Number(body.reorder_level);

      try {
        if (id) {
          await App.api(`/api/products/${id}`, { method: 'PUT', body });
          App.toast('Product updated successfully');
        } else {
          await App.api('/api/products', { method: 'POST', body });
          App.toast('Product added successfully');
        }
        App.closeModal();
        this.loadProducts();
      } catch {
        // Error toasted by App.api
      }
    });
  },

  async stockAdjust(id, type) {
    App.openModal(type === 'in' ? 'Stock In' : 'Stock Out', `
      <form id="stockForm">
        <div class="form-group">
          <label>Amount</label>
          <input class="form-control" name="amount" type="number" min="1" value="1" required autofocus />
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn ${type === 'in' ? 'btn-success' : 'btn-danger'}">
            ${type === 'in' ? '↑ Stock In' : '↓ Stock Out'}
          </button>
        </div>
      </form>
    `);

    document.getElementById('stockForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const amount = Number(new FormData(e.target).get('amount'));
      try {
        await App.api(`/api/products/${id}/stock`, { method: 'PATCH', body: { type, amount } });
        App.toast(`Stock ${type === 'in' ? 'added' : 'removed'} successfully`);
        App.closeModal();
        this.loadProducts();
      } catch { }
    });
  },

  async remove(id) {
    const ok = await App.confirm('Are you sure you want to delete this product? This action cannot be undone.');
    if (!ok) return;

    try {
      await App.api(`/api/products/${id}`, { method: 'DELETE' });
      App.toast('Product deleted');
      this.loadProducts();
    } catch { }
  }
};
