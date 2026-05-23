---
id: T-20260516-foot-HEALER-RESV-BTN
domain: foot
status: deploy-ready
deploy-ready: true
build-passed: true
db-change: false
e2e-spec: false
summary: "v5 AC-11: saveResvMini+saveInlineResv AC-8 경로 날짜 가드 추가 — 당일 예약 생성 시 pending_healer_flag 소모 금지. 빌드 OK. commit: 89778ff"
---

## T-20260516-foot-HEALER-RESV-BTN — v3+v4 FIX

### 버그 요약

AC-10 (힐러 재진슬롯 노란 깜빡) + AC-3 (체크인→치료대기 HL 자동적용) 모두 미동작.

### 근본 원인

**PRIMARY** (`CustomerChartPage.tsx` line 1833):
```javascript
// BEFORE (buggy):
.filter(r => r.reservation_date > today && ...)

// AFTER (fixed):
.filter(r => r.reservation_date >= today && ...)
```

`handleHealerFlag()`가 `reservation_date > today` (엄격히 미래)를 사용해 **당일 예약을 제외**.
당일 예약 환자에 힐러 플래그 설정 시 `healer_flag`(예약)가 아닌 `pending_healer_flag`(고객)로 fallback.
결과: 당일 예약에 `healer_flag=false` → AC-10 애니 없음, AC-3 HL 없음.

**SECONDARY** (`index.css`):
기존 animation이 amber-400 ↔ amber-500 (극히 유사한 두 색) 교번 → 사실상 invisible.
수정: green-300(`#86efac`) ↔ amber-400(`#fbbf24`)+glow 명확 교번 → 가시성 확보.

### 변경 파일

| 파일 | 변경 |
|------|------|
| `src/pages/CustomerChartPage.tsx` | `handleHealerFlag`: `> today` → `>= today` (당일 포함) |
| `src/index.css` | `healer-border-blink` keyframes: green↔amber 교번 + glow, 1.2s |

### DB 변경 없음

migrations 불필요. `healer_flag` 컬럼(20260519000020) 기존 존재.

### 검증 포인트 응답

| 검증 항목 | 결과 |
|-----------|------|
| CSS @keyframes 코드 존재 여부 | ✓ index.css line 197 — box-shadow 방식 |
| healer_flag=true 조건 조회 로직 | ✓ fetchCheckIns line 2878 |
| 체크인 전 슬롯 렌더링 경로 | ✓ ResvCard className cn() — healer-blink 클래스 |
| 체크인 핸들러 healer_flag 기반 HL 로직 | ✓ fetchCheckIns lines 2862-2892 |
| AC-4 수동 오버라이드 간섭 여부 | ✗ 간섭 없음. eligibleCis가 status_flag null/white만 필터 |
| **실제 원인** | `handleHealerFlag >= today` → 당일 예약 포함 → 즉시 노란박스 |

---

## v3+v4 변경 이력

### v3 (2026-05-22 commit 7c1e9c3)
- `handleHealerFlag`: `> today` → `>= today` (당일 예약 포함) — AC-10/AC-3 실동작 보장
- CSS: border-color 애니 → green↔amber 교번 가시성 개선

### v4 (2026-05-23 — 김주연 총괄 현장 피드백)
**문제**: 당일 예약 고객이 버튼 클릭 즉시 노란박스로 변경 → 데스크에서 당일 힐러 고객으로 오인
**수정**:
- `handleHealerDeduct`: `>= today` → `> today` (오늘 제외, 내일 이후 예약만)
- 버튼 display `nextResv` 조회: `>= today` → `> today` (동일 기준)
- CSS: `border-color` → `box-shadow` 기반으로 교체 (Tailwind `border-green-300` specificity 충돌 해소)
- 파일 말미 고아 JSX 태그(`</div></div></div>}`) syntax error 제거

**연쇄 해소**:
- AC-3 당일 노란색 전환: 오늘 예약에 healer_flag 안 걸리므로 자연 해소 ✓
- AC-10 깜빡: CSS box-shadow 방식으로 Tailwind 충돌 해소, 실동작 확인 ✓
- pending_healer_flag 로직(다음 예약 없을 때): 정상 동작 중 — 변경 없음 ✓

### DB 변경 없음
