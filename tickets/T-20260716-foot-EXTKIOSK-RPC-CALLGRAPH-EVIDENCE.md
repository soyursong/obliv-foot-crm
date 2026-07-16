---
id: T-20260716-foot-EXTKIOSK-RPC-CALLGRAPH-EVIDENCE
domain: foot
priority: P2
status: done
deploy_ready: false      # 조사 전용 — 배포 산출물 없음(코드/마이그 0). deploy-ready 마킹 대상 아님.
hotfix: false
kind: investigation
db_changed: false        # 권한변경·마이그레이션 없음 (조사 전용)
db_migration: none
created: 2026-07-16
completed: 2026-07-16
parent: T-20260715-foot-STATS-RPC-ANON-EXEC-REVOKE-SWEEP
da_req: MSG-20260716-171526-nmir
gate: none               # db_change=false → supervisor DDL-diff·대표게이트·E2E 불요(티켓 규정)
evidence: evidence/T-20260716-foot-EXTKIOSK-RPC-CALLGRAPH-EVIDENCE/callgraph_classification.md
followup_to: planner     # DA 재-CONSULT 회신 라우팅
---

# T-20260716-foot-EXTKIOSK-RPC-CALLGRAPH-EVIDENCE

## 목적
외부 셀프체크인 앱 `soyursong/foot-checkin`(foot-checkin.pages.dev) 의 `.rpc()` 콜그래프로
parent Batch2 17함수(`self_checkin_*` 3 + `fn_selfcheckin_*` 14)를
top-level 직접호출(KEEP) vs nested-only(REVOKE-eligible)로 분류 → DA 재-CONSULT evidence.

## 산출 (→ evidence/ 아티팩트)
- **KEEP (top-level anon 직접호출) 7**: self_checkin_with_reservation_link, fn_selfcheckin_reservation_banner,
  fn_selfcheckin_today_reservations, fn_selfcheckin_dup_guard, fn_selfcheckin_update_personal_info,
  fn_selfcheckin_rrn_match, fn_selfcheckin_create_health_q_token
- **REVOKE-eligible (anon 직접호출 0 + nested 0) 10**: self_checkin_create, self_checkin_lookup(⚠def부재),
  fn_selfcheckin_create_check_in, fn_selfcheckin_existing_checkin_today, fn_selfcheckin_find_customer,
  fn_selfcheckin_linked_checkin, fn_selfcheckin_match_reservation, fn_selfcheckin_upsert_customer,
  fn_selfcheckin_upsert_customer_resolve_v2, fn_selfcheckin_upsert_customer_resolve_v3
- **⚠ CRITICAL 신규 발견**: `fn_selfcheckin_verify_reservation` — 키오스크 HEAD 2026-07-15 가 top-level 호출하나
  17-scope·allowlist·Batch1 KEEP-32 밖 + migration 정의 전무 → 17-scope 불완전. Batch1 sweep 파손 위험. DA 조치 요망.

## 게이트
db_change=false·조사전용 → 마이그/권한변경 금지(downstream 별건). supervisor DDL-diff·대표게이트·E2E 불요.

## 참고
- 상세 분류·근거·한계: `evidence/T-20260716-foot-EXTKIOSK-RPC-CALLGRAPH-EVIDENCE/callgraph_classification.md`
- DA 재-CONSULT 회신 경로 `da_replies/DA-20260716-foot-STATS-RPC-ANON-EXEC-RECONSULT.md` = 현재 레포 부재(디렉터리 없음) 확인.
