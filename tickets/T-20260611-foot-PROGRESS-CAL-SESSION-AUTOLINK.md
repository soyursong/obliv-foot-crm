---
ticket_id: T-20260611-foot-PROGRESS-CAL-SESSION-AUTOLINK
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-06-11
deploy_ready_at: 2026-06-12
deploy_ready_by: dev-foot
build_ok: true
spec_added: tests/e2e/T-20260611-foot-PROGRESS-CAL-SESSION-AUTOLINK.spec.ts
db_changed: false
rollback_sql: ""
risk_level: GO_WARN (ask2 유일경로 가드 통과 + ask3 태그필터 재사용 확인)
commit_sha: <pending>
---

## 요청

원천: NEW-TASK MSG-20260611-183845-dqfl (planner, P2, GO_WARN) — 김주연 총괄(#project-doai-crm-풋확장).
"해당 캘린더에 표기되는 특정 회차 명확하게 + 예약생성(+) 제거 + 경과분석 필요 대상만 자동 연동 표기."

부모 기능: T-20260526-foot-PROGRESS-CHECKPOINT(done) — 체크포인트 회차 세팅 + 예약현황 경과분석 필터.

## 0. diff-first 확정 (착수 전 게이트)

- **'해당 캘린더' surface = `src/pages/Reservations.tsx` 예약현황 캘린더의 경과분석 뷰(filterProgress ON)**.
  경과분석 태그/회차 배지가 존재하는 유일 surface. `ClinicCalendar.tsx`는 progress/cycle 로직 전무 → 대상 아님.
  부모 PROGRESS-CHECKPOINT AC-4('다음날 예약현황에서 경과분석 태그 환자만 보기')가 정확히 이 뷰. → 고신뢰, FOLLOWUP 불요.
- **(+) dedupe-check**: 본 (+)는 ① 슬롯 그리드 `slot-plus-${dateStr}-${time}` ② 페이지 상단 '새 예약' 버튼.
  TOPBAR-RESV-BTN-REMOVE는 AdminLayout `<header>`의 `btn-header-make-reservation`(별개 surface). **동일 버튼 아님 → 충돌 없음.**
- **선례**: T-20260611-foot-PROGRESS-VIEW-BATCH-CHECKIN-LEAK가 경과분석 뷰에서 '일괄 배치' 버튼을 동일 방식(렌더 가드)으로 숨김. 본 작업은 그 패턴을 (+)에 확장.

## 1. 변경 내용 (FE-only, src/pages/Reservations.tsx)

### §1 회차 명확화
- 경과분석 배지(`progress-badge-${r.id}`)에 **'체크포인트' 접미** 추가 → "6회 경과분석 체크포인트" 형태로 회차가 또렷.
- 경과분석 뷰(filterProgress ON)에서 배지 글자 강조(`text-[10px] font-semibold`).
- 회차값 출처는 `progress_check_label`(= plan.session_milestone 반영, 예약 생성 시 자동 부여) **그대로 재사용 — 신설 계산 없음**.

### §2 예약생성(+) 제거 (조회 전용 가드)
- 슬롯 그리드 (+) 버튼: `!filterProgress && !full` 가드 → 경과분석 뷰에서 미렌더.
- 페이지 상단 '새 예약' 버튼: `{!filterProgress && (...)}` 가드 → 경과분석 뷰에서 미렌더.
- **로직 불변**: `openNewSlot`/editor 핸들러 삭제 없음(렌더 가드만). filterProgress OFF 복귀 시 즉시 재노출.
- **유일경로 가드(통과)**: 일반 달력의 (+) 유지 + 상단 버튼은 OFF에서 복귀 + 고객관리·대시보드·차트 등 진입점 보존 → 예약 동선 손실 0.

### §3 경과분석 필요 대상만 자동연동
- 기존 AC-4 필터 `filterProgress ? list.filter(r => r.progress_check_required) : list` 재확인 — 체크포인트 태그 환자만 노출.
- PROGRESS-CHECKPOINT 태그 로직 **그대로 재사용(read-only 필터)**. 본 티켓에서 ticket-ref 주석으로 자동연동 의미 명시.

### DB 변경 없음 (표시/버튼 가드/필터만).

## 2. AC

- ① 경과분석 뷰 각 항목에 회차+'체크포인트' 명확 표기
- ② 경과분석 뷰에서 슬롯 (+) · 상단 '새 예약' 미노출 (일반 달력은 정상 노출)
- ③ 경과분석 뷰는 progress_check_required=TRUE 환자만 노출
- ④ 일반 달력 예약 동선 회귀 없음 / 콘솔에러 없음

## 3. E2E (tests/e2e/T-20260611-foot-PROGRESS-CAL-SESSION-AUTOLINK.spec.ts — 10 pass)

source-integrity gating(거대 인라인 Reservations.tsx 관례). §1×3 / §2×4 / §3×2 + dedupe 단언.
회귀: PROGRESS-CHECKPOINT(7) + TREATMENT-CYCLE-ALERT(4) + TOPBAR-RESV-BTN-REMOVE(8) 20 pass.

## 4. supervisor field-soak 체크포인트

- [ ] 경과분석 토글 ON → 각 카드에 "N회 … 체크포인트" 또렷, 슬롯 (+)·상단 '새 예약' 사라짐
- [ ] 경과분석 토글 OFF → (+)·'새 예약' 정상 복귀, 빈 슬롯 예약 생성 동작
- [ ] 경과분석 뷰에 태그 없는 환자 미노출
- [ ] 콘솔 에러 0 (PC·태블릿 폭)
