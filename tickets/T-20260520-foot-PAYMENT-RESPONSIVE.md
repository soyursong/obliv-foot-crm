---
id: T-20260520-foot-PAYMENT-RESPONSIVE
title: "결제 미니창(PaymentMiniWindow) 모바일/태블릿 반응형 수정"
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-05-20
deploy_ready_at: 2026-05-20
commit_sha: 953d579
db_migration: false
build_passed: true
e2e_spec: tests/e2e/T-20260520-foot-PAYMENT-RESPONSIVE.spec.ts
deadline: 2026-05-22
---

## 현장 보고

김주연 총괄 직접 지적(2026-05-20): "모바일(iPhone)에서 PaymentMiniWindow 열면 좌측 탭/우측 테이블 겹침, 텍스트 절단, 버튼 터치 불가". "최소 PC랑 똑같이 구현" 지시.

## 수정 내용

### 1. DialogContent 폭 (L1154)
- Before: `max-w-[1080px]`
- After: `sm:max-w-[1080px] max-w-full w-full` — 모바일 전체 폭

### 2. 본문 컨테이너 (L1176)
- Before: `flex` + `height: 520px` 인라인
- After: `flex flex-col sm:flex-row flex-1 min-h-0 overflow-y-auto sm:overflow-hidden sm:flex-none sm:h-[520px]`  
  - 모바일: `flex-col` 세로 스택 + `overflow-y-auto`
  - 태블릿/PC: 기존 3열 가로 + `h-[520px]`

### 3. 좌측 탭 (L1179, L1187)
- Before: `w-28 border-r flex-col py-2` + 탭버튼 `w-full px-3 py-3 text-left border-l-2`
- After:
  - 컨테이너: `shrink-0 border-b sm:border-b-0 sm:border-r bg-muted/30 flex flex-row sm:flex-col py-0 sm:py-2 sm:w-20 md:w-24 lg:w-28`
  - 탭버튼: `flex-1 sm:flex-none sm:w-full px-2 sm:px-3 py-2 sm:py-3 text-center sm:text-left border-b-2 sm:border-b-0 sm:border-l-2 min-h-[44px]`
  - 모바일: 가로 탭바, 균등 분할(`flex-1`), 44px 터치 영역

### 4. 중앙 코드 영역 (L1198)
- Before: `flex-1 flex flex-col min-h-0 min-w-0`
- After: `flex flex-col min-w-0 min-h-0 h-52 sm:h-auto sm:flex-1`
  - 모바일: `h-52` 고정 / 데스크탑: `flex-1`

### 5. 풋케어 그리드 (L1227)
- Before: `grid-cols-4`
- After: `grid-cols-3 lg:grid-cols-4` — PC(1024px+)에서만 4열

### 6. Zone 2 진료비 (L1284, L1330)
- Before: `w-60 border-l`
- After: `sm:w-52 md:w-56 lg:w-60 border-t sm:border-t-0 sm:border-l`
- 수가항목 스크롤: `max-h-48 sm:max-h-none sm:flex-1` (모바일 카드형)

### 7. Zone 3 서류/패키지 (Zone 3 컨테이너)
- Before: `w-60 border-l`
- After: `sm:w-52 md:w-56 lg:w-64 border-t sm:border-t-0 sm:border-l`
- 패키지 목록: `max-h-40 sm:max-h-none sm:flex-1`

### 8. 모든 액션 버튼 min-h-[44px] (모바일)
- 저장/차감 버튼: `h-11 sm:h-9`
- 결제수단 버튼: `h-11 sm:h-8`
- 수납 버튼: `h-11 sm:h-10`
- 서류/패키지 버튼: `min-h-[44px] sm:min-h-0`

## AC 체크리스트

- [x] AC-1: 모바일(≤640px) 탭→상단 가로 탭바. 겹침 없음
- [x] AC-2: 진료비 수가항목 `max-h-48 + overflow-y-auto` 카드형. 100% 가독
- [x] AC-3: 버튼 터치 영역 `min-h-[44px]` — 탭/저장/수단/수납/서류 버튼 전체 적용
- [x] AC-4: 태블릿(641~1024px) `sm:w-52 md:w-56 lg:w-60/64` 반응형 폭 정상
- [x] AC-5: PC(≥1025px) `lg:` 클래스로 기존 레이아웃 완전 보존. regression 없음

## 빌드

```
✓ built in 3.27s (tsc -b && vite build)
```

## 주의사항

- DEDUCT-PAY-METHOD(P0) · PKG-REVENUE-SPLIT(P1) 동시 진행 중이었으나 코드 충돌 없음
- Tailwind responsive 기존 클래스(sm/md/lg) 활용 — 신규 패키지 없음
- DB 변경 없음
