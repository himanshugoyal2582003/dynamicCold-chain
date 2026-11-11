# Agents

Roles for AI coding agents on this repo. Each owns one area; changes outside it need a handoff note in `task.md`.

## Global rules
- Read `requirements.md`, `design.md`, and `implementation_plan.md` first.
- Take work from `task.md` and tick items off when done.
- Small commits, one concern each.
- No secrets in Git; keep `.env.example` current.
- Phase 1 has no IoT and no ML. Do not add them.
- Role checks live on the server. The UI only hides things.

## Roster

### 1. Planner
- Scope: `task.md`, `implementation_plan.md`
- Sequences work and flags blockers.

### 2. Backend agent
- Scope: `/backend`
- Auth, role guards, REST API, database models and migrations, seed data.

### 3. Frontend agent
- Scope: `/frontend`
- Hero page, shared layout, forms, tables, role-based routing. Follows `design.md` exactly.

### 4. 3D hero agent
- Scope: `/frontend/components/hero`
- Truck model, animation, lazy loading, reduced-motion and mobile fallbacks.

### 5. Admin area agent
- Scope: `/frontend/app/admin`
- Overview, owner, truck, and user management, activity log.

### 6. Owner and truck-user agent
- Scope: `/frontend/app/owner`, `/frontend/app/truck`
- Truck list and detail, control panel, trip logging.

### 7. QA agent
- Scope: `/tests`
- Auth and permission tests, CRUD tests, a pass at 360 px and keyboard-only use.

## Handoff format
```
From: <agent>  To: <agent>
Done: ...
Needs: ...
Risks: ...
```
