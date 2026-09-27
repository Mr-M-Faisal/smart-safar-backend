# Booking, passenger location, and payment API

## Booking rules

The normal booking flow is route-first:

```text
Route details -> POST /api/bookings with routeId -> backend resolves bus and driver -> confirmation
```

The backend accepts only an active route with at least one stop. It considers buses on that route that are active, have seats, have an assigned driver, and have a matching active shift. When more than one bus is eligible, resolution is deterministic:

1. Most recent `lastLocationUpdate`
2. `busNumber` ascending
3. Bus `_id` ascending

The client does not choose a driver in the route-first flow. Manual mode can send a bus and, optionally, a driver, but the backend verifies the stored driver -> bus -> route relationship and the matching active shift. A supplied driver never overrides that relationship.

Fare and currency come from the server environment. Client `fare` is ignored for compatibility with older clients. Client `amount`, `paymentStatus`, booking `status`, and unknown fields are rejected.

Required environment values:

```env
BOOKING_FARE=50
BOOKING_CURRENCY=PKR
```

`BOOKING_FARE` defaults to `0` when the service intentionally supports free bookings. Set it explicitly in deployed environments.

## HTTP endpoints

### Create a booking

`POST /api/bookings`

Authentication: bearer token.

Route-first request:

```json
{
  "routeId": "ROUTE_OBJECT_ID",
  "seatNumber": "A1",
  "paymentMethod": "online",
  "shareLocation": true,
  "pickupLocation": {
    "latitude": 31.418,
    "longitude": 73.079,
    "accuracy": 8,
    "timestamp": "2026-09-19T10:00:00.000Z"
  }
}
```

Manual request:

```json
{
  "routeId": "ROUTE_OBJECT_ID",
  "bus": "BUS_OBJECT_ID",
  "driverId": "DRIVER_OBJECT_ID",
  "seatNumber": "A1",
  "paymentMethod": "cash"
}
```

For legacy compatibility, `bus` may be sent without `routeId`; the backend derives and validates the bus route. `driverId` may only accompany a selected bus.

A successful response is `201`. Booking and seat decrement occur in one MongoDB transaction. Duplicate active bookings by the same passenger on the same bus and duplicate active seat numbers are rejected with `409`.

All new bookings begin with `paymentStatus: "pending"`, including online payments. The frontend cannot mark a booking paid.

### List the passenger's bookings

`GET /api/bookings/me`

Authentication: bearer token. Returns only the authenticated user's booking history.

### Update or stop passenger location sharing

`PATCH /api/bookings/:id/location`

Authentication: the booking owner.

Start or update sharing:

```json
{
  "shareLocation": true,
  "pickupLocation": {
    "latitude": 31.419,
    "longitude": 73.08,
    "accuracy": 5,
    "timestamp": "2026-09-19T10:05:00.000Z"
  }
}
```

Stop sharing:

```json
{
  "shareLocation": false
}
```

Coordinates are optional for booking, but storing them requires explicit `shareLocation: true`. Sharing is permitted only while the booking is confirmed and its stored bus/driver/route assignment has a matching active shift.

### Assigned passenger locations

`GET /api/bookings/assigned/passenger-locations`

Authentication: driver role.

The driver is resolved from the authenticated account, its assigned bus, and its active shift. The endpoint returns only confirmed, opted-in bookings for that exact driver/bus/route. It never returns another route's passenger locations.

Passenger coordinates are not added to public route, stop, bus, GPS, or ETA endpoints.

### Cancel a booking

`PATCH /api/bookings/:id/cancel`

Authentication: the booking owner.

Cancellation and seat release occur in one transaction. Location sharing is disabled. Pending/failed payment state becomes `cancelled`; an already paid payment remains `paid` because refunds require a provider-specific refund flow.

## Socket.IO

The existing Socket.IO server is reused.

A driver subscribes with:

```js
socket.emit(
  'watchDriverBookings',
  { token: driverJwt },
  ({ ok, busId, message }) => {}
);
```

The server verifies the JWT, driver role, assigned bus, bus ownership, and active shift before joining `driver:<driverId>`. A client can leave with `unwatchDriverBookings`.

Only that private room receives `passengerLocationUpdate`:

```json
{
  "bookingId": "BOOKING_OBJECT_ID",
  "passenger": {
    "id": "PASSENGER_OBJECT_ID",
    "name": "Passenger name"
  },
  "sharing": true,
  "latitude": 31.419,
  "longitude": 73.08,
  "accuracy": 5,
  "timestamp": "2026-09-19T10:05:00.000Z"
}
```

Cancellation or a passenger opt-out sends the same event with `sharing: false` and no coordinates. Shift end emits `passengerLocationAccessEnded` and removes every socket from the driver's private room.

The public `watchBus` room continues to receive bus GPS only.

## Payment verification

The backend contains provider-neutral payment state and signed-notification verification. It does not initiate a charge and no gateway is claimed as integrated.

States are:

- `pending`
- `paid`
- `failed`
- `cancelled`

Configure the trusted payment adapter:

```env
PAYMENT_WEBHOOK_SECRET=replace-with-a-long-random-secret
PAYMENT_PROVIDER=provider-audit-label
```

Never put `PAYMENT_WEBHOOK_SECRET` in frontend code. Without the secret, payment notifications return `503`; no payment is marked successful.

### Verified provider notification

`POST /api/bookings/payments/webhook`

The trusted backend adapter sends:

```json
{
  "paymentReference": "BOOKING_PAYMENT_REFERENCE",
  "status": "paid",
  "amount": 50,
  "currency": "PKR",
  "providerTransactionId": "PROVIDER_TRANSACTION_ID"
}
```

For failure it sends `status: "failed"` and may include `failureReason`.

The `x-payment-signature` header is the lowercase HMAC-SHA256 hex digest of this UTF-8 string:

```js
JSON.stringify([
  paymentReference,
  status,
  Number(amount),
  currency.toUpperCase(),
  providerTransactionId,
  failureReason || null
])
```

A valid failure cancels the booking, disables location sharing, and releases the seat atomically. A valid success marks an eligible pending online booking paid. Amount and currency must exactly match the server-owned booking values. Repeated notifications with the same provider transaction are idempotent; conflicting transactions are rejected.

Before production, connect this adapter to the selected gateway's official server-to-server callback and signature scheme. Merchant credentials, checkout/intent creation, capture, refunds, and settlement reconciliation remain provider-specific work and are deliberately not simulated.

## Validation and status codes

- `400`: malformed IDs/coordinates, unsupported fields, mismatched bus/route/driver, or amount/currency mismatch
- `401`: missing/invalid user token or invalid payment signature
- `403`: wrong role or accessing another passenger's booking
- `404`: route, bus, booking, or payment reference not found
- `409`: no eligible active assignment, duplicate booking/seat, inactive booking, or invalid payment transition
- `503`: transaction-capable MongoDB or payment verification configuration is unavailable
