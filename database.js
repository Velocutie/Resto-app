const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const dbPath = path.join(__dirname, 'resto.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const now = () => new Date().toISOString();
const QR_SECRET = process.env.QR_SECRET || 'resto-app-local-qr-secret';

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function signTableToken(restaurantId, tableId) {
  const payload = `${restaurantId}.${tableId}`;
  const signature = crypto.createHmac('sha256', QR_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifyTableToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [restaurantId, tableId, signature] = parts;
  const expected = crypto.createHmac('sha256', QR_SECRET).update(`${restaurantId}.${tableId}`).digest('base64url');
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return { restaurantId: Number(restaurantId), tableId: Number(tableId) };
}

db.exec(`
  CREATE TABLE IF NOT EXISTS restaurants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    tagline TEXT NOT NULL DEFAULT 'Scan. Order. Enjoy.',
    logo_url TEXT NOT NULL DEFAULT '',
    gst_rate REAL NOT NULL DEFAULT 5,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER,
    role_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    avatar_url TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS dining_tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    seats INTEGER NOT NULL DEFAULT 4,
    status TEXT NOT NULL DEFAULT 'available',
    qr_token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (restaurant_id, label),
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    UNIQUE (restaurant_id, name),
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER NOT NULL,
    category_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    ingredients TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL,
    diet_type TEXT NOT NULL CHECK (diet_type IN ('veg', 'non_veg')),
    is_available INTEGER NOT NULL DEFAULT 1,
    prep_minutes INTEGER NOT NULL DEFAULT 15,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER NOT NULL,
    table_id INTEGER NOT NULL,
    order_number TEXT NOT NULL UNIQUE,
    guest_name TEXT NOT NULL DEFAULT 'Guest',
    guest_phone TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    subtotal REAL NOT NULL,
    gst_amount REAL NOT NULL,
    total_amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'received',
    payment_status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (table_id) REFERENCES dining_tables(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    menu_item_id INTEGER NOT NULL,
    item_name TEXT NOT NULL,
    unit_price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    special_instructions TEXT NOT NULL DEFAULT '',
    line_total REAL NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE RESTRICT
  );

  CREATE TABLE IF NOT EXISTS order_status_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    provider TEXT NOT NULL DEFAULT 'cash',
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    reference TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS customer_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    restaurant_id INTEGER NOT NULL,
    table_id INTEGER NOT NULL,
    order_id INTEGER,
    type TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT,
    FOREIGN KEY (restaurant_id) REFERENCES restaurants(id) ON DELETE CASCADE,
    FOREIGN KEY (table_id) REFERENCES dining_tables(id) ON DELETE RESTRICT,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
  );
`);

function seed() {
  const restaurantCount = db.prepare('SELECT COUNT(*) AS count FROM restaurants').get().count;
  if (restaurantCount > 0) return;

  const insertRestaurant = db.prepare(`
    INSERT INTO restaurants (name, slug, tagline, logo_url, gst_rate)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertRole = db.prepare('INSERT INTO roles (name) VALUES (?)');
  const insertUser = db.prepare(`
    INSERT INTO users (restaurant_id, role_id, name, phone, password_hash)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertTable = db.prepare(`
    INSERT INTO dining_tables (restaurant_id, label, seats, status, qr_token)
    VALUES (?, ?, ?, ?, ?)
  `);
  const insertCategory = db.prepare(`
    INSERT INTO categories (restaurant_id, name, sort_order) VALUES (?, ?, ?)
  `);
  const insertMenuItem = db.prepare(`
    INSERT INTO menu_items
      (restaurant_id, category_id, name, description, ingredients, image_url, price, diet_type, prep_minutes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const seedTx = db.transaction(() => {
    const restaurantId = Number(insertRestaurant.run(
      'Resto App Bistro',
      'resto-app-bistro',
      'Scan. Order. Enjoy.',
      'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=900&q=80',
      5
    ).lastInsertRowid);

    ['admin', 'kitchen', 'waiter', 'customer'].forEach((role) => insertRole.run(role));
    const roles = Object.fromEntries(db.prepare('SELECT id, name FROM roles').all().map((role) => [role.name, role.id]));

    insertUser.run(restaurantId, roles.admin, 'Aarav Admin', '9000000001', hashPassword('admin123'));
    insertUser.run(restaurantId, roles.kitchen, 'Nisha Kitchen', '9000000002', hashPassword('kitchen123'));
    insertUser.run(restaurantId, roles.waiter, 'Kabir Waiter', '9000000003', hashPassword('waiter123'));

    for (let index = 1; index <= 8; index += 1) {
      const tableId = index;
      insertTable.run(restaurantId, `T${index}`, index <= 2 ? 2 : 4, 'available', signTableToken(restaurantId, tableId));
    }

    const categoryIds = {};
    [
      ['Starters', 1],
      ['Mains', 2],
      ['Biryani', 3],
      ['Beverages', 4],
      ['Desserts', 5]
    ].forEach(([name, sortOrder]) => {
      categoryIds[name] = Number(insertCategory.run(restaurantId, name, sortOrder).lastInsertRowid);
    });

    const image = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=80`;
    [
      ['Starters', 'Paneer Tikka', 'Charred cottage cheese with peppers and mint chutney.', 'Paneer, yoghurt, bell pepper, kasuri methi', image('photo-1567188040759-fb8a883dc6d8'), 249, 'veg', 12],
      ['Starters', 'Chicken Pepper Fry', 'Crisp boneless chicken tossed with curry leaves and cracked pepper.', 'Chicken, pepper, curry leaves, onion', image('photo-1604908176997-125f25cc6f3d'), 289, 'non_veg', 14],
      ['Mains', 'Dal Tadka', 'Slow cooked yellow dal finished with ghee tempering.', 'Toor dal, garlic, cumin, ghee', image('photo-1546833999-b9f581a1996d'), 199, 'veg', 10],
      ['Mains', 'Butter Chicken', 'Tandoor chicken in a silky tomato makhani gravy.', 'Chicken, tomato, cream, butter', image('photo-1603894584373-5ac82b2ae398'), 349, 'non_veg', 18],
      ['Mains', 'Veg Kolhapuri', 'Seasonal vegetables in a bold coconut and chilli masala.', 'Vegetables, coconut, chilli, coriander', image('photo-1596797038530-2c107229654b'), 259, 'veg', 16],
      ['Biryani', 'Hyderabadi Veg Biryani', 'Layered basmati rice, saffron, vegetables and raita.', 'Basmati rice, saffron, vegetables, spices', image('photo-1633945274405-b6c8069047b0'), 299, 'veg', 20],
      ['Biryani', 'Dum Chicken Biryani', 'Aromatic chicken biryani sealed and slow cooked.', 'Chicken, basmati rice, saffron, mint', image('photo-1589302168068-964664d93dc0'), 369, 'non_veg', 22],
      ['Beverages', 'Fresh Lime Soda', 'Sweet, salted or mixed lime soda over ice.', 'Lime, soda, mint', image('photo-1622597467836-f3285f2131b8'), 109, 'veg', 4],
      ['Beverages', 'Masala Chai', 'House chai brewed with ginger and cardamom.', 'Tea, milk, ginger, cardamom', image('photo-1561336526-2914f13ceb36'), 79, 'veg', 6],
      ['Desserts', 'Gulab Jamun', 'Warm milk dumplings soaked in saffron syrup.', 'Khoya, sugar, saffron, cardamom', image('photo-1605197161470-5d2a9af0a3f0'), 139, 'veg', 6]
    ].forEach(([category, name, description, ingredients, imageUrl, price, dietType, prepMinutes]) => {
      insertMenuItem.run(restaurantId, categoryIds[category], name, description, ingredients, imageUrl, price, dietType, prepMinutes);
    });
  });

  seedTx();

  const fixTokens = db.transaction(() => {
    const tables = db.prepare('SELECT id, restaurant_id FROM dining_tables').all();
    const update = db.prepare('UPDATE dining_tables SET qr_token = ? WHERE id = ?');
    tables.forEach((table) => update.run(signTableToken(table.restaurant_id, table.id), table.id));
  });
  fixTokens();
}

seed();

module.exports = {
  db,
  hashPassword,
  signTableToken,
  verifyTableToken,
  now
};
