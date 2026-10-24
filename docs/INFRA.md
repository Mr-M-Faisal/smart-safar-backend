# AWS and backend operations notes

These are manual deployment notes. This change does not modify AWS resources, CodePipeline, CodeBuild, Elastic Beanstalk, CloudFront, or the configured deployment region. Keep the existing pipeline and `buildspec.yml` as the source of truth.

## CloudFront in front of the public API

Use the API origin (the existing Elastic Beanstalk/API hostname) for API behaviors. Configure behaviors from most specific to least specific and leave authenticated/session routes uncached:

| Path pattern | Methods | Cache behavior |
| --- | --- | --- |
| `/api/routes*` | GET, HEAD, OPTIONS | Short public TTL (for example 30 seconds); cache key includes `Origin` and query strings; forward `Origin` to the origin. |
| `/api/buses/*/eta*` | GET, HEAD, OPTIONS | Short public TTL only if the endpoint remains unauthenticated; include `Origin` and relevant query strings. |
| `/api/auth/*`, `/api/bookings*`, `/api/passenger*`, `/api/admin*`, `/api/driver*`, `/api/safety*`, `/api/reports*`, `/api/route-alerts*`, `/api/buses/*/location*`, `/socket.io/*` | All required API methods | Disable caching (minimum TTL 0); forward authorization, cookies, query strings, and required request headers; permit WebSocket upgrade on the socket behavior. |
| Default API behavior | All API methods | Disable caching and forward the required viewer authorization/cookies/query strings. |

Do not allow a broad cache behavior to match authenticated APIs. CloudFront's minimum TTL must be zero for private responses; otherwise a positive minimum TTL can override origin `no-store` directives. For CORS, cache variants must include `Origin`; if caching `OPTIONS`, include the relevant preflight request headers and method in the policy. CloudFront's cache and origin request policies are separate settings; values in the cache key are sent to the origin too. See [CloudFront cache and origin request policies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/controlling-origin-requests.html) and [CORS header caching](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/header-caching.html).

After deploying a distribution change, invalidate only the affected API paths if a stale object remains. Confirm behavior ordering and the selected origin before saving.

### Verify after configuration

Run these from a terminal where `API_BASE` is the CloudFront API hostname and `ORIGIN` is the deployed frontend origin:

```sh
curl -sSI -H "Origin: $ORIGIN" "$API_BASE/api/health"
curl -sSI -H "Origin: $ORIGIN" "$API_BASE/api/routes"
curl -sSI -H "Origin: $ORIGIN" "$API_BASE/api/routes"
curl -sSI -H "Origin: $ORIGIN" "$API_BASE/api/bookings"
curl -sSI -X OPTIONS -H "Origin: $ORIGIN" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: authorization,content-type" "$API_BASE/api/bookings"
```

Confirm `Access-Control-Allow-Origin` matches the requesting frontend, public route responses show a short TTL and a cache hit on a repeat request (when enabled), and booking responses remain private/no-store with no cross-user cache hit. An unauthenticated booking request should still be rejected by the API. `Server-Timing`, `X-Request-Id`, and `Vary: Origin` should be present where applicable.

## Regional placement and redeployment

Choose a region based on user latency, data residency, service availability, and operational cost. For Faisalabad users, compare Mumbai (`ap-south-1`) and Bahrain (`me-south-1`) from a real network measurement; AWS lists both regions, but application and database service availability can differ by region. See [AWS region names and codes](https://docs.aws.amazon.com/global-infrastructure/latest/regions/aws-regions.html).

Moving the API is a migration: provision equivalent application resources in the target region, migrate and verify MongoDB data/backups and secrets, update the existing pipeline's target settings and frontend API URL, deploy through the same CodePipeline/CodeBuild path, run the endpoint checks above, then switch DNS only after verification. Keep the old environment available for rollback until the new region is stable. Do not copy production secrets into source files.
