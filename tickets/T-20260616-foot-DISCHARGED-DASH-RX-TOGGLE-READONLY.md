---
id: T-20260616-foot-DISCHARGED-DASH-RX-TOGGLE-READONLY
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260616-foot-DISCHARGED-DASH-RX-TOGGLE-READONLY.spec.ts
e2e_spec_exempt_reason: null
created: 2026-06-16
assignee: dev-foot
reporter: 문지은 대표원장
source-msg: MSG-20260616-211855-ej2z
---

# T-20260616-foot-DISCHARGED-DASH-RX-TOGGLE-READONLY — 귀가 환자 처방·임상경과 영역 readonly 잠금

진료대시보드(DoctorCallDashboard) 진료완료 섹션에서 **귀가(discharged) 환자의 처방/임상경과 영역 토글이
열리며 editable input 이 활성화되던 누수**를 close. 펼침(읽기)은 유지하되 작성·수정 진입만 차단.

## 배경 (정책 역전 아님)
deployed 안전정책 T-20260609-QUICKRX-INCLINIC-GATE + T-20260611-DISCHARGED-DASH-RXMUTATE-LOCK 의
누수 close(강화). 귀가 환자 in-place mutate 차단 SSOT(inClinicRxGate/rxMutationGuard, fail-closed)는
유지하고, UI 진입점에서도 editable 토글이 안 열리도록 한 번 더 막는다.

## 누수 진단 (diff-first, planner read-only + dev 전수 점검)
CompletedRow 토글 전수 점검 결과:
- 처방 셀: 귀가는 이미 `'-'`(잠김, L1404~). 회귀 아님.
- RxConfirmedSummary(확정 처방, split 모드): 귀가 = `blockedByGate=true` → `cancellable=false` →
  연필(빠른수정 진입) 미렌더(QuickRxBar L845), 펼침(읽기)·'차트에서 수정' 동선만 유지. **이미 닫힘**.
- HandToggle(✋): 완료 모드 안내 토스트만 — editable 없음.
- 이름 클릭: 풀차트 네비게이션(별도 surface, T-20260611 LOCK + 자체 게이트). 인라인 입력 아님 = scope 밖.
- ⚠ **임상경과 빈값 '—' 셀(L1427~)**: 귀가도 클릭 → `setShowClinical(true)` →
  인라인 MedicalChartPanel(editable) 오픈 = **유일한 누수**.

## 수정 (DoctorCallDashboard.tsx, CompletedRow, FE-only)
1. **임상경과 빈값 셀** — `discharged` 분기 신설 → 클릭 불가 readonly `<span>—</span>`
   (`doctor-completed-clinical-empty-readonly`). 작성 진입점(onClick/setShowClinical) 제거.
2. **인라인 임상경과 편집행** — `showClinical && !discharged && customer_id` 이중방어(fail-closed):
   진입점을 막았어도 showClinical 이 어떤 경로로 true 가 되더라도 editable input 미렌더.

## AC 충족
- **AC-1 토글 차단**: 귀가 임상경과 빈값 셀이 readonly span(편집창 미진입) + 인라인 편집행 `!discharged` 게이트. ✓
- **AC-2 열려도 readonly**: clinicalPreview 펼침은 read-only div(whitespace-pre-wrap, input/textarea/select 부재). ✓
- **AC-3 disabled UX**: readonly span = `text-gray-300`(회색) + `cursor-default` + hover/underline 클래스 부재. ✓
- **AC-4 원내잔류 무회귀**: `!discharged` 작성 버튼·처방 popover·QuickRxBar 인라인·대기섹션(CallFeedRow) 전부 무변경. ✓
- **AC-5 안전게이트 무접촉**: inClinicRxGate/rxMutationGuard fail-closed 판정 회귀 0(spec 검증). ✓

## 검증
- tsc exit 0 · vite build OK 4.15s.
- E2E `tests/e2e/T-20260616-foot-DISCHARGED-DASH-RX-TOGGLE-READONLY.spec.ts` **12 PASS**
  (S1 AC-1/2/3 4건 + S2 AC-4 3건 + S3 AC-5 5건. 완료/대기 셀 블록 격리 검증 + 게이트 판정 회귀 + 가드 에러 변환).
- DB변경: 없음.

## 현장 클릭 시나리오 (supervisor 갤탭 실기기 confirm)
1. 진료대시보드 → 진료완료 섹션 → 귀가('귀가' 상태, emerald dot) 환자 행.
2. 임상경과 칸의 '—'(빈값) 클릭 → 편집창(input) 안 열림 + 회색 readonly. (이전: 편집창 열림 = 버그)
3. 처방완료(파란 약요약) 환자 귀가 행 → 본문 클릭 시 펼침(읽기)만, 연필(수정) 버튼 없음 + '차트에서 수정' 안내.
4. (무회귀) 원내잔류('귀가 대기' amber) 환자는 임상경과 '—' 클릭 시 종전대로 작성창 열림.

## 잔여 게이트
- supervisor 표준 QA + 김주연 총괄/문지은 대표원장 갤탭 실기기 현장 confirm.
