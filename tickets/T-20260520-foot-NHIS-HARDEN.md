---
ticket_id: T-20260520-foot-NHIS-HARDEN
title: NHIS 자격조회 API 실가동 보강 (Phase b+c)
domain: foot
priority: P1
status: deployed
qa_result: pass
qa_grade: Yellow
deploy_commit: f65842dd6b90ea1c1aab61af478353a074565f3c
deployed_at: 2026-05-19T20:04:00+09:00
bundle_hash: ConsentForm-D5Ch2hec
field_soak_until: 2026-05-20T20:04:00+09:00
deploy_ready: true
db_change: true
db_change_note: |
  migrations/20260520000030_rrn_key_harden.sql
  - rrn_encrypt / rrn_decrypt: 하드코딩 폴백 제거, app.rrn_key 미설정 시 RAISE EXCEPTION
  - nhis_idor_audit_logs 테이블 신규 생성 (IDOR 감사 로그, service_role RLS)
spec_ref: MSG-20260519-194658-lbak
e2e_spec: tests/e2e/T-20260520-foot-NHIS-HARDEN.spec.ts
unit_test: supabase/functions/nhis-lookup/nhis-lookup.test.ts
build_ok: true
created_at: 2026-05-19
completed_at: 2026-05-19
implemented_by: dev-foot
---

# T-20260520-foot-NHIS-HARDEN — NHIS 자격조회 API 보안 보강 Phase b+c

## 구현 범위

### Phase b — 보안 (즉시 착수)

| AC | 내용 | 파일 |
|----|------|------|
| AC-1 | `obliv_foot_rrn_key_2026` 하드코딩 폴백 제거 → 미설정 시 `RAISE EXCEPTION P0002` | `migrations/20260520000030_rrn_key_harden.sql` |
| AC-2 | 응답 `raw` 주민번호 마스킹 (앞6자리만, 뒤7 `*******`) | `functions/nhis-lookup/index.ts` `maskRrnInRaw()` |
| AC-3 | IDOR 가드 — 호출자 clinic ↔ customer.clinic_id 검증, 불일치 시 403 + 감사 로그 | `functions/nhis-lookup/index.ts` + `nhis_idor_audit_logs` 테이블 |
| AC-4 | `mapQualificationCode` 산정특례(burdenCode=7)·희귀난치(8)·경감(3)·보훈(9) 추가 | `functions/nhis-lookup/index.ts` |
| AC-5 | AC-1~4 단위테스트 | `functions/nhis-lookup/nhis-lookup.test.ts` (Deno test) |

### Phase c — 환경 분리 (즉시 착수)

| AC | 내용 | 파일 |
|----|------|------|
| AC-6 | `NHIS_API_URL/KEY/FACILITY_CODE` Edge Secrets 문서화 | `functions/nhis-lookup/index.ts` 헤더 주석 |
| AC-7 | `NHIS_MOCK=true` dev 환경 모의 응답 분기 | `functions/nhis-lookup/index.ts` `buildMockResponse()` |
| AC-8 | dev/prod 분리 확인 — NHIS_MOCK dev Secrets에만 설정, prod 미설정 규약 명시 | 동상 |

### BLOCKED (Phase a — AC-9~10 미구현)

- AC-9~10: 운영경로 확정 후 요청/응답 키 placeholder 교체 — CERT-CHECK + 의사결정 대기

## DB 변경 사항

### `20260520000030_rrn_key_harden.sql`

```
1. rrn_encrypt / rrn_decrypt — 하드코딩 폴백 제거
   BEFORE: app.rrn_key 미설정 시 'obliv_foot_rrn_key_2026' 폴백
   AFTER:  RAISE EXCEPTION 'app.rrn_key not configured' (ERRCODE P0002)

2. nhis_idor_audit_logs 테이블 신규
   컬럼: id, event_type, user_id, customer_id, caller_clinic_id,
          customer_clinic_id, ip_address, detail, created_at
   RLS: service_role 전용
```

### 롤백

```bash
# 롤백 시 실행 (Supabase Dashboard SQL Editor)
-- 20260520000030_rrn_key_harden.down.sql 내용 실행
-- rrn_key 폴백 복원 + nhis_idor_audit_logs 테이블 DROP
```

## 테스트 현황

- 단위테스트: `supabase/functions/nhis-lookup/nhis-lookup.test.ts`
  - `deno test --allow-env supabase/functions/nhis-lookup/nhis-lookup.test.ts`
  - 총 18개 테스트: mapQualificationCode 11, maskRrnInRaw 6, IDOR 규약 1
- E2E spec: `tests/e2e/T-20260520-foot-NHIS-HARDEN.spec.ts`
  - AC-1, AC-2, AC-3, AC-7, AC-4, 회귀(KENBO) 6시나리오
- 회귀 spec (별도 파일 유지): `tests/e2e/T-20260515-foot-KENBO-API-NATIVE.spec.ts`

## 배포 전 주의사항

1. **app.rrn_key 미설정 시 rrn_encrypt/rrn_decrypt 전체 중단**
   - 마이그레이션 전 반드시 DB에 `app.rrn_key` 설정 확인
   - 확인 쿼리: `SELECT current_setting('app.rrn_key');`
   - 미설정 시 먼저 설정: `ALTER DATABASE postgres SET "app.rrn_key" = '<key>';`

2. **nhis_idor_audit_logs 테이블 — service_role only**
   - authenticated 사용자는 읽기/쓰기 불가
   - Edge Function이 SUPABASE_SERVICE_ROLE_KEY로만 INSERT

3. **NHIS_MOCK=true 절대 prod에 설정 금지**
   - dev Supabase Edge Function Secrets에만 설정

## 미구현 (Phase a — BLOCKED)

- AC-9: NHIS API 요청 필드명 → 운영 스펙 키 교체
- AC-10: NHIS API 응답 필드명 → 운영 스펙 키 교체
- 블로커: CERT-CHECK 완료 + 의사결정 대기
