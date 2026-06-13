---
id: T-20260613-foot-MEDCHART-EDITMODE-RXTABLE-LAYOUT-POLISH
title: "[진료차트] 편집모드 UI·처방내역 테이블·진료일/진료의·타이포 폴리시 4묶음"
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: PENDING
created: 2026-06-13
assignee: dev-foot
reporter: 문지은 대표원장
source_msg: MSG-20260613-175125-lijd
risk_verdict: GO
---

# T-20260613-foot-MEDCHART-EDITMODE-RXTABLE-LAYOUT-POLISH

진료차트(MedicalChartPanel + DiagnosisFolderPicker) UI 폴리시 4묶음. 100% FE presentation,
DB/저장/비즈로직 무변경. DIAG-RX-TABLEVIEW-REFINE(099c3ee) + MEMO-TIMELINE-REFINE(dc466fc)
deploy-ready 2건 위에서 작업(main HEAD rebase).

## REDEFINITION 화해 (B그룹)
본 티켓 B(처방내역 행구분선+좌측세로선)는 DIAG-RX AC-4("테두리 전부 제거")를 부분 reverse.
→ **무거운 외곽/버튼 테두리 제거는 유지**하고, 그 위에 얇은 가로 행 구분선 + 좌측 세로 구분선 1개만
추가("테두리 전부 복원" 아님). 동일 reporter 자기수정이라 현장 재확인 없이 진행.

## AC 결과
- **A. 편집모드 UI (특이사항 헤더)**
  - AC-1 ✅ 연필 버튼 펼침 토글 왼쪽(검증/유지 — MEMO-TIMELINE AC-5 기적용).
  - AC-2 ✅ 빨강/파랑 상태닷 → `specialNoteEditing`(연필 ON)일 때만 노출, 기본 숨김. 적용 글씨색은 상시 유지.
  - AC-3 ✅ 편집 vs 일반 시각 구분 — 편집 시 teal `편집 중` 배지(색상 1택).
- **B. 처방내역 테이블**
  - AC-4 ✅ 처방내역 행(tr) 가로 구분선 `border-b border-gray-100 last:border-b-0`.
  - AC-5 ✅ 진단명↔처방 사이 세로 구분선 1개 `sm:border-l sm:border-gray-200 sm:pl-3`(우컬럼 단독).
  - AC-6 ✅ '___ 외 N건' 트리거: 읽기전용 시 버튼형 → 평문 div(클릭불가·꺾쇠 제거). 편집 시 버튼 유지.
- **C. 진료일/진료의**
  - AC-7 ✅ 진료일 ___ 담당의 ___ 한 줄(검증/유지 — DIAG-RX AC-5 동일방향).
  - AC-8 ✅ 담당의 블록 행 끝 우측 정렬 `sm:ml-auto`.
- **D. 타이포·정렬**
  - AC-9 ✅ 좌측 폼 섹션 헤더 `text-xs` 통일 확인(진료일/담당의/진단명/처방내역/치료사차트/치료메모/임상경과) — MEMO-TIMELINE 회귀 없음.
  - AC-10/11 ✅ AC-5 세로선 여백 + AC-8 우측정렬로 정돈. 과변경(회귀 위험) 지양.

## 검증
- `npx tsc --noEmit` PASS
- `npm run build` PASS (4.47s)
- E2E: `tests/e2e/T-20260613-foot-MEDCHART-EDITMODE-RXTABLE-LAYOUT-POLISH.spec.ts` 11/11 PASS (현장 시나리오 3종 매핑)
- 회귀: DIAG-RX-TABLEVIEW(8) + MEMO-TIMELINE-REFINE(13) = 21/21 PASS

## DB변경: 없음 (FE presentation only)
변경 파일: `src/components/MedicalChartPanel.tsx`, `src/components/medical/DiagnosisFolderPicker.tsx`
