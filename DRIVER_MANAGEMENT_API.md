# Driver management and synchronized bus assignment

Implemented in the backend only. Drivers remain existing User documents with role "driver". User._id is their generated MongoDB ObjectId; email is their login ID. No separate Driver model, username, status field, authentication system or frontend data was added.

## Admin driver API

All four endpoints require the existing Bearer JWT protect middleware and database-backed authorize('admin') checks. Missing/invalid sessions return 401; authenticated drivers and commuters return 403.

| Method and endpoint | Request | Success |
| --- | --- | --- |
| GET /api/admin/drivers | No body | 200, array of all driver accounts, including unassigned drivers. |
| POST /api/admin/drivers | Required name, email, password; optional phone | 201, safe created driver. Server sets role to driver and assignedBus to null. No token is returned. |
| PUT /api/admin/drivers/:id | One or more of name, email, phone | 200, safe updated driver. |
| DELETE /api/admin/drivers/:id | No body | 200, {"message":"Driver deleted"}. |

Directory/create/update responses contain only:

| Field | JSON type / meaning |
| --- | --- |
| _id | String, generated User ObjectId. |
| name | String. |
| email | String, trimmed and lowercased. |
| phone | Optional string, trimmed. |
| role | String, "driver". |
| assignedBus | Bus ObjectId string or null, unpopulated. |
| createdAt | ISO date string. |
| updatedAt | ISO date string. |

Passwords, password hashes, __v and authentication tokens are excluded from these responses. No driver account status or username is implied.

Creation requires a nonempty trimmed name, basic valid email format and a string password of at least six characters, matching the existing User password requirement. Phone is optional; the current model requires only a trimmed string, so no new phone-number format is invented. Existing bcrypt hashing runs through User.create and the model's pre-save hook. Email uniqueness is checked both before creation and through the existing unique database index, including concurrent requests.

Creation rejects fields outside name/email/password/phone. Updates reject fields outside name/email/phone, including role, password, assignedBus and status. Invalid IDs/validation return 400; missing/non-driver accounts return 404; duplicate email returns 409. A general driver update cannot provision an admin or bypass assignment handling.

Deletion is hard deletion because the current User schema has no deactivation or soft-delete state. The transaction clears all Bus.driver references to the removed driver, clears profile claims to affected buses and deletes the User. Existing JWTs then fail protect because the database User no longer exists. Unrelated booking/report lifecycle behavior was not changed.

## Existing bus assignment API

The existing URL and JSON response style are preserved:

PUT /api/buses/:id

Assignment body:

    {"driver":"<existing driver User ObjectId>"}

Unassignment body:

    {"driver":null}

Only admins can call this operation. Invalid bus/driver IDs return 400, missing records return 404, and selecting a user whose role is not driver returns 400. Incoming update operators and unknown/immutable top-level fields are rejected rather than being allowed to bypass relationship handling.

Success is 200 with the updated, unpopulated Bus document. Fields remain _id, busNumber, route, driver, capacity, availableSeats, currentLocation, lastLocationUpdate, status, trustScore, currentStopIndex, recentSpeeds, createdAt, updatedAt and __v. route and non-null driver are ObjectId strings; currentLocation contains latitude/longitude, and trustScore contains score/totalRatings. GET /api/buses and GET /api/buses/:id continue to populate route {_id, routeName} and driver {_id, name, phone?} or null. No custom success envelope was introduced.

Assignment commits Bus.driver = driver._id and User.assignedBus = bus._id together. Changing the bus from Driver A to Driver B clears profile claims to this bus except Driver B, then sets Driver B's assignment and the bus reference. Profiles pointing to other buses are preserved. Unassigning clears the bus reference and profiles whose assignedBus still points to this bus. Repeating assign/unassign is safe; repeating a matching legacy fleet assignment can repair its unsynchronized profile.

Chosen conflict behavior: one driver can have one bus, consistent with the existing scalar assignedBus field. If the selected driver's profile points to a different bus, or another fleet bus references that driver, return 409 with a message to unassign the other bus first. There is no silent transfer. Changing a bus to an otherwise available driver is supported. Historical inconsistent records are detected; this task did not bulk-migrate database assignments. The live audit found zero preexisting assignment mismatches.

Assignment-bearing POST /api/buses also validates/synchronizes the driver. Available seats still initialize from capacity, and its success remains 201 with a Bus document. A duplicate bus or conflict rolls back any profile update. DELETE /api/buses/:id clears User.assignedBus links before deleting the bus in the same transaction; its existing {"message":"Bus deleted"} response remains intact. Ordinary bus edits without a driver field retain their existing update behavior and schema validation.

## Transactions and concurrent requests

The actual configured MongoDB topology was checked using hello before implementation: it is a replica set with sessions, and real transaction writes/rollback passed. No database URI or credentials were printed or committed.

Relationship changes use Mongoose connection.transaction with primary reads, snapshot read concern and majority write concern. Every operation explicitly uses the same session and runs sequentially; no Promise.all is used inside a transaction. Mongoose retries transient transaction conflicts. Driver and bus writes serialize competing assignment operations; the bus driver path is marked modified even on repeated assignment so it participates in write-conflict detection. Deletion writes the same affected records, preventing concurrent operations from leaving dangling assignments.

Any failure aborts all relationship changes. This was tested with a bus validation failure after profile writes and with duplicate assigned-bus creation. Concurrent assignment of one driver to two buses produces one success and one 409; concurrent updates of the same bus leave one matching driver/profile pair. Concurrent driver/bus deletion and assignment leaves no orphan references.

These operations require transaction-capable MongoDB (replica set or sharded deployment). Unsupported transaction operations return 503 and do not fall back to unrelated writes. Existing configured deployment supports the required transactions. See the [Mongoose 8 transaction guide](https://mongoosejs.com/docs/8.x/docs/transactions.html).

## Existing authentication

POST /api/auth/register preserves commuter registration and its existing identity-plus-token response. The server always provisions role "commuter" and assignedBus null. Requests explicitly asking for admin, driver or another non-commuter role are rejected with 400 before account creation. Public registration cannot set an assignment.

POST /api/auth/login still accepts {email, password} and returns {_id, name, email, role, token}. Email is normalized before lookup. Driver accounts created by the admin API authenticate through this same endpoint. No admin session token is replaced during account creation.

GET /api/auth/profile still returns the current database-backed User without password, including assignedBus. A newly signed-in driver sees the saved bus ID immediately, and subsequent profile reads preserve it. The existing frontend can fetch GET /api/buses/:id using that value.

## Frontend integration contract

No frontend files changed in this task. The current admin UI still needs to consume GET /api/admin/drivers instead of deriving choices from fleet references, wire the three other driver-management operations above, and refetch both buses and the driver directory after assignments. It should distinguish loading, confirmed-empty and failure/retry states, use actual driver._id values, and display name/email/ID as needed. Limitation notices can be removed when that frontend integration is performed.

The existing Driver Dashboard already reads assignedBus from the authenticated profile, so the backend now supplies its required assignment source. Do not infer assignment from public fleet records or localStorage. No browser redirect or dropdown frontend change is claimed by this backend task.

Shift lifecycle, password reset and driver deactivation endpoints were not introduced. There is no new persisted Not Started/Active/Ended shift state; Start/End Shift remain outside this backend assignment scope. Existing location/seat authorization and tracking controllers otherwise remain unchanged.

## Validation

npm.cmd test runs the Node built-in test runner through test/driver-management.test.js. No testing dependency was added. Tests use actual HTTP handlers, JWT middleware, bcrypt, Socket.IO and a real transaction-capable MongoDB connection. TEST_MONGO_URI may supply a separate test server; otherwise the existing backend MONGO_URI is used with an explicitly overridden, uniquely named transit_driver_test_ database. All fixtures are confined to that database, and cleanup verifies the exact generated name and prefix before dropping only that database. The live fleet is never seeded by this suite.

24 tests passed: commuter registration; public admin/driver rejection; safe hashed driver creation; duplicate-email race; field validation; update and role/mass-assignment prevention; driver login/wrong password; 401/403 authorization; profile persistence after fresh login and repeated reads; assignment/change/unassignment; conflict and legacy reference checks; transaction rollback; concurrent assignment and deletion; assigned-bus creation/deletion; ordinary bus edits; real GPS/Socket.IO location event; ETA; seats; route/stop/alert reads; booking/cancellation; reports/safety reads; existing admin analytics.

The first test setup hit the Atlas database-name length limit before fixture creation. The generated name was shortened, and the complete suite then passed. Test database cleanup completed.

A separate manual HTTP audit against the running backend used the provided existing admin/driver accounts, real directory records and an existing unused bus. It verified profile synchronization, a fresh driver login, repeated profile reads, populated route/ETA reads, change/unassignment, unauthorized directory denial and wrong-password rejection. Initial live counts were three buses and four drivers, with zero assignment mismatches. Original bus and driver profile assignments were restored. Mutation timestamps can reflect verification; no live account or bus was created or deleted.

Syntax checks passed for all 36 backend JavaScript files under src and test. There is no backend build or lint script; none is claimed as run. The SHA-256 integrity comparison passed for all 151 frontend files outside generated/dependency directories: no changed, added or removed files.

The historical test-script.js publicly provisions privileged roles and seeds the live API; it was not run. Its privileged-registration expectation is intentionally incompatible with this security fix. Use npm test for repeatable isolated checks.

## Changed files

Modified: package.json, src/controllers/authController.js, src/controllers/busController.js, src/routes/adminRoutes.js, src/server.js. The server retains normal direct startup; exporting its existing app/server/io allows integration tests to use actual handlers with their isolated connection.

Created: src/controllers/adminDriverController.js, src/services/busAssignmentService.js, src/utils/accountValidation.js, src/utils/apiError.js, test/driver-management.test.js and this document. User/Bus schemas, dependencies and frontend files were not changed.
