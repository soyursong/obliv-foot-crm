---
ticket_id: T-20260715-foot-MASKPII-TABLE-TRIGGER-DURABLE
id: T-20260715-foot-MASKPII-TABLE-TRIGGER-DURABLE
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-07-15
owner: agent-fdd-dev-foot
requester: agent-data-architect durable-fix 지정 (writepath rescope decision)
approved_by: DA CONSULT-REPLY GO(조건부) — MSG-20260715-014202-e3cz
build_ok: true
qa_result: pass
data_architect_consult: >
  GO(조건부) — MSG-20260715-014202-e3cz / signoff da_decision_foot_maskpii_table_trigger_durable_signoff_20260715.md.
  foot 단일·ADDITIVE(신규 predicate 0, 旣GO helper _fn_is_masked_pii 재사용) = CONVENE 불요, 본 CONSULT-REPLY 가 인가.
  Q1 unchanged-short-circuit GO + 하드닝 2조건 반영: (1) NULL-safe IS NOT DISTINCT FROM, (2) prod 사후검증(INV-3 무영속 + apply후 has_trigger=true 스모크).
  Q2 트리거=문(door)/9행=별도 DESTRUCTIVE 백필 분리 + 순서강제(트리거 live 후 백필 unblock).
  §3.1 대표게이트 면제(회귀0 실증: dry-run 10케이스 + sentinel/NULL false-reject無). 다음=supervisor DDL-diff(pg_trigger) 단일게이트.
risk_level: GO — ADDITIVE(신규 트리거+함수, 스키마/컬럼/enum 무변경). 기존 9 grandfathered 행은 short-circuit 로 무관 UPDATE 통과(회귀0). per-RPC 가드는 door-level defense-in-depth 로 잔존(제거X).
deploy_ready: true
deploy-ready-by: agent-fdd-dev-foot
deploy-ready-at: 2026-07-15
deploy_commit: PENDING_COMMIT
commit_sha: PENDING_COMMIT
deployed_at: n/a (pending supervisor DDL-diff apply — db_only AC-5)
db_change: true
db_changed: true
e2e_spec_exempt_reason: db_only
mig_files: [supabase/migrations/20260715130000_customers_maskreject_table_trigger.sql]
mig_rollback: supabase/migrations/20260715130000_customers_maskreject_table_trigger.rollback.sql (트리거+함수 DROP, helper 보존 — RESCOPE/CLOSE-R2 공유)
mig_dryrun: >
  PASS — No-Persistence Protocol INV-3 (txn-control strip + BEGIN..ROLLBACK 재래핑 + plpgsql exception-handler + pg_trigger post-probe has_trigger=false 무영속 실증).
  10 케이스: A/B masked INSERT reject 22023 · C clean INSERT pass · D/E clean→masked corruption reject · F grandfathered 무관 UPDATE pass(short-circuit) · G masked→raw 정정 pass · H 변경&masked reject · I sentinel '미확인' INSERT pass · I2 NULL/sentinel/dummy false-reject無.
mig_ledger_check: >
  prod↔file 정본. 원장(schema_migrations) 무기재 = foot manual-apply 관례(sibling 20260714180000/190000 동일), drift 아님 → forward-doc. 원장 무접점(백필 §3 안전 준수).
db_gate_evidence: db-gate/T-20260715-foot-MASKPII-TABLE-TRIGGER-DURABLE_dryrun.md
field_soak_gate: >
  db_only(FE 무변경) → 현장 UX 무영향. 검증 = supervisor apply 후 has_trigger=true + grandfathered 9행 무관 UPDATE 1건 prod 스모크 pass(DA 하드닝② 착지항).
followup_ticket: >
  9행 contam-backfill = 별도 DESTRUCTIVE 티켓(planner TICKET-REQ). 본 트리거 live(has_trigger=true) 에 의존 = unblock 관계. 백필 정정 UPDATE 는 name·phone 양축 동시 non-masked 필수(한 축만 정정 시 트리거 RAISE 차단).
---

# T-20260715-foot-MASKPII-TABLE-TRIGGER-DURABLE — 마스킹 PII write-path 정본 폐쇄 (durable fix)

## 문제 (재발)

per-RPC 마스킹-reject 가드가 포렌식 심화마다 문이 늘어나 불변식을 bound 못함 (8→4→11 anon customers-write 경로). RESCOPE apply 8h 後 신규 masked customer `e3216e83`("접****1"/phone "7887") 재유입 = 소스 미봉쇄 확증.

## 정본 (durable fix)

데이터가 사는 곳(`customers` 테이블)에서 불변식을 강제 → **BEFORE INSERT OR UPDATE 트리거 한 곳**으로 현재 11 INSERT경로 + 미래 전경로 + UPDATE 4경로(update_personal_info / save_customer_address / complete_prescreen_checklist / rrn_match)를 동시 폐쇄. per-RPC 가드(CLOSE-R2 계열)는 door-level defense-in-depth 로 잔존.

- 旣GO helper `_fn_is_masked_pii(NEW.name, NEW.phone)` 재사용 — 신규 predicate 0, 신규 컬럼/enum/테이블 0 = ADDITIVE.
- **unchanged-short-circuit** (DA Q1 GO + 하드닝①): `TG_OP='UPDATE' AND NEW.name IS NOT DISTINCT FROM OLD.name AND NEW.phone IS NOT DISTINCT FROM OLD.phone` → 재검사 면제. grandfathered 9행의 무관 UPDATE 통과(false-positive 회귀0), NULL-safe.
- fail-closed `RAISE 22023` — 에러 메시지 raw PII 미노출(PHI 위생).

## 산출물

- migration: `supabase/migrations/20260715130000_customers_maskreject_table_trigger.sql`
- rollback:  `supabase/migrations/20260715130000_customers_maskreject_table_trigger.rollback.sql`
- dry-run(무영속 INV-3): `scripts/T-20260715-foot-MASKPII-TABLE-TRIGGER-DURABLE_dryrun.mjs` (10 케이스 PASS)
- fp 감사(READ-ONLY): `scripts/T-20260715-foot-MASKPII-TABLE-TRIGGER-DURABLE_fp_audit.mjs`
- 증빙: `db-gate/T-20260715-foot-MASKPII-TABLE-TRIGGER-DURABLE_dryrun.md`

## 게이트 경로

1. [x] 1차게이트 DA blast-radius CONSULT-REPLY GO(조건부) — 하드닝 2조건 반영완료
2. [ ] **supervisor DDL-diff(pg_trigger) 단일게이트** ← 다음 (§3.1 대표게이트 면제). prod apply + has_trigger=true + 스모크는 supervisor MIG-GATE 소관.
3. [ ] (후속·별도 티켓) 9행 contam-backfill — 트리거 live 후 착수(DA Q2 순서강제).
