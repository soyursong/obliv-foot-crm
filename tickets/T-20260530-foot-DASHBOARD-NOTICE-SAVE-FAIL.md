---
id: T-20260530-foot-DASHBOARD-NOTICE-SAVE-FAIL
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
hotfix: false
created: 2026-05-30 21:27
completed: 2026-05-30
deadline: 2026-06-02
db_changed: false
db_migration: none
db_rollback: none
db_deployed: false
e2e_spec: tests/e2e/T-20260530-foot-DASHBOARD-NOTICE-SAVE-FAIL.spec.ts
risk_verdict: GO
risk_reason: "FE-only 1라인 수정 (created_by null 고정). DB 무변경. 5/17 Notices.tsx 패치를 대시보드 패널에 동기화. E2E 3/3 green."
author: dev-foot
---

# T-20260530-foot-DASHBOARD-NOTICE-SAVE-FAIL — 대시보드 공지 저장 안 됨 (P1, 4번째 재발)

## 상태

**deploy-ready** — FE 단독 수정 + E2E 3/3 green + 빌드 통과. DB 무변경.

## 진단 결과 (원인 위치 = FE, DB 회귀 아님)

### 근본원인
`src/components/CalendarNoticePanel.tsx`(대시보드 좌측 공지 패널)의 insert가
`created_by: profile?.id ?? null`을 전달. `profile.id` = `auth.uid()`(user_profiles.id)인데,
`notices.created_by` FK는 `staff(id)`를 참조 → **FK constraint `notices_created_by_fkey` 위반(23503)**.

### 왜 4번째 재발인가 (= 회귀가 아니라 잠복 버그)
- 과거 3회는 모두 DB 레벨 수정:
  - 5/12 `notices_rls_insert_fix` (INSERT RLS)
  - 5/16/19 `notices_rls_full_fix` (SELECT/UPDATE/DELETE RLS `USING true`)
  - 5/17 `f858246` FK 불일치 수정 — **단, `src/pages/Notices.tsx`만 패치**(`created_by: null`)
- 대시보드 공지는 별도 컴포넌트 `CalendarNoticePanel.tsx`를 사용하는데, 5/17 패치가
  **이 파일을 놓침**. 이 파일은 생성 시점(5/10, b67d45f)부터 `created_by: profile?.id` 보유.
- 5/29 dashboard 배포(TIMETABLE-SYNC/CHECKIN-BTN-REMOVE)는 이 파일을 **건드리지 않음**
  → 코드 회귀 아님. 로그인 사용자가 user_profiles 행을 가질 때(=항상) profile.id가
  non-null로 채워져 FK 위반이 노출되는 잠복 버그.

### DB 현황 검증 (REST/service_role 실측, 변경 없음)
- notices RLS 정책: SELECT/INSERT/UPDATE/DELETE 모두 `authenticated`에게 `USING/CHECK true` 잔존 (과거 수정분 정상 유지) → DB 회귀 아님.
- `created_by = auth.uid()` INSERT 실측 → **23503 FK 위반** "Key (created_by)=(...) is not present in table staff".
- `created_by = null` INSERT 실측 → **성공**.
- user_profiles 샘플 5건 전부 staff에 부재 확인.
- 진단 스크립트: `scripts/diag_notices_rest_20260530.mjs` (read-only + 즉시 롤백)

## 수정

`src/components/CalendarNoticePanel.tsx`:
- `created_by: profile?.id ?? null` → `created_by: null` (5/17 Notices.tsx 패치 동기화)
- 미사용된 `useAuth` import + `const { profile } = useAuth()` 제거

DB 마이그레이션 불필요 (DB는 정상 상태).

## AC

- AC-1: 패널 '공지 등록' 클릭 → 폼 노출
- AC-2: 제목 입력 후 저장 → FK 위반 없음(`저장 실패` toast 부재) + 폼 닫힘
- AC-3: 저장된 공지가 패널 목록에 즉시 반영 (= 저장 성공의 결정적 증거)
- AC-4: 제목 없이 저장 시 검증 에러 toast

## 검증

- `npm run build` ✅
- E2E `tests/e2e/T-20260530-foot-DASHBOARD-NOTICE-SAVE-FAIL.spec.ts` → **3/3 passed**
- 회귀 참고: 기존 `T-20260516-foot-NOTICE-SAVE-FAIL.spec.ts` AC-1+2+3은
  transient success-toast 타이밍 의존으로 간헐 실패(pre-existing flaky, 본 변경 무관 —
  Notices.tsx 미변경). 별도 정리 권고.

## 후속 권고 (별도 티켓)

- 근본 정리: `staff.user_id`에 auth UUID 백필 후 모든 notices 정책을
  `staff.user_id = auth.uid()` 조건으로 교체(clinic 격리 강화) + created_by에 실제 staff.id 매핑.
  (현재는 created_by null 고정으로 작성자 추적 불가)
