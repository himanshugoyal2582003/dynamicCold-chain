# Requirements — Cold-Chain Fleet Platform (Phase 1)

Team Elite Avengers · GLA University, Mathura · 2026–27

## 1. Scope for now
Phase 1 is a web app only: a hero page, an admin page, a truck owner area with a list of trucks, and a control panel for truck users.

**Removed from this phase:** IoT hardware (ESP32, DHT22, MQTT), AI/ML shelf-life prediction, and route optimization. They can return in a later phase; the data model leaves room for them.

## 2. Roles
| Role | Who | Can do |
|---|---|---|
| Admin | Platform operator | Manage owners, trucks, users, and settings |
| Truck owner | Fleet owner | See and manage their own trucks and assigned users |
| Truck user | Driver or operator of one truck | Use the control panel for the truck assigned to them |

## 3. Functional requirements

### Public
| ID | Requirement | Acceptance check |
|---|---|---|
| FR-1 | Hero page with a 3D moving truck, product summary, sign-in button | Loads and animates; readable before the 3D model loads |

### Authentication
| ID | Requirement | Acceptance check |
|---|---|---|
| FR-2 | Sign in with email and password; role decides the landing page | Admin, owner, and truck user land on their own pages |
| FR-3 | Sign out; protect every non-public route | Direct URL access without login redirects to sign in |

### Admin page
| ID | Requirement | Acceptance check |
|---|---|---|
| FR-4 | Overview: total owners, trucks, users, trucks by status | Counts match the data |
| FR-5 | Create, edit, deactivate truck owners | Changes appear in the owner list |
| FR-6 | Create, edit, deactivate trucks and assign them to an owner | Truck shows under the right owner |
| FR-7 | Create, edit, deactivate truck users and assign each to a truck | User sees only that truck |
| FR-8 | Search and filter by owner, status, truck type | Results update as filters change |
| FR-9 | Activity log of admin actions | Each change is listed with who and when |

### Truck owner area
| ID | Requirement | Acceptance check |
|---|---|---|
| FR-10 | List of the owner's trucks as cards or a table: number plate, type, capacity, status, assigned user, last update | Only the owner's trucks appear |
| FR-11 | Truck detail page with full info and document dates (insurance, permit, fitness) | Expiring documents are flagged |
| FR-12 | Add and edit their trucks; assign or change the truck user | Saved and shown in the list |
| FR-13 | Set a truck's status: available, on trip, maintenance | Status badge updates |

### Truck user control panel
| ID | Requirement | Acceptance check |
|---|---|---|
| FR-14 | Shows the assigned truck's info and current status | Matches the owner's data |
| FR-15 | Start trip, end trip, report issue | Status and trip history update |
| FR-16 | Log trip details: origin, destination, cargo type, notes | Entry appears in trip history |
| FR-17 | Set a target temperature for the cargo (manual setting, no sensors) | Value saved and shown |
| FR-18 | View own trip history | Lists past trips for that truck |

## 4. Non-functional requirements
- Responsive from 360 px up; the truck user panel must work well on a phone.
- Role checks enforced on the server, not only in the UI.
- Passwords hashed; no secrets in Git.
- Accessible: visible keyboard focus, AA contrast, reduced-motion respected.
- Hero loads fast: 3D scene is lazy-loaded with a static fallback.

## 5. Data (summary)
Users, Trucks, Trips, Issues, ActivityLog. Details in `implementation_plan.md`.

## 6. Assumptions
- "Truck user" means the driver or operator assigned to one truck. Tell us if you meant something different.
- Truck data is entered manually; no live tracking in this phase.

## 7. Out of scope
IoT sensors, ML prediction, route optimization, live GPS, payments, notifications by SMS.
