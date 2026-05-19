---
id: T-20260519-foot-CHART-BEFORE-CHECKIN
domain: foot
status: deployed
priority: P1
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260519-foot-CHART-BEFORE-CHECKIN.spec.ts
created: 2026-05-19
deadline: 2026-05-20
qa_result: pass
qa_grade: Green
deployed_at: 2026-05-19T22:09:00+09:00
deploy_commit: 95713ad
bundle_hash: CustomerChartPage-BcMsQE1b
field_soak_until: 2026-05-20T22:09:00+09:00
---

# T-20260519-foot-CHART-BEFORE-CHECKIN — 초진 카드(Box1) 클릭 시 접수 전 차트 열람

## 배경

FIRSTVISIT-CHECKIN(28682fa) 배포 후에도 초진 카드(Box1) 클릭 시 차트가 열리나 내용이 표시되지 않음.
김주연 매니저 5/19 2회 반복 요청. 재진(Box2) 패리티 요구.

## 문제 분석

`CustomerChartPage.tsx` 930~974줄:
- `checklists` 쿼리가 `if (checkInIds.length > 0)` 블록 안에 잘못 위치
- `checklists` 테이블은 `customer_id` 기반 (check_in 불요)인데 check_in gate 뒤에 있음
- → 접수(체크인) 전 고객: `checklistEntries = []` → 체크리스트 탭 "기록 없음" 표시
- `form_submissions` 도 동일하게 `check_in_id` 필터로만 조회 → 접수 전 작성 양식 누락

## 수정 내용

**`src/pages/CustomerChartPage.tsx`**:
1. `checklists` 쿼리를 `if (checkInIds.length > 0)` 밖으로 이동
   - `customer_id` 기반 독립 실행
   - 접수 전 사전 체크리스트 데이터 즉시 표시
2. `form_submissions` 쿼리를 `.in('check_in_id', ...)` → `.eq('customer_id', customerId)` 로 전환
   - `check_in_id = null` (접수 전 작성 양식) 포함
3. `prescriptions` + `consent_forms` 는 여전히 `checkInIds.length > 0` 게이트 유지 (check_in 기반이 맞음)
4. `data-testid="checklist-tab-content"` + `data-testid="checklist-summary"` 추가

## AC 검증

| AC | 항목 | 결과 |
|----|------|------|
| AC-1 | Box1 초진 카드 클릭 → 차트 즉시 열림 | ✅ 기존 구현 (handleReservationSelect) |
| AC-2 | 차트 내용: customer+reservation+checklist 기반 (check_in 의존 제거) | ✅ 이번 수정 |
| AC-3 | 카드 클릭 → 차트 열림 / 접수 버튼 → 별도 체크인 | ✅ 기존 구현 유지 |
| AC-4 | 기존 접수 버튼(onCheckIn) 동작 유지 | ✅ 무변경 |
| AC-5 | 재진(Box2) 패리티 — 동일 handleReservationSelect 사용 | ✅ 공통 코드 |
| AC-6 | 셀프접수 회귀 없음 | ✅ 무변경 |

## 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `src/pages/CustomerChartPage.tsx` | checklists + form_submissions 쿼리를 check_in gate 밖으로 이동, customer_id 기반 전환 |
| `tests/e2e/T-20260519-foot-CHART-BEFORE-CHECKIN.spec.ts` | E2E spec 신규 (4 specs) |
| `tickets/T-20260519-foot-CHART-BEFORE-CHECKIN.md` | 티켓 생성 |

## DB 변경

없음

## 롤백

`CustomerChartPage.tsx` revert:
- `checkInIds.length > 0` 블록 안으로 checklists 쿼리 복원
- form_submissions 쿼리를 `.in('check_in_id', checkInIds)` 로 복원
