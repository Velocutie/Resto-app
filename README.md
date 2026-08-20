# 🍽️ Resto App

### Scan. Order. Enjoy.

Resto App is a Phase 1 MVP for **QR-based restaurant ordering and management**.

Customers can scan a table QR code, browse the menu, place orders, request waiter assistance, and track their order status in real time. Restaurant staff can manage orders through dedicated admin, kitchen, and Waiter dashboards.

---

## ✨ Features

### 👤 Customer

- QR-based table identification
- Secure signed table tokens
- Guest menu browsing
- Menu filtering
- Shopping cart
- GST bill calculation
- Order placement
- Waiter assistance requests
- Live order-status tracking
- Real-time order updates

### 🧑‍💼 Admin

- Restaurant dashboard
- Today's orders
- Revenue overview
- Active table monitoring
- Pending-order monitoring
- Menu management
- Table management
- Table QR links

### 👨‍🍳 Kitchen

- View incoming orders
- Accept orders
- Mark orders as preparing
- Mark orders as ready
- Real-time order notifications

### 🧑‍🍳 Waiter

- View ready orders
- Deliver orders
- Handle customer requests
- Receive real-time notifications

---

## ⚡ Realtime System

Resto App uses **Socket.IO** for real-time communication between customers and restaurant staff.

Examples include:

```text
Customer places order
        ↓
Kitchen receives notification
        ↓
Kitchen accepts order
        ↓
Order status → Preparing
        ↓
Kitchen marks order ready
        ↓
Waiter receives notification
        ↓
Waiter delivers order
        ↓
Customer sees updated status
