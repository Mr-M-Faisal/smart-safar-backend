# Local Driver and Admin Testing

The `/api/auth/dev-login` endpoint creates a local demo Driver or Administrator session for UI testing. It never accepts commuter roles and stays unavailable unless both development switches below are set.

## Backend `.env` (local machine only)

```env
NODE_ENV=development
ALLOW_LOCAL_TEST_LOGIN=true
JWT_SECRET=use-a-long-random-local-secret
MONGO_URI=your-local-or-development-mongodb-connection
```

## Frontend `.env.local`

```env
NEXT_PUBLIC_ENABLE_LOCAL_TEST_LOGIN=true
NEXT_PUBLIC_API_URL=http://localhost:5000/api
```

Restart both development servers after changing these values. The backend must connect to MongoDB and have a valid `JWT_SECRET`; it creates persistent demo accounts named `local-demo-driver@smartsafar.invalid` and `local-demo-admin@smartsafar.invalid` on first use. The login form's email and password are only used to satisfy its normal fields; the local test endpoint does not authenticate those values.

Do not set `ALLOW_LOCAL_TEST_LOGIN=true` or expose this endpoint in a deployed environment. The endpoint returns 404 unless `NODE_ENV` is exactly `development` and the opt-in flag is exactly `true`.

The demo Driver account has no bus assignment. Use the Admin demo workspace to inspect admin screens; assign a real test bus to the Driver through the admin tools before testing shift workflows.
