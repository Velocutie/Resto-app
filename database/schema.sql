CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE restaurants (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  tagline TEXT NOT NULL DEFAULT 'Scan. Order. Enjoy.',
  logo_url TEXT NOT NULL DEFAULT '',
  gst_rate NUMERIC(5, 2) NOT NULL DEFAULT 5,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE roles (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (name IN ('customer', 'admin', 'kitchen', 'waiter'))
);

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT REFERENCES restaurants(id) ON DELETE CASCADE,
  role_id BIGINT NOT NULL REFERENCES roles(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE dining_tables (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  seats INTEGER NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'occupied', 'needs_attention')),
  qr_token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, label)
);

CREATE TABLE categories (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (restaurant_id, name)
);

CREATE TABLE menu_items (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  category_id BIGINT NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  ingredients TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0),
  diet_type TEXT NOT NULL CHECK (diet_type IN ('veg', 'non_veg')),
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  prep_minutes INTEGER NOT NULL DEFAULT 15,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_id BIGINT NOT NULL REFERENCES dining_tables(id),
  order_number TEXT NOT NULL UNIQUE,
  guest_name TEXT NOT NULL DEFAULT 'Guest',
  guest_phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  subtotal NUMERIC(10, 2) NOT NULL,
  gst_amount NUMERIC(10, 2) NOT NULL,
  total_amount NUMERIC(10, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'accepted', 'preparing', 'ready', 'delivered', 'cancelled')),
  payment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id BIGINT NOT NULL REFERENCES menu_items(id),
  item_name TEXT NOT NULL,
  unit_price NUMERIC(10, 2) NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  special_instructions TEXT NOT NULL DEFAULT '',
  line_total NUMERIC(10, 2) NOT NULL
);

CREATE TABLE order_status_events (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payments (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reference TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customer_requests (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_id BIGINT NOT NULL REFERENCES dining_tables(id),
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_orders_restaurant_status ON orders (restaurant_id, status);
CREATE INDEX idx_orders_restaurant_created ON orders (restaurant_id, created_at DESC);
CREATE INDEX idx_menu_restaurant_category ON menu_items (restaurant_id, category_id);
CREATE INDEX idx_requests_restaurant_status ON customer_requests (restaurant_id, status);
