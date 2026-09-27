# Driver Shift API

Driver shifts are persistent backend records. The authenticated driver's `assignedBus` selects the bus, and that bus selects the route. Clients must not send a bus or route ID when starting or ending a shift.

All protected requests use the existing JWT header:

```http
Authorization: Bearer <token>
```

## Start a shift

```http
POST /api/buses/assigned/start-shift
Content-Type: application/json
```

Authentication and authorization: driver only. The request has no body.

The server verifies that the authenticated driver has an assigned bus, the bus still exists and references that driver, the bus has a route, and neither the driver nor bus has an active shift. It then atomically creates the shift, initializes the operational cycle in the outbound direction at the first route target, and marks the bus `active`.

Success: `201 Created`

```json
{
  "message": "Shift started successfully",
  "shift": {
    "_id": "<shiftId>",
    "driver": {
      "_id": "<driverId>",
      "name": "Driver Name",
      "email": "driver@example.com",
      "phone": "03001234567"
    },
    "bus": {
      "_id": "<busId>",
      "busNumber": "Bus 101",
      "status": "active",
      "direction": "outbound",
      "currentStopIndex": 0,
      "route": "<routeId>"
    },
    "route": {
      "_id": "<routeId>",
      "routeName": "Abdullahpur to Jaranwala",
      "startPoint": "Abdullahpur",
      "endPoint": "Jaranwala"
    },
    "status": "active",
    "startDirection": "outbound",
    "startedAt": "2026-09-19T08:00:00.000Z",
    "endedAt": null
  }
}
```

Possible errors:

| Status | Meaning |
| --- | --- |
| `400` | No bus is assigned, or the assigned bus has no route. |
| `401` | JWT is missing, invalid, or expired. |
| `403` | The account is not a driver, or the assigned bus does not belong to this driver. |
| `404` | The assigned bus no longer exists. |
| `409` | An active shift already exists for this driver or bus. |
| `500` | An unexpected shift-start failure occurred. |
| `503` | The database deployment cannot run the required transaction. |

Unique partial indexes on active shifts protect both `driver` and `bus`, so concurrent start requests cannot create duplicate active shifts.

## End a shift

```http
POST /api/buses/assigned/end-shift
Content-Type: application/json
```

Authentication and authorization: driver only. The request has no body.

The server resolves the authenticated driver's assigned bus, verifies ownership and an active matching shift, then atomically sets the shift to `completed`, records `endedAt`, and marks the bus `idle`. The shift and final bus location/progress remain stored.

Success: `200 OK`

```json
{
  "message": "Shift ended successfully",
  "shift": {
    "_id": "<shiftId>",
    "status": "completed",
    "startedAt": "2026-09-19T08:00:00.000Z",
    "endedAt": "2026-09-19T16:00:00.000Z",
    "bus": {
      "_id": "<busId>",
      "busNumber": "Bus 101",
      "status": "idle",
      "direction": "return",
      "currentStopIndex": 4,
      "route": "<routeId>"
    }
  }
}
```

Possible errors:

| Status | Meaning |
| --- | --- |
| `400` | No bus is assigned. |
| `401` | JWT is missing, invalid, or expired. |
| `403` | The account is not a driver, or the assigned bus does not belong to this driver. |
| `404` | The assigned bus no longer exists. |
| `409` | No active shift exists for this driver and bus. |
| `500` | An unexpected shift-end failure occurred. |
| `503` | The database deployment cannot run the required transaction. |

## Restore current shift state

```http
GET /api/auth/profile
Authorization: Bearer <token>
```

The existing profile response is unchanged except for `activeShift`. For a driver with a current shift it contains the populated active shift; otherwise it is `null`. Clients should reload this endpoint after refresh and treat it as the source of truth.

```json
{
  "_id": "<driverId>",
  "role": "driver",
  "assignedBus": "<busId>",
  "activeShift": null
}
```

## GPS and Socket.IO

Location sharing continues through the existing endpoint:

```http
PATCH /api/buses/:id/location
Authorization: Bearer <driver-token>
Content-Type: application/json

{
  "latitude": 31.418,
  "longitude": 73.079,
  "speed": 18.5
}
```

A location update is accepted only when `:id` is both the driver's `assignedBus` and a bus whose `driver` is the authenticated user, and a matching active shift exists. After an end shift, the endpoint returns `409` and cannot reactivate the bus.

Accepted updates use the existing Socket.IO server and emit the existing `locationUpdate` event to the `bus:<busId>` room. Ending a shift reuses that event once to publish the persisted `idle` status immediately to connected clients. No separate socket connection or shift-specific event is required.

## Return trip

Return travel remains a separate action:

```http
POST /api/buses/assigned/return-trip
Authorization: Bearer <driver-token>
```

It requires an active shift and the bus to be at the outbound terminal. It changes `Bus.direction` from `outbound` to `return`, resets direction-relative progress, reuses the reversed stop order, and broadcasts the new direction through `locationUpdate`. Starting a shift never starts a return trip automatically.

## Admin visibility

```http
GET /api/admin/shifts
Authorization: Bearer <admin-token>
```

Returns shift history newest first with driver, bus, and route summaries. `GET /api/admin/overview` also includes `activeShifts`. Both endpoints are admin-only.
