# Deployment and rollback notes

This repository keeps the existing AWS deployment path intact. The frontend is built and hosted by AWS Amplify. The backend is deployed by the existing AWS CodePipeline, which includes CodeBuild and a `buildspec.yml`. CI checks in GitHub Actions only verify pull requests and pushes; they do not deploy either service.

## Architecture

```text
Browser / installed PWA
  ├─ Amplify-hosted Next.js frontend
  └─ HTTPS API and Socket.IO → CloudFront → existing Elastic Beanstalk stack
                                      └─ MongoDB Atlas

GitHub pull request / main push → backend and frontend CI workflows (checks only)
Backend deployment → existing AWS CodePipeline → CodeBuild (`buildspec.yml`) → current deployment stages
Frontend deployment → existing AWS Amplify branch build and hosting
```

No AWS resources, CodePipeline stages, Amplify settings, Elastic Beanstalk options, or CloudFront behaviors are changed by the Phase 1 code changes. There is no `buildspec.yml` in this source copy, so the buildspec location and remaining CodePipeline stages continue to be defined by the existing AWS pipeline configuration.

## Backend environment variables

| Variable | Example or default | Secret |
| --- | --- | --- |
| `MONGO_URI` | `mongodb+srv://<user>:<password>@<cluster>/<database>` | Yes |
| `JWT_SECRET` | Random value of at least 32 characters | Yes |
| `JWT_ACCESS_EXPIRES_IN` | `15m` | No |
| `NODE_ENV` | `production` | No |
| `CORS_ORIGIN` | `https://your-amplify-domain.example,https://your-domain.example` | No |
| `PORT` | Set by the hosting service | No |
| `ALLOW_LOCAL_TEST_LOGIN` | `false` | No |
| `TRUST_PROXY_HOPS` | `1` until verified from the diagnostic endpoint | No |
| `ENABLE_PROXY_DIAGNOSTIC` | `false` | No |
| `SHIFT_STALE_HOURS` | `12` | No |
| `SESSION_INACTIVITY_DAYS` | `7` | No |
| `BOOKING_FARE` | `0` | No |
| `BOOKING_CURRENCY` | `PKR` | No |
| `PAYMENT_PROVIDER` | Empty unless configured | No |
| `PAYMENT_WEBHOOK_SECRET` | Provider webhook secret | Yes |

Production startup now stops with a clear error if the JWT secret is too short, the MongoDB URI is missing, CORS has no explicit origin or contains `*`, or local test login is enabled. CORS accepts a comma-separated allowlist and is shared by HTTP and Socket.IO.

The proxy diagnostic is available at `GET /api/admin/proxy-diagnostic` only to an authenticated admin and only when `ENABLE_PROXY_DIAGNOSTIC=true`. It returns `req.ip`, `req.ips`, and `X-Forwarded-For`. Temporarily enable it through the existing deployment process, inspect the result, then disable it. Set `TRUST_PROXY_HOPS` to the verified number of trusted proxies; do not infer the value from the example. `GET /api/health` provides a database-independent health response. The Elastic Beanstalk health check setting remains unchanged.

Socket.IO uses explicit 10-second ping interval and timeout values. Keep both comfortably below the CloudFront origin response timeout configured for the existing distribution.

## Frontend environment variables

| Variable | Example or default | Secret |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | `https://your-api-domain.example` (no `/api` suffix) | No; exposed in the browser |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google web client ID | No; public client ID |
| `NEXT_PUBLIC_ENABLE_LOCAL_TEST_LOGIN` | `false` | No; development only |
| `NEXT_PUBLIC_DEMO_MODE` | `false` | No; keeps illustrative data disabled unless explicitly enabled |

## Phase 2 data endpoints

- `GET /api/routes/overview` returns active routes with ordered stops and bus summaries. Public responses use a 10-second browser cache with a 30-second stale-while-revalidate window.
- `GET /api/passenger/bootstrap` requires a commuter session and returns the passenger profile, bookings, alerts, safety sessions, and the route overview in one response. It is private and not cached.
- `GET /api/admin/routes-with-details` requires an admin session and returns active routes with ordered stops and unexpired alerts. It is private and not cached.

The frontend's optional illustrative route data is loaded only when `NEXT_PUBLIC_DEMO_MODE=true`, and is labeled as demo data. Leave it `false` for production.

## Deploy and rollback

### Frontend on Amplify

The current Amplify branch and build settings remain authoritative. To roll back, open the app in the AWS Amplify console, select the affected branch, open its deployment history, and redeploy the last known-good build. If the previous build is not available there, revert the source change and let the existing branch build run. Confirm the public site and API connection after the rollback.

### Backend through CodePipeline and Elastic Beanstalk

The current CodePipeline and Elastic Beanstalk configuration remain authoritative. To roll back, use the existing pipeline's release history to redeploy the last known-good source revision. If the pipeline retains prior Elastic Beanstalk application versions, use the Elastic Beanstalk console to select the known-good version and deploy it to the existing environment. Confirm the environment health and API response before considering the rollback complete.

### Before deployment

- Confirm `npm ci`, the relevant tests, and the production frontend build pass in CI.
- Confirm `NEXT_PUBLIC_API_URL` is the HTTPS API URL for the target environment.
- Confirm the backend environment has a 32-character-or-longer `JWT_SECRET`, `MONGO_URI`, explicit `CORS_ORIGIN`, and `ALLOW_LOCAL_TEST_LOGIN=false`.
- Review the deployment diff and preserve the established Amplify and CodePipeline paths.
- After deployment, check the existing environment health and the API's `/api/health` endpoint.
