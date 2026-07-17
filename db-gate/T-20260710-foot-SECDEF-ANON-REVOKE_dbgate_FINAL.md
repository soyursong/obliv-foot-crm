# DB-GATE 증거 — T-20260710-foot-SECDEF-ANON-REVOKE (재baseline v2, 2026-07-18)

> **v1 폐기(2026-07-10).** v1 증거는 anon **119→14** baseline 위에 작성됐으나, supervisor DB-GATE
> 독립 재검증(2026-07-18)에서 현 prod anon=**33** 으로 확인 = v1 baseline **stale·prod drift**.
> 본 v2 는 **현 prod 실측(Management API, ref rxlomoozakkjesdqjtvd, 2026-07-18)** 으로 전면 재작성한다.
>
> **판정: 본 마이그 CLOSE-AS-SUPERSEDED 권고.** 핵심 보안목표(default-deny + Tier-A 회수)는 더 넓고
> 최신인 별도 sweep 으로 **이미 달성**됨. 원안 마이그(whitelist 14)를 지금 적용하면 **회귀**(live
> self-checkin 함수 회수 → 셀프체크인 파손). 잔여 유효 항목 = §5 supabase_admin default-priv 1줄뿐.
>
> 재현: scripts/T-20260710-foot-SECDEF-ANON-REVOKE_rebaseline_probe.mjs +
>       scripts/T-20260710-foot-SECDEF-ANON-REVOKE_usage_analysis.mjs (전 read-only, prod 무변경).

---

## §0 요약 (supervisor FIX-REQUEST 4조건 대응)

| FIX 조건 | 결과 |
|----------|------|
| **1) 현 prod baseline 재측정(anon 33)으로 증거 전면 재작성 — 119 baseline 폐기** | ✅ §1. anon **33** / authenticated **142** / service_role **144** / postgres **144**. 07-10 119 baseline 폐기. |
| **2) whitelist 를 현 prod 실측 + pg_stat_statements(anon) 대조로 재도출 — live self-checkin/reservation 회수 금지** | ✅ §2·§3. 현 anon-33 은 **전부 self-service CLASS**. 그중 **12개가 live**(self_checkin_lookup·get_today_reservations 포함). 원안 whitelist 14 는 이 중 2개 live 회수 + 19개 구조필수 회수 = **파손**. |
| **3) SUPERSEDED 검토 — 핵심 보안목표 달성 여부 → 잔여 delta / close-as-superseded** | ✅ §4. default-deny(postgres 경로) + Tier-A 회수 **이미 달성**. money/Tier-A 함수 anon-grant **0건**. 잔여 postgres-경로 delta **없음** → **close-as-superseded 권고**. planner 스코프 재확정 요청(FOLLOWUP). |
| **4) §5 supabase_admin default-priv 하드닝(anon 잔존) 여전히 유효 → supervisor 상위권한 집행** | ✅ §5. pg_default_acl supabase_admin 경로 **anon=X 잔존 확인**. supervisor 상위권한 집행 항목으로 유지(유일 잔여). |

---

## §1 proacl 3자 대조 — v1 증거(07-10) vs 현 prod(07-18)

Management API has_function_privilege(role, oid, 'EXECUTE') count over pg_proc(schema=public).

| role | v1 증거 BEFORE (07-10) | **현 prod NOW (07-18)** | 원안 마이그 target | 판정 |
|------|----------------------|------------------------|-------------------|------|
| **anon** | 119 | **33** | 14 | v1 baseline(119) **stale**. 현 33 = 별도 sweep 산출 |
| authenticated | 133 | **142** | 무접촉 | drift +9 |
| service_role | 135 | **144** | 무접촉 | drift +9 |
| postgres | 135 | **144** | 무접촉 | drift +9 |
| total funcs (public) | — | **144** | — | postgres=service_role=total=144 |
| anon transfer_package_atomic (Tier-A) | TRUE (라이브 홀) | **FALSE (이미 봉합)** | false | 핵심목표 **이미 달성** |

→ v1 의 119→14 baseline 은 현 prod(33)와 불일치 = **v1 증거 무효**. 본 v2 로 대체.

---

## §2 현 prod anon-EXECUTE 33개 — 전부 self-service CLASS

현 anon-33 함수는 **money/Tier-A 0건**, 전량 self-checkin·health-q·reservation intake CLASS
(= AC1 정당 CLASS ①셀프체크인 ②문진 ③공개 예약/조회). 즉 **이미 정제된 whitelist** 상태.

money/Tier-A 잔존 확인 쿼리 결과:
```
proname ~ 'package|refund|payment|transfer|consume|deduct|calc_refund' AND anon EXECUTE  ->  0 rows
```
→ RLS-우회 급성 표면(돈-함수 anon 노출) **이미 봉합됨**. 전체 33개 목록: §3 표.

---

## §3 whitelist 재도출 — 현 prod 실측 + pg_stat_statements(anon) 대조

pg_stat_statements (stats_reset **2026-04-19**, 관측창 **~89일**), pg_roles.rolname='anon' 필터.

| # | 함수 | anon 호출(~89d) | 상태 | 원안 whitelist? |
|---|------|-----------------|------|----------------|
| 1 | fn_selfcheckin_today_reservations | **7830** | ★LIVE | ✅ |
| 2 | fn_health_q_validate_token | **406** | ★LIVE | ✅ |
| 3 | fn_selfcheckin_reservation_banner | **245** | ★LIVE | ✅ |
| 4 | fn_selfcheckin_dup_guard | **199** | ★LIVE | ✅ |
| 5 | fn_health_q_submit | **196** | ★LIVE | ✅ |
| 6 | self_checkin_with_reservation_link | **179** | ★LIVE | ✅ |
| 7 | fn_selfcheckin_create_health_q_token | **157** | ★LIVE | ✅ |
| 8 | fn_selfcheckin_rrn_match | **121** | ★LIVE | ✅ |
| 9 | fn_selfcheckin_update_personal_info | **111** | ★LIVE | ✅ |
| 10 | next_queue_number | **111** | ★LIVE | ✅ |
| 11 | **self_checkin_lookup** | **34** | ★LIVE | ❌ **누락 → 회수 시 파손** |
| 12 | **get_today_reservations** | **5** | ★LIVE | ❌ **누락 → 회수 시 파손** |
| 13 | fn_complete_prescreen_checklist | 0 | idle(구조필수) | ✅ |
| 14 | fn_prescreen_start | 0 | idle(구조필수) | ✅ |
| 15 | fn_selfcheckin_create_check_in | 0 | idle(구조필수) | ❌ 누락 |
| 16 | fn_selfcheckin_upsert_customer | 0 | idle(구조필수) | ❌ 누락 |
| 17 | fn_selfcheckin_upsert_customer_resolve_v2 | 0 | idle(구조필수) | ❌ 누락 |
| 18 | fn_selfcheckin_upsert_customer_resolve_v3 | 0 | idle(구조필수) | ❌ 누락 |
| 19 | fn_selfcheckin_find_customer | 0 | idle(구조필수) | ❌ 누락 |
| 20 | fn_selfcheckin_match_reservation | 0 | idle(구조필수) | ❌ 누락 |
| 21 | fn_selfcheckin_existing_checkin_today | 0 | idle(구조필수) | ❌ 누락 |
| 22 | fn_selfcheckin_linked_checkin | 0 | idle(구조필수) | ❌ 누락 |
| 23 | self_checkin_create | 0 | idle(구조필수) | ❌ 누락 |
| 24 | reservation_to_checkin | 0 | idle(구조필수) | ❌ 누락 |
| 25 | batch_checkin | 0 | idle(구조필수) | ❌ 누락 |
| 26 | find_customer_by_phone | 0 | idle(구조필수) | ❌ 누락 |
| 27 | upsert_reservation_from_source | 0 | idle(구조필수) | ❌ 누락 |
| 28 | fn_reservation_dup_guard | 0 | idle(구조필수) | ❌ 누락 |
| 29 | fn_health_q_create_token | 0 | idle(구조필수) | ❌ 누락 |
| 30 | fn_dashboard_reissue_health_q_token | 0 | idle(구조필수) | ❌ 누락 |
| 31 | fn_check_in_slot_dwell | 0 | idle(구조필수) | ❌ 누락 |
| 32 | get_or_create_unified_customer_id | 0 | idle(구조필수) | ❌ 누락 |
| 33 | enqueue_dopamine_reschedule | 0 | idle(구조필수) | ❌ 누락 |

### ★ 회귀 리스크 실증 (원안 마이그 적용 시)
- **21개 함수 anon EXECUTE 상실**. 그중 **live 2개**(self_checkin_lookup 34 / get_today_reservations 5) → 42501 = **셀프체크인 조회 / 오늘예약 조회 파손**.
- 나머지 19 idle(0호출)은 대부분 self-checkin write-path 구조필수 — stat 0 은 SECURITY DEFINER definer-chain(호출자 EXECUTE 불검사) 또는 저빈도 분기(신규고객 최초등록 등) 가능성. 회수 시 **저빈도 분기 사일런트 파손** = 본건 WARN 리스크.
- 원안 whitelist 는 is_approved_user()·current_user_is_admin_or_manager() 를 anon 에 **부여**하려 하나 현 prod 는 이 2함수 anon **미부여**(anon_exec=false 실측) → anon 표면 **역방향 확장**.
- 원안 whitelist 근거(외부앱 HEAD ee3b78f grep, 07-10) 8일 경과·prod drift 로 **stale**. "앱 직접호출 0/레거시" 주장이 현 prod 실측(deliberate grant + live 호출)과 **모순**.

---

## §4 SUPERSEDED 판정 — 핵심 보안목표 이미 달성

| 마이그 핵심 목표 | 현 prod 상태 | 판정 |
|-----------------|-------------|------|
| default-deny (postgres 창조경로 신규상속 차단) | pg_default_acl postgres 경로 = {postgres, authenticated, service_role} — **PUBLIC·anon 이미 제거** | ✅ 달성 (마이그 step1 = no-op) |
| Tier-A 돈-함수 anon 회수 | transfer_package_atomic anon=FALSE + money-func anon-grant **0건** | ✅ 달성 |
| 소급 anon 표면 축소 | anon 119 → **33** (전량 self-service CLASS) | ✅ 별도 sweep 으로 달성 |

→ 원안 마이그의 postgres-경로 잔여 delta = **없음**. 유일 잔여 = §5 supabase_admin 경로.
→ **CLOSE-AS-SUPERSEDED 권고.** planner 스코프 재확정 필요(FOLLOWUP).

---

## §5 잔여 유효 항목 — supabase_admin default-priv (supervisor 상위권한)

pg_default_acl 실측:
```
grantor=postgres       acl={postgres=X, authenticated=X, service_role=X}          <- anon 이미 제거 OK
grantor=supabase_admin acl={postgres=X, anon=X, authenticated=X, service_role=X}  <- anon=X 잔존 (!)
```
supabase_admin 창조경로 신규 함수는 anon 이 default 로 EXECUTE 상속 = 잔여 신규상속 홀.
postgres 권한으로 변경 불가(42501 실측). **supervisor 상위권한 1줄 집행 요망**:
```sql
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
```
(실무상 앱/마이그 함수는 전부 postgres 창조 → 급성 리스크 아님. 완결성 위해 유지.)

---

## §6 재현 스크립트 (전 read-only, prod 무변경)

- scripts/T-20260710-foot-SECDEF-ANON-REVOKE_rebaseline_probe.mjs — §1 counts·§5 default_acl·anon-33 목록·Tier-A·pg_stat_statements meta.
- scripts/T-20260710-foot-SECDEF-ANON-REVOKE_usage_analysis.mjs — §3 anon-33 × pg_stat_statements(anon) 호출수 대조.
- 전송: Supabase Management API POST /v1/projects/rxlomoozakkjesdqjtvd/database/query (PAT). 스크린샷 N/A(db_only).

net: prod DB write **0** (전 SELECT/introspection). 마이그 apply **안 함**.
