# ColdChain Fleet Optimization

Fleet Optimization is available at `/admin/fleet-optimization` and `/owner/fleet-optimization`. It plans one pending shipment per available truck for an immediate dispatch window. Each run covers one owner fleet, up to 12 selected shipments and 12 selected trucks. Recommendations are read-only. A manager may approve one operational recommendation at a time.

## Repository audit and setup

The existing Trips module already assigns an active driver to an active truck, checks open trips, writes the audit trail and broadcasts updates. Fleet approval extends that transaction with an atomic shipment link and planning-specific guards. Existing manual trips still use the same entry points and eligibility rules. The optimizer does not divert a truck or update an active trip.

Fleet and tracking modules already maintain truck ownership, the recorded capacity ceiling and location history. The existing fleet capacity can contain defaults, so dispatch requires an explicitly confirmed usable capacity at or below that ceiling. Cargo compatibility, cost rates and dispatch positions cannot be inferred from truck type, insurance values or tracker fallbacks. Administrators and owners supply those facts through the dispatch profile. The position is an operator-confirmed dispatch position, with no claim that it is GPS telemetry. Saving or reconfirming the profile gives it a 30-minute validity window, and transferring a truck hides the previous owner's profile. The existing road-routing service shared with Rescue provides the loaded and empty legs. Existing Rescue Engine states reserve trucks with open cases, and approved assignments remain visible under Trips for subsequent operational monitoring.

Predictive Maintenance supplies the latest scored assessment for the current truck pairing and setpoint. The planner excludes warning or critical assessments and missing or stale evidence. Digital Twin uses different inputs for thermal what-if scenarios, such as ambient temperature and observed initial temperature. The dashboard links to it for those analyses. Fleet planning uses the entered nominal shelf-life cutoff for feasibility and prioritization. It does not call the thermal forecast with made-up inputs or present this reserve as a spoilage probability.

Run the existing services after applying migrations through `008_fleet_optimization.sql` to the intended database. For local verification, use disposable PostgreSQL and set the existing `OSRM_BASE_URL` to an approved road provider or a local synthetic fixture. The fixture tests need no routing provider or shared database. A valid session JWT signing secret is also used with a separate purpose prefix and audience for short-lived allocation quotes.

1. Choose an owner fleet. Add pending shipments with real, verified pickup and delivery coordinates, weights, handling time, deadline and shelf-life cutoff. The deadline and cutoff are separate timestamps. The browser converts local times to timezone-qualified API inputs.
2. Edit the profiles of the candidate trucks. Confirm the dispatch position, capacity, compatible cargo list and distance rate. Use one currency per plan. The cost estimate covers the supplied distance rate over both legs and has no separate tolls, fixed fees, traffic uplift or fuel model.
3. Select the pending shipments and trucks, then choose **Compare allocations**. Compare coverage, priority, distance, duration, cost, relative score, and utilization of selected trucks. Expand the rankings for the score breakdown and infeasibility reasons.
4. For a real operational recommendation, choose **Review assignment**, confirm the shipment and truck, and click **Approve and assign trip**. Check Trips for the resulting assignment. Re-run planning after an approval to refresh the remaining choices.

Shipment and profile forms default to synthetic. Plans compare either synthetic or operational shipments, with matching profile provenance. Synthetic plans issue no approval token and cannot create trips. The automated acceptance test creates a separate, visibly TEST-labeled operational-mode row solely inside isolated PostgreSQL to exercise the guarded approval path.

## Feasible graph and objective

A graph edge is feasible only when the following conditions hold.

- The truck belongs to the selected fleet, is active and available, has an available assigned driver, and has neither an active trip nor an open rescue case.
- A fresh, confirmed matching-provenance profile lists the shipment's normalized cargo type and enough verified capacity at the current truck setpoint. A setpoint change requires reconfirmation. The rate uses the same currency as the plan. The recorded truck capacity remains a ceiling.
- The latest maintenance assessment matches the current pairing and setpoint, is scored, was observed within 15 minutes, and is normal or watch. An assessment timestamp up to five seconds ahead is tolerated.
- Both road legs are available. If the dispatch position equals pickup exactly, the empty leg is zero. Otherwise missing routing blocks the edge. No straight-line fallback is used.
- Immediate departure plus the empty leg, loaded leg and handling time reaches delivery at or before the deadline and strictly before the nominal shelf-life cutoff. Cold reserve at delivery is cutoff minus ETA. The fraction consumed is elapsed duration divided by reserve at planning time.

Distance is both legs. Cost is distance times the operator-confirmed rate, rounded to two decimal places. Travel duration includes handling. The additive score has five rounded integer contributions and stays between 0 and 10,000.

| Component | Weight | Normalization |
| --- | ---: | --- |
| Estimated transportation cost | 35% | Fraction of the highest feasible pair cost in the run, with minimum denominator 1 |
| Road distance | 10% | Fraction of the highest feasible distance in the run, with minimum denominator 1 |
| Delivery duration | 20% | Fraction of the highest feasible duration in the run, with minimum denominator 1 |
| Nominal shelf-life reserve consumed | 20% | Fraction of the shipment's starting nominal reserve |
| Equipment health deduction | 15% | 1 minus maintenance score / 100 |

The algorithm is minimum-cost maximum flow with unit capacities in the bipartite shipment–truck graph. An augmenting path may use a reverse residual arc to move an earlier shipment to a different truck. It maximizes total matches first, then critical matches, then high matches, then minimizes total additive score. Shipment priority penalties on source arcs use a unit of shipment count × 10,000 + 1. Each critical loss therefore outweighs the entire possible high-priority count swing and score variation. A high-priority loss outweighs the entire pair score variation. Ties follow stable input order after sorting database records by ID.

For S shipments, T trucks, E feasible pairs and K matches, V = S + T + 2. Bellman–Ford relaxation for each augmentation uses O(K × V × (S + T + E)) time and O(V + E) graph space, with an additional final unsuccessful search. Routing is external to solver time and may require up to S × T + S unique lookups, with duplicate legs coalesced. Two concurrent runs per backend process and one per actor are allowed, with bounded route batches. A planning run that exceeds its routing budget between batches fails and can be retried with a smaller selection. Provider failures exclude the affected edges. The optimizer is exact for its feasible graph and stated lexicographic objective. It cannot prove optimality across omitted selections, missing or inaccurate routes, multi-stop routes, future departure windows, split cargo, or multiple shifts.

The greedy baseline visits critical, high and then standard shipments, breaking priority ties by deadline and ID. It picks the cheapest score still available for each shipment, using the same feasible graph. A more complete optimized plan can legitimately show higher total cost than a greedy plan that leaves loads behind. Scores are normalized per plan and are only comparable inside that run.

## APIs, approval and data isolation

All routes are under `/api/fleet-optimization` and require the existing HTTP-only session cookie. POST and PUT also require the existing double-submit CSRF token. Roles and fleet access are checked against current database records.

| Method and path | Result |
| --- | --- |
| GET `/fleets` | Admin's active owner fleets or the authenticated owner's fleet |
| GET `/fleets/:ownerId` | Up to 100 active trucks and 100 pending shipments, with a truncation flag |
| POST `/fleets/:ownerId/shipments` | Store a pending shipment with fleet-unique reference |
| PUT `/fleets/:ownerId/trucks/:truckId/profile` | Save or reconfirm operator-attested dispatch facts |
| POST `/fleets/:ownerId/plan` | Compare optimized and greedy runs for `shipmentIds`, `truckIds` and `currency` |
| POST `/fleets/:ownerId/approve` | Explicit approval with a signed `quote` and `confirmed: true` |

Shipment input fields are `reference`, `cargoType`, `weightTons`, `origin`, `destination`, `originLat`, `originLng`, `destinationLat`, `destinationLng`, `deadline`, `shelfLifeUntil`, `handlingMinutes`, `priority`, and `synthetic`. Capacity and weight are decimal metric tons, coordinates are decimal degrees, handling is whole minutes from 0 to 240, and cutoffs are timezone-qualified and up to 90 days ahead. Profile fields are `cargoTypes`, `usableTons`, `targetC`, `costPerKm`, `currency`, `latitude`, `longitude`, `synthetic`, and `confirmed`. Approvals only accept server-signed optimized recommendations. Invalid payloads return 400, missing sessions 401, disallowed roles or CSRF failures 403, inaccessible fleets or selections 404, and stale, conflicted or expired approval 409.

A quote is bound to actor, role, fleet, truck, driver, shipment, profile revision, maintenance window, road duration and review ETA. It expires in 60 seconds. Approval atomically checks current scope, dispatch profile, same maintenance window, available truck and driver, open rescue state, and whether dispatch now still meets the deadline and cutoff. It locks the shipment and profile plus the existing truck and driver locks, creates an assigned trip, links the shipment and records the existing audit event in one transaction. Existing database uniqueness constraints arbitrate concurrent manual or planner assignments. Retries cannot create a duplicate shipment assignment. Approval creates no rescue action and does not move or start a trip.

## Reproducible checks

From `backend/`, run `npm run test:fleet`, then `npm run evaluate:fleet`. The unit test compares the solver with exhaustive search on 160 small generated graphs. The evaluation generates 600 synthetic graphs with fleet sizes from 6–12 and fixed seed 19880217. It found 5,063 optimized assignments versus 4,643 greedy assignments. Coverage improved in 365 runs. In the 229 runs with identical coverage and priority mix, the total pair score fell by 13.81%. These are synthetic graph results. They measure neither real fleet savings nor end-to-end route latency.

For headless browser verification, build the frontend with `NEXT_PUBLIC_API_URL=http://127.0.0.1:3420`. From `backend/`, run `node scripts/fleet-browser.cjs` with `FLEET_BROWSER_FRONTEND` pointing to the built frontend if outside the normal location, optionally `PLAYWRIGHT_MODULE` pointing to a separately installed Playwright module and `FLEET_BROWSER_EXECUTABLE` pointing to a local Chrome executable. The harness starts a loopback Next server and a Nest HTTP fixture with isolated PGlite and synthetic routes. It checks mobile owner and desktop admin workflows, data isolation, editable inputs, recommendations, comparison, utilization and explicit approval.
