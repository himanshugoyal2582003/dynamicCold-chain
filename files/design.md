# Design

## Brief
A white, classic, elite-looking site. The hero shows a 3D truck moving with a calm, refined animation. Everything else stays quiet so the truck is the one memorable thing. The admin, owner, and truck user screens use the same look but are built for work: clear, dense where needed, never decorative.

## Direction
Private-bank stationery meets a luxury logistics house: generous white space, fine type, restrained color, slow deliberate motion.

## Color tokens
| Name | Hex | Use |
|---|---|---|
| Paper | #FFFFFF | Page background |
| Ivory | #F7F6F3 | Panels, table headers, alternate sections |
| Ink | #14171C | Headings, body |
| Slate | #5B6470 | Secondary text |
| Hairline | #E3E1DC | Borders, dividers |
| Gold | #B08D3C | Single accent: key lines, active states, focus |

Status colors, always paired with a text label:
- Available #2E7D5B · On trip #2F5D8A · Maintenance #C9962B · Issue or expired #A3262A

## Type
- Display: a high-contrast classic serif (Cormorant Garamond or Playfair Display), light to regular weight.
- Body and UI: a clean sans (Inter or Manrope), 16 px, line-height 1.6.
- Tables and numbers: tabular figures.
- Scale: 14 / 16 / 20 / 28 / 44 / 72. Body lines under 70 characters.

## Hero
White page. A 3D refrigerated truck sits centered, three-quarter angle, rolling slowly along a thin Hairline road with a soft ground shadow.

```
+--------------------------------------------------+
|  Logo                                   Sign in  |
|                                                  |
|        Every truck in your fleet,                |
|        in one clear view.                        |
|        [ Sign in ]                               |
|                                                  |
|     ____________________________                 |
|    |  [3D truck, moving right]  |==>              |
|  ----------------------------------- road ------ |
+--------------------------------------------------+
```

- Left-aligned headline; truck spans the width below it.
- Copy is plain and says what the product does for a fleet owner.

## Truck animation
- Tech: Three.js through React Three Fiber.
- Model: low-poly GLB under 1.5 MB, white and ivory body, thin gold stripe, matte tires.
- Load: truck drives in from the left (about 2.5 s, ease-out), then idles: wheels spin, slight body bob, road lines scroll.
- Scroll: the truck keeps moving forward and the camera pans a little. Scroll is the only other trigger.
- Lighting: soft studio light, one directional shadow.
- A thin gold line draws behind the truck as it moves.

## Other motion
One orchestrated load sequence only. No fade-up on every section, no hover wobble. Motion is allowed for feedback: opening a panel, saving, switching tabs.

## App screens (admin, owner, truck user)
- Shell: slim left navigation on desktop, bottom tab bar on mobile. Ivory background for panels, Hairline borders, one 4 px radius, no shadows.
- Admin overview: four count tiles (owners, trucks, users, trucks on trip), then a recent activity list.
- Lists: table on desktop, cards on mobile, search and filters on top, status badge in each row.
- Owner truck list: number plate as the row title, then type, capacity, status, assigned user, last update. Expiring documents show a red label with the date.
- Truck detail: info on the left, trip history on the right, edit and assign actions at the top.
- Truck user control panel: mobile first. One large primary action at a time (Start trip or End trip), truck info above it, report issue and target temperature below, trip history last.

## Copy rules
Sentence case, active verbs, plain words. Buttons say what happens: Add truck, Save truck, Start trip, End trip. Confirmations reuse the action name: "Truck saved." Errors say what failed and how to fix it. Empty states say what to do next.

## Quality floor
- Responsive down to 360 px; on weak devices the 3D scene falls back to a static image.
- `prefers-reduced-motion`: truck stays parked, no scroll animation.
- Visible keyboard focus (2 px Gold outline), AA contrast or better.
- Lazy-load the 3D scene; the hero text is readable before the model loads.
