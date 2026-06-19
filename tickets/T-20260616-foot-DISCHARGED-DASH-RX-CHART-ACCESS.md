---
id: T-20260616-foot-DISCHARGED-DASH-RX-CHART-ACCESS
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260616-foot-DISCHARGED-DASH-RX-CHART-ACCESS.spec.ts
e2e_spec_exempt_reason: null
medical_confirm_gate: required
confirm_status: confirmed
created: 2026-06-16
assignee: dev-foot
reporter: 문지은 대표원장
source-msg: MSG-20260620-024046-sxco
confirm-msg: MSG-20260620-023304-oyu3
---

# T-20260616-foot-DISCHARGED-DASH-RX-CHART-ACCESS — 귀가 환자 행 처방/차트 1클릭 진입 (A안)

진료대시보드(DoctorCallDashboard) 진료완료 섹션에서 귀가(status='done', discharged) 환자 행의
처방/임상경과 진입점이 **데드버튼·숨김으로 찾아 들어가야 하던 동선**이라, reporter(문지은 대표원장)
A안 확정에 따라 **클릭 시 진료차트(MedicalChartPanel 서랍)가 1클릭으로 바로 열림**으로 통일.

## reporter CONFIRM (A안, MSG-20260620-023304-oyu3 item4)
> "잠금유지하면서 차트는 열리게 해줘. 직접 차트 열어서 수정만 가능하게 (귀가완료환자 기준)"

## 작업 (비파괴 동선단축 only, FE-only)
1. **처방 셀 — 귀가·미처방 '-'**(L1475~): 정적 데드텍스트 → 1클릭 `onOpenChart('full')` 버튼.
   QuickRxBar(인플레이스 처방 입력)는 이 진입점에서 미렌더 — 처방 수정은 차트 안에서만.
2. **임상경과 셀 — 귀가 빈값 '—'**(L1498~): readonly span(TOGGLE-READONLY S1) → 1클릭 `onOpenChart('full')` 버튼.
   `setShowClinical`(인라인 MedicalChartPanel embed editable) 미사용 — 작성·수정은 풀차트 서랍 안에서만.
   ⚠ supersede: TOGGLE-READONLY S1 readonly-span(데드)을 차트오픈 진입으로 대체. 인플레이스 작성 차단은 유지.
3. **customer_id 결측 폴백**: 차트 진입 불가 시 종전 readonly span(`doctor-completed-clinical-empty-readonly`) 유지(클릭 불가).
4. **확정 처방(RxConfirmedSummary)**: 귀가(blockedByGate)는 기존대로 '차트에서 수정'(onOpenChart) 진입 — 이미 일관(무변경).

## ★ 안전게이트 회귀 금지 (reporter "잠금유지" 명시 조건)
- 대시보드 인플레이스 처방 mutate(apply/cancel/confirm) **여전히 차단** —
  rxMutationGuard fail-closed / inClinicRxGate / RX-TOGGLE-READONLY 게이트 **무접촉**.
- 인라인 임상경과 편집행(`showClinical && !discharged && customer_id`) 게이트 무접촉 — 귀가 인라인 editable 미렌더.
- T-20260609-QUICKRX-INCLINIC-GATE / T-20260611-DISCHARGED-DASH-RXMUTATE-LOCK 판정 회귀 0(spec 검증).

## 검증
- tsc exit 0 · vite build OK 4.45s.
- E2E `tests/e2e/T-20260616-foot-DISCHARGED-DASH-RX-CHART-ACCESS.spec.ts` (S1 4건 + S2 5건) +
  supersede 갱신한 `T-20260616-foot-DISCHARGED-DASH-RX-TOGGLE-READONLY.spec.ts` (12건) — **합산 21 PASS**.
- DB변경: 없음(db_change=false).

## 의료화면 컨펌 게이트 (§11)
진료대시보드 = 의사(문지은 대표원장) 공간 → `medical_confirm_gate: required`.
본 티켓은 reporter(문지은 대표원장) 본인 A안 CONFIRM(MSG-20260620-023304) → `confirm_status: confirmed`.

## 현장 클릭 시나리오 A안 (supervisor 갤탭 실기기 confirm)
1. 진료대시보드 → 진료완료 섹션 → 귀가('귀가', emerald dot) 환자 행.
2. 처방 칸 '-'(미처방) 클릭 → 진료차트(서랍) 1클릭 오픈 → 차트 안에서 처방 수정.
3. 임상경과 칸 '—'(빈값) 클릭 → 진료차트(서랍) 1클릭 오픈 → 차트 안에서 임상경과 작성.
4. (잠금유지) 귀가 행 처방완료(파란 약요약) → 펼침(읽기)만, 대시보드 인플레이스 취소/수정 불가 + '차트에서 수정' 안내.
5. (무회귀) 원내잔류('귀가 대기' amber) 환자는 종전대로 대시보드에서 처방 입력·임상경과 작성 가능.

## 잔여 게이트
- supervisor 표준 QA + 김주연 총괄/문지은 대표원장 갤탭 실기기 현장 confirm.
