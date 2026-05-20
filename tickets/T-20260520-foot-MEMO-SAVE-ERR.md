---
id: T-20260520-foot-MEMO-SAVE-ERR
domain: foot
priority: P0
status: deploy-ready
deploy_ready: true
commit: 1fb053c
db_changed: true
rollback_sql: supabase/migrations/20260520000100_customer_treatment_memos.down.sql
e2e_spec: tests/e2e/T-20260520-foot-MEMO-SAVE-ERR.spec.ts
e2e_result: 8/8 pass
build: success
created_at: 2026-05-20
---

# T-20260520-foot-MEMO-SAVE-ERR — P0 Hotfix: 치료메모 저장 오류

## 근본원인
commit 073bd0a (SET-LOAD-REMOVE + MEMO-HISTORY) 배포 시 MEMO-HISTORY 코드 포함.
그러나 `supabase/migrations/20260520000100_customer_treatment_memos.sql` DB push 미적용.
에러: `"저장 실패: Could not find the table 'public.customer_treatment_memos' in the schema cache"`

## 조치

### AC-1: DB Migration 적용 ✅
- `supabase db query --linked` 로 직접 실행
- CREATE TABLE + 인덱스 2개 + RLS 4개 정책 적용
- REST API PGRST205 → `[]` (정상) 확인

### AC-2: 치료메모 탭 INSERT 정상화 ✅
- 테이블 생성으로 INSERT 성공
- 목록 반영 정상

### AC-3: Graceful fallback 추가 ✅
- `treatmentMemoUnavailable` 상태 플래그 추가
- `loadTreatmentMemos`: PGRST205/schema cache 에러 → setTreatmentMemoUnavailable(true)
- `saveNewTreatmentMemo`: 테이블 미존재 시 "치료메모 기능 준비 중입니다" toast (raw 에러 숨김)
- UI: amber 안내 배너 + 입력폼 숨김

### AC-4: 기존 memo 필드 손상 없음 ✅
- customers.treatment_note / .memo 컬럼 REST 200 확인

### AC-5: 빌드 + E2E ✅
- `npm run build` ✓
- E2E 8/8 pass (T-20260520-foot-MEMO-SAVE-ERR.spec.ts)

## 변경 파일
- `src/pages/CustomerChartPage.tsx` — graceful fallback 로직 + UI 배너
- `tests/e2e/T-20260520-foot-MEMO-SAVE-ERR.spec.ts` — E2E spec 신규

## 롤백
```sql
-- supabase/migrations/20260520000100_customer_treatment_memos.down.sql
DROP TABLE IF EXISTS customer_treatment_memos;
```
