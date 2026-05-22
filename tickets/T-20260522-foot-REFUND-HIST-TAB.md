---
ticket_id: T-20260522-foot-REFUND-HIST-TAB
title: 2번차트 [환불내역] 탭 추가 + 탭 레이아웃 균등 배치
domain: foot
priority: P2
status: deploy-ready
deploy_ready: true
build_passed: true
e2e_spec: tests/e2e/T-20260522-foot-REFUND-HIST-TAB.spec.ts
db_migration: null
regression_risk: low
reporter: planner
created_at: 2026-05-22
deployed_at: null
---

# T-20260522-foot-REFUND-HIST-TAB — 2번차트 [환불내역] 탭 추가

## 개요
2번차트(CustomerChartPage) 이력 탭 바에 [환불내역] 탭 신규 추가.
기존 payments + package_payments 데이터에서 payment_type='refund' 필터링.
탭 레이아웃 flex 균등 배치(좌측 쏠림 해소).

## AC 목록
- **AC-1**: 이력 탭 바에 [환불내역] 탭 신규 — 메시지 탭 우측 (index 5)
- **AC-2**: 환불 데이터 자동 연동 — payments + package_payments 필터 (payment_type='refund'). Realtime 기존 구독 재사용.
- **AC-3**: 탭 레이아웃 균등 배치 — flex-1 적용 (clinical/history 양쪽 탭 열 모두)
- **AC-4**: 기존 탭 기능 무영향

## 구현 내용
- `HISTORY_TABS`에 `{ key: 'refunds', label: '환불내역' }` 추가
- `IMPLEMENTED_HISTORY`에 `'refunds'` 추가
- 탭 버튼 CSS: `shrink-0 px-3` → `flex-1 justify-center` (양쪽 탭 열)
- 탭 컨테이너 CSS: `overflow-x-auto` 제거 (균등 배치와 충돌)
- 환불내역 탭 콘텐츠: payments + pkgPayments refund 필터 → 합계 + 테이블 표시
- DB 변경 없음. Realtime payments 구독은 기존 c2_payments_{customerId} 채널 재사용.

## 리스크
GO (0/5). DB 변경 없음. UI 탭 추가 + 기존 데이터 조회만.
