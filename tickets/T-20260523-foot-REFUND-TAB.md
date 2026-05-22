---
ticket_id: T-20260523-foot-REFUND-TAB
title: 2번차트 [환불내역] 탭 추가 + 탭 레이아웃 균등배치
domain: foot
priority: P2
status: deploy-ready
deploy_ready: true
build_passed: true
e2e_spec: tests/e2e/T-20260523-foot-REFUND-TAB.spec.ts
db_migration: null
regression_risk: low
reporter: planner
created_at: 2026-05-23
deployed_at: null
---

# T-20260523-foot-REFUND-TAB — 2번차트 [환불내역] 탭 추가

## 개요
2번차트(CustomerChartPage) 이력 탭 2행에 [환불내역] 탭 신규 추가.
payments + package_payments 에서 payment_type='refund' 필터링.
탭 레이아웃 1행·2행 모두 flex 균등 배치.

## AC 목록
- **AC-1**: 2행 [메시지] 탭 우측에 [환불내역] 탭 렌더링 ✅
- **AC-2**: payments + package_payments customer_id 기준 환불 자동 연동 ✅
- **AC-3**: 2행(이력) + 1행(문진/진료) 탭 전체 flex-1 균등배치 ✅
- **AC-4**: 환불 0건 시 "환불 내역 없음" 빈 상태 안내 ✅

## 구현 내용
선행 커밋 `6560d84` (T-20260522-foot-REFUND-HIST-TAB)에서 모든 AC 충족 완료.

- `HISTORY_TABS` index 5: `{ key: 'refunds', label: '환불내역' }` (메시지 바로 우측)
- `IMPLEMENTED_HISTORY` 에 `'refunds'` 포함 → 준비중 fallback 없음
- 탭 버튼 CSS: `flex-1 justify-center min-h-[44px]` (clinical/history 양쪽 동일)
- 환불 콘텐츠: payments + pkgPayments payment_type='refund' 필터 → 최신순 합계+테이블
- 빈 상태: `allRefunds.length === 0` → "환불 내역 없음" border-dashed 안내 박스
- DB 변경 없음. Realtime `c2_payments_{customerId}` 기존 구독 재사용.

## 리스크
GO (0/5). DB 변경 없음. 선행 커밋 이미 main 배포 완료.
