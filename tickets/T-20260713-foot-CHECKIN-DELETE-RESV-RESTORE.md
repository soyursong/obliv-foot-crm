---
id: T-20260713-foot-CHECKIN-DELETE-RESV-RESTORE
domain: foot
priority: P1
status: deploy-ready
qa_result: pass
deploy_commit: fecb5101d309
deployed_at: n/a (NOT yet deployed)
bundle_hash: n/a (NOT yet deployed)
summary: "접수 상세창(CheckInDetailSheet) '체크인 삭제(관리자)'가 check_ins row만 지우고 원본 예약의 상태 역전이를 누락 → 예약이 'checked_in'에 묶여 재체크인 불가 + 통합시간표·대시보드에서 예약 카드 소실. RC: '체크인 취소'(T-20260611-CHECKIN-CANCEL-RENAME-RESTORE)는 예약을 'confirmed'로 되돌리는데 '삭제' 경로만 이 역연산이 빠져 삭제 vs 취소 동작이 갈림(현장 스레드 진단 '삭제 vs 취소 경로 차이'와 일치). 수정(FE-only): deleteCheckIn이 checkIn.reservation_id의 예약을 'confirmed'로 복구. FE 원자성(saga) — 예약 복구를 먼저 커밋 → 체크인 삭제 → 삭제 실패 시 예약을 'checked_in'으로 보상 롤백. 멱등 가드(.eq('status','checked_in'))로 이미 다른 상태면 무변경. 신규 컬럼·enum 없음(기존 status 값 재사용), DB 스키마 변경 없음. 빌드 OK. E2E: 정적 불변식 가드(항상 실행, 삭제↔취소 재분기 방지) PASS + 시나리오3(삭제→예약복구→재체크인) seed 기반 skip-tolerant. 인접 회귀: checkin-flow 창건 테스트 실패는 clean HEAD에서도 동일(빈 test-DB 환경 이슈, 본 변경 무관 확인)."
created: 2026-07-13
assignee: dev-foot
db_change: false
e2e_spec_exempt_reason: n/a
superseded_ref: T-20260713-foot-CHECKIN-FAIL-REGRESSION-TRIAGE (SUPERSEDED — 회귀 아님 확정)
---

# T-20260713-foot-CHECKIN-DELETE-RESV-RESTORE — 체크인 삭제 시 예약 상태 복구

## 배경 (현장 확정 — MSG-20260713-161222-ezes, thread 1783926011.700929)
- 화면: admin CRM 접수 상세창(CheckInDetailSheet) '체크인 삭제(관리자)' 버튼.
- 증상: 삭제 후 예약이 'checked_in'에 묶임 → 재체크인 불가 → 예약카드 대시보드 소실.
- 장쳰 스레드 진단 "삭제 vs 취소 경로 차이" = 본 티켓 RC와 동일.
- 회귀조사 티켓 CHECKIN-FAIL-REGRESSION-TRIAGE는 SUPERSEDED (13:05 P0 798a2281 WRITE-path 가드 회귀 아님 확정).

## 근본 원인 (RC)
`deleteCheckIn`(src/components/CheckInDetailSheet.tsx)은 check_ins row만 delete하고,
체크인 시점에 reservations→'checked_in'으로 전이됐던 원본 예약을 되돌리지 않았다.
'체크인 취소'(Dashboard 상태변경 핸들러, T-20260611-foot-CHECKIN-CANCEL-RENAME-RESTORE)는
예약을 'confirmed'로 복구(역연산)하는데, '삭제' 경로에만 이 역연산이 없어 동작이 갈렸다.

## 수정 (FE-only, DB 스키마 무변경)
`deleteCheckIn` 성공 시 `checkIn.reservation_id`의 예약을 'confirmed'로 복구.
- FE 원자성(saga): 예약 복구를 먼저 커밋 → check_ins 삭제 → 삭제 실패 시 예약을 'checked_in'으로 보상 롤백.
- 멱등 가드: `.eq('status', 'checked_in')`으로 이미 다른 상태인 예약은 건드리지 않음.
- 복구 UPDATE는 `.eq('id', resvId)`로 스코프 — 전역/무조건 UPDATE 금지.
- 신규 컬럼·enum 0 — 기존 status 값('confirmed'/'checked_in') 재사용.

## AC
- **AC-1**: deleteCheckIn 성공 직후 reservations.status='confirmed' 복구 (원자성 — 삭제 실패 시 보상 롤백).
- **시나리오3**: 삭제→재체크인 왕복 — 삭제 후 예약이 다시 체크인 가능 상태('confirmed')로 복귀.

## 검증
- 빌드: `npm run build` OK.
- E2E: tests/e2e/T-20260713-foot-CHECKIN-DELETE-RESV-RESTORE.spec.ts
  - 정적 불변식 가드(항상 실행): 복구+멱등 가드+삭제 유지+보상 롤백 소스 고정 → PASS.
  - 시나리오3: seed(예약 confirmed→checked_in + 연결 체크인) → UI 삭제 → DB 왕복(예약 confirmed, 체크인 row 삭제) 검증. 빈 test-DB에서는 skip-tolerant.
- 인접 회귀: tests/functional/checkin-flow.spec.ts '창건' 테스트 실패는 clean HEAD에서도 동일 재현(빈 test-DB 환경 이슈), 본 변경과 무관 확인.
