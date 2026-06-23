---
ticket_id: T-20260623-foot-RESVMGMT-EXPORT-CANCEL-EXCL-NOSHOW
id: T-20260623-foot-RESVMGMT-EXPORT-CANCEL-EXCL-NOSHOW
status: deploy-ready
priority: P2
domain: foot
created_at: 2026-06-23
owner: agent-fdd-dev-foot
requester: 김주연 운영총괄 (foot U0ATDB587PV)
approved_by: planner NEW-TASK MSG-20260623-195315-m6ih
build_ok: true
spec_added: tests/e2e/T-20260623-foot-RESVMGMT-EXPORT-CANCEL-EXCL-NOSHOW.spec.ts
db_changed: false
data_architect_consult: 불요 — 신규 컬럼/테이블/enum 0. 기존 reservations read-only 집계. summarizeKinds 반환 타입에 부가 카운트 필드(cancelled/noshow/excluded) 추가는 코드 레벨 ADDITIVE.
risk_level: GO (1/5 — ADDITIVE 부가 버킷. 유효합계 분모 불변, TIMETABLE-VISITCOUNT 소비자 무영향. DB 무변경)
deploy_ready: true
deploy-ready-by: agent-fdd-dev-foot
deploy-ready-at: 2026-06-23
deploy_commit: 0a48a16a
commit_sha: 0a48a16a
parent_ticket: T-20260623-foot-RESVMGMT-DAILY-RESV-EXPORT (6c34afe2)
followup: planner FOLLOWUP excluded_status_mapping — 제외 매핑 코드값 reporter(김주연 U0ATDB587PV) 1줄 확인 대기
---

# T-20260623-foot-RESVMGMT-EXPORT-CANCEL-EXCL-NOSHOW

예약현황 내려받기(parent DAILY-RESV-EXPORT, 6c34afe2)에 취소/제외/노쇼 별도 버킷 카운트 추가. 김주연 총괄 피드백.

## 구현
- **SSOT** `resvSlotAgg.summarizeKinds()` 반환을 `KindSummary`(extends SlotKindCount)로 확장 — `cancelled`/`noshow`/`excluded` 부가 필드. parent·TIMETABLE-VISITCOUNT 동일 함수 유지(이중 산식 0).
- **산식 불변식**: 유효합계(n/r/h/o/total)는 종전대로 — 취소·제외 제외, 노쇼 포함(parent 81행 결정 유지). 분모 변경 없음. 취소/노쇼/제외는 별도 버킷으로만 노출.
- **화면 요약(toast)**: `초진 N · 재진 N(HL N, PD N)` + `취소 N · 제외 N · 노쇼 N`.
- **CSV**: 하단 `상태별 집계` 블록(취소/제외/노쇼) — 유효합계와 분리.

## 상태 매핑 (코드 그라운딩)
- 취소 = `cancelled` (확정)
- 노쇼 = `noshow` (확정 — initial_schema L118 `CHECK (status IN ('confirmed','checked_in','cancelled','noshow'))` 권위값. ticket의 `no_show` 아님)
- 제외 = **현 reservations 스키마에 대응 status/플래그 부재** → 0 처리. summarizeKinds 분기 1줄로 확정 시 즉시 반영. → reporter 1줄 확인 FOLLOWUP.

## E2E 시나리오
- S1: CSV 하단에 취소/제외/노쇼 상태별 집계 블록 추가.
- S2: 기존 유효합계 블록(초진/재진/HL/PD/합계) 보존 — 분모 회귀 가드.
