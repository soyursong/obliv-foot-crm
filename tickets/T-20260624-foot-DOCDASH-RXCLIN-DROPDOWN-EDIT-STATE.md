---
id: T-20260624-foot-DOCDASH-RXCLIN-DROPDOWN-EDIT-STATE
domain: foot
status: deploy-ready
priority: P1
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
e2e-spec: tests/e2e/T-20260624-foot-DOCDASH-RXCLIN-DROPDOWN-EDIT-STATE.spec.ts
created: 2026-06-24
reporter: 문지은 대표원장 (#foot, "수정빨리")
parent: T-20260620-foot-DOCDASH-RXCLIN-PREVIEW-DROPDOWN (deployed f94a2515)
dedup_of: T-20260624-foot-DOCDASH-RXCLIN-DISCHARGE-PREVIEW-EDIT-GATE (deployed 49f1793b)
medical_confirm_gate: exempt (reporter=문원장 본인 self-request, autonomy §3.1 — DB무변경·FE only·안전방향)
---

# T-20260624-foot-DOCDASH-RXCLIN-DROPDOWN-EDIT-STATE — 진료대시보드 처방·임상경과 드롭다운 귀가상태별 편집상태 분기

## ★ DEDUP 결론

본 티켓은 同일자 선행 티켓 **T-20260624-foot-DOCDASH-RXCLIN-DISCHARGE-PREVIEW-EDIT-GATE (deployed `49f1793b`, 21:57)** 와
동일 reporter(문지은 대표원장 "수정빨리") 요청을 다른 티켓ID로 재기술한 것이다.
기능 코드는 旣 배포·라이브이며 **신규 코드 델타 없음**. 본 티켓ID 회귀앵커 spec만 추가했다.

## AC 검증 (4/4 충족 — 旣 배포 코드)

- **AC-1 귀가완료(discharged)**: 미리보기(truncate) → 클릭 시 read-only 전체보기 펼침(편집 input 없음).
  - 임상경과: `if (discharged) setExpandClinical` → `doctor-completed-clinical-expand-pop`(whitespace-pre-wrap, MedicalChartPanel 미포함).
  - 처방: `editableBodyClick={!discharged}`=false → `onToggleExpand→expandRx` 읽기 펼침.
- **AC-2 비귀가(원내잔류)**: 미리보기 → 클릭 시 편집 가능 드롭다운 바로 open(별도 편집클릭 없이 즉시 수정).
  - 임상경과: `else if (checkIn.customer_id) setShowClinical(true)` → 인라인 편집창(그 자리 수정·저장).
  - 처방: 본문 클릭 `if (editableBodyClick && cancellable)` → `setEditPos`(빠른수정 팝오버=QuickRxBar apply) 즉시 open.
- **AC-3 안전게이트 무접촉·무회귀**: 편집 분기는 `editableBodyClick && cancellable` 동반 필수. `cancellable = doctorMode && !!checkInId && !blockedByGate`(checkRxInClinic SSOT). 귀가완료 인라인 임상경과 편집창 이중방어 `showClinical && !discharged` 보존.
- **AC-4 귀가완료 차트 readonly 무회귀**: 이름 클릭 `onOpenChart(checkIn.customer_id, 'full', discharged)`.

## 검증 결과

- build OK (4.44s, tsc 0)
- E2E 신규 8 PASS (본 티켓 spec) + canonical 12 PASS (DISCHARGE-PREVIEW-EDIT-GATE spec) = 20 PASS
- DB 변경: 없음 (FE presentation/게이트만)
- 실기기 시각 confirm(갤탭) = supervisor 게이트
