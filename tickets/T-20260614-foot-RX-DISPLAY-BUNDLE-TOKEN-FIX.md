---
id: T-20260614-foot-RX-DISPLAY-BUNDLE-TOKEN-FIX
title: "[처방] 묶음처방 흡수분 포함 처방 표기 '약물명 1/3/2' 단일 토큰 경로 수렴"
domain: foot
priority: P0
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: aa0e453
reopen_commit_sha: PENDING
created: 2026-06-14
assignee: dev-foot
reporter: 문지은 대표원장
source_msg: MSG-20260614-005739-67ia
reopen_msg: MSG-20260614-200238-kpjl
risk_verdict: GO
---

# T-20260614-foot-RX-DISPLAY-BUNDLE-TOKEN-FIX

문지은 대표원장 긴급(MSG-004738-patx): "환자 처방내역이 다 엉망. 묶음처방 흡수하면서 약물 표기방식
정확히 약물명 1/3/2 처방에 떠야해. 지금 막 텍스트로 보이고 엉망." → 처방 표기 최우선.

## RCA (착수 전 우선 수행)
토큰 정본 `formatRxConfirmedSummary`(T-20260610 RX-TOKEN-FORMAT, deployed 662d34b)는 존재하나,
흡수 함수 `normalizeRxItem` 이 **DoctorPatientList 로컬에만** 존재 → 묶음처방을 흡수해 렌더하는
다른 surface 들이 정본 토큰 경로를 미경유:
- 진료차트 처방내역 타임라인(MedicalChartPanel L2823): `{rx.name}{rx.dosage}` = 반쪽 raw text(/count/days 누락).
- 미리보기 teaser(chartPreviewSegments): 약명-only.
- TreatmentTable.prescriptionSummary: `{medication_name} {dosage}` raw.
묶음처방 흡수분(loadPrescriptionSet→formRx→prescription_items)도 동일 surface 라 같이 깨짐 = field regression.

## 변경 (SSOT 단일 정규화 경로 — @/lib/rxTooltip)
- **AC-1**: `normalizeRxItem` export 격상 + `formatRxItemToken`(raw 1건 → '약물명 1/3/2', per-<li>) 추가.
  토큰 도출 로직을 `buildDoseTokens` private 헬퍼 1곳으로 수렴(formatRxConfirmedSummary 출력 byte 불변).
  묶음처방 흡수 항목(dosage/count/days)이 '약물명 1/3/2'로 정확 표기. DB·저장경로 무변경.
- **AC-2**: 처방 surface 전반 단일 경로 수렴.
  · DoctorPatientList — 로컬 normalizeRxItem 제거 → rxTooltip import.
  · MedicalChartPanel — 진료차트 처방내역 li / 미리보기 teaser → formatRxItemToken.
  · TreatmentTable — prescriptionSummary → normalizeRxItem→formatRxConfirmedSummary.
- **AC-3 (P2 deferred-OK)**: 약물명 검증 본체는 RX-DRUG-WHITELIST(blocked) 정본 — 본 티켓 미구현(재구현 금지).

## REDEFINITION 화해
- QUICKRX-MULTI-DRUG(in_progress): rxTooltip.ts/QuickRxBar 동시편집 → 본 티켓은 rxTooltip 에
  **additive export만**(normalizeRxItem/formatRxItemToken/buildDoseTokens) + 기존 formatRxConfirmedSummary
  출력 byte 불변 유지 → 충돌면 최소. QuickRxBar 무접촉.
- MEDCHART-EDITMODE-RXTABLE(deploy-approval-requested): formRx 편집 테이블(L3085 input 컬럼)은 무접촉.
- DOCDASH-RXCELL-REFINE(deployed): DoctorPatientList prescriptionOneLine 셀 = 이미 정본 사용, 동작 불변.

## 검증
- build OK. spec: tests/e2e/T-20260614-foot-RX-DISPLAY-BUNDLE-TOKEN-FIX.spec.ts 14 passed.
- 회귀: DOCPATIENTLIST-EXPAND-CLINICAL/COURSE-RXHISTORY, MEDCHART-TIMELINE-COMPACT/SOAK-REFINE,
  TIMELINE-FILTER-PREVIEW-FIX 29 passed / 21 skipped(DB라이브).

---

## REOPEN (P0, MSG-20260614-200238-kpjl) — 문지은 대표원장 강제새로고침 후에도 동일 현상

### 배포 검증(planner #1 우선) 결과 — 배포 미반영 아님
- prod index.html → `MedicalChartPanel-BBqIIufT.js` 참조. 이 prod 번들에 aa0e453 가 추가한
  `data-testid="timeline-rx-item"` 마커 **존재 확인** → **진료차트 타임라인은 prod 에 fix 정상 반영**.
- 즉 "배포 누락"이 RCA 아님. aa0e453 는 HEAD 의 ancestor(merge-base 확인).

### 진짜 RCA — fix 가 surface 를 잘못 골랐다(다른 컴포넌트만 수렴)
- aa0e453 는 **MedicalChartPanel / DoctorPatientList / TreatmentTable** 만 토큰 수렴.
- 그러나 문지은 대표원장 묶음처방 흡수 **실동선 = CheckInDetailSheet → `DoctorTreatmentPanel`**:
  · 묶음처방 불러오기 picker 미리보기(`RxSetPicker` L344) = `{name} — {dosage} {frequency} {days}일` raw.
  · 흡수 처방 목록(`PrescriptionView` L457) = name/dosage/route/frequency/days **흩뿌린 raw spans**(=엉망).
  → 이 패널은 aa0e453 가 전혀 손대지 않아, 배포돼도 그녀 화면은 그대로 raw. 단건/묶음 무관 동일 raw.

### REOPEN 수정 (presentation only · DB 무변경)
- `DoctorTreatmentPanel.tsx`: `formatRxItemToken` SSOT import.
  · RxSetPicker 미리보기 li → `formatRxItemToken(item)` ('약물명 1/3/2').
  · PrescriptionView 행 → `formatRxItemToken(item)` 주표기 + route 부가칩 보존 + ✕/notes 유지.
- 좌표 격리: QUICKRX-MULTI-DRUG(QuickRxBar)·MEDCHART-EDITMODE-RXTABLE(MedicalChartPanel 편집테이블)과
  **다른 컴포넌트** → 충돌 없음. CustomerChartPage 처방전(관계형 prescriptions·자유텍스트 dosage·count 컬럼 없음)은
  데이터모델 상이 → 본 토큰 강제 시 오출력('1정 1일 3회/3') 위험으로 **범위 제외**(planner 별도 판단 필요).

### REOPEN 검증
- build OK. spec 18 passed (S4 REOPEN 4건 추가: DTP-IMPORT/PICKER/LIST + set.items shape 토큰).
- 실동작 prod 렌더 확인은 재배포 후 번들 마커(`prescription-item-token`) 갱신 검증 + 현장 confirm 필요.
