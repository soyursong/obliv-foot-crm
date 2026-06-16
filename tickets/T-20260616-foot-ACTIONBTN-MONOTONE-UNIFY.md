---
ticket_id: T-20260616-foot-ACTIONBTN-MONOTONE-UNIFY
domain: foot
priority: P2
status: deploy-ready
block_reason: ''
requester: 김주연 총괄
owner: agent-fdd-dev-foot
approved_by: planner NEW-TASK MSG-20260616-184955-a85g
stage_done: [Button-variant-single-source, save4-named, teal-action-sweep-35, blue-action-4, nhis-2, build, login-render, auth-render-dashboard-settings]
stage_pending: [supervisor-QA, AC1↔AC5-emerald-action-clarify]
deploy-ready: true
deploy-ready-by: agent-fdd-dev-foot
deploy-ready-at: 2026-06-17
db-change: false
build: pass
spec: e2e 면제(코스메틱 색상 전수교체 — planner 명시 typo). 검증=build PASS + 컴파일 CSS neutral 유틸 확인 + 실브라우저 렌더(login + auth dashboard/settings)
qa_result: self-pass-pending-supervisor
---

# 풋센터 CRM action/저장 버튼 모노톤 통일

primary/action 버튼이 RECOLOR 후 warm Umber(=--primary) / warm teal(remap) / blue / slate / amber 로 혼재.
김주연 총괄 지시 → **action 버튼 한정 모노톤(neutral charcoal/black) 통일**, cancel/secondary → 흰배경+그레이테두리.

## 적용 방침 (단일출처 우선)

### 1. Button 컴포넌트 variant (단일출처 — 435개 `<Button>` 일괄)
`src/components/ui/button.tsx`
- **default**: `bg-primary text-primary-foreground` → `bg-neutral-800 text-white hover:bg-neutral-900`
  - ⚠ `--primary` 토큰 자체는 **불변** → 활성탭·CTA 텍스트(link variant `text-primary`)는 warm Umber 유지 → **RECOLOR AC3 충돌 없음**.
- **outline / secondary** (AC4): `border-neutral-300 bg-background hover:bg-neutral-100` (흰배경+그레이테두리)
- charcoal = neutral-800 #262626 / hover neutral-900 #171717 (RECOLOR 모노 베이스 Gray800·Near-Black 정합)

### 2. 4종 저장 버튼 명시 처리
- **저장**(Packages DialogFooter) — Button default → ①로 자동 모노톤 ✓
- **저장**(고객차트 전화 인라인, CustomerChartPage:4518) — teal outline → `bg-neutral-800 text-white`
- **차감**(CustomerChartPage:6953) — `bg-teal-600` → `bg-neutral-800`
- **힐러예약 후 차감**(CustomerChartPage:6962) — active `bg-slate-500`→`bg-neutral-800`, inactive `amber`→흰배경+그레이테두리(✓ 마크로 상태 구분 유지)
- **자격조회**(NhisLookupPanel Button default) — ①로 자동 모노톤 ✓

### 3. raw filled teal action 버튼 sweep (35건, line-targeted)
`scripts/T-20260616-ACTIONBTN-teal-sweep.mjs` — `bg-teal-500/600/700`+`text-white` filled **action/CTA**만 neutral 치환.
대상: HealthQResultsPanel·DrugFolderTree·KohReportTab·OpinionDocTab·ProgressPlansTab·DutyRosterImportDialog·MedicalChartPanel(6)·AdminLayout·DiagnosisFolderPicker·CheckInDetailSheet·Dashboard(2)·CustomerChartPage(11)·ClinicSettings(2)·Staff(2).

### 4. blue action 버튼 (4건)
- Dashboard add-slot/add-consult 3건 `bg-blue-500`→`bg-neutral-800`
- NhisLookupPanel 갱신 버튼 + 외부조회 링크-버튼 blue→neutral gray outline

## carve-out 불변 검증 (AC5)
다음은 **의도적 미변경**(상태표시·의미색 — RECOLOR warm 유지):
- 칸반 status.ts pin / badge.tsx / index.css `.theme-brown`·`.dark` — `git diff` 0 변경 확인.
- **selected-state 토글**(view===v, basis===, isSelected, primary-flag 뱃지), **today 마커**, **count 뱃지**, **세그먼트 토글** = teal-warm 유지 (action 버튼 아닌 상태표시).
- **역할칩**(Handover therapist=green/other=teal 페어) = 역할 의미색 유지.
- **emerald/green** 전부 유지: 재진·선체험·success·역할칩 + 카메라 **시술 전(slate)/후(emerald)** 의미색 구분.

## ⚠ AC1↔AC5 경계 (planner 질의 — 후속)
`CustomerChartPage:9302 [항목 합산 (+N회)]` submit 버튼이 `bg-emerald-600`. 의미(재진/success 등) 없는 일반 action 이지만 **emerald=명시적 carve-out 색**. AC1(green 0)↔AC5(emerald 불변) 충돌 → 단독 판단으로 carve-out 뒤집지 않고 **유지**. 김주연 총괄/ planner 결정 시 후속 치환. (MedicalChartPanel 카테고리칩 treat=blue/doc=emerald 도 동일 — 데이터 구분 의미색, 유지.)

## 검증
- `npm run build` PASS (4.30s)
- 컴파일 CSS: `bg-neutral-800{rgb(38 38 38)}` · `hover:bg-neutral-900:hover{rgb(23 23 23)}` · `border-neutral-300{rgb(212 212 212)}` 생성 확인
- 변환 라인 35+4+4건 teal/blue/green/amber/slate **잔존 0** (스크립트 audit)
- 실브라우저 렌더:
  - `evidence/..._login-render.png` — 로그인 버튼 rgb(38,38,38) charcoal (이전 Umber→모노톤)
  - `evidence/..._dashboard.png` — 체크인(action) rgb(38,38,38), green/blue filled action 0
  - `evidence/..._settings.png`

## AC 결과
- AC1 저장4종+전역 action 모노톤(green/blue 0) — ✓ (단 emerald 일반 action 1건 carve-out 충돌로 유지·질의)
- AC2 높이·폰트·radius 일관 — ✓ (색상만 변경, 사이즈 무변경)
- AC3 RECOLOR 방향성 충돌 없음 — ✓ (--primary 토큰·teal 램프·장식 teal 텍스트/보더 불변)
- AC4 secondary/cancel 흰배경+그레이테두리 — ✓ (outline/secondary variant)
- AC5 의미색 carve-out 불변 — ✓ (status.ts/badge/theme-brown git diff 0)

## CHART2-TAB-BTN-DECOLOR 정합
chart2 겹침 파일(ReservationDetailPopup·Chart2InsuranceCalcPanel)은 본 teal-action 목록에 없어 최소 겹침. 양 티켓 동일 neutral 타깃(neutral-800/900) 사용 → 색상 정합 유지.
