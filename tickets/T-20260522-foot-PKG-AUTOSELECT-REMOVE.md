---
id: T-20260522-foot-PKG-AUTOSELECT-REMOVE
domain: foot
type: fix
priority: P2
status: deploy-ready
deploy-ready: true
deploy-ready-at: 2026-05-22T22:14:44+09:00
build: OK
db-change: false
e2e-spec: tests/e2e/T-20260522-foot-PKG-AUTOSELECT-REMOVE.spec.ts
commit: a4165ac
hotfix: false
created: 2026-05-22
deadline: 2026-05-29
assignee: dev-foot
---

# T-20260522-foot-PKG-AUTOSELECT-REMOVE

## 요약

2번차트 > 회차 차감 > 패키지 선택 드롭다운에서 "-- 첫 번째 활성 패키지" 자동선택 옵션 제거.

## 배경

패키지 2개 이상 고객의 경우 드롭다운에 "첫 번째 활성 패키지" 옵션이 표시되어 의도치 않은 패키지에 차감되는 오류가 발생함. 사용자가 직접 패키지를 선택하도록 변경.

## 수용기준 (AC)

- **AC-1**: 패키지 2개 이상일 때, 드롭다운에서 "-- 첫 번째 활성 패키지" 옵션 제거 ✅
- **AC-2**: 패키지 2개 이상일 때, 드롭다운 초기값 미선택(placeholder: "패키지를 선택하세요") ✅
- **AC-3**: 패키지 1개일 때, 기존 동작 유지 (드롭다운 미노출) ✅
- **AC-4**: 패키지 미선택 상태에서 차감 시도 시 toast + 빨간 테두리 highlight ✅

## 변경 파일

- `src/pages/CustomerChartPage.tsx` — 드롭다운 옵션 제거, placeholder 교체, saveC22Deduct/handleHealerDeduct 미선택 검증 추가
- `tests/e2e/T-20260522-foot-PKG-AUTOSELECT-REMOVE.spec.ts` — E2E 3 시나리오

## 리스크

| # | 항목 | 판정 |
|---|------|------|
| 1 | DB 스키마 변경 | PASS (FE-only) |
| 2 | 외부 서비스 의존 | PASS |
| 3 | 비즈니스 로직 변경 | PASS (기능 제거) |
| 4 | 대량 데이터 변경 | PASS |
| 5 | 신규 npm 패키지 | PASS |

**판정: GO (0/5)**
