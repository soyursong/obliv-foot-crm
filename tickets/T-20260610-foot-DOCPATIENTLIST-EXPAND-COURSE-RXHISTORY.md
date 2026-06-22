---
id: T-20260610-foot-DOCPATIENTLIST-EXPAND-COURSE-RXHISTORY
title: "진료환자목록 행 확장 영역에 임상경과 + 처방내역(read 뷰) 표시"
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: 50dd87bf
created: 2026-06-10
assignee: dev-foot
reporter: 문지은(대표원장)
source_msg: MSG-20260610-133011-5ook
needs_field_confirm: true
related_tickets:
  - T-20260610-foot-QUICKRX-BLOCK-PANEL-HIDE
  - T-20260610-foot-DOCPATIENTLIST-QUICKRX-CHARTBTN
  - T-20260609-foot-DOCPATIENTLIST-RXCANCEL-DISCHARGE-GATE
---

# T-20260610-foot-DOCPATIENTLIST-EXPAND-COURSE-RXHISTORY

## 핵심
진료환자목록(DoctorPatientList) 행 확장(expanded) 영역에 **임상경과 + 처방내역(read 뷰)** 표시.

## DELTA 범위 (중복 금지)
원 신고 3요소 중:
- ①불가 패널 · ②차트연결 = **351dd72(BLOCKED-PANEL-HIDE) + 497672b(빈 렌더)** 가 이미 해소 (origin/main 반영, prod LIVE). → **미접촉**.
- ③임상경과 + 처방내역 표시 = **본 티켓 DELTA**.

AC-0 STEP1 확인: 351dd72·497672b 모두 origin/main 포함(`git branch -r --contains`) → Vercel 자동배포 반영 확정. reporter "불가/차트연결" 불만은 stale SPA build 추정.

## 구현
확장 영역 하단에 공통 상세 블록(`patient-expand-detail`) 추가:
- **처방내역**: `prescriptionOneLine(formatRxConfirmedSummary 정본)` 다중약 전체 read 한 줄. 확정 행은 상단 RxConfirmedSummary가 이미 표시 → 중복 방지로 `!isConfirmed` 행만.
- **임상경과**: `MedicalChartPanel embed variant='clinical'` (DoctorCallDashboard `showClinical` 동일 SSOT). `customer_id && clinic_id` 일 때만, 기존 차트 read 모드(isReadOnly) 로드. 신규 조회경로/Drawer 0.
- 비잔류(빠른처방 불가) 행은 QuickRxBar 빈 렌더 → 그 빈 자리를 채움(최소요건 b). 동선 일관성 위해 모든 확장 행에 표시(옵션 a, dev 판단).

## AC-3 회귀가드
- QuickRxBar `blockedByUiGate → return null` / 빠른처방 버튼·게이트 불변 (351dd72/497672b 회귀 0)
- RxConfirmedSummary onOpenChart·rx-cancel-open-chart 보존
- 인접 DoctorCallDashboard 미접촉(showClinical embed clinical 패턴 보존)

## 검증
- E2E `tests/e2e/T-20260610-foot-DOCPATIENTLIST-EXPAND-COURSE-RXHISTORY.spec.ts` — 시나리오 S1~S3 + 회귀 R1~R5, **14 pass**.
- 회귀: 형제 QUICKRX-CHARTBTN + RXCANCEL-DISCHARGE-GATE **22 pass**.
- `npm run build` OK. DB 변경 없음.

commit: 0a370b2 (main → Vercel 자동)
