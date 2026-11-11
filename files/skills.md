# Skills

Reusable procedures agents follow.

## S1. Add a role-protected route
1. Add the route and its allowed roles to the route table.
2. Add a server guard for the matching API endpoint.
3. Add a frontend redirect for users without access.
4. Test with each role, including no login.

## S2. Add a CRUD resource
1. Define the model and migration.
2. Add endpoints: list, get, create, update, deactivate (soft delete).
3. Validate input on the server.
4. Write an activity log entry for each change.
5. Build the list, form, and detail views with the shared components.

## S3. Scope data by owner
1. Every truck query filters by `ownerId` unless the caller is admin.
2. Truck users only get the truck assigned to them.
3. Test that one owner cannot read another owner's trucks by ID.

## S4. Build a list view
1. Table on desktop, cards on mobile.
2. Search, filter, and sort in the query, not in the browser, once data grows.
3. Empty state says what to do next ("Add your first truck").

## S5. Build a form
1. Labels above fields, inline errors that say how to fix the problem.
2. Disable the submit button while saving; confirm with a plain message ("Truck saved").
3. Keep action names consistent: Add truck, Save truck.

## S6. Build the 3D hero
1. Load the scene lazily after the headline renders.
2. Keep the model under 1.5 MB.
3. Provide a static image fallback and a reduced-motion parked state.
4. Test on a low-end phone.

## S7. Seed demo data
1. One admin, two owners, five to eight trucks, three truck users, a few trips.
2. Include an expiring document and a truck in maintenance so every state is visible in the demo.
