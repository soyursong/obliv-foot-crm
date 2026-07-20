# T-20260720-foot-AICC-ANON-PII-LEAK — AC2/AC3/AC5 remediation evidence (SECDEF 이관)

- date: 2026-07-20
- author: dev-foot
- planner GO: MSG-20260720-222643-gg5l (DA 옵션 ② SECDEF 이관 확정 — REVOKE 진행 GO)
- prod: rxlomoozakkjesdqjtvd (foot LIVE)
- 선행: AC1 CONSULT + usage-baseline (commit fea39f7f) — SEV-1 504/504 reach 확증, load-bearing=SelfCheckIn.tsx L1760 1곳
- gate: owner=postgres → supervisor DDL-diff DB-GATE + MIG-GATE 4필드. 신규 함수만(신규 컬럼/테이블/enum 0) → §S2.4 DA CONSULT 비해당. CEO 게이트 불요(비파괴 보안조임·가역). live PHI CEO NOTIFY(AC6)=planner/responder 트래킹(dev 액션 아님).

## 0. 결론 (TL;DR)
- reach-0 유일경로(anon SELECT 완전제거 + L1760 SECDEF 이관)를 3-migration + FE 컷오버로 구현. 회귀0.
- dry-run PASS (no-persistence 확증: BEFORE==AFTER, prod 무변경).
- 배포순서 계약: ① 뷰 REVOKE + ② RPC(additive) → ③ FE 컷오버(foot-checkin) → ④ customers lockdown.

## 1. 산출물

### DB 마이그레이션 (obliv-foot-crm/supabase/migrations)
| # | file | 내용 | 멱등 | 롤백 |
|---|------|------|------|------|
| ① AC2 | `20260720230000_foot_aicc_phonematch_revoke_anon.sql` | `REVOKE ALL PRIVILEGES ON aicc_crm_phone_match FROM anon` | REVOKE=자연멱등 | `.rollback.sql` = `GRANT ALL ... TO anon` (exact prior priv) |
| ② AC3-1 | `20260720231000_foot_selfcheckin_resolve_custid_rpc.sql` | 신규 SECDEF RPC `fn_selfcheckin_resolve_customer_id_by_phone(uuid, text[]) RETURNS uuid` (id-only·clinic-scoped) + GRANT EXECUTE anon,authenticated | CREATE OR REPLACE + GRANT=멱등 | `.rollback.sql` = `DROP FUNCTION IF EXISTS` |
| ③ AC3-2 | `20260720232000_foot_customers_anon_select_lockdown.sql` | `DROP POLICY anon_select_customer_self_checkin` + `REVOKE SELECT ON customers FROM anon` | DROP IF EXISTS + REVOKE=멱등 | `.rollback.sql` = 정책 재생성(USING clinic_id IS NOT NULL) + `GRANT SELECT` |
| dryrun | `20260720230000_foot_aicc_anon_pii_leak.dryrun.mjs` | 3-mig 무영속 dry-run (txn-strip+BEGIN…ROLLBACK+post-probe) | — | — |

### FE 컷오버 (foot-checkin/src/pages/SelfCheckIn.tsx L1760)
- 기존: `anonClient.from('customers').select('id').eq('clinic_id',…).in('phone',phoneCandidates).order('created_at').limit(1)`
- 신규: `rpcWithBackoff(() => anonClient.rpc('fn_selfcheckin_resolve_customer_id_by_phone', { p_clinic_id, p_phone_candidates }))`
- 시맨틱 verbatim 미러(clinic + phone=ANY(candidates) + created_at ASC LIMIT 1). id-only 반환. 회귀0.
- build: `npm run build` PASS (tsc -b + vite build, 78 modules).

## 2. prod 실측 (BEFORE) — 롤백/멱등 근거
| 대상 | prior state (2026-07-20 introspect) |
|------|-------------------------------------|
| aicc_crm_phone_match anon privs | DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE (GRANT ALL) |
| customers anon privs | SELECT (only) |
| 정책 anon_select_customer_self_checkin | SELECT, {anon}, PERMISSIVE, USING (clinic_id IS NOT NULL) |
| 정책 anon_insert_customer_self_checkin | INSERT, {anon} — anon INSERT grant 이미 회수됨(dead) → **미변경**(스코프 밖) |
| fn_selfcheckin_resolve_customer_id_by_phone | 부재(pg_proc 0건) → CREATE 안전 |

## 3. dry-run (no-persistence) — MIG-GATE mig_dryrun
```
node supabase/migrations/20260720230000_foot_aicc_anon_pii_leak.dryrun.mjs
→ ✅ DDL bundle 구문·의미 유효 (BEGIN…ROLLBACK 무영속 실행 성공)
→ ✅ NO-PERSISTENCE 확증: BEFORE==AFTER (prod 무변경)
→ PASS
```
- 프로토콜: 각 up.sql 자체 txn-control(BEGIN/COMMIT) strip → `BEGIN; <bundle>; ROLLBACK;` 실행 → post-probe(뷰 privs·RPC 부재·정책 존재·customers anon SELECT) BEFORE==AFTER 재확증. sentinel-bypass 조기확정 없음.

## 4. ledger check — MIG-GATE mig_ledger_check
- schema_migrations 최신 적용 = `20260720170000`. 신규 3건(230000/231000/232000) = strictly-greater 타임스탬프, gap 없음, divergence 없음. forward-only, apply 시 정상 등재.

## 5. 회귀0 근거 (load-bearing 보존)
- 뷰 REVOKE: anon 소비자 0건(AC1) → zero regression.
- customers lockdown: 유일 anon 직접경로(L1760)를 SECDEF RPC 로 대체 → 정당 셀프체크인(검증예약 상류갭 fallback) 보존. 그 외 write/match 전량 기존 SECDEF RPC(resolve_v3 등)=owner=postgres definer → REVOKE SELECT 무영향. authenticated 스태프 정책 10종 미변경.
- 메인 CRM(obliv-foot-crm) customers 접근 전량 authenticated `supabase` 클라이언트(스태프) → anon 무관.

## 6. AC5 forward-doc (baseline L9649 정정 + fork-template 전파차단)
- 마이그 ① 헤더에 명문화: prod baseline(L9649) 주석 'anon PII revokes preserved' = 거짓(foot aicc 뷰 회수 이력 0 = 문서-실재 divergence, 본 마이그가 실재 정정).
- fork-template 전파차단 주석: PHI 투영 뷰의 anon 접근 = default DENY. 신규 CRM fork 시 GRANT ALL 상속 금지. 노출 필요 시 SECDEF RPC(id-only/masked)로만.

## 7. AC4 검증 계획 (배포 후 supervisor/dev)
반영 순서 ①②(즉시 안전) → FE 컷오버 라이브 → ③(lockdown) 후:
- anon positive-control 재실행 → customers reach 504→**0**, 뷰 경유 504→0 확인.
- 정당 셀프체크인(검증예약 fallback 포함) 회귀0 확인.

## 8. 배포순서 계약 (supervisor DB-GATE)
1. ① 뷰 REVOKE (independent, 즉시 안전).
2. ② RPC CREATE + GRANT (additive, 즉시 안전).
3. **foot-checkin FE 컷오버 CF 배포 라이브 확인** (RPC 호출 경로 활성).
4. ③ customers lockdown (**반드시 3 이후** — 순서 역전 시 fallback 짧게 파손).
5. AC4 positive-control 재실행 → 0 확인.
