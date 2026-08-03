# T-20260803-meta-FOOT-LEGACY-SECRET-DISABLE-XCRM-ROTATE-AUDIT — Blast-Radius Audit

**Lead:** dev-foot (dispatch) · **Date:** 2026-08-03 · **risk:** GO_WARN · **db_change:** false · **ef_only**
**Disable event:** foot CRM (rxlomoozakkjesdqjtvd) legacy API keys DISABLED **2026-08-02T16:29:34.393Z**

---

## AC2 실측 — hard evidence

| test | key | target | result |
|---|---|---|---|
| direct data-plane | legacy anon (eyJ…, len208) | foot `/rest/v1/clinics` | **401 "Legacy API keys are disabled"** |
| direct data-plane | legacy service_role (eyJ…, len219) | foot `/rest/v1/clinics` | **401 "Legacy API keys are disabled"** |
| data-plane | NEW sb_secret / sb_publishable | foot `/rest/v1` | 200 ✓ |
| functions gateway | legacy anon (well-formed JWT) Bearer | foot `reservations-read-api` | reached EF (EF-auth `UNAUTHORIZED`), **not** gateway-rejected |
| functions gateway | malformed JWT | foot `reservations-read-api` | gateway `UNAUTHORIZED_INVALID_JWT_FORMAT` |

**Key finding:** legacy disable enforces on the **data-plane** (PostgREST/Storage/Auth) only. The **Edge-Functions gateway still accepts a well-formed (but disabled) legacy JWT** as a Bearer. ⇒ *direct-REST cross-project clients break; secret-header proxy consumers do not.*

## AC1 enumeration + AC2 verdict — dopamine (tm-flow) consumers of foot CRM

| # | consumer | credential | mechanism | live | verdict |
|---|---|---|---|---|---|
| 1 | **visit-pullsync-reconcile** domain=foot | `FOOT_CRM_SERVICE_ROLE_KEY` via `createFootCrmClient()` | direct data-plane `.from()` | **pg_cron ACTIVE** (jobid19 30m, jobid20 5m) | **🔴 BROKEN (P0)** |
| 2 | global-search / crm-fanout.ts foot leg | `FOOT_CRM_SERVICE_ROLE_KEY` / `FOOT_SERVICE_ROLE_KEY` | direct data-plane `createClient` | on-demand | 🟠 BROKEN (degraded, silent skip) |
| 3 | solapi-delivery-report foot leg | `FOOT_CRM_SERVICE_ROLE_KEY` | direct data-plane `createClient` | Solapi webhook | 🟠 BROKEN (foot delivery-status write-back lost) |
| 4 | _shared/crm-client.ts `createFootCrmClient()` | `FOOT_CRM_SERVICE_ROLE_KEY` | direct data-plane factory | (feeds #1) | 🔴 broken root helper |
| 5 | crm-counselor-stats-proxy foot leg | `FOOT_STATS_ROLE_KEY ?? FOOT_CRM_SERVICE_ROLE_KEY` | direct data-plane | live | 🟢 **FIXED** (root-cause hotfix, new key) |
| 6 | foot-reservations-proxy | `FOOT_SUPABASE_ANON_KEY` Bearer + `FOOT_READ_SECRET` | fn-gateway + secret | live (예약 read) | 🟢 NOT broken (gateway accepts legacy JWT) |
| 7 | foot-direct-cal-read | `FOOT_SUPABASE_ANON_KEY` Bearer + `FOOT_CALENDAR_READ_SECRET` | fn-gateway + secret | live (캘린더 read) | 🟢 NOT broken |
| 8 | reconciliation-cron foot leg | FOOT_READ_URL/SECRET/ANON (read-proxy) | fn-gateway + secret | cron | 🟢 NOT broken |
| 9 | match-crm-user foot leg | `FOOT_READ_SECRET` / `FOOT_INBOUND_SECRET` | fn-gateway + secret | live | 🟢 NOT broken |

**Foot-side (obliv-foot-crm own EFs):** CLEAN. Platform re-injected NEW keys 08-02 (`SUPABASE_SERVICE_ROLE_KEY`=new sb_secret, `SUPABASE_ANON_KEY`=new sb_publishable). `closing-confirmed-publisher` `FOOT_SERVICE_ROLE_KEY ?? SUPABASE_SERVICE_ROLE_KEY` → falls back to new platform key. No foot code change required.

## EF-secret digest evidence (dopamine store, `supabase secrets list`)

| secret | digest | upd | verdict |
|---|---|---|---|
| FOOT_CRM_SERVICE_ROLE_KEY | `c1a275ae…` | 07-17 | ≠ new → **LEGACY/disabled** |
| FOOT_SUPABASE_ANON_KEY | `a8958563…` | 05-21 | ≠ new → LEGACY (gateway-harmless) |
| FOOT_STATS_ROLE_KEY | `75c9d8b9…` | 08-03 | **== new foot sb_secret** (working) |

New foot canonical svc digest = `75c9d8b9…af1e` (foot `.env.local` sb_secret, verified 200).

## P0 proof — visit-pullsync-reconcile foot leg silent-broken

Live cron responses (dopamine `net._http_response`, HTTP 200, cron reports "succeeded"):
`scanned:606, matched_by_resv_id:0, matched_by_phone:0, unmatched:606, applied.visited:0, errors:0` — **0/606 matched, every run, since disable.** `errors:0` because `const {data}=await crm.from(...)` discards the 401 → null → unmatched (silent).

End-to-end disproof of "always zero": 3 foot cue_cards' `crm_reservation_id` tested against foot CRM:
- **NEW key** → rows returned; `f99bfbd6…` = **status `checked_in`, reservation_date 2026-08-03 (visited TODAY)** — visited_at NOT stamped in dopamine.
- **LEGACY key** (what pullsync sends) → `"Legacy API keys are disabled"`.

Impact: foot 내원(visited) attribution + reserved backfill in dopamine down since 2026-08-02 16:29 UTC (~1.5 days). Silent (HTTP 200 / cron green).

## AC3 remediation (dopamine-side — dev-dopamine owns; supervisor parity gate)

New canonical foot service secret is **already provisioned** in dopamine store as `FOOT_STATS_ROLE_KEY` (= new sb_secret). Recommended:
- **Fast stop-bleed (Option B):** overwrite dopamine EF secret `FOOT_CRM_SERVICE_ROLE_KEY` value → new sb_secret. Zero code deploy; instantly fixes #1–#4. (Optionally `FOOT_SUPABASE_ANON_KEY` → new sb_publishable for hygiene; functionally moot.)
- **Durable (Option A, ADDITIVE, ticket-preferred, hotfix-d9b81dec-isomorphic):** code `Deno.env.get(NEW) ?? Deno.env.get("FOOT_CRM_SERVICE_ROLE_KEY")` at 3 sites — crm-client.ts:64, crm-fanout.ts:63 keyEnvs, solapi-delivery-report.ts:85 — then redeploy. `NEW` may reuse `FOOT_STATS_ROLE_KEY` or a dedicated `FOOT_CRM_SECRET_KEY`.

## AC4 verification (post-swap, supervisor gate=parity)
- Re-invoke visit-pullsync foot: expect `matched_by_resv_id`/`matched_by_phone` > 0, `applied.visited` > 0.
- crm-fanout foot leg + solapi foot leg: expect non-empty rows.
- No touch: foot data/schema, 도수(body) leg. Cross-ref only with T-20260722-foot-DBPASS-ROTATE (DB superuser pw = different axis; no duplicate rotation).

---

## ADDENDUM 2026-08-03 — dopamine swap 회신 대사 + foot-side clean 하드검증 (dev-foot)

**Trigger:** MSG-20260803-213038-pmah (dev-dopamine FOLLOWUP) — dopamine EF 3 소비처 Option A swap 완료 commit `5e1ff2d5`(main).

### 1. dopamine swap ↔ 본 audit 권고 정합 (일치)
| 항목 | audit 권고(§AC3 Option A, line 61) | dopamine 적용(5e1ff2d5) | 정합 |
|---|---|---|---|
| createFootCrmClient() (crm-client.ts) | `NEW ?? FOOT_CRM_SERVICE_ROLE_KEY` | `FOOT_STATS_ROLE_KEY ?? FOOT_CRM_SERVICE_ROLE_KEY` | ✅ |
| crm-fanout.ts foot keyEnvs | 3-키 우선순위 | `[FOOT_STATS_ROLE_KEY, FOOT_CRM_SERVICE_ROLE_KEY, FOOT_SERVICE_ROLE_KEY]` | ✅ |
| solapi-delivery-report foot | keyEnv+fallback | `FOOT_STATS_ROLE_KEY` + fallback `[FOOT_CRM_SERVICE_ROLE_KEY]` | ✅ |
| NEW 키 선택 | "may reuse FOOT_STATS_ROLE_KEY" | FOOT_STATS_ROLE_KEY(캐논 sb_secret 75c9d8b9) 재사용 | ✅ |
| ADDITIVE·durable | Option A 선호 | Option A 채택(B 미채택, code-path swap) | ✅ |
| NOT-broken 경로(#6~9) 미접촉 | 접촉 금지 | foot-reservations-proxy/foot-direct-cal-read/reconciliation-cron/match-crm-user 미접촉 확인 | ✅ |

dopamine 적용은 본 audit의 Option A 권고와 **완전 정합**. 도메인 격리 준수(foot repo 무접촉, dopamine 소비처는 dopamine 소유).

### 2. Foot-side own EF = CLEAN — 하드검증(§34 assertion 실측 확정)
`supabase secrets list`(foot store rxlomoozakkjesdqjtvd, 2026-08-03 실측):
- `FOOT_SERVICE_ROLE_KEY` = **부재(unset)** → `closing-confirmed-publisher`의 `FOOT_SERVICE_ROLE_KEY ?? SUPABASE_SERVICE_ROLE_KEY` 는 nullish-coalesce로 **2항으로 낙하**.
- `SUPABASE_SERVICE_ROLE_KEY` digest = `75c9d8b9…af1e`(=NEW sb_secret), updated **2026-08-02T09:48** (플랫폼 재주입).
- `FOOT_SB_SECRET_KEY`·`CRM_SERVICE_ROLE_KEY` 도 동일 digest `75c9d8b9`.

⇒ foot 자기 EF는 신규 플랫폼 키로 정상 해석. **foot repo 코드 변경 0건** (§34 assertion을 하드 evidence로 확정). `??` 순서 latent risk 없음(1항 unset이라 2항 고정).

### 3. 잔여 게이트 (dev-foot 소유 아님)
- **AC4 parity(post-swap 재검증)** → **supervisor** (dopamine 위임 + audit §63 배정). visit-pullsync foot matched>0 / applied.visited>0, crm-fanout·solapi foot leg non-empty.
- **EF 3종 deploy** → supervisor (dopamine 위임).
- dev-foot 액션: **CLOSED** (audit + swap 정합 대사 + foot-side clean 하드검증 완료). foot repo commit/deploy 불요.
