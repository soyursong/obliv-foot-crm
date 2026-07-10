# T-20260710-foot-SECDEF-ANON-REVOKE — DB 게이트 FINAL (supervisor 집행 입력값)

> dev-foot. **FIX-REQUEST(MSG-20260710-224216-xxu3, qa_fail=phase1 spec_missing) 대응 증빙 패키지.**
> 본 문서 = supervisor DB-GATE **입력값(gate input)**. dev-foot 는 prod 무변경 read-only + BEGIN..ROLLBACK dry-run 만 수행(**prod write 0**). **apply·COMMIT·상위권한(supabase_admin) 집행은 supervisor.**
> 가역 anon-tightening(스키마 무변경·proacl 권한 메타만·rollback SQL 동봉) → autonomy §3.1 대표 게이트 면제(planner 판정 유효). 데이터 무손실.
> 마이그: `supabase/migrations/20260710223000_secdef_anon_execute_revoke_allowlist.sql` (+ `.rollback.sql`).
> 증거 재현 스크립트: `db-gate/*_dryrun_proacl.sql` · `*_func_e2e_anon.sql` · `*_tierA_denial.sql` (Management API BEGIN..ROLLBACK, prod ref `rxlomoozakkjesdqjtvd`, 2026-07-10).

## 게이트 진행 상태

| # | supervisor DB-GATE 요구 (FIX-REQUEST) | 상태 |
|---|----------------------------------------|------|
| 1 | proacl 3자 대조 + anon 119→14 + authenticated/service_role/postgres EXECUTE 무손실 (AC2 정정 최우선) | ✅ **PASS** (§1) |
| 2 | 화이트리스트 14 정확 시그니처 재부여 (오버로드 대비) | ✅ **PASS** (§2) |
| 3 | Tier-A anon 무호출 증거 (pg_stat_statements 30–90d) | ✅ **PASS** (§3, ~82d 0건) |
| 4 | staging E2E — 공개/셀프서비스(예약·체크인·문진) + 스태프 경로 정상 | ✅ **PASS** (§4, anon-role 기능 dry-run) |
| 5 | supabase_admin default-priv 하드닝 1줄 (postgres 42501 불가) | ⏳ **supervisor 상위권한 집행 대기** (§5) |

---

## §1 — proacl 3자 대조 (적용 전 / 후(dry-run) / 마이그 선언) ★AC2 정정 최우선

**측정 방법**: `has_function_privilege(role, oid, 'EXECUTE')` 전수 count, prod ref `rxlomoozakkjesdqjtvd`.
BEFORE=현 prod 실측(마이그 미적용). AFTER=전체 마이그를 `BEGIN..ROLLBACK` dry-run 내 측정(prod 무변경).

| role | BEFORE (현 prod) | AFTER (dry-run) | 마이그 선언 | 판정 |
|------|------------------|-----------------|-------------|------|
| **anon** | **119** | **14** | 14 (GRANT 14개) | ✅ 119→14 일치 |
| **authenticated** | 133 | **133** | 무접촉 | ✅ **무손실** |
| **service_role** | 135 | **135** | 무접촉 | ✅ **무손실** |
| **postgres** | 135 | **135** | 무접촉 | ✅ **무손실** |

- **AC2 정정 검증(최우선 항목)**: 마이그가 `REVOKE ... FROM PUBLIC, anon` 을 수행(원안 `FROM anon` 단독은 프로드 no-op — anon 이 PUBLIC 멤버). PUBLIC 회수에도 **authenticated/service_role/postgres 는 각자 명시 grant 보유 → 3자 모두 EXECUTE count 무변동(133/135/135)**. → planner 가 상향한 "PUBLIC 접촉 시 연쇄 파괴 미발생" 주장이 적용 전/후 proacl 로 **실증됨**. AC2 안전목표(스태프/EF 무접촉) 준수.
- 재현: `db-gate/T-20260710-foot-SECDEF-ANON-REVOKE_dryrun_proacl.sql`.

## §2 — 화이트리스트 14 정확 시그니처 재부여 (오버로드 대비)

dry-run AFTER 상태에서 `has_function_privilege('anon',...)=TRUE` 인 함수 **정확히 14개**, identity-args 포함(오버로드 안전):

| # | class | 함수(정확 sig, prod 실측) |
|---|-------|---------------------------|
| 1 | WL-문진 | `fn_health_q_submit(p_token text, p_form_data jsonb, p_storage_path text)` |
| 2 | WL-문진 | `fn_health_q_validate_token(p_token text)` |
| 3 | WL-사전문진 | `fn_prescreen_start(p_check_in_id uuid)` |
| 4 | WL-사전문진 | `fn_complete_prescreen_checklist(p_check_in_id uuid, p_checklist_data jsonb, p_storage_path text)` |
| 5 | WL-셀프체크인 | `fn_selfcheckin_create_health_q_token(p_check_in_id uuid, p_clinic_id uuid, p_lang text)` |
| 6 | WL-셀프체크인 | `fn_selfcheckin_dup_guard(p_clinic_id uuid, p_customer_id uuid, p_phone text, p_today date)` |
| 7 | WL-셀프체크인 | `fn_selfcheckin_reservation_banner(p_clinic_id uuid, p_phone text)` |
| 8 | WL-셀프체크인 | `fn_selfcheckin_rrn_match(p_check_in_id uuid, p_clinic_id uuid)` |
| 9 | WL-셀프체크인 | `fn_selfcheckin_today_reservations(p_clinic_id uuid, p_date date)` |
| 10 | WL-셀프체크인 | `fn_selfcheckin_update_personal_info(p_check_in_id uuid, p_clinic_id uuid, p_birth_date text, p_address text, p_address_detail text, p_postal_code text, p_privacy_consent boolean, p_insurance_consent boolean, p_visit_route text, p_visit_route_detail text, p_consent_sensitive boolean, p_consent_agreed_at timestamp with time zone, p_consent_version text)` |
| 11 | WL-셀프체크인 | `self_checkin_with_reservation_link(p_clinic_id uuid, p_customer_payload jsonb, p_today date)` |
| 12 | WL-셀프체크인 | `next_queue_number(p_clinic_id uuid, p_date date)` |
| 13 | WL-RLS헬퍼 | `is_approved_user()` |
| 14 | WL-RLS헬퍼 | `current_user_is_admin_or_manager()` |

- dry-run `anon_whitelist` 배열(14개)과 마이그 `GRANT EXECUTE ON FUNCTION public.<sig> TO anon` 14줄이 **sig 단위 1:1 일치**. 초과/누락 0.
- 근거: 외부 셀프체크인앱(github `soyursong/foot-checkin`, `foot-checkin.pages.dev`, anon key, HEAD 2026-07-10 전수 grep) + in-repo 익명 페이지(App.tsx `/health-q/:token`·`/checklist/:checkInId`) + `pg_policies` {public}/{anon} 정책이 직접 호출하는 헬퍼 2개.
- 티켓 원안 후보 CLASS(`create_check_in`·`submit_walkin_intake_survey`·`get/submit_intake_survey`·공개예약 RPC §304)는 **실측 미사용/부재** → 회수 정당(증거기반).

## §3 — Tier-A anon 무호출 증거 (pg_stat_statements)

- `pg_stat_statements` 설치=TRUE, `stats_reset = 2026-04-19 09:50:49+00`, 측정 `now = 2026-07-10 13:48+00` → **관측 창 ≈ 82일 (30–90d 요건 충족)**.
- anon role(userid=anon) 통계 중 Tier-A 돈-함수 정규식 매치(`transfer_package_atomic|consume_package_sessions_for_checkin|refund_package_atomic|calc_refund_amount|get_package_remaining|refund_single_payment|deduct_session_atomic|get_customer_packages`) → **0건**.
- anon 실 트래픽(상위)은 전부 테이블 SELECT(customers/reservations/packages/check_ins/checklists/consent_forms/timer_records/rooms…, RLS 지배)와 비-Tier-A RPC(`pgrst_call`)뿐. **돈-함수 호출 흔적 0**.
- ∴ Tier-A anon EXECUTE 회수는 정당 공개 흐름을 파손하지 않음(무호출 실증). §16-3c RLS-우회 표면 봉합의 순-보안이득.

**보강(privilege 전/후)**: Tier-A 5함수 anon EXECUTE — BEFORE 현 prod **전부 TRUE**(라이브 우회 홀 존재) → AFTER dry-run **전부 FALSE**(봉합). authenticated/service_role 은 AFTER 도 TRUE(스태프/EF 무접촉).

## §4 — staging E2E (anon-role 기능 dry-run)

foot 는 별도 staging Supabase 프로젝트 부재 → prod 무변경 원칙 하에 **`BEGIN..ROLLBACK` dry-run 내에서 `SET LOCAL ROLE anon` 후 실제 함수 호출**로 권한 경계를 기능 검증(prod write 0, rollback). `42501=insufficient_privilege` 여부로 판정.

| 공개/셀프서비스 흐름 | 대표 함수 | 결과 | 판정 |
|----------------------|-----------|------|------|
| 문진 제출/토큰검증 (HealthQMobilePage) | `fn_health_q_validate_token` | EXEC-OK (권한 통과, logic-only) | ✅ 정상 |
| 셀프체크인 대기번호 | `next_queue_number` | EXEC-OK | ✅ 정상 |
| 태블릿 사전문진 (TabletChecklistPage) | `fn_prescreen_start` | EXEC-OK | ✅ 정상 |
| anon RLS 정책 평가 헬퍼 | `is_approved_user` | EXEC-OK | ✅ 정상 (하드에러 회피) |
| **Tier-A 돈-함수(차단 기대)** | `transfer_package_atomic(uuid,uuid)` | **DENIED-42501** | ✅ 봉합 |
| Tier-A 돈-함수(차단 기대) | `refund_package_atomic(uuid,uuid,uuid,text)` | **DENIED-42501** | ✅ 봉합 |
| Tier-B 조회(차단 기대) | `get_customer_packages(uuid)` | **DENIED-42501** | ✅ 회수 |

- 예약 anon 경로 = `reservations` **테이블 SELECT**(RLS 지배, 함수 EXECUTE 축과 무관) → 회수 무영향(§1 authenticated/anon 테이블 권한 불변).
- 스태프(authenticated) 경로: §1 authenticated EXECUTE 133 무변동 = 스태프 전 함수 무접촉 = 회귀 0.
- E2E 소스-단언 스펙: `tests/e2e/T-20260710-foot-SECDEF-ANON-REVOKE.spec.ts` (마이그 구조·화이트리스트 14·Tier-A 제외·rollback 멱등 단언).
- 재현: `db-gate/*_func_e2e_anon.sql` · `*_tierA_denial.sql`.

## §5 — supervisor 상위권한 집행 대기 (postgres 42501 불가)

`pg_default_acl` 함수 default 부여자 role 2종 = `{postgres, supabase_admin}`. 마이그는 postgres 창조 경로만 `ALTER DEFAULT PRIVILEGES` 하드닝. **supabase_admin 창조 경로는 postgres 권한 부족(ERROR 42501)** → supervisor(상위권한/대시보드 SQL) 1줄 별도 집행 요망:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
```

(실무상 앱/마이그 함수는 전부 postgres 창조 → 급성 리스크 아님. anon 신규-상속 잔여경로 완결 봉합 목적. **집행 시점·증빙 supervisor 기록 요망.**)

---

## apply 순서 (supervisor 집행)

1. **§5 supabase_admin default-priv 하드닝 1줄** (상위권한) — 신규상속 잔여경로 선봉합.
2. **forward 마이그 apply** `20260710223000_secdef_anon_execute_revoke_allowlist.sql` (postgres 경로 default-priv + 소급 REVOKE + WL 14 GRANT, 단일 tx).
3. **사후검증** (apply 후): anon EXECUTE=14 / Tier-A anon=false / authenticated·service_role=133/135 불변 / WL 14 sig 재확인.
4. 회복 필요 시 `*.rollback.sql` (anon 119 원상, 멱등, 데이터 무손실).
