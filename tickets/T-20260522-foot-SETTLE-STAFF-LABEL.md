---
id: T-20260522-foot-SETTLE-STAFF-LABEL
domain: foot
priority: P1
deadline: 2026-05-29
status: deploy-ready
deploy_ready: true
db_changed: false
e2e_spec: EXEMPT (ui_label_and_datasource_only)
e2e_spec_exempt_reason: 라벨 변경 + 데이터소스 전환 — 기존 sales-doctor testid 재사용, 별도 E2E spec 불필요
commit: fe5e6e4
risk: GO (0/5)
approved_by: 김주연 총괄 (P1 상향 요청)
completed_at: 2026-05-22
---

# T-20260522-foot-SETTLE-STAFF-LABEL

## 개요

매출집계 화면 "담당의별" 탭 — 라벨 변경 + 데이터소스를 DAILY-SETTLE-STAFF(9a97d5a)와 동일하게 연결.

**현장 리포트**: 김주연 총괄 직접 확인 — 2번차트 담당자→매출집계 연동 안 됨.

## AC

- [x] **AC-1**: "담당의별" → "담당실장별" 라벨 변경 (탭 버튼 + 테이블 헤더 + 하단 주석)
- [x] **AC-2**: 데이터소스 `consultant_id`(deprecated) → `customers.assigned_staff_id`
  - DAILY-SETTLE-STAFF(9a97d5a) 동일 3-step join 패턴 채택
  - `payments(customer_id)` → `customers(assigned_staff_id)` → `staff(name)` 인메모리 조인
  - NULL assigned_staff → '미지정' 표시 (DAILY-SETTLE-STAFF AC-3 일관성)

## 변경 파일

| 파일 | 변경 내용 |
|------|----------|
| `src/pages/Sales.tsx` | SALES_TABS `'담당의별'` → `'담당실장별'` |
| `src/components/sales/SalesDoctorTab.tsx` | 전체 rewrite — 데이터소스 교체 + 라벨 변경 |

## 검증

- `npm run build` ✅ 통과 (fe5e6e4)
- DB 변경 없음 — READ-ONLY
- Vercel 자동 배포 예정

## 근거

`consultant_id`는 T-20260522-foot-CLOSING-PAY-3COL에서 `assigned_staff_id` 단일 소스로 확정 대체됨.
매출집계 화면도 동일 소스를 참조해야 일마감 결제내역 화면과 숫자가 일치함.
