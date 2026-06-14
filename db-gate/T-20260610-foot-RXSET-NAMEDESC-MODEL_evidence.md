# T-20260610-foot-RXSET-NAMEDESC-MODEL — DB-gate evidence (audit + apply)

- prod: rxlomoozakkjesdqjtvd
- 실행: 2026-06-14T23:59:32.791Z
- audit: supabase/ops/rxset_namedesc_dryrun_audit_20260613.sql
- migrate: supabase/migrations/20260613120000_rxset_namedesc_migrate.sql
- mode: AUDIT-ONLY

## [A] read-only audit (3 SELECT, 쓰기 없음)
```
(1) 분포: total=19 single=19 multi=0 will_migrate=0 already=19
    기대: total=19 single=19 multi=0 will_migrate=19 already=0
```

(2) before→after 미리보기 (0건):
```
```

(3) multi-item 세트 (0건, 0 기대):
```
  (없음)
```

## [GATE] 기대값 대조
```
  PASS  total: got=19 expect=19
  PASS  single: got=19 expect=19
  PASS  multi: got=0 expect=0
  FAIL  will_migrate: got=0 expect=19
  FAIL  already: got=19 expect=0
  gate = FAIL ❌
```

⛔ 기대값 불일치 → apply 중단. supervisor 보고 필요.
