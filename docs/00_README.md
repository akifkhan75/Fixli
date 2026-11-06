# FIXLI — Product Documentation Pack

## Working product name
**Fixli**

**Tagline:** Get skilled help. Done right.

> Naming note: this is a product-name recommendation, not trademark/domain clearance. A legal trademark search, app-store search, domain check, and social-handle check must be completed before committing the brand.

## Product in one sentence
Fixli is a global mobile-first marketplace that uses AI to understand a customer's service problem, match them with trusted local professionals, coordinate scheduling and payment, provide live job visibility, and create a verified record of the work.

## Source of truth
The original concept supplied for this project is preserved in the PRD and feature-spec documents. The original concept includes AI matching, NLP service intake, severity classification, AR assistance, smart scheduling, verified worker profiles, pricing estimation, trust/safety, live tracking, emergency workflows, visual AI, chat, worker analytics, admin controls, and Gemini-powered service analysis.

## Documentation index
1. 01_PRD.md — master product requirements
2. 02_PRODUCT_STRATEGY.md — positioning, personas, competitive differentiation
3. 03_USER_FLOWS.md — end-to-end customer/provider/admin journeys
4. 04_FEATURE_SPEC.md — detailed functional requirements
5. 05_SYSTEM_ARCHITECTURE.md — production architecture
6. 06_DATA_MODEL.md — PostgreSQL/PostGIS domain model
7. 07_API_SPEC.md — backend API contract
8. 08_AI_SPEC.md — Gemini AI architecture, safety and evaluation
9. 09_TRUST_SAFETY_COMPLIANCE.md — verification, emergency, disputes, compliance
10. 10_PAYMENTS_MONETIZATION.md — marketplace payments and revenue
11. 11_REALTIME_NOTIFICATIONS.md — sockets, GPS, push and messaging
12. 12_ADMIN_OPERATIONS.md — operations/admin requirements
13. 13_SECURITY_PRIVACY.md — security and privacy requirements
14. 14_QA_TEST_PLAN.md — QA, automation, UAT and release gates
15. 15_ROADMAP.md — phased launch roadmap
16. 16_ANALYTICS.md — event taxonomy and KPIs
17. 17_GLOBALIZATION.md — internationalization/localization strategy
18. 18_ANTIGRAVITY_MASTER_PROMPT.md — master implementation prompt for Gemini/Antigravity
19. 19_AGENT_ENGINEERING_RULES.md — rules for AI coding agents
20. 20_RELEASE_CHECKLIST.md — production launch checklist
21. 21_PRODUCTION_AUDIT_HARDENING.md — production readiness audit & hardening
22. 22_UX_UI_AUDIT_AND_REDESIGN_PLAN.md — UX/UI redesign, design system & smart forms
23. 23_TRIPLY_UI_UX_REDESIGN_PLAN.md — premium redesign instructions
24. 24_IMPLEMENTATION_AUDIT_AND_PLAN.md — implementation audit and phase-wise build plan
25. 25_OWNER_DECISIONS.md — living list of owner decisions and open questions
26. 26_COMPREHENSIVE_PENDING_PLAN.md — master plan for all pending items & edge cases

## Recommended technology direction
- Mobile: React Native + Expo + TypeScript
- API: NestJS + TypeScript
- Database: PostgreSQL + PostGIS
- Cache/queues: Redis
- Realtime: WebSockets/Socket.IO
- Object storage: S3-compatible storage
- Search: PostgreSQL/PostGIS initially; dedicated search only when scale requires it
- AI: Gemini via a backend AI gateway
- Payments: marketplace PSP abstraction with Stripe Connect where supported plus regional providers
- Maps/routing: provider abstraction supporting Google Maps or Mapbox
- Notifications: FCM/APNs plus SMS/WhatsApp/email provider abstraction
- Admin: web application, separate from customer/provider mobile UX
- Observability: OpenTelemetry + structured logs + error monitoring
- CI/CD: GitHub Actions
- Deployment: containerized services

## Critical implementation principle
Do not let the AI agent invent business rules while coding. All state transitions, permissions, fees, cancellation rules, verification states, payment states, and safety rules must be explicit in the backend domain layer.
