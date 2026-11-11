# Cold-Chain Fleet Platform (Phase 1) — Master Instructions & Execution Guide

> **Project:** Cold-Chain Fleet Platform (Phase 1)  
> **Team:** Elite Avengers · GLA University, Mathura · 2026–27  
> **Source Specifications:** Based on [`files/requirements.md`](./files/requirements.md), [`files/design.md`](./files/design.md), [`files/implementation_plan.md`](./files/implementation_plan.md), [`files/agents.md`](./files/agents.md), [`files/skills.md`](./files/skills.md), and [`files/task.md`](./files/task.md).

---

## 1. Scope & Guardrails

### Included in Phase 1
- **Public Hero Page (`/`):** 3D moving refrigerated truck (React Three Fiber / Three.js), refined aesthetic, product summary, Sign-in CTA.
- **Authentication (`/login`):** Email + password, secure JWT in `httpOnly` cookie, server-side role validation, automatic role-based redirect.
- **Admin Area (`/admin`):** Fleet overview metric tiles, owner management, truck management, user management, activity audit log.
- **Truck Owner Area (`/owner`):** Fleet vehicle list (desktop table / mobile cards), detail view, expiring compliance documents (insurance, permit, fitness), user assignment, status updates.
- **Truck User Control Panel (`/truck`):** Mobile-first driver interface, start/end trip, trip logger (cargo, origin, destination, notes), manual cargo target temperature setting, issue reporting, trip history.

### Strict Scope Exclusions (DO NOT Implement in Phase 1)
- ❌ **No IoT Hardware:** No ESP32, DHT22, MQTT, or live sensor telemetry.
- ❌ **No AI/ML:** No shelf-life prediction or machine learning models.
- ❌ **No Route Optimization / Live GPS / Payment Gateways / SMS Services.**
*The database schema retains placeholder fields for future phases, but no logic or UI should attempt to connect hardware or ML.*

---

## 2. Roles & Permissions Matrix

| Role | Target Route | Allowed Capabilities | Data Access Scope |
|---|---|---|---|
| **Admin** | `/admin` | Manage owners, trucks, users; view global metrics; inspect activity log | Global (All system data) |
| **Truck Owner** | `/owner` | View/edit own trucks, assign drivers, update truck status, monitor document expiry | Scoped strictly to `ownerId` |
| **Truck User** | `/truck` | Control panel for assigned truck, start/end trip, log cargo & target temp, report issue | Scoped strictly to single assigned `truckId` |

> **Security Rule:** All role checks **MUST** be enforced server-side in API route guards and middleware. Frontend guards are purely for UX redirection.

---

## 3. Design System & Visual Guidelines

Follow the "Private-bank stationery meets luxury logistics" aesthetic: generous whitespace, refined typography, restrained color palette, crisp 4px borders, and deliberate motion.

### Color Tokens
```css
:root {
  --color-paper:    #FFFFFF; /* Page canvas */
  --color-ivory:    #F7F6F3; /* Panels, table headers, alternating cards */
  --color-ink:      #14171C; /* Primary headings, body copy */
  --color-slate:    #5B6470; /* Secondary text, metadata labels */
  --color-hairline: #E3E1DC; /* Borders, dividers, subtle separators */
  --color-gold:     #B08D3C; /* Key accent, active states, focus outlines */

  /* Semantic Status Indicators */
  --status-available:   #2E7D5B; /* Green */
  --status-on-trip:     #2F5D8A; /* Blue */
  --status-maintenance: #C9962B; /* Amber */
  --status-issue:       #A3262A; /* Crimson (also for expired docs) */
}
```

### Typography & Layout Rules
- **Display Headings:** High-contrast classic serif (`Cormorant Garamond` or `Playfair Display`), light to regular weight.
- **Body & UI:** Clean, legible sans-serif (`Inter` or `Manrope`), 16px base, 1.6 line height.
- **Numbers & Metrics:** Tabular figures (`font-variant-numeric: tabular-nums`).
- **Scale:** 14px / 16px / 20px / 28px / 44px / 72px. Max line length < 70 characters.
- **Component Geometry:** 4px border radius (`rounded`), Hairline 1px borders, subtle or no drop-shadows.
- **Accessibility:** Visible 2px Gold keyboard focus outline, AA contrast ratio minimum, responsive down to 360px viewport.

---

## 4. Technical Architecture

```
e:\MyProject\coldChain\
├── backend/                  # Node.js (Express / NestJS) REST API
│   ├── src/
│   │   ├── config/           # Database & JWT configs
│   │   ├── controllers/      # Auth, Admin, Owner, Truck, Trip controllers
│   │   ├── middlewares/      # authGuard, roleGuard, ownerScopeGuard
│   │   ├── models/ / db/     # PostgreSQL schema, migrations, seed script
│   │   └── routes/           # REST endpoints
│   ├── package.json
│   └── .env.example
├── frontend/                 # Next.js App Router with Tailwind CSS / CSS tokens
│   ├── app/
│   │   ├── page.tsx          # Public Hero page with 3D truck
│   │   ├── login/page.tsx    # Sign-in page
│   │   ├── admin/            # Admin dashboard and CRUD screens
│   │   ├── owner/            # Truck owner fleet views and detail pages
│   │   └── truck/            # Truck user mobile-first control panel
│   ├── components/
│   │   ├── hero/             # 3D canvas, GLB truck loader, motion fallbacks
│   │   ├── ui/               # Reusable tables, cards, badges, modal forms
│   │   └── layout/           # Desktop sidebar nav & mobile bottom bar
│   ├── styles/globals.css
│   └── package.json
├── files/                    # Project specifications (requirements, design, etc.)
└── INSTRUCTIONS.md           # This master instruction manual
```

---

## 5. Data Model & PostgreSQL Schema

### Tables & Key Attributes

1. **`users`**
   - `id`: UUID (Primary Key)
   - `name`: VARCHAR(100)
   - `email`: VARCHAR(150) UNIQUE NOT NULL
   - `password_hash`: VARCHAR(255) NOT NULL
   - `role`: ENUM (`admin`, `owner`, `truckUser`)
   - `owner_id`: UUID (FK -> users.id, nullable; used if driver belongs to owner)
   - `truck_id`: UUID (FK -> trucks.id, nullable; currently assigned truck)
   - `active`: BOOLEAN DEFAULT true
   - `created_at`: TIMESTAMP

2. **`trucks`**
   - `id`: UUID (Primary Key)
   - `owner_id`: UUID (FK -> users.id, NOT NULL)
   - `plate_number`: VARCHAR(50) UNIQUE NOT NULL
   - `type`: VARCHAR(50) (e.g. Refrigerated Van, 10-ton Reefer)
   - `capacity_tons`: NUMERIC(5,2)
   - `status`: ENUM (`available`, `on_trip`, `maintenance`) DEFAULT `available`
   - `target_temp_c`: NUMERIC(4,1) DEFAULT 4.0
   - `insurance_expiry`: DATE
   - `permit_expiry`: DATE
   - `fitness_expiry`: DATE
   - `active`: BOOLEAN DEFAULT true
   - `created_at`: TIMESTAMP

3. **`trips`**
   - `id`: UUID (Primary Key)
   - `truck_id`: UUID (FK -> trucks.id, NOT NULL)
   - `user_id`: UUID (FK -> users.id, NOT NULL)
   - `origin`: VARCHAR(255) NOT NULL
   - `destination`: VARCHAR(255) NOT NULL
   - `cargo_type`: VARCHAR(100) NOT NULL
   - `notes`: TEXT
   - `started_at`: TIMESTAMP DEFAULT NOW()
   - `ended_at`: TIMESTAMP NULL

4. **`issues`**
   - `id`: UUID (Primary Key)
   - `truck_id`: UUID (FK -> trucks.id, NOT NULL)
   - `reported_by`: UUID (FK -> users.id, NOT NULL)
   - `description`: TEXT NOT NULL
   - `status`: ENUM (`open`, `investigating`, `resolved`) DEFAULT `open`
   - `created_at`: TIMESTAMP DEFAULT NOW()

5. **`activity_log`**
   - `id`: UUID (Primary Key)
   - `actor_id`: UUID (FK -> users.id, NOT NULL)
   - `action`: VARCHAR(100) NOT NULL (e.g., `CREATE_TRUCK`, `DEACTIVATE_USER`)
   - `entity`: VARCHAR(50) NOT NULL
   - `entity_id`: UUID NOT NULL
   - `created_at`: TIMESTAMP DEFAULT NOW()

---

## 6. Standard Procedures (Skills S1 – S7)

When developing features, strictly follow these procedures:

- **S1: Add a Role-Protected Route**
  1. Register route path and allowed roles.
  2. Implement backend middleware verification (`authGuard` + `roleGuard`).
  3. Enforce frontend redirect for unauthenticated / unauthorized access.
  4. Test route against all 3 roles and guest state.

- **S2: Add a CRUD Resource**
  1. Define DB schema migration.
  2. Implement endpoints: `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `PATCH /:id/deactivate`.
  3. Validate all payload fields server-side with standard error responses.
  4. Emit an audit record into `activity_log`.
  5. Build corresponding desktop table / mobile card view with consistent styling.

- **S3: Scope Data by Owner**
  1. Filter all truck queries by `WHERE owner_id = req.user.id` unless `req.user.role === 'admin'`.
  2. Truck users are restricted to `truck_id === req.user.truckId`.
  3. Test that Owner A cannot view or manipulate Owner B's trucks via direct ID injection.

- **S4: Build a List View**
  1. Desktop: Tabular data with status badges and action menus.
  2. Mobile: Stacked cards preserving critical metadata.
  3. Search & filter controls at the top.
  4. Meaningful empty state (e.g., *"No trucks found. Add your first truck."*).

- **S5: Build a Form**
  1. Standard labels above inputs with explicit helper text.
  2. Inline validation errors indicating how to resolve issues.
  3. Disabled submit button during request in-flight.
  4. Clear action nomenclature (*"Add truck"*, *"Save truck"*).

- **S6: 3D Hero Scene**
  1. Lazy-load the Three.js canvas; render headline and Sign In immediately.
  2. Lightweight GLB model (< 1.5 MB) with ivory/white finish, gold accent line, and soft ground shadow.
  3. Animation sequence: 2.5s drive-in from left, idle bobbing + wheel rotation, scroll movement.
  4. Fallback: Respect `prefers-reduced-motion` (parked state) and low-power devices (static image).

- **S7: Demo Seed Data**
  - **1 Admin** (`admin@elitecold.com`)
  - **2 Owners** (`owner1@elitecold.com`, `owner2@elitecold.com`)
  - **6-8 Trucks** across statuses: Available, On trip, Maintenance (include 1 truck with expiring insurance/fitness).
  - **3 Truck Users / Drivers** assigned to respective vehicles.
  - Active and completed trips + sample reported issue.

---

## 7. Phased Implementation Roadmap

### Phase 1: Environment & Project Setup
- [ ] Initialize Next.js in `/frontend` with App Router, Tailwind CSS, and custom tokens from `design.md`.
- [ ] Initialize Express/NestJS in `/backend` with CORS, cookie-parser, and dotenv.
- [ ] Set up PostgreSQL connection, migration runner, and initial schema.
- [ ] Implement seed script (`npm run seed`) populating demo accounts and vehicles.

### Phase 2: Authentication & Authorization
- [ ] Endpoints: `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`.
- [ ] Passwords hashed with `bcrypt`, JWT stored in `httpOnly` secure cookie.
- [ ] Middleware guards for `Admin`, `TruckOwner`, and `TruckUser`.
- [ ] Login screen (`/login`) with automatic redirection based on user role.

### Phase 3: Hero Page & 3D Truck
- [ ] Public landing page at `/` with luxury styling and typography.
- [ ] React Three Fiber canvas with truck model and drive-in idle sequence.
- [ ] Fallback image for mobile/low-spec devices and reduced-motion support.

### Phase 4: Admin Dashboard
- [ ] Metrics cards: Total Owners, Total Trucks, Active Drivers, Trucks on Trip.
- [ ] CRUD interfaces for Owners, Trucks, and Truck Users with deactivation support.
- [ ] Search, filter, and Activity Log viewer.

### Phase 5: Truck Owner Fleet Portal
- [ ] Fleet overview with desktop table and mobile cards.
- [ ] Highlighting of expiring documents (permit, insurance, fitness) in red alert tags.
- [ ] Truck detail view with trip history and driver reassignment form.
- [ ] Status toggle (Available / Maintenance).

### Phase 6: Truck User Control Panel
- [ ] Mobile-first interface for assigned truck.
- [ ] Primary action toggles: "Start trip" / "End trip".
- [ ] Trip logging modal (origin, destination, cargo type, notes).
- [ ] Target cargo temperature manual control.
- [ ] Issue reporting and trip history review.

### Phase 7: Verification & QA
- [ ] Security testing: unauthorized route access, cross-tenant data leaks.
- [ ] Responsiveness pass at 360px viewport width.
- [ ] Keyboard navigation and accessibility contrast validation.
- [ ] Full end-to-end walk-through for all three personas.
