const crypto = require('crypto');
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const { db, hashPassword, verifyTableToken, signTableToken, now } = require('./database');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.CORS_ORIGIN || '*' }
});

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || 'resto-app-local-jwt-secret';
const ORDER_STATUSES = ['received', 'accepted', 'preparing', 'ready', 'delivered', 'cancelled'];
const STAFF_ROLES = ['admin', 'kitchen', 'waiter'];

app.disable('x-powered-by');
app.use(securityHeaders);
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60_000, max: 180 }));
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
  socket.on('join:restaurant', ({ restaurantId }) => {
    if (restaurantId) socket.join(`restaurant:${restaurantId}`);
  });

  socket.on('join:order', ({ orderId }) => {
    if (orderId) socket.join(`order:${orderId}`);
  });

  socket.on('join:role', ({ restaurantId, role }) => {
    if (restaurantId && STAFF_ROLES.includes(role)) {
      socket.join(`restaurant:${restaurantId}:role:${role}`);
    }
  });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'Resto App API', time: now() });
});

app.get('/api/bootstrap', (req, res) => {
  const restaurant = db.prepare('SELECT * FROM restaurants WHERE is_active = 1 ORDER BY id LIMIT 1').get();
  const table = db.prepare('SELECT * FROM dining_tables WHERE restaurant_id = ? ORDER BY id LIMIT 1').get(restaurant.id);
  res.json({
    restaurant,
    demoTableToken: table.qr_token,
    demoQrUrl: `/t/${table.qr_token}`,
    demoStaff: {
      admin: { phone: '9000000001', password: 'admin123' },
      kitchen: { phone: '9000000002', password: 'kitchen123' },
      waiter: { phone: '9000000003', password: 'waiter123' }
    }
  });
});

app.post('/api/auth/login', (req, res) => {
  const { phone, password } = req.body || {};
  if (!phone || !password) return badRequest(res, 'Phone and password are required.');

  const user = db.prepare(`
    SELECT u.*, r.name AS role, restaurants.name AS restaurant_name
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN restaurants ON restaurants.id = u.restaurant_id
    WHERE u.phone = ? AND u.is_active = 1
  `).get(String(phone).trim());

  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const token = signJwt({
    sub: user.id,
    role: user.role,
    restaurantId: user.restaurant_id,
    name: user.name
  });

  res.json({
    token,
    user: publicUser(user)
  });
});

app.post('/api/auth/guest', (req, res) => {
  const { tableToken, name = 'Guest', phone = '' } = req.body || {};
  const context = resolveTableToken(tableToken);
  if (!context) return badRequest(res, 'Invalid table QR token.');

  res.json({
    token: signJwt({
      role: 'customer',
      restaurantId: context.restaurant.id,
      tableId: context.table.id,
      name: sanitizeText(name, 80),
      phone: sanitizeText(phone, 20)
    }),
    guest: {
      name: sanitizeText(name, 80),
      phone: sanitizeText(phone, 20),
      restaurant: context.restaurant,
      table: context.table
    }
  });
});

app.get('/api/qr/resolve', (req, res) => {
  const context = resolveTableToken(req.query.token);
  if (!context) return res.status(404).json({ error: 'QR code is invalid or expired.' });
  res.json(context);
});

app.get('/api/menu', (req, res) => {
  const restaurantId = Number(req.query.restaurantId);
  if (!restaurantId) return badRequest(res, 'restaurantId is required.');

  const params = [restaurantId];
  const conditions = ['m.restaurant_id = ?'];

  if (req.query.search) {
    conditions.push('(m.name LIKE ? OR m.description LIKE ? OR m.ingredients LIKE ?)');
    const search = `%${String(req.query.search).trim()}%`;
    params.push(search, search, search);
  }
  if (req.query.categoryId && req.query.categoryId !== 'all') {
    conditions.push('m.category_id = ?');
    params.push(Number(req.query.categoryId));
  }
  if (req.query.diet && req.query.diet !== 'all') {
    conditions.push('m.diet_type = ?');
    params.push(String(req.query.diet));
  }

  const categories = db.prepare(`
    SELECT * FROM categories
    WHERE restaurant_id = ? AND is_active = 1
    ORDER BY sort_order, name
  `).all(restaurantId);

  const items = db.prepare(`
    SELECT m.*, c.name AS category_name
    FROM menu_items m
    JOIN categories c ON c.id = m.category_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY c.sort_order, m.name
  `).all(...params);

  res.json({ categories, items });
});

app.post('/api/orders', (req, res) => {
  const { tableToken, guestName = 'Guest', guestPhone = '', notes = '', items = [] } = req.body || {};
  const context = resolveTableToken(tableToken);
  if (!context) return badRequest(res, 'A valid table QR token is required.');
  if (!Array.isArray(items) || items.length === 0) return badRequest(res, 'At least one cart item is required.');

  const normalizedItems = items.map((item) => ({
    menuItemId: Number(item.menuItemId),
    quantity: Number(item.quantity),
    specialInstructions: sanitizeText(item.specialInstructions || '', 300)
  }));

  for (const item of normalizedItems) {
    if (!item.menuItemId || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) {
      return badRequest(res, 'Each item needs a valid menuItemId and quantity from 1 to 20.');
    }
  }

  const created = createOrder({
    restaurant: context.restaurant,
    table: context.table,
    guestName: sanitizeText(guestName, 80) || 'Guest',
    guestPhone: sanitizeText(guestPhone, 20),
    notes: sanitizeText(notes, 500),
    items: normalizedItems
  });

  publishOrder(created, 'order:created');
  res.status(201).json(created);
});

app.get('/api/orders/:id', (req, res) => {
  const order = getOrder(Number(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json(order);
});

app.get('/api/orders', requireAuth(STAFF_ROLES), (req, res) => {
  const { status = 'all' } = req.query;
  const params = [req.user.restaurantId];
  const conditions = ['o.restaurant_id = ?'];
  if (status !== 'all') {
    conditions.push('o.status = ?');
    params.push(status);
  }

  const orders = db.prepare(`
    SELECT o.*, t.label AS table_label
    FROM orders o
    JOIN dining_tables t ON t.id = o.table_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY o.created_at DESC
    LIMIT 100
  `).all(...params).map((order) => decorateOrder(order));

  res.json(orders);
});

app.patch('/api/orders/:id/status', requireAuth(STAFF_ROLES), (req, res) => {
  const status = String((req.body || {}).status || '').toLowerCase();
  if (!ORDER_STATUSES.includes(status)) return badRequest(res, 'Invalid order status.');

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND restaurant_id = ?')
    .get(Number(req.params.id), req.user.restaurantId);
  if (!order) return res.status(404).json({ error: 'Order not found.' });

  const allowed = {
    received: ['accepted', 'cancelled'],
    accepted: ['preparing', 'cancelled'],
    preparing: ['ready', 'cancelled'],
    ready: ['delivered'],
    delivered: [],
    cancelled: []
  };

  if (!allowed[order.status].includes(status)) {
    return badRequest(res, `Cannot move order from ${order.status} to ${status}.`);
  }

  db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), order.id);
  db.prepare('INSERT INTO order_status_events (order_id, status, note) VALUES (?, ?, ?)')
    .run(order.id, status, `${req.user.role} updated order`);

  if (status === 'delivered') {
    db.prepare('UPDATE dining_tables SET status = ? WHERE id = ?').run('available', order.table_id);
  }

  const updated = getOrder(order.id);
  publishOrder(updated, 'order:updated');
  res.json(updated);
});

app.get('/api/admin/dashboard', requireAuth(['admin']), (req, res) => {
  const restaurantId = req.user.restaurantId;
  const today = new Date().toISOString().slice(0, 10);
  const summary = db.prepare(`
    SELECT
      COUNT(*) AS todays_orders,
      COALESCE(SUM(total_amount), 0) AS revenue,
      SUM(CASE WHEN status IN ('received', 'accepted', 'preparing') THEN 1 ELSE 0 END) AS pending_orders
    FROM orders
    WHERE restaurant_id = ? AND date(created_at) = date(?)
  `).get(restaurantId, today);

  const activeTables = db.prepare(`
    SELECT COUNT(*) AS count FROM dining_tables
    WHERE restaurant_id = ? AND status IN ('occupied', 'needs_attention')
  `).get(restaurantId).count;

  const statusBreakdown = db.prepare(`
    SELECT status, COUNT(*) AS count
    FROM orders
    WHERE restaurant_id = ?
    GROUP BY status
  `).all(restaurantId);

  res.json({ ...summary, active_tables: activeTables, status_breakdown: statusBreakdown });
});

app.get('/api/admin/tables', requireAuth(['admin', 'waiter']), (req, res) => {
  const tables = db.prepare(`
    SELECT * FROM dining_tables WHERE restaurant_id = ? ORDER BY label
  `).all(req.user.restaurantId);
  res.json(tables.map((table) => ({
    ...table,
    qr_url: `/t/${table.qr_token}`
  })));
});

app.post('/api/admin/tables', requireAuth(['admin']), (req, res) => {
  const label = sanitizeText((req.body || {}).label, 20).toUpperCase();
  const seats = Math.max(1, Math.min(20, Number((req.body || {}).seats || 4)));
  if (!label) return badRequest(res, 'Table label is required.');

  const result = db.prepare(`
    INSERT INTO dining_tables (restaurant_id, label, seats, qr_token)
    VALUES (?, ?, ?, ?)
  `).run(req.user.restaurantId, label, seats, crypto.randomUUID());

  const token = signTableToken(req.user.restaurantId, Number(result.lastInsertRowid));
  db.prepare('UPDATE dining_tables SET qr_token = ? WHERE id = ?').run(token, result.lastInsertRowid);
  const table = db.prepare('SELECT * FROM dining_tables WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json({ ...table, qr_url: `/t/${table.qr_token}` });
});

app.post('/api/admin/categories', requireAuth(['admin']), (req, res) => {
  const name = sanitizeText((req.body || {}).name, 80);
  if (!name) return badRequest(res, 'Category name is required.');
  const result = db.prepare(`
    INSERT INTO categories (restaurant_id, name, sort_order) VALUES (?, ?, ?)
  `).run(req.user.restaurantId, name, Number((req.body || {}).sortOrder || 0));
  res.status(201).json(db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid));
});

app.post('/api/admin/menu-items', requireAuth(['admin']), (req, res) => {
  const payload = menuItemPayload(req.body || {}, req.user.restaurantId);
  if (payload.error) return badRequest(res, payload.error);

  const result = db.prepare(`
    INSERT INTO menu_items
      (restaurant_id, category_id, name, description, ingredients, image_url, price, diet_type, is_available, prep_minutes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.restaurantId,
    payload.categoryId,
    payload.name,
    payload.description,
    payload.ingredients,
    payload.imageUrl,
    payload.price,
    payload.dietType,
    payload.isAvailable,
    payload.prepMinutes
  );

  res.status(201).json(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(result.lastInsertRowid));
});

app.patch('/api/admin/menu-items/:id', requireAuth(['admin']), (req, res) => {
  const existing = db.prepare('SELECT * FROM menu_items WHERE id = ? AND restaurant_id = ?')
    .get(Number(req.params.id), req.user.restaurantId);
  if (!existing) return res.status(404).json({ error: 'Menu item not found.' });

  const payload = menuItemPayload({ ...existing, ...req.body }, req.user.restaurantId);
  if (payload.error) return badRequest(res, payload.error);

  db.prepare(`
    UPDATE menu_items
    SET category_id = ?, name = ?, description = ?, ingredients = ?, image_url = ?,
        price = ?, diet_type = ?, is_available = ?, prep_minutes = ?
    WHERE id = ? AND restaurant_id = ?
  `).run(
    payload.categoryId,
    payload.name,
    payload.description,
    payload.ingredients,
    payload.imageUrl,
    payload.price,
    payload.dietType,
    payload.isAvailable,
    payload.prepMinutes,
    existing.id,
    req.user.restaurantId
  );

  res.json(db.prepare('SELECT * FROM menu_items WHERE id = ?').get(existing.id));
});

app.delete('/api/admin/menu-items/:id', requireAuth(['admin']), (req, res) => {
  const result = db.prepare('DELETE FROM menu_items WHERE id = ? AND restaurant_id = ?')
    .run(Number(req.params.id), req.user.restaurantId);
  if (result.changes === 0) return res.status(404).json({ error: 'Menu item not found.' });
  res.json({ success: true });
});

app.post('/api/customer-requests', (req, res) => {
  const { tableToken, orderId = null, type, note = '' } = req.body || {};
  const context = resolveTableToken(tableToken);
  if (!context) return badRequest(res, 'A valid table QR token is required.');
  const allowedTypes = ['Need Water', 'Need Spoon', 'Need Bill', 'Call Waiter'];
  if (!allowedTypes.includes(type)) return badRequest(res, 'Invalid request type.');

  const result = db.prepare(`
    INSERT INTO customer_requests (restaurant_id, table_id, order_id, type, note)
    VALUES (?, ?, ?, ?, ?)
  `).run(context.restaurant.id, context.table.id, orderId ? Number(orderId) : null, type, sanitizeText(note, 250));

  db.prepare('UPDATE dining_tables SET status = ? WHERE id = ?').run('needs_attention', context.table.id);
  const request = getCustomerRequest(result.lastInsertRowid);
  publishRequest(request);
  res.status(201).json(request);
});

app.get('/api/waiter/requests', requireAuth(['admin', 'waiter']), (req, res) => {
  const requests = db.prepare(`
    SELECT cr.*, t.label AS table_label
    FROM customer_requests cr
    JOIN dining_tables t ON t.id = cr.table_id
    WHERE cr.restaurant_id = ? AND cr.status = 'open'
    ORDER BY cr.created_at ASC
  `).all(req.user.restaurantId);
  res.json(requests);
});

app.patch('/api/waiter/requests/:id/resolve', requireAuth(['admin', 'waiter']), (req, res) => {
  const request = db.prepare('SELECT * FROM customer_requests WHERE id = ? AND restaurant_id = ?')
    .get(Number(req.params.id), req.user.restaurantId);
  if (!request) return res.status(404).json({ error: 'Customer request not found.' });

  db.prepare('UPDATE customer_requests SET status = ?, resolved_at = ? WHERE id = ?')
    .run('resolved', now(), request.id);

  const openCount = db.prepare(`
    SELECT COUNT(*) AS count FROM customer_requests
    WHERE table_id = ? AND status = 'open'
  `).get(request.table_id).count;
  if (openCount === 0) {
    db.prepare('UPDATE dining_tables SET status = ? WHERE id = ?').run('occupied', request.table_id);
  }

  const resolved = getCustomerRequest(request.id);
  publishRequest(resolved);
  res.json(resolved);
});

app.get('/t/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

server.listen(PORT, () => {
  console.log(`Resto App running at http://localhost:${PORT}`);
});

function createOrder({ restaurant, table, guestName, guestPhone, notes, items }) {
  const tx = db.transaction(() => {
    const resolvedItems = items.map((item) => {
      const menuItem = db.prepare(`
        SELECT * FROM menu_items
        WHERE id = ? AND restaurant_id = ? AND is_available = 1
      `).get(item.menuItemId, restaurant.id);
      if (!menuItem) throw new Error(`Menu item ${item.menuItemId} is unavailable.`);
      return {
        ...item,
        itemName: menuItem.name,
        unitPrice: menuItem.price,
        lineTotal: roundMoney(menuItem.price * item.quantity)
      };
    });

    const subtotal = roundMoney(resolvedItems.reduce((sum, item) => sum + item.lineTotal, 0));
    const gstAmount = roundMoney(subtotal * (restaurant.gst_rate / 100));
    const totalAmount = roundMoney(subtotal + gstAmount);
    const orderNumber = `R${restaurant.id}-${Date.now().toString().slice(-6)}`;

    const result = db.prepare(`
      INSERT INTO orders
        (restaurant_id, table_id, order_number, guest_name, guest_phone, notes, subtotal, gst_amount, total_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(restaurant.id, table.id, orderNumber, guestName, guestPhone, notes, subtotal, gstAmount, totalAmount);

    const orderId = Number(result.lastInsertRowid);
    const insertItem = db.prepare(`
      INSERT INTO order_items
        (order_id, menu_item_id, item_name, unit_price, quantity, special_instructions, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    resolvedItems.forEach((item) => {
      insertItem.run(orderId, item.menuItemId, item.itemName, item.unitPrice, item.quantity, item.specialInstructions, item.lineTotal);
    });
    db.prepare('INSERT INTO order_status_events (order_id, status, note) VALUES (?, ?, ?)')
      .run(orderId, 'received', 'Order placed by customer');
    db.prepare('UPDATE dining_tables SET status = ? WHERE id = ?').run('occupied', table.id);

    return getOrder(orderId);
  });

  return tx();
}

function getOrder(orderId) {
  const order = db.prepare(`
    SELECT o.*, t.label AS table_label, r.name AS restaurant_name, r.gst_rate
    FROM orders o
    JOIN dining_tables t ON t.id = o.table_id
    JOIN restaurants r ON r.id = o.restaurant_id
    WHERE o.id = ?
  `).get(orderId);
  if (!order) return null;
  return decorateOrder(order);
}

function decorateOrder(order) {
  return {
    ...order,
    items: db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(order.id),
    events: db.prepare('SELECT * FROM order_status_events WHERE order_id = ? ORDER BY id').all(order.id)
  };
}

function getCustomerRequest(id) {
  return db.prepare(`
    SELECT cr.*, t.label AS table_label
    FROM customer_requests cr
    JOIN dining_tables t ON t.id = cr.table_id
    WHERE cr.id = ?
  `).get(id);
}

function publishOrder(order, eventName) {
  io.to(`restaurant:${order.restaurant_id}`).emit(eventName, order);
  io.to(`restaurant:${order.restaurant_id}:role:admin`).emit(eventName, order);
  io.to(`restaurant:${order.restaurant_id}:role:kitchen`).emit(eventName, order);
  if (order.status === 'ready') {
    io.to(`restaurant:${order.restaurant_id}:role:waiter`).emit('order:ready', order);
  }
  io.to(`order:${order.id}`).emit(eventName, order);
}

function publishRequest(request) {
  io.to(`restaurant:${request.restaurant_id}:role:waiter`).emit('request:updated', request);
  io.to(`restaurant:${request.restaurant_id}:role:admin`).emit('request:updated', request);
}

function resolveTableToken(token) {
  try {
    const parsed = verifyTableToken(token);
    if (!parsed) return null;
    const restaurant = db.prepare('SELECT * FROM restaurants WHERE id = ? AND is_active = 1').get(parsed.restaurantId);
    const table = db.prepare('SELECT * FROM dining_tables WHERE id = ? AND restaurant_id = ?')
      .get(parsed.tableId, parsed.restaurantId);
    if (!restaurant || !table) return null;
    return { restaurant, table };
  } catch {
    return null;
  }
}

function menuItemPayload(body, restaurantId) {
  const categoryId = Number(body.categoryId || body.category_id);
  const category = db.prepare('SELECT id FROM categories WHERE id = ? AND restaurant_id = ?').get(categoryId, restaurantId);
  if (!category) return { error: 'Valid categoryId is required.' };
  const name = sanitizeText(body.name, 120);
  if (!name) return { error: 'Name is required.' };
  const price = Number(body.price);
  if (!Number.isFinite(price) || price < 0) return { error: 'Price must be a valid positive number.' };
  const dietType = String(body.dietType || body.diet_type || 'veg');
  if (!['veg', 'non_veg'].includes(dietType)) return { error: 'dietType must be veg or non_veg.' };

  return {
    categoryId,
    name,
    description: sanitizeText(body.description || '', 500),
    ingredients: sanitizeText(body.ingredients || '', 500),
    imageUrl: sanitizeText(body.imageUrl || body.image_url || '', 500),
    price: roundMoney(price),
    dietType,
    isAvailable: body.isAvailable === false || body.is_available === 0 ? 0 : 1,
    prepMinutes: Math.max(1, Math.min(120, Number(body.prepMinutes || body.prep_minutes || 15)))
  };
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), geolocation=()');
  next();
}

function rateLimit({ windowMs, max }) {
  const buckets = new Map();
  return (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'local';
    const current = Date.now();
    const bucket = buckets.get(key) || { resetAt: current + windowMs, count: 0 };
    if (current > bucket.resetAt) {
      bucket.resetAt = current + windowMs;
      bucket.count = 0;
    }
    bucket.count += 1;
    buckets.set(key, bucket);
    if (bucket.count > max) return res.status(429).json({ error: 'Too many requests. Please try again soon.' });
    next();
  };
}

function requireAuth(roles) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const payload = verifyJwt(token);
    if (!payload) return res.status(401).json({ error: 'Authentication required.' });
    if (!roles.includes(payload.role)) return res.status(403).json({ error: 'Insufficient permissions.' });
    req.user = payload;
    next();
  };
}

function signJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

function verifyJwt(token) {
  try {
    const [header, body, signature] = String(token).split('.');
    if (!header || !body || !signature) return null;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    if (signature.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function verifyPassword(password, stored) {
  const [salt, original] = String(stored).split(':');
  if (!salt || !original) return false;
  const candidate = hashPassword(password, salt).split(':')[1];
  return original.length === candidate.length && crypto.timingSafeEqual(Buffer.from(original), Buffer.from(candidate));
}

function publicUser(user) {
  return {
    id: user.id,
    restaurantId: user.restaurant_id,
    restaurantName: user.restaurant_name,
    role: user.role,
    name: user.name,
    phone: user.phone
  };
}

function sanitizeText(value, max) {
  return String(value || '').trim().replace(/[<>]/g, '').slice(0, max);
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}
