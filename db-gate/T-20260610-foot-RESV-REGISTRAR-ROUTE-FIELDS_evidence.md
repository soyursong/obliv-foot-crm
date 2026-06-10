# T-20260610-foot-RESV-REGISTRAR-ROUTE-FIELDS — DB-gate evidence

- prod: rxlomoozakkjesdqjtvd
- 실행: 2026-06-10T23:14:26.278Z
- 출처: supervisor FIX-REQUEST MSG-20260611-081226-7voz (phase1 db_gate_apply_required)

## [1] 사전 probe (재적용 전 — HALF-APPLIED 확인)
```
reservation_registrars EXISTS : false
reservations.visit_route      : false
reservations.registrar_id     : false
reservations.registrar_name   : false
visit_route CHECK constraint  : false
RLS policies                  : (none)
updated_at trigger            : false
seed rows                     : (none)
```

## [2] 마이그레이션 idempotent 재적용
파일: supabase/migrations/20260610110000_resv_registrar_route_fields.sql
(ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / seed NOT EXISTS 가드 — 재실행 안전)
  (선제 정책 DROP skip: relation "public.reservation_registrars" does not exist)
✅ 적용 완료 (에러 없음)

## [3] 사후 probe (verify — supervisor 요구 항목)
```
PASS  reservation_registrars EXISTS
PASS  reservations.visit_route EXISTS
PASS  reservations.registrar_id EXISTS
PASS  reservations.registrar_name EXISTS
PASS  visit_route CHECK constraint
PASS  updated_at trigger
PASS  RLS policies (4종)
RLS policy list: resv_registrars_delete, resv_registrars_insert, resv_registrars_select, resv_registrars_update
```

## [4] seed rows (원내4 / TM4) — clinic별
```
오블리브 풋센터 송도 | TM | 4
오블리브 풋센터 송도 | 원내 | 4
오블리브의원 서울 오리진점 | TM | 4
오블리브의원 서울 오리진점 | 원내 | 4
```
명단 샘플:
```
  1. [원내] 김민경
  2. [원내] 박민석
  3. [원내] 장예지
  4. [원내] 김지혜
  5. [TM] 진운선
  6. [TM] 이수빈
  7. [TM] 김효신
  8. [TM] 문해민
  1. [원내] 김민경
  2. [원내] 박민석
  3. [원내] 장예지
  4. [원내] 김지혜
  5. [TM] 진운선
  6. [TM] 이수빈
  7. [TM] 김효신
  8. [TM] 문해민
```

## [결과] db_gate_status = PASS ✅

- additive only, 기존 데이터 무손실. rollback: 20260610110000_resv_registrar_route_fields.rollback.sql
