---
id: T-20260522-foot-FOOT-PKG-DEDUCT-BUG
domain: foot
priority: P0
status: deploy-ready
hotfix: true
deploy-ready: true
fix_commit: 01ebfc3
resolved_by: T-20260522-foot-PKG-HEALER-DEDUCT
related: T-20260516-foot-HEALER-RESV-BTN
e2e_spec: tests/e2e/T-20260522-foot-FOOT-PKG-DEDUCT-BUG.spec.ts
db_change: false
created: 2026-05-22
deadline: 2026-05-22
reporter: 김주연 총괄
risk_verdict: GO_WARN
---

# T-20260522-foot-FOOT-PKG-DEDUCT-BUG — 힐러 예약 후 패키지 회차 차감 미작동 (P0 hotfix)

## 증상 (접수)

- 2번차트 힐러 예약 생성 후 [힐러예약 후 차감] 버튼 클릭 시:
  - 당일 시술 차감: ✅ 정상
  - 패키지 티켓(회차) 차감: ❌ 미작동
- 반복 재현 확인 (김주연 총괄)

## 조사 결과

### 1단계 — HEALER-RESV-BTN v3 커버 여부

**결론: 커버 X — 별도 fix 필요**

| 항목 | 내용 |
|------|------|
| HEALER-RESV-BTN v3 변경 (7c1e9c3) | `handleHealerFlag()` 날짜 비교 `> today` → `>= today` (1줄) |
| 패키지 차감 포함 여부 | **없음** — 패키지 차감 코드 전혀 없음 |
| 결론 | HEALER-RESV-BTN v3는 당일 예약 healer_flag 미반영 버그만 수정; 패키지 회차 차감 버그와 독립 |

### 2단계 — Root cause

기존 `handleHealerFlag` 함수: **힐러 플래그 설정만** 수행.
[힐러예약 후 차감] 버튼이 `handleHealerFlag`만 호출 → `package_sessions.insert` 호출 없음 → 패키지 회차 차감 누락.

## Fix (commit 01ebfc3)

**`handleHealerDeduct` 복합 핸들러 신설** (`CustomerChartPage.tsx`):

```
[힐러예약 후 차감] 클릭
  ↓
  1. 프리체크 (치료사 선택 + 활성 패키지 존재 확인)
  ↓
  2. package_sessions.insert → 패키지 회차 차감
  ↓
  3. package_sessions 새로고침 → computeRemainingFromSessionRows → 잔여 회차 실시간 갱신
  ↓
  4. healer_flag ON (다음 예약 있음) 또는 pending_healer_flag ON (없음)
```

- 기존 `healerFlagLoading` 폐기 → `savingHealerDeduct` 통합
- 버튼 disabled 조건에 "활성 패키지 없음" 가드 추가

## AC 체크

| AC | 내용 | 상태 |
|----|------|------|
| AC-1 | 힐러 예약 시 패키지 회차 차감 정상 처리 | ✅ handleHealerDeduct step2 |
| AC-2 | 기존 당일 시술 차감([차감] 버튼) 회귀 없음 | ✅ saveC22Deduct 미변경 |
| AC-3 | 잔여 회차 표시 실시간 갱신 | ✅ step3 sessData 새로고침 |
| AC-4 | HEALER-RESV-BTN 관계 명확화 | ✅ 코드 주석 + 본 문서 |

## 관계

- **T-20260522-foot-PKG-HEALER-DEDUCT** (01ebfc3): 동일 이슈. 본 티켓이 planner MSG 수신 후 재추적. 동일 fix로 해결됨.
- **T-20260516-foot-HEALER-RESV-BTN** v3 (7c1e9c3+96e53b0): 날짜 비교 버그만 수정. 패키지 차감 미포함. 독립적.
