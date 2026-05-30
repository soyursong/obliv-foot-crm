---
id: T-20260525-foot-PMW-SCROLL-FIX
domain: foot
priority: P1
status: deploy-ready
qa_result: pending
qa_fail_reason: ""
qa_fail_phase: ""
deploy_ready: true
deploy_ready_at: "2026-05-30T17:30:00+09:00"
deploy_ready_commit: 154cb5d
deploy_ready_build: "PASS (vite 3.45s, total 11s) — re-verified 2026-05-30, phase1 build_fail은 false-negative(환경 timeout)"
deploy_ready_e2e: tests/e2e/T-20260525-foot-PMW-SCROLL-FIX.spec.ts
deploy_ready_db_change: "없음 (FE CSS only)"
fix_detail: "FIX-REQUEST(scenario_missing) 해소 — 현장 클릭 시나리오 섹션 추가. AC-1 세트코드 드롭다운 max-h-48/AC-2 action buttons shrink+min-h-0+overflow-y-auto 구현 코드(32982b8) 확인 완료."
build_status: "PASS (3.33s)"
db_change: false
e2e_spec: tests/e2e/T-20260525-foot-PMW-SCROLL-FIX.spec.ts
hotfix: false
created: 2026-05-25 20:38
deadline: 2026-05-28
slack_channel: C0ATE5P6JTH
reporter: 김주연 총괄
risk_verdict: GO
risk_reason: "FE-only CSS/레이아웃 변경. DB·외부API·비즈로직·대량데이터·npm 변경 없음 (0/5)"
related:
  - T-20260523-foot-FEE-ITEM-SCROLL (deploy-ready, e7305e8 — 세트코드 드롭다운 스크롤 미포함)
  - T-20260522-foot-PAY-INPUT-001 (deployed — 카드 정보 박스 추가 원인)
promoted_from: P2
promotion_reason: "카드 결제 수납 처리 자체 불가 (운영 차단)"
---

# T-20260525-foot-PMW-SCROLL-FIX — 수납방법 카드 선택 시 수납 버튼 클리핑 + 세트코드 드롭다운 스크롤

## 배경

1. **수납 버튼 클리핑**: PaymentMiniWindow Zone2 action buttons 섹션이 `shrink-0`이라 카드
   결제 선택 시 추가 출현하는 카드 정보 박스(승인번호·TID)가 action buttons 높이를 ~287px로
   늘려, 소형 뷰포트(태블릿, 92vh 제약)에서 Zone2 총 fixed 요소 합산이 600px 초과 →
   `sm:overflow-hidden` 부모가 수납 버튼 클리핑 → 카드 결제 수납 처리 불가.

2. **세트코드 드롭다운 스크롤 미포함**: T-20260523-foot-FEE-ITEM-SCROLL(e7305e8)은
   수가 항목 컨테이너 높이만 수정. 세트코드 드롭다운 목록(`absolute z-50`)에는
   max-height·overflow-y-auto 없음 → 세트 템플릿 다수 시 목록이 창 아래로 무한 확장.
   **FEE-ITEM-SCROLL 배포가 세트코드 드롭다운 스크롤을 커버하지 않음 — 별도 FIX 필요.**

## 수용 기준

- **[x] AC-1**: 세트코드 드롭다운 목록에 `max-h-48 overflow-y-auto` 추가 → 항목 다수 시 스크롤
- **[x] AC-2**: Zone2 action buttons `shrink-0` → `shrink min-h-0 overflow-y-auto` 변경 →
  카드 정보 박스 출현 후에도 수납 버튼 스크롤로 접근 가능
- **[x] AC-3**: 카드 외 결제수단(현금·이체·패키지) 선택 시 수납 버튼 정상 노출 회귀 없음
- **[x] AC-4**: 수가 항목 0건 상태에서 액션 버튼 영역 이상 없음
- **[x] AC-5**: 세트 템플릿 3건 이하 시 스크롤 없이 정상 출력

## 현장 클릭 시나리오

### A. 수납 버튼 클리핑 수정 (AC-2) — 카드 결제 선택 시

**사전 조건**: 수납대기(`payment_wait`) 상태 환자 1명 이상. 1개 이상의 수가 항목이 저장된 상태.

| # | 액션 | 기대 결과 |
|---|------|-----------|
| 1 | 대시보드(`/admin`) → 수납대기 칸반에서 `[data-testid="btn-pay"]` 클릭 | PaymentMiniWindow 열림 |
| 2 | Zone2(가운데) 수가 항목 입력 후 "시술 저장 및 포함 금액 산정" 버튼 클릭 | 저장 완료 → `data-testid="btn-settle"` 표시 |
| 3 | 결제수단 버튼 중 "카드" 클릭 | 카드 정보 박스(승인번호·카드 TID) 추가 출현, action buttons 높이 증가 |
| 4 | `[data-testid="btn-settle"]` (수납 버튼)을 `scrollIntoViewIfNeeded()` 후 확인 | 버튼이 뷰포트 내 visible, 클릭 가능 (클리핑 없음) |
| 5 | action buttons 컨테이너 class 확인 | `shrink-0` 미포함, `overflow-y-auto` 포함, `shrink` 포함 |

**검증 포인트 (AC-2, AC-3)**:
- `[data-testid="btn-settle"]` `.isVisible()` → `true`
- action buttons div class: `shrink-0` 미포함 ✓, `overflow-y-auto` 포함 ✓
- 현금/이체/패키지 선택 시에도 `[data-testid="btn-settle"]` visible ✓

---

### B. 세트코드 드롭다운 스크롤 (AC-1) — 항목 다수 시

**사전 조건**: 관리자 설정에서 세트코드 템플릿(`fee_set_templates`) 1개 이상 등록.

| # | 액션 | 기대 결과 |
|---|------|-----------|
| 1 | 대시보드 → PaymentMiniWindow 열기 | Zone2 표시 |
| 2 | `[data-testid="fee-set-dropdown-btn"]` 클릭 | 세트코드 드롭다운 목록 펼침 |
| 3 | `[data-testid="fee-set-dropdown-list"]` class 확인 | `max-h-48`, `overflow-y-auto` 포함 |
| 4 | 세트코드 템플릿 3건 이하 시 스크롤바 없음 확인 | 목록이 자연스럽게 펼침 (overflow 미발생) |
| 5 | 드롭다운 버튼 재클릭 | 목록 닫힘 |

**검증 포인트 (AC-1, AC-5)**:
- `[data-testid="fee-set-dropdown-list"]` class에 `max-h-48` ✓, `overflow-y-auto` ✓

---

### E2E spec ↔ 시나리오 매핑

| AC | spec 테스트명 | 대응 시나리오 단계 |
|----|--------------|-----------------|
| AC-1 | `AC-1: 세트코드 드롭다운 리스트에 max-h-48 overflow-y-auto 클래스 포함` | B 단계 2-3 |
| AC-2 | `AC-2: 카드 결제 선택 후 수납 버튼이 클릭 가능 (클리핑 없음)` | A 단계 2-4 |
| AC-3 | `AC-3: action buttons 컨테이너 CSS 클래스 — shrink-0 제거, overflow-y-auto 추가 확인` | A 단계 5 |
| AC-4/5 | `AC-4/5: PaymentMiniWindow 기본 렌더 확인` | B 전체 + A 단계 1 |

---

### 공통 구조 확인 포인트
- `PaymentMiniWindow.tsx` Zone2 action buttons div (line 2096): `overflow-y-auto border-t shrink min-h-0` ✓
- 세트코드 드롭다운 list div (line 1936): `max-h-48 overflow-y-auto` ✓
- `shrink-0` 제거 여부: action buttons 영역에 `shrink-0` 미존재 ✓

## 리스크 5항목

| # | 항목 | 판정 | 근거 |
|---|------|------|------|
| 1 | DB 스키마 변경 | ✅ 없음 | FE CSS/레이아웃 only |
| 2 | 외부 서비스 의존 | ✅ 없음 | — |
| 3 | 비즈니스 로직 변경 | ✅ 없음 | 표시 영역 레이아웃만 |
| 4 | 대량 데이터 변경 | ✅ 없음 | — |
| 5 | 신규 npm 패키지 | ✅ 없음 | — |

**판정: GO (0/5)**

## 기술 참고

- 대상 컴포넌트: `src/components/PaymentMiniWindow.tsx`
- Fix 1: action buttons div — `shrink-0` → `shrink min-h-0 overflow-y-auto` (line 2096)
  - Zone2 flex-col에서 (fee items flex-1 + action buttons shrink)로 자연스럽게 shrink budget 배분
  - 공간 부족 시 action buttons가 압축되고 overflow-y-auto로 스크롤 발생
- Fix 2: 세트코드 드롭다운 list div — `max-h-48 overflow-y-auto` 추가 (line 1936)
- 구현 포함 커밋: `32982b8` (feat(foot): T-20260525-foot-FEE-ITEM-REORDER)

## FIX-REQUEST 처리 (2026-05-30, MSG-20260530-171027-khmh)

**supervisor phase1 build_fail (TIMEOUT after 60s) → false-negative 확정.**

빌드 재검증 결과 (cwd: `/Users/domas/Documents/GitHub/obliv-foot-crm`, HEAD `154cb5d` == origin/main):

| 시나리오 | 명령 | 결과 |
|----------|------|------|
| warm | `timeout 180 npm run build` | EXIT=0, 11s (vite 3.45s) |
| cold-tsc (tsbuildinfo 삭제) | `npm run build` | EXIT=0, 11s (vite 3.65s) |
| full-cold (`npm ci` 후 tsbuildinfo 삭제) | `npm ci` 6s + `npm run build` | EXIT=0, 빌드 11s (vite 3.38s) |

- install 훅(preinstall/postinstall/prepare) 없음 → hang 위험 없음.
- 최악(fresh checkout) 합산 ≈ 17s. 60s 근처 아님.
- 직전 T-20260529-foot-CHART-OPEN-SINGLE 과 동일한 60s build timeout false-negative 패턴.
- AC 코드 HEAD 실존 확인: 세트코드 드롭다운 list `max-h-48 overflow-y-auto`(line 1879),
  action buttons div `overflow-y-auto border-t shrink min-h-0`(line 2030, shrink-0 미존재).

**원인 추정: macstudio 멀티 에이전트 동시 실행으로 인한 리소스 경합 → 11s 빌드가 60s timeout 초과.**
**권고: supervisor 빌드 검증 timeout 60s → 180s 상향 또는 warm 캐시 후 측정.**
