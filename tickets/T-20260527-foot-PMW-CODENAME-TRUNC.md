---
id: T-20260527-foot-PMW-CODENAME-TRUNC
title: 결제 미니창 "수가 항목" 코드명 text-overflow 잘림 해소
domain: foot
priority: P1
status: deploy-ready
created: 2026-05-27
deploy-ready: true
build-status: pass
db-change: false
spec-file: tests/e2e/T-20260527-foot-PMW-CODENAME-TRUNC.spec.ts
spec-count: 7
---

## 요청

결제 미니창 "수가 항목 (5건)" 영역에서 "재진-롤...", "단순처치 [..." 잘림.
스크린샷 F0B68KZSLRZ 확인 기준.

## 원인 분석

### AC-1: 잘림 CSS 위치 특정

`SortablePricingRow` 컴포넌트 (PaymentMiniWindow.tsx) 코드명 span:

```tsx
<span className="flex-1 font-medium truncate min-w-0" title={service.name}>
```

`truncate` 클래스 = `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`

### 공간 부족 계산 (sm=640px 기준)

| 구성 | 너비 |
|------|------|
| Zone1 (sm:w-20) | 80px |
| Zone3 (sm:w-52) | 208px |
| Zone2 (flex-1) | 352px |
| pricing-list p-2 | -16px |
| row px-1.5 | -12px |
| 고정 버튼합 (drag+checkbox+price+tax+↑↓+remove+gaps) | -206px |
| **코드명 가용** | **~118px** |

"재진-롤링복합레이저치료" (14자 × ~12px) = 168px → **50px 초과 → 잘림**

REDBOX-CODENAME-TRIM(이전 티켓)은 1자→5-6자 개선에 그침. 실제 장문 코드명은 여전히 잘림.

### 배경
- PMW-ORDER-REMOVE(deployed): 서비스 메뉴카드 순서편집 제거 → 별도 문제
- 코드명 잘림은 `SortablePricingRow` (수가 항목 행) CSS 미수정 상태로 잔존

## 수정 내용

### 변경: `truncate` → `break-words leading-tight` (PaymentMiniWindow.tsx:525)

```tsx
// Before
<span className="flex-1 font-medium truncate min-w-0" title={service.name}>

// After
<span className="flex-1 font-medium break-words min-w-0 leading-tight" title={service.name}>
```

**효과:**
- `white-space: nowrap` 해제 → 줄바꿈 허용 (한글은 글자 단위 자동 개행)
- `overflow-wrap: break-word` → 장문 영문도 잘림 없이 처리
- `leading-tight` → 2줄 표시 시 행 간격 최소화 (compact 유지)
- `title={service.name}` tooltip 유지 → 추가 보험

## AC 충족

| AC | 결과 |
|----|------|
| AC-1: 잘림 CSS 위치 특정 | ✅ `truncate` 클래스 (line 523 → 525) |
| AC-2: 코드명 전체 표시 | ✅ break-words 줄바꿈 허용 |
| AC-3: 5건+ 레이아웃 안정 | ✅ overflow-y-auto pricing-list 유지 |
| AC-4: 금액·수량 우측 밀림 없음 | ✅ shrink-0 고정 요소 변경 없음 |
| AC-5: 빌드 통과 | ✅ 3.27s |

## 빌드

```
✓ built in 3.27s
```

## E2E

```
7 passed (14.9s)
```

## DB 변경

없음
