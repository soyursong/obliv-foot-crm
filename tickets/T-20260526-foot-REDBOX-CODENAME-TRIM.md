---
id: T-20260526-foot-REDBOX-CODENAME-TRIM
title: 수가 코드명 잘림 해소 + DnD 빨간박스 확인
domain: foot
priority: P2
status: deploy-ready
created: 2026-05-26
deploy-ready: true
build-status: pass
db-change: false
spec-file: tests/e2e/T-20260526-foot-REDBOX-CODENAME-TRIM.spec.ts
spec-count: 5
---

## 요청

김주연 총괄: 수가 영역에 빨간박스가 보이고 수가 코드명이 잘림.
"순서 배치 기능 때문이면 그냥 제거해줘"

## 원인 분석

### AC-1: 빨간박스 원인 특정
- 코드 전체 조사: PaymentMiniWindow.tsx, index.css, dnd-kit 라이브러리 내부까지 확인
- `border-red`, `ring-red`, `outline-red` 클래스 없음
- 스크린샷의 red rectangle = **iOS/MacOS Screenshot 마크업 annotation** (코드 산출물 아님)
- DnD 라이브러리(dnd-kit)는 기본적으로 red border를 추가하지 않음
- 결론: 순서배치 기능이 red box UI를 만들지 않음 → AC-2 N/A

### AC-3: 수가 코드명 잘림 원인
**FEE-ITEM-REORDER(7b95bb3)** 가 수정한 내용:
- drag handle: p-0.5 → `min-w-[28px]` min-h-[28px] (추가 +28px)
- ↑↓ 버튼: p-0 h-2.5 w-2.5(10px) → `min-w-[32px]` (추가 +32px)

Zone2 너비 sm:w-60 = 240px, 패딩 12px → 가용 228px

변경 전 고정 요소: checkbox(12) + code(36) + price(64) + tax(20) + delete(16) = 148px + gap 20px = 168px
→ name 가용: 228 - 168 = 60px (**양호**)

변경 후 (REORDER 추가): +28(handle) +32(↑↓) + 2gap(8) = +68px
→ name 가용: 60 - 68 = **-8px (붕괴 → 1자만 표시)**

## 수정 내용

### 변경 1: 코드번호 컬럼 제거 (+40px 확보)
- `<span className="w-9 shrink-0 ...">service_code</span>` 제거
- 코드번호는 Zone1(좌측 서비스 선택 영역)에 이미 표시됨 → 중복 제거
- name span에 `title={service.name}` tooltip 추가

### 변경 2: drag handle 축소 (+8px 확보)
- `min-w-[28px] min-h-[28px]` → `min-w-[20px] min-h-[20px]`
- `p-1` → `p-0.5`, `h-3.5 w-3.5` → `h-3 w-3`
- `outline-none focus:outline-none` 추가 → 브라우저 포커스 링 제거

### 변경 3: ↑↓ 버튼 너비 소폭 축소 (+8px 확보)
- `min-w-[32px]` → `min-w-[24px]`
- `p-1.5` → `p-1`
- min-h-[22px] 유지 (세로 터치 타깃 보존)
- 기능(↑↓ 순서 변경, data-testid) 완전 보존

### 변경 4: Zone2 너비 확장 (+16px 확보)
- `sm:w-60` → `sm:w-64` (md/lg는 그대로)

### 총 개선
- 확보 공간: 40+8+8+16 = **+72px**
- name 가용: -8 + 72 = **64px → 약 5-6자 표시**
- 이전 1자 → 이후 5-6자 (재진진찰료-의원의 "재진진찰료" 표시)

## AC 충족

| AC | 결과 |
|----|------|
| AC-1: 빨간박스 원인 특정 | ✅ annotation임 확인 (코드 내 red border 없음) |
| AC-2: 빨간박스 UI 제거 | N/A (코드 산출물 아님) |
| AC-3: 수가 코드명 표시 개선 | ✅ 1자 → 5-6자 표시 |
| AC-4: 순서 변경 기능 유지 | ✅ drag handle + ↑↓ buttons + DnD 모두 보존 |
| AC-5: 빌드 통과 | ✅ 3.23s |

## 빌드
```
✓ built in 3.23s
```

## E2E
```
6 passed (14.8s)
```

## DB 변경
없음
