---
id: T-20260516-foot-HEALER-RESV-BTN
domain: foot
status: deploy-ready
deploy-ready: true
build-passed: true
db-change: false
e2e-spec: false
summary: "AC-10 healer_flag 깜빡 + AC-3 체크인 HL 자동 적용 — v3 fix: handleHealerFlag 당일예약 포함 + CSS 가시성 개선"
---

## T-20260516-foot-HEALER-RESV-BTN — v3 FIX

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
| CSS @keyframes 코드 존재 여부 | ✓ index.css line 192 |
| healer_flag=true 조건 조회 로직 | ✓ fetchCheckIns line 2378 |
| 체크인 전 슬롯 렌더링 경로 | ✓ ResvCard className cn() line 1299 |
| 체크인 핸들러 healer_flag 기반 HL 로직 | ✓ fetchCheckIns line 2366-2396 |
| AC-4 수동 오버라이드 간섭 여부 | ✗ 간섭 없음. eligibleCis가 status_flag null/white만 필터 — 새 체크인은 null로 생성 |
| **실제 원인** | `handleHealerFlag > today` → 당일 예약 제외 → healer_flag never set |
