---
ticket_id: T-20260519-foot-PKG-ITEM-FEE
domain: foot
title: 구매패키지 항목별 수가 금액 표시
status: deploy-ready
priority: P2
created_at: 2026-05-19
deploy_ready_at: 2026-05-19
deploy_ready_by: dev-foot
build_ok: true
db_migration: none
e2e_spec: tests/e2e/T-20260519-foot-PKG-ITEM-FEE.spec.ts
---

## 요약

`PackageDetailSheet` (Packages.tsx)에 항목별 수가 금액 테이블 추가.
가열/비가열/포돌로게/수액별 회수×단가→소계 + 합계를 표시.

## 구현 내용

- **`PackageItemFees` 컴포넌트** 신규 추가 (Packages.tsx)
  - `heated_unit_price`, `unheated_unit_price`, `iv_unit_price`, `podologe_unit_price` 필드 사용
  - 회수 > 0인 항목만 표시 (0회 항목 숨김)
  - unit_price 데이터 없는 구형 패키지는 전체 숨김 (graceful degradation)
  - price_override로 수기조정된 경우 "계약금 ₩X (수기조정 적용)" 주석 표시
- `PackageDetailSheet` 내 포돌로게 블록 아래, 총 계약금 위에 삽입

## AC 검증

- AC-1 ✅ 항목별 수가 개별 표시 (가열 ₩XX 1회당, 소계)
- AC-2 ✅ 총합계 grid 유지 (그 위에 항목 테이블 추가)
- AC-3 ✅ 합 = 총계약금 검증, 불일치 시 amber 노트 표시
- AC-4 ✅ compact table, tabular-nums, 태블릿 가독성
- AC-5 ✅ 단일 항목 패키지 — 1행만 표시, 정상 동작

## 사전조사 결과

DB에 `heated_unit_price`, `unheated_unit_price`, `iv_unit_price`, `podologe_unit_price` 컬럼이
이미 존재 (T-20260507-foot-PKG-TEMPLATE-REDESIGN에서 추가됨).
패키지 생성 시 템플릿에서 단가가 복사되어 저장됨 — DB 마이그레이션 불필요.
