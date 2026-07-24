# MIG-GATE evidence — T-20260724-foot-JUYEON-DOCWRITE-1WK-TEMPACCESS

migration: `supabase/migrations/20260724210000_foot_juyeon_director_1wk_tempgrant.sql`
rollback:  `supabase/migrations/20260724210000_foot_juyeon_director_1wk_tempgrant.rollback.sql`

## db_change 판정: **true** (ADDITIVE)
- 신규 함수 1: `public.foot_juyeon_tempgrant_tick(timestamptz)`
- 신규 cron job 1: `foot-juyeon-tempgrant-lifecycle` (매 15분)
- 계정 1행 role UPDATE (date-gated, 잡이 수행)
- 신규 컬럼·테이블·enum = **0**

## DA CONSULT: 면제(ADDITIVE, 대표 게이트 면제)
근거: function+cron, no col/table/enum. 선례 `20260710190000_redpay_reconcile_cron.sql`
("신규 컬럼·테이블·enum 0 → §S2.4 데이터 정책 게이트 대상 아님"). 동일 봉투.
→ 티켓 db_change 재평가의 "additive 컬럼 도입 시 DA CONSULT" 경로는 회피(컬럼 미도입).

## MIG-GATE 4필드
- **mig_files**: 20260724210000_foot_juyeon_director_1wk_tempgrant.sql (+ .rollback.sql)
- **mig_dryrun**: PASS — no-persistence (아래)
- **mig_ledger_check**: PASS — prod ledger 최신=20260724200000, 신규=20260724210000 (충돌 없음, 단조 증가)
- **mig_rollback**: 준비완료 — .rollback.sql (잡 해지 + director→admin 원복 + 함수 DROP, idempotent)

## dry-run (no-persistence) 로그
```
node scripts/dryrun_lib.mjs 20260724210000_...sql --absent fn_absent --absent cron_absent
  stripped top-level txn-control (INV-5): ["BEGIN;","COMMIT;"]
  post-probe [fn_absent]   absent? -> true
  post-probe [cron_absent] absent? -> true
  == DRY-RUN PASS ==
```

## 분기 로직 실증 (트랜잭션 강제 롤백, 무영속)
tick() 를 경계시각 3점에서 호출 후 대상 role 관측 → 즉시 rollback:
```
DRYRUN_RESULT pre=admin grant=director revert=admin
POST-PROBE prod 대상 role: admin (무영속 확인 — 변경 0)
```
| now (UTC) | KST | 기대 | 실측 |
|---|---|---|---|
| 2026-07-24 12:00 | 07-24 21:00 (발효 전) | admin (no-op) | admin ✓ |
| 2026-07-25 06:00 | 07-25 15:00 (window) | director (부여) | director ✓ |
| 2026-08-01 06:00 | 08-01 15:00 (원복 후) | admin (원복) | admin ✓ |

## E2E
`tests/e2e/T-20260724-foot-JUYEON-DOCWRITE-1WK-TEMPACCESS.spec.ts` — 8 passed (logic-mirror).

## build
`npm run build` ✓ (6.37s)

## 실행 주체 / 순서 (supervisor)
1. supervisor DDL-diff 게이트 통과 후 up.sql prod 적용(오늘 7/24 내).
2. 적용 후 검증(up.sql 하단 SELECT): 함수/잡 설치 + 대상 role='admin' 유지(발효 전).
3. 7/25 00:00 KST 자동 부여 → 8/1 00:00 KST 자동 원복(잡 자기해지).
4. 조기 원복 요청 시 .rollback.sql 즉시 실행.

## 인적 backstop (guard #2 이중화)
자동원복(cron) 사일런트 실패 대비 → planner FOLLOWUP 로 8/1 원복 확인 human_pending 등록 요청.
