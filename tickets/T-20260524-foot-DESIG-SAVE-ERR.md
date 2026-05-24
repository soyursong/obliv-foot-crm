---
id: T-20260524-foot-DESIG-SAVE-ERR
title: "지정 치료사 저장 에러 수정 — DB 컬럼 미존재 hotfix"
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-05-24
deadline: 2026-05-25
deploy_ready_at: 2026-05-24
deploy_ready_by: dev-foot
db_migration: true
build_passed: true
build_time: "3.23s"
e2e_spec: "tests/e2e/T-20260524-foot-DESIG-SAVE-ERR.spec.ts"
e2e_spec_exempt_reason: ""
reporter: 김주연 총괄
reporter_slack_id: U0ATDB587PV
risk: "1/5 (DB ALTER TABLE only, ADD COLUMN IF NOT EXISTS)"
---

# T-20260524-foot-DESIG-SAVE-ERR — 지정 치료사 저장 에러 수정

## 배경

김주연 총괄 "저장 에러 그대로구만 뭐가 해결이야!!!" — 2번차트 [지정 치료사] 드롭다운 변경 시
`지정 치료사 저장 실패: ...` 토스트가 반복 노출. 현장 테스트 완전 차단.

## 근본 원인

**DB 컬럼 미존재.**

`20260522070000_designated_therapist.sql` 마이그레이션 파일은 커밋되어 있었으나
live DB에 **실제로 적용된 적이 없었음**.

- `supabase_migrations.schema_migrations` 최신 버전: `20260521000010`
- `designated_therapist_id` 컬럼: live DB `customers` 테이블에 부재

FE 코드:
```javascript
supabase.from('customers')
  .update({ designated_therapist_id: newTherapistId || null })
  .eq('id', customer.id)
```
→ 존재하지 않는 컬럼에 UPDATE 시도 → Supabase 400 에러 → 저장 실패 토스트

PKG-DEDUCT-THERAPIST(dd2e672)는 치료사 드롭다운 노출 fix였고, 저장 경로와 무관.
FE 코드/RLS 정책은 모두 정상 — DB 컬럼만 없었음.

## 수정 내용

**DB 직접 실행 (2026-05-24):**
```sql
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS designated_therapist_id UUID
    REFERENCES staff(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_customers_designated_therapist
  ON customers(designated_therapist_id)
  WHERE designated_therapist_id IS NOT NULL;
```

- `designated_therapist_id` 컬럼 추가 (UUID, nullable, FK → staff.id ON DELETE SET NULL)
- 인덱스 `idx_customers_designated_therapist` 생성
- FE 코드 변경 없음 (이미 올바르게 작성되어 있었음)

## 검증

- 컬럼 존재 확인: ✅ `information_schema.columns` 쿼리
- FK 제약 확인: ✅ `customers_designated_therapist_id_fkey`
- 인덱스 확인: ✅ `idx_customers_designated_therapist`
- 빌드: ✅ 3.23s

## AC 달성

- AC-1 ✅ 저장 에러 원인 특정 — DB 컬럼 미존재
- AC-2 ✅ designated_therapist_id 컬럼 + FK + 인덱스 live DB 적용
- AC-3 ✅ FE 코드 변경 없음, 기존 기능 회귀 없음
- AC-4 ✅ 빌드 3.23s 통과
