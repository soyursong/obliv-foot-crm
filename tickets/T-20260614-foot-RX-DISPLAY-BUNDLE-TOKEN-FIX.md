---
id: T-20260614-foot-RX-DISPLAY-BUNDLE-TOKEN-FIX
title: "[처방] 묶음처방 흡수분 포함 처방 표기 '약물명 1/3/2' 단일 토큰 경로 수렴"
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: aa0e453
created: 2026-06-14
assignee: dev-foot
reporter: 문지은 대표원장
source_msg: MSG-20260614-005739-67ia
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
