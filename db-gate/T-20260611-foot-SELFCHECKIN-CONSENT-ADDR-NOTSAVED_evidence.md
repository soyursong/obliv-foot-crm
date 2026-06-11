# T-20260611-foot-SELFCHECKIN-CONSENT-ADDR-NOTSAVED — DB-gate evidence

- prod: rxlomoozakkjesdqjtvd
- 실행: 2026-06-11T03:15:01.079Z
- 출처: supervisor FIX-REQUEST MSG-20260611-104014-tfn2 (phase1 db_migration_pending)
- 마이그: supabase/migrations/20260611100000_selfcheckin_personal_info_consolidate.sql (commit 7b04bef)

## [1] 사전 probe (적용 전)
```
fn_selfcheckin_update_personal_info 시그니처:
  (9 args) p_check_in_id uuid, p_clinic_id uuid, p_birth_date text, p_address text, p_address_detail text, p_privacy_consent boolean, p_insurance_consent boolean, p_visit_route text, p_visit_route_detail text
customers.privacy_consent_at : false
customers.sms_opt_in_at      : false
```
적용 전 REST 10-arg 호출:
```
HTTP 404 → {"code":"PGRST202","details":"Searched for the function public.fn_selfcheckin_update_personal_info with parameters p_address, p_address_detail, p_birth_date, p_check_in_id, p_clinic_id, p_insurance_consent, p_postal_code, p_privacy_consent, p_visit_route, p_visit_route_detail or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.","hint":"Perhaps you meant to call the function public.fn_selfcheckin_update_personal_info(p_address, p_address_detail, p_birth_date, p_check_in_id, p_clinic_id, p_insurance_consent, p_privacy_consent, p_visit_route, p_visit_route_detail)","message":"Could not find the function public.fn_selfcheckin_update_personal_info(p_address, p_address_detail, p_birth_date, p_check_in_id, p_clinic_id, p_insurance_consent, p_postal_code, p_privacy_consent, p_visit_route, p_visit_route_detail) in the schema cache"}
```

## [2] 마이그레이션 적용 (BEGIN/COMMIT 내장, DROP 구시그니처 → 10-arg 재생성)
✅ 적용 완료 (에러 없음)
NOTIFY pgrst reload schema 전송

## [3] 사후 probe — pg 스키마 검증
```
잔존 시그니처:
  (10 args) p_check_in_id uuid, p_clinic_id uuid, p_birth_date text DEFAULT NULL::text, p_address text DEFAULT NULL::text, p_address_detail text DEFAULT NULL::text, p_postal_code text DEFAULT NULL::text, p_privacy_consent boolean DEFAULT NULL::boolean, p_insurance_consent boolean DEFAULT NULL::boolean, p_visit_route text DEFAULT NULL::text, p_visit_route_detail text DEFAULT NULL::text

PASS  10-arg canonical 시그니처 존재
PASS  구 시그니처 1종만(오버로드 모호성 제거)
PASS  customers.privacy_consent_at 컬럼
PASS  customers.sms_opt_in_at 컬럼
```

## [4] 사후 probe — PostgREST 10-arg RPC 호출 (supervisor 핵심 요구)
```
HTTP 200 → {"error":"check_in_not_found","success":false}
```
판정: PASS ✅ (PGRST202 아님 — 10-arg 해석 정상)

## [결과] db_gate_status = PASS ✅

- RPC replace + additive 컬럼. 기존 데이터 무손실. 백필 없음(NULL 유지).
- rollback: supabase/migrations/20260611100000_selfcheckin_personal_info_consolidate.rollback.sql
