# Resto App API

Base URL: `http://localhost:3000`

## Authentication

Staff login uses `POST /api/auth/login`.

```json
{
  "phone": "9000000001",
  "password": "admin123"
}
```

Use the returned token as `Authorization: Bearer <token>` for staff endpoints.

Demo users:

- Admin: `9000000001` / `admin123`
- Kitchen: `9000000002` / `kitchen123`
- Waiter: `9000000003` / `waiter123`

## Customer Flow

- `GET /api/bootstrap` returns the seeded restaurant, demo table QR token, and demo staff credentials.
- `GET /api/qr/resolve?token=<qr_token>` resolves restaurant and table.
- `GET /api/menu?restaurantId=1&search=&categoryId=all&diet=all` lists categories and menu items.
- `POST /api/orders` places an order from a QR table.
- `GET /api/orders/:id` retrieves order status, items, and event history.
- `POST /api/customer-requests` sends waiter requests such as `Need Water`, `Need Spoon`, `Need Bill`, or `Call Waiter`.

## Staff Flow

- `GET /api/admin/dashboard` returns today's orders, revenue, active tables, pending orders, and status breakdown.
- `GET /api/admin/tables` lists tables and QR links.
- `POST /api/admin/tables` creates a table and secure QR token.
- `POST /api/admin/categories` creates a menu category.
- `POST /api/admin/menu-items` creates a menu item.
- `PATCH /api/admin/menu-items/:id` updates a menu item.
- `DELETE /api/admin/menu-items/:id` deletes a menu item.
- `GET /api/orders?status=all` lists restaurant orders for staff.
- `PATCH /api/orders/:id/status` advances an order through the workflow.
- `GET /api/waiter/requests` lists open customer requests.
- `PATCH /api/waiter/requests/:id/resolve` closes a request.

## Order Statuses

`received -> accepted -> preparing -> ready -> delivered`

Orders may be cancelled from `received`, `accepted`, or `preparing`.

## Socket.IO Events

Client emits:

- `join:restaurant` with `{ restaurantId }`
- `join:role` with `{ restaurantId, role }`
- `join:order` with `{ orderId }`

Server emits:

- `order:created`
- `order:updated`
- `order:ready`
- `request:updated`
