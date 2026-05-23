---
id: T-20260522-foot-TOUCH-EXPAND
title: "태블릿 터치영역(버튼·셀·탭) 최소 44px 확대"
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-05-22
deadline: 2026-05-26
착수예정: 2026-05-24
completed_at: 2026-05-22
deploy_ready: true
deploy_ready_at: 2026-05-22
fix_commit: 2c60a30
build_ok: true
db_migration: false
db_change: false
e2e_spec: tests/e2e/T-20260522-foot-TOUCH-EXPAND.spec.ts
assignee: dev-foot
depends_on:
  - T-20260522-foot-PENCHART-REFUND-AUTOFILL
source: planner MSG-20260522-011218-g41d
---

# T-20260522-foot-TOUCH-EXPAND (P1)

## 배경

태블릿(갤럭시 탭 S9) 사용 시 작은 버튼·탭·셀의 미스터치가 빈번함.
Apple HIG / Material Design 권장: 최소 터치 타겟 44×44px.
현재 foot-crm에 24px~32px 버튼/탭 다수 존재.

## 스펙

### 대상 범위

#### 1. 칸반 컬럼 헤더 탭 (KanbanBoard)
- 현재: `text-sm py-1 px-2` → `min-h-[44px] py-2 px-3`
- 탭 전환 버튼 전체 (신규/재진/체험 등)

#### 2. 고객 카드 액션 버튼
- 칸반 카드 내 [이동] [상세] 버튼: `min-h-[44px] min-w-[44px]`
- 패키지 회차 소진 [-] [+] 버튼

#### 3. 테이블/목록 행 (예약관리, 고객관리)
- 행 높이: `min-h-[44px]` 보장
- 현재 `h-10(40px)` → `min-h-[44px]`

#### 4. 탭 네비게이션 (CustomerChartPage 탭 등)
- 탭 버튼: `py-3` 이상 보장 → 최소 44px 높이

#### 5. 드롭다운·셀렉트 트리거
- Select 컴포넌트: `min-h-[44px]`

### 구현 방식
- 전역 CSS 변수: `--touch-min: 44px`
- Tailwind 커스텀: `touch-target` = `min-h-[44px] min-w-[44px]`
- 기존 버튼 클래스에 `touch-target` 추가 (기존 스타일 override 최소화)
- 스크롤 레이아웃에 영향 주는 변경은 flex/grid 내 shrink-0 병행

### 변경 파일 (예상)
- `src/index.css` — `--touch-min`, `.touch-target` 추가
- `tailwind.config.js` — `extend.minHeight.touch` 추가
- `src/components/KanbanBoard.tsx` — 탭·카드 버튼
- `src/components/PackageManagement.tsx` — [-]/[+] 버튼
- `src/pages/ReservationPage.tsx` — 행 높이
- `src/pages/CustomerListPage.tsx` — 행 높이
- `src/pages/CustomerChartPage.tsx` — 탭 버튼

## 수용기준

- AC-1: 칸반 탭 버튼 모두 min-h-44px 이상
- AC-2: 패키지 [-]/[+] 버튼 44×44px 이상
- AC-3: 예약/고객 목록 행 높이 44px 이상
- AC-4: 기존 레이아웃 깨짐 없음 (빌드 OK)
- AC-5: 데스크탑 뷰에서도 시각적 이상 없음
- AC-6: E2E spec — 주요 버튼 클릭 시나리오 통과

## 착수 조건

- T-20260522-foot-PENCHART-REFUND-AUTOFILL deploy-ready
