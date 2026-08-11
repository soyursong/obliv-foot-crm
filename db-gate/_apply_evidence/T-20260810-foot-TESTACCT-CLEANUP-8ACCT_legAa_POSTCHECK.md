# POSTCHECK — T-20260810-foot-TESTACCT-CLEANUP-8ACCT Leg A-(a) 정상삭제 3행

- verifier: supervisor · postcheck_ts(UTC): 2026-08-11T06:59:56Z
- prod_ref: rxlomoozakkjesdqjtvd · migration_sha256: 6901c1d4812e29d9fe29bde679fcb870b0e2327f19861c582ab3f6c83c85a3fb
- GO-token: db-gate/T-20260810-foot-TESTACCT-CLEANUP-8ACCT_GO.token.json (nonce e589df7bc1cd35ad · issued 06:46:23Z · TTL 08:16:23Z)
- apply_evidence: status=applied · apply_ts 06:52:30Z (dry_run 06:51:54Z 선행) — TTL 내 집행

## 대상 3 customers (roots)
- 엄경은2 F-4691 = a0f8c846-9f93-47bf-a79e-57d265d989b6
- 엄경은2(DUMMY) F-4703 = 02594dfa-9428-4405-b640-95ab50ad5e5d
- 풋서류테스트입니다 F-4468 = c074025b-cd27-443c-93a9-151d6d4214d4

## 결과 (READ-ONLY q() Management API 실측)
| 항목 | expect | actual | 판정 |
|------|--------|--------|------|
| live customers roots 잔존 | 0 | 0 | PASS |
| 삭제 총행수 (= archive 보존행) | 80 | 80 | PASS |
| _arch_testacct8_aa_* 테이블 존재 | 17 | 17 | PASS |
| live reservations(roots) 잔존 | 0 | 0 | PASS |
| live packages(roots) 잔존 | 0 | 0 | PASS |
| per-table archive count mismatch | 0 | 0 | PASS |

per-table archive rows: customers3 · reservations2 · packages2 · check_ins2 · assignment_actions2 · chart_treatment_requests1 · check_in_room_logs2 · check_in_services20 · customer_treatment_memos1 · health_q_results1 · health_q_tokens2 · reservation_logs1 · reservation_memo_history1 · status_transitions9 · package_sessions1 · notification_logs2 · phi_access_log28 = 80.

## 판정: POSTCHECK PASS
- 파괴 DELETE 80행 정확 착지 · customers 3 소멸 · archive-first 80행 무손실 보존(완전가역 rollback.sql).
- HOLD leg 무접촉: A-b Path-B(F-4425/F-4692) · Leg B 2차 flag(F-4427/F-4445) 본 apply 범위 밖.
