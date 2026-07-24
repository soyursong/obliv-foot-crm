# T-20260724-foot-JUYEON-DOCWRITE-1WK-TEMPACCESS — PROD APPLY + POSTCHECK evidence

- **apply 주체**: dev-foot (DEPLOY-EXEC MSG-20260724-210508-ynzo)
- **게이트**: supervisor DDL-diff = GO(PASS) / 문지은 대표원장 Option A 컨펌 / DA 면제(redpay 20260710190000 선례)
- **applied_at**: 2026-07-24 22:59 KST
- **prod**: rxlomoozakkjesdqjtvd
- **main HEAD (merge)**: 386833ac (Merge T-20260724-foot-JUYEON-DOCWRITE-1WK-TEMPACCESS, 5 additive files, 0 FE revert)
- **정규 러너 규약 준수**: 마이그 body(BEGIN..COMMIT) apply + `supabase_migrations.schema_migrations` version=20260724210000 명시 INSERT(ON CONFLICT DO NOTHING). management API raw-query 우회 아님 — ledger 등록 확인(POSTCHECK c).

## PRE (apply 직전, read-only)
```
[{"k":"role","v":"admin"},{"k":"fn","v":"0"},{"k":"cron","v":"0"},{"k":"ledger_max","v":"20260724200000"},{"k":"ledger_210000","v":"0"}]
```
- role=admin (fail-closed 가드 통과 조건) ✓ / fn·cron absent ✓ / ledger 210000 미등록 ✓ / ledger_max 20260724200000 < 210000 (단조증가) ✓

## POSTCHECK (apply 직후) — ALL PASS
- **(a1)** `pg_proc foot_juyeon_tempgrant_tick` 설치 **n=1**, secdef=true, anon_exec=**false**(REVOKE FROM PUBLIC 반영) ✓
- **(a2)** `cron.job foot-juyeon-tempgrant-lifecycle` **active=true**, schedule=`*/15 * * * *` ✓
- **(b)** `user_profiles.role`(ee67fc6b) = **admin 유지** (발효 전 — 7/25 00:00 KST 전이므로 grant 미발동이 정상) ✓
- **(c)** `schema_migrations` 최신 = **20260724210000** (ledger 등록 확인) ✓

## 발효 스케줄 (date-gated, 즉시부여 아님)
- grant: 2026-07-24T15:00Z = **2026-07-25 00:00 KST** (admin→director)
- revert: 2026-07-31T15:00Z = **2026-08-01 00:00 KST** (director→admin + cron 자기해지)
- 폴링 */15 → 경계 15분 내 반영. 조기 원복 = rollback.sql 즉시 실행 가능.

## 서류 틀 무변경 / FE·CF 무변경
- 본 배포 = 5 additive 파일(mig/rollback/evidence/spec/ticket)만. FE·CF 무변경 (merge diff origin/main..HEAD = 5파일, 0 deletion).
