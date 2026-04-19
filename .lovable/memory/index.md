# Project Memory

## Core
- React, TS, Tailwind, shadcn/ui. Supabase Auth/DB/Realtime/Edge. @dnd-kit. Toss Payments.
- `check_ins` and `reservations` need REPLICA IDENTITY FULL for Realtime.
- Primary soft navy, teal accents. Status: Gray(Wait), Blue(Consult), Green(Treat), LtGray(Done), Red(No-show).
- Mobile-first public routes (queue check-in), Desktop-first admin dashboard.
- Mask phone numbers on staff UI. Check-ins delete at midnight; Customers persist.
- Persistent layout containers for loading states (no early returns) to prevent CLS.
- No route-based CSS splitting; rely on standard Tailwind CSS purging.

## Memories
- [Project Overview](mem://project/overview) — Queue & CRM system overview for Obliv Ose
- [Tech Stack](mem://tech/stack) — Framework and Supabase database specifics
- [Notifications](mem://features/notifications) — Current DB logging and future Solapi integration
- [Routing Structure](mem://routing/structure) — Mobile vs desktop route separation and dashboard tabs
- [Queue Management](mem://logic/queue-management) — Daily queue number generation logic
- [Admin Dashboard](mem://features/admin-dashboard) — Kanban board interactions and staff alerts
- [Customer Waiting](mem://features/customer-waiting) — Mobile waiting screen alert overlays and vibration
- [Internationalization](mem://features/i18n) — Korean/English UI and international phone inputs
- [Visual Design](mem://style/visual-design) — Color palette and status colors
- [Privacy Compliance](mem://constraints/privacy-compliance) — Consent, data masking, and deletion policies
- [Reservations](mem://features/reservations) — Slot-based booking and clinic time settings
- [Payments](mem://features/payments) — Manual payment entry and Toss POS integration
- [Customer DB](mem://features/customer-db) — Persistent customer records and history
- [Check-in Workflow](mem://logic/check-in-workflow) — QR logic, reservation matching, and Supabase RPCs
- [Data Model Alignment](mem://tech/data-model-alignment) — Nullable clinic settings and active staff fields
- [Performance & SEO](mem://constraints/performance-seo) — CSS, network hints, layout stability, and SEO rules
- [TM Module](mem://features/tm-module) — Telemarketing module: lead lists, call logging, recall alerts, bulk upload
