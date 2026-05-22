---
id: T-20260523-foot-PKG-AUTOSEL-REMOVE
domain: foot
priority: P2
status: deploy-ready
title: 2번차트 패키지 선택 드롭다운 자동선택 제거
created: 2026-05-23
deadline: 2026-05-30
assignee: dev-foot
db-change: false
deploy-ready: true
build-ok: true
regression-risk: low
e2e-spec: tests/e2e/T-20260523-foot-PKG-AUTOSEL-REMOVE.spec.ts
---

# T-20260523-foot-PKG-AUTOSEL-REMOVE — 2번차트 패키지 자동선택 제거

## 요약

2번차트 회차 차감 섹션에서 활성 패키지가 1개일 때도 첫 번째 패키지가 자동 선택되던 문제 수정.
수동 선택 강제 — 미선택 시 버튼 비활성 + validation.

## 변경 내용 (FE-only)

| 위치 | 변경 전 | 변경 후 |
|------|---------|---------|
| 드롭다운 노출 조건 | `activeDisplayPackages.length > 1` | `>= 1` |
| saveC22Deduct 검증 | `length > 1 && !packageId` → 에러 | `length >= 1 && !packageId` → 에러 |
| handleHealerDeduct 검증 | `length > 1 && !packageId` → 에러 | `length >= 1 && !packageId` → 에러 |
| [차감] 버튼 disabled | 활성 0개만 비활성 | 활성 0개 또는 패키지 미선택 시 비활성 |
| [힐러예약 후 차감] disabled | 동일 | 동일 |

## AC 검증

- [x] AC-1: 드롭다운 진입 시 자동선택 없음 (placeholder "패키지를 선택하세요")
- [x] AC-2: 미선택 시 차감 불가 (버튼 비활성 + toast.error)
- [x] AC-3: 활성 패키지 0개 시 기존 동작 유지 (드롭다운 미노출)
- [x] AC-4: 기존 handleHealerDeduct 로직 무영향 (동일 패턴으로 일관 적용)

## reporter
김주연 총괄 (U0ATDB587PV) / C0ATE5P6JTH / 1779454162.305099
