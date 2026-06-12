// ═══════════════════════════════════════════════════════════════════════════
// Dashboard Module
// ═══════════════════════════════════════════════════════════════════════════

const Dashboard = {
  async render() {
    const content = document.getElementById('content');

    try {
      const data = await App.api('/api/dashboard');

      content.innerHTML = `
        <div class="fade-in">
          <!-- Metrics -->
          <div class="metrics-grid">
            <div class="metric-card purple">
              <div class="metric-label">Total Products</div>
              <div class="metric-value purple">${data.totalProducts}</div>
            </div>
            <div class="metric-card blue">
              <div class="metric-label">Total Customers</div>
              <div class="metric-value blue">${data.totalCustomers}</div>
            </div>
            <div class="metric-card green">
              <div class="metric-label">Orders Today</div>
              <div class="metric-value green">${data.ordersToday}</div>
            </div>
            <div class="metric-card orange">
              <div class="metric-label">Low Stock Items</div>
              <div class="metric-value orange">${data.lowStock}</div>
            </div>
            <div class="metric-card red">
              <div class="metric-label">Inventory Value</div>
              <div class="metric-value red">${App.currency(data.inventoryValue)}</div>
            </div>
          </div>

          <!-- Panels -->
          <div class="grid-2">
            <!-- Recent Orders -->
            <div class="card">
              <div class="card-header">
                <h3 class="card-title">Recent Orders</h3>
                <button class="btn btn-sm btn-outline" onclick="App.navigate('orders')">View All</button>
              </div>
              ${data.recentOrders.length === 0 ? '<p style="color:var(--text-muted)">No orders yet.</p>' : `
              <div class="table-wrapper">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Customer</th>
                      <th>Product</th>
                      <th>Total</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${data.recentOrders.map(o => `
                      <tr>
                        <td>#${o.id}</td>
                        <td>${o.customer_name}</td>
                        <td>${o.product_name}</td>
                        <td>${App.currency(o.total_amount)}</td>
                        <td><span class="badge ${o.status === 'Completed' ? 'badge-success' : 'badge-warning'}">${o.status}</span></td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>`}
            </div>

            <!-- Low Stock Products -->
            <div class="card">
              <div class="card-header">
                <h3 class="card-title">Low Stock Alert</h3>
                <button class="btn btn-sm btn-outline" onclick="App.navigate('products')">View All</button>
              </div>
              ${data.lowStockProducts.length === 0 ? '<p style="color:var(--text-muted)">All products are well stocked!</p>' : `
              <div class="table-wrapper">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>Qty</th>
                      <th>Reorder Level</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${data.lowStockProducts.map(p => `
                      <tr class="low-stock">
                        <td>${p.name}</td>
                        <td><strong>${p.quantity}</strong> ${p.unit}</td>
                        <td>${p.reorder_level}</td>
                        <td>
                          <span class="stock-warning">
                            ${App.warningIcon()}
                            ${p.quantity === 0 ? 'Out of Stock' : 'Low Stock'}
                          </span>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>`}
            </div>
          </div>
        </div>
      `;
    } catch {
      content.innerHTML = '<div class="empty-state"><h3>Failed to load dashboard</h3><p>Please check your server connection.</p></div>';
    }
  }
};
