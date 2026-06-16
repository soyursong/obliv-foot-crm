---
id: T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-3FIX
title: "[진료알림판] 경과시간 ✋옆 +N분 이전 / 임상경과 인라인 50%우측 / 저장 즉시반영 (3종)"
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: a1a44b10
impl_commit: a1a44b10
polish_commit: 4d21cda9
created: 2026-06-16
assignee: dev-foot
reporter: planner
source_msg: MSG-20260616-192440-8uyj
risk_verdict: GO_WARN
needs_field_confirm: true
related_tickets:
  - T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-POLISH
  - T-20260615-foot-DOCDASH-SHAKE-ACK-NOT-COMPLETE
  - T-20260610-foot-DOCDASH-CLINICAL-INLINE-REFINE
  - T-20260615-foot-DOCDASH-NAME-EMOJI-CLINICAL-3FIX
---

# T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-3FIX

진료알림판(DoctorCallDashboard) 3종 표시·레이아웃·반영타이밍 보정. **DB 무변경, FE only.**

## 처리 결과 — 사전 완료 확인 (re-dispatch / duplicate-noop)

본 NEW-TASK(MSG-20260616-192440-8uyj, 19:24 dispatch)는 **동일 ticket_id 가 당일 선행 완료된 작업의 재발행**이다.
재착수 시 코드 대조 결과 AC-1~AC-3 전부 이미 origin/main 반영·push 완료 상태였고, 신규 코드 변경 0.
재커밋 없이 본 ticket 파일(누락분)만 보충해 board deploy-ready 정합.

- **AC-1** 별도 '경과시간(시간)' 칼럼(양 테이블) 제거 → 상태셀 ✋ 옆 `+N분` 인라인, 30분↑ 빨간색(`elapsedMin >= 30` → `font-semibold text-red-500`). `elapsedMinutes(getCallTime)→formatElapsedPlus` 계산 체인 재사용, 표시위치만 이동. `DOCDASH_COLSPAN`/`COMPLETED_COLSPAN` 9→8, colgroup 시간 col(5%) 제거→임상경과 32→37% 흡수.
  - ⚠ GUARD: ✋ ack-only(SHAKE-ACK-NOT-COMPLETE d913b1a) 손 상태머신 미접촉 — `+N분`은 별도 `<span>` 표시 추가뿐.
- **AC-2** 인라인 임상경과 편집패널 full-width → 내부 div `ml-auto w-1/2 overflow-hidden`(50% 오른쪽끝 정렬 + 내부 truncate), 양 섹션. MedicalChartPanel singleLine clinical 내부(CLINICAL-INLINE-REFINE textarea확대·담당의 one-row) 미접촉.
- **AC-3** 미리보기 갱신경로 = react-query `useCompletedClinicalProgress`(refetchInterval 30s, 非-realtime). 저장후 최대 30s 지연이 RC였음. 3FIX=onSaved→refetchClinical 트리거 + POLISH(4d21cda9)=저장 본문으로 queryKey `['docdash_completed_clinical', clinicId]` optimistic setQueryData(0지연) + 백그라운드 refetch 정합. 데이터 CRUD/스키마 불변(캐시 표시 갱신만).

## 무회귀 직교축 GUARD

동일 surface 완료-UX 분쟁 티켓(T-20260616-foot-DOCDASH-COMPLETEBTN-REMOVE, blocked/human_pending)과 **표시/레이아웃/갱신타이밍 직교축** — 완료버튼·✋ 완료전이 semantics 일절 미변경(표시만 추가).

## 증거

- commit: a1a44b10 (3FIX) + 4d21cda9 (POLISH AC-3 0지연), origin/main push 완료
- build: tsc+vite GREEN (4.38s, re-verify @ 2026-06-16)
- E2E: tests/e2e/T-20260616-foot-DOCDASH-ELAPSED-CLINICAL-3FIX.spec.ts (12 PASS) + ...POLISH.spec.ts (11 PASS) = 23 PASS
- DB변경: 없음

## 잔여 게이트

supervisor 갤탭 실기기 현장 confirm (김주연 총괄 / 문지은 대표원장) — 저장 즉시반영 체감 + ✋ ack 무회귀 시각 확인.
