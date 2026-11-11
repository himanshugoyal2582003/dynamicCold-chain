# Implementation Plan — Phase 1

## Stack
- Frontend: Next.js, Tailwind CSS, React Three Fiber (hero)
- Backend: Node.js with NestJS or Express
- Database: PostgreSQL
- Auth: email and password, JWT in an httpOnly cookie, role guards
- Tools: VS Code, Git, GitHub

## Architecture
```
Browser (Next.js)
  |- /            Hero page (public)
  |- /login
  |- /admin       Admin area
  |- /owner       Truck owner area
  '- /truck       Truck user control panel
        |
     REST API (role guards)
        |
     PostgreSQL
```

## Data model
| Table | Key fields |
|---|---|
| users | id, name, email, passwordHash, role (admin / owner / truckUser), ownerId?, truckId?, active |
| trucks | id, ownerId, plateNumber, type, capacityTons, status, targetTempC, insuranceExpiry, permitExpiry, fitnessExpiry, active |
| trips | id, truckId, userId, origin, destination, cargoType, notes, startedAt, endedAt |
| issues | id, truckId, reportedBy, description, status, createdAt |
| activity_log | id, actorId, action, entity, entityId, createdAt |

Truck status values: available, on trip, maintenance.

## Pages
| Route | Role | Content |
|---|---|---|
| / | Public | Hero with 3D truck, short product summary, Sign in |
| /login | Public | Sign-in form |
| /admin | Admin | Overview counts, recent activity |
| /admin/owners, /admin/trucks, /admin/users | Admin | List, search, filter, create, edit, deactivate |
| /owner | Owner | Truck list, status summary, expiring documents |
| /owner/trucks/[id] | Owner | Truck detail, assign user, edit, trip history |
| /truck | Truck user | Control panel: truck info, start or end trip, report issue, target temperature, trip history |

## API (outline)
- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `GET/POST/PATCH /admin/owners`, `/admin/trucks`, `/admin/users`
- `GET/POST/PATCH /owner/trucks`
- `GET /truck/me`, `POST /truck/trips`, `PATCH /truck/trips/:id/end`, `POST /truck/issues`, `PATCH /truck/temperature`

## Phases
1. **Setup and design (week 1):** repo, tokens from `design.md`, layout shell, database and seed data.
2. **Auth and roles (week 2):** login, JWT, guards, role redirects.
3. **Hero page (week 2–3):** 3D truck, animation, fallbacks.
4. **Admin area (week 3–4):** overview and three management lists.
5. **Owner area (week 4–5):** truck list, detail, assign user.
6. **Truck user panel (week 5–6):** trips, issues, temperature setting.
7. **Testing and polish (week 7):** permissions, mobile, accessibility, demo rehearsal, deploy.

Weeks are placeholders; confirm dates with the guide.

## Suggested split
| Member | Focus |
|---|---|
| Himanshu | Backend, auth, integration |
| Ajay | Hero page and 3D |
| Ravindra | Admin area |
| Shivam | Owner area |
| Aaditya | Truck user panel and QA |

## Risks
| Risk | Mitigation |
|---|---|
| 3D hero slows the page | Lazy-load, low-poly model, static fallback |
| Permission bugs leak data | Server-side guards, tests for cross-owner access |
| Scope creep back to IoT/ML | Keep them in "Later" below |

## Later (not in this phase)
IoT sensors, spoilage prediction, route optimization, live tracking, notifications.

## Definition of done
Every FR in `requirements.md` passes its acceptance check, and the demo runs through all three roles.
