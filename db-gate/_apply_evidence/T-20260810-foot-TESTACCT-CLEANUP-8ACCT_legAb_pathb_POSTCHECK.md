# POSTCHECK — T-20260810-foot-TESTACCT-CLEANUP-8ACCT Leg A-(b) Path-B 물리삭제 2행

- migration: `20260811050000_foot_testacct8_legAb_pathb_scopeddisable_2row.sql`
- sql_sha256: `c85fa1b1c7ec6db820ff432caaf354cf9bfb56b655ce78250ac5636454d5fc91`
- GO-token: `db-gate/T-20260810-foot-TESTACCT-CLEANUP-8ACCT_GO.token.json` (key_id supv-dbgate-2026a · nonce 93f34a848ce21f0b · issued 2026-08-11T08:02:41Z)
- apply lane: prod (rxlomoozakkjesdqjtvd) · guard: db_apply_guard.sh · status=applied
- apply_ts: 2026-08-11T09:03:14Z (TTL 09:32:41Z 내)
- applied by: dev-foot

## apply 통로 note
- 최초 apply 시 worktree(_wt-testacct8-gate) supabase link 미설정 → `LegacyProjectNotLinkedError` 로 apply_failed(**SQL 미실행 · DB 무접점 · 롤백 불요**).
- 조치: 메인 레포 supabase/.temp(동일 prod ref rxlomoozakkjesdqjtvd) link 상태를 worktree로 복제 후 재apply → applied.
- pre-state probe(재apply 직전): customers_target=2 · fs_target=2 · arch_tables=0 · tgenabled='O' (supervisor 판정시각 probe 와 일치).

## POSTCHECK 결과 — 전건 PASS
| 항목 | 값 | 기대 | 판정 |
|------|-----|------|------|
| live customers target (F-4425/F-4692) | 0 | 0 | ✅ 소멸 |
| live form_submissions target | 0 | 0 | ✅ 소멸 |
| F-4427 customer(e72022d0) 생존 (leak-guard) | 1 | 1 | ✅ scope 밖 보존 |
| F-4427 fs(b4a36c4e) 생존 (leak-guard) | 1 | 1 | ✅ scope 밖 보존 |
| trg_form_submissions_published_immutable tgenabled='O' (H3 prod live) | 1 | 1 | ✅ DISABLE 무누출 |
| _arch_testacct8_ab_* 아카이브 테이블 수 | 17 | 17 | ✅ |
| 아카이브 총 행수 | 91 | 91 | ✅ |

## per-table archive expect-N 일치 (17테이블 / 91행)
customers 2/2 · reservations 3/3 · packages 2/2 · check_ins 2/2 · assignment_actions 2/2 ·
chart_treatment_requests 2/2 · check_in_room_logs 4/4 · check_in_services 16/16 ·
customer_treatment_memos 1/1 · form_submissions 2/2 · health_q_results 1/1 · health_q_tokens 1/1 ·
reservation_logs 2/2 · reservation_memo_history 1/1 · status_transitions 10/10 ·
notification_logs 5/5 · phi_access_log 35/35 → **전건 일치**

## 결론
Leg A-(b) Path-B 물리삭제 2행 apply + POSTCHECK 완료. tgenabled='O' 재확인(DISABLE 누출 없음).
supervisor 사후검증 대상. → 순서: 본 완료 後 Leg B DB-GATE 별건 발행 대기(planner INFO 순차).
