# MIG-GATE evidence — T-20260724-foot-JUYEON-DOCWRITE-1WK-TEMPACCESS (A안: 8/1 자동원복 해제)

planner NEW-TASK: MSG-20260725-090449-wfwp / 대표원장 문지은 A안 재컨펌 2026-07-25 09:00 KST (ts 1784937364.145639)

migration: `supabase/migrations/20260725170000_foot_juyeon_tempgrant_disable_autorevert.sql`
rollback:  `supabase/migrations/20260725170000_foot_juyeon_tempgrant_disable_autorevert.rollback.sql`
dryrun:    `scripts/T-20260724-foot-JUYEON-DOCWRITE-DISABLE-AUTOREVERT_dryrun.mjs`

## db_change 판정: **true** (ADDITIVE — 신규 컬럼·테이블·enum = 0)
- CREATE OR REPLACE 함수 1: `public.foot_juyeon_tempgrant_tick(timestamptz)` — 자동원복+재부여 제거(hold)
- 신규 함수 1: `public.foot_juyeon_tempgrant_revert()` — on-request 원복 canonical(→admin)
- 계정 1행 role ensure(admin→director, idempotent — grant 라이브 보장; 실측 이미 director → 0행)
- cron 스케줄 재확인(upsert, 동일 */15 — tick=hold 로 미발동)
- 신규 컬럼·테이블·enum = **0**

## DA CONSULT: 면제 (ADDITIVE, 대표 게이트 면제)
근거: function+cron, no col/table/enum. 선례 `20260710190000_redpay_reconcile_cron.sql`
(redpay 선례 봉투 — "신규 컬럼·테이블·enum 0 → §S2.4 데이터 정책 게이트 대상 아님"). 동일 봉투.
→ supervisor DDL-diff 게이트 대상(함수 = DDL 오브젝트).

## MIG-GATE 4필드
- **mig_files**: 20260725170000_foot_juyeon_tempgrant_disable_autorevert.sql (+ .rollback.sql)
- **mig_dryrun**: PASS — no-persistence (아래)
- **mig_ledger_check**: PASS — prod ledger 최신=20260725120000 < 신규=20260725170000 (충돌 없음, 단조 증가, n=0 미존재)
- **mig_rollback**: 준비완료 — .rollback.sql (선행 20260724210000 자동원복 tick 복원 + revert 함수 DROP + 스케줄 복원, idempotent)

## dry-run (no-persistence) 로그 — txn-control strip + plpgsql exception-rollback + post-probe absent
```
[pre]  target role = director            ← grant 라이브 실측(7/25 00:00 KST 발효 완료)
== dry-run 20260725170000_foot_juyeon_tempgrant_disable_autorevert.sql ==
   stripped top-level txn-control (INV-5): ["BEGIN;","COMMIT;"]
   harness response: []                   ← 실 마이그 에러 0 (guard 통과: role∈{admin,director})
   post-probe [proc public.foot_juyeon_tempgrant_revert] absent? -> [{"absent":true}]   ← 신규 fn 무영속
   post-probe [tick auto-revert branch unchanged (신규 hold-def 무영속)] absent? -> [{"absent":true}]
== DRY-RUN PASS ==
[post] target role = director
[role no-persistence] pre==post ? YES ✓   ← role UPDATE 무영속
```

## prod pre-apply 상태 스냅샷 (evidence/..._backup.json)
| 항목 | 값 |
|---|---|
| target role | **director** (updated_at 2026-07-24 15:00Z = 7/25 00:00 KST) — grant 라이브 |
| tick 자동원복 브랜치(v_revert_at) | present=true (선행 20260724210000 함수) |
| revert fn 존재 | false (본 마이그가 신설) |
| cron job | foot-juyeon-tempgrant-lifecycle */15 active=true |
| ledger 최신 | 20260725120000 |

## POSTCHECK (deploy-ready 마킹 전 요구 3항목 — 적용 후 supervisor 실증)
- (a) **revert 브랜치 미발동 실증**: 신 tick prosrc 에 v_revert_at/자동 UPDATE 없음(hold only).
      `SELECT public.foot_juyeon_tempgrant_tick('2026-08-01 06:00:00+00');` → action='hold', rows=0.
- (b) **role=director 유지**: `SELECT role FROM user_profiles WHERE id='ee67fc6b…';` → director.
- (c) **baseline='admin' 보존**: tick·revert 두 함수 v_orig_role 상수='admin' (스냅샷 재기록 없음).

## AC 매핑 (개정)
- AC4(개정): 8/1 도래해도 자동원복 미발동 — role=director 유지. ✓ (spec AC4/AC4-b/AC4-c)
- AC6(신규): 총괄 원복요청 시 canonical(→admin) 경유 원복 + baseline='admin' 보존. ✓ (spec AC6-a/b/c)
- AC1/AC2/AC5(서류틀·ROLE-MATRIX 정본 불변) 계속 유효. ✓ (spec R1/R2 — 발행 게이트 SSOT 불변, 1행만 조작)

## E2E
`tests/e2e/T-20260724-foot-JUYEON-DOCWRITE-DISABLE-AUTOREVERT.spec.ts` — 8 passed (logic-mirror, --project=unit).

## build
`npm run build` ✓ (6.65s). FE/TS 소스 변경 0 (DB-only) → bundle_hash n/a.

## 실행 주체 / 순서 (supervisor)
1. supervisor DDL-diff 게이트 통과 후 up.sql prod 적용(정규 러너 — schema_migrations 20260725170000 명시 INSERT, raw-query 우회 금지).
2. 적용 후 POSTCHECK 3항목(위 a/b/c) 실증.
3. 8/1 자동원복 없음 확인 후 티켓 종결. 총괄 "원복해줘" 수신 시에만 `SELECT public.foot_juyeon_tempgrant_revert();` (신규 티켓 불요).

## planner belt 주의
기존 8/1 09:07 KST planner belt(자동원복 이중화)는 A안으로 무효화 대상 — belt 취소는 planner 소관(별도). dev 는 pg_cron revert 무력화만 처리.
