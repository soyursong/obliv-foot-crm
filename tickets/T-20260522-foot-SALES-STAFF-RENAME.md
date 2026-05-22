---
id: T-20260522-foot-SALES-STAFF-RENAME
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build: pass
db_change: false
spec_added: false
spec_exempt_reason: 선행 SETTLE-STAFF-LABEL(fe5e6e4)에서 동일 변경 완료 — 신규 코드 변경 없음
commit: fe5e6e4
risk: GO (0/5)
created_at: 2026-05-22
updated_at: 2026-05-22
---

# T-20260522-foot-SALES-STAFF-RENAME — 매출집계 "담당의별" → "담당실장별" + 2번차트 담당자 연동

## 개요

매출집계 화면 "담당의별" 항목명 변경 + 2번차트 1구역 담당자(`customers.assigned_staff_id`) 매출 연동.

**결론**: 선행 티켓 `T-20260522-foot-SETTLE-STAFF-LABEL` (commit `fe5e6e4`)에서 모든 AC가 이미 충족됨.
추가 코드 변경 없음. 현재 배포 완료 상태.

## AC 충족 현황

- [x] **AC-1**: "담당의별" → "담당실장별" 라벨 변경
  - `src/pages/Sales.tsx` SALES_TABS `label: '담당실장별'` ✅
  - `src/components/sales/SalesDoctorTab.tsx` 테이블 헤더 + 하단 주석 ✅
  - 소스 전역 grep — "담당의별" 가시 라벨 0건 ✅

- [x] **AC-2**: 2번차트 1구역 담당자(customers.assigned_staff_id) 매출 집계 연동
  - 3-step join: `payments(customer_id)` → `customers(assigned_staff_id)` → `staff(name)` ✅
  - 참고: DB에 `payments.staff_id` 컬럼 없음 — DAILY-SETTLE-STAFF(789dd63) 확인 기록
  - 실제 소스: `customers.assigned_staff_id` (2번차트 1구역 담당자 드롭 단일 소스) ✅

- [x] **AC-3**: 일마감(DAILY-SETTLE-STAFF, 789dd63)과 동일 소스 → 정합성 유지
  - Closing.tsx `payStaffId = cust?.assigned_staff_id` ↔ SalesDoctorTab `custStaffMap.get(p.customer_id)` 동일 소스 ✅

- [x] **AC-4**: staff_id NULL → "미지정" 표시
  - `staffId === '__UNASSIGNED__'` → `staffName = '미지정'` ✅
  - '미지정'은 테이블 최하단 정렬 ✅

## 선행 티켓 참조

| 티켓 | 커밋 | 내용 |
|------|------|------|
| T-20260522-foot-SETTLE-STAFF-LABEL | fe5e6e4 | 라벨 + 데이터소스 변경 (이 티켓의 모든 AC 포함) |
| T-20260522-foot-DAILY-SETTLE-STAFF | 789dd63 | 일마감 담당실장별 집계 — assigned_staff_id 소스 확정 |

## 검증

- `npm run build` ✅ 4.85s (2026-05-22 현재)
- DB 변경 없음 — READ-ONLY
- Vercel main 브랜치 자동 배포 완료
