// ═══════════════════════════════════════════════════════════════════════════
// Customers Module
// ═══════════════════════════════════════════════════════════════════════════

const Customers = {
  async render() {
    const content = document.getElementById('content');
    content.innerHTML = `
      <div class="fade-in">
        <div class="toolbar">
          <div class="search-box">
            ${App.searchIcon()}
            <input type="text" id="customerSearch" placeholder="Search customers by name, phone, or address..." />
          </div>
          <button class="btn btn-primary" id="addCustomerBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Customer
          </button>
        </div>
        <div class="table-wrapper">
          <table class="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Address</th>
                <th>Notes</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="customersBody">
              <tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted)">Loading...</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    `;

    this.loadCustomers();
    this.setupEvents();
  },

  setupEvents() {
    document.getElementById('addCustomerBtn').addEventListener('click', () => this.showForm());

    let timer;
    document.getElementById('customerSearch').addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.loadCustomers(), 300);
    });
  },

  async loadCustomers() {
    const search = document.getElementById('customerSearch')?.value || '';

    try {
      const customers = await App.api(`/api/customers?search=${encodeURIComponent(search)}`);
      const tbody = document.getElementById('customersBody');

      if (customers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><h3>No customers found</h3><p>Add your first customer to get started.</p></div></td></tr>';
        return;
      }

      tbody.innerHTML = customers.map(c => `
        <tr>
          <td>#${c.id}</td>
          <td><strong>${c.name}</strong></td>
          <td>${c.phone || '—'}</td>
          <td>${c.address || '—'}</td>
          <td>${c.notes || '—'}</td>
          <td class="actions">
            <button class="btn-icon edit" title="Edit" onclick="Customers.showForm(${c.id})">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn-icon delete" title="Delete" onclick="Customers.remove(${c.id})">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </td>
        </tr>
      `).join('');
    } catch { }
  },

  async showForm(id) {
    let customer = { name: '', phone: '', address: '', notes: '' };

    if (id) {
      const customers = await App.api('/api/customers');
      customer = customers.find(c => c.id === id) || customer;
    }

    App.openModal(id ? 'Edit Customer' : 'Add Customer', `
      <form id="customerForm">
        <div class="form-group">
          <label>Customer Name *</label>
          <input class="form-control" name="name" value="${customer.name}" required placeholder="Enter customer name" />
        </div>
        <div class="form-group">
          <label>Phone Number</label>
          <input class="form-control" name="phone" value="${customer.phone}" placeholder="Enter phone number" />
        </div>
        <div class="form-group">
          <label>Address</label>
          <textarea class="form-control" name="address" rows="2" placeholder="Enter address">${customer.address}</textarea>
        </div>
        <div class="form-group">
          <label>Notes</label>
          <textarea class="form-control" name="notes" rows="2" placeholder="Any additional notes">${customer.notes}</textarea>
        </div>
        <div class="form-actions">
          <button type="button" class="btn btn-outline" onclick="App.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">${id ? 'Update' : 'Add'} Customer</button>
        </div>
      </form>
    `);

    document.getElementById('customerForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));

      try {
        if (id) {
          await App.api(`/api/customers/${id}`, { method: 'PUT', body });
          App.toast('Customer updated successfully');
        } else {
          await App.api('/api/customers', { method: 'POST', body });
          App.toast('Customer added successfully');
        }
        App.closeModal();
        this.loadCustomers();
      } catch { }
    });
  },

  async remove(id) {
    const ok = await App.confirm('Delete this customer? All associated orders will also be removed.');
    if (!ok) return;

    try {
      await App.api(`/api/customers/${id}`, { method: 'DELETE' });
      App.toast('Customer deleted');
      this.loadCustomers();
    } catch { }
  }
};
