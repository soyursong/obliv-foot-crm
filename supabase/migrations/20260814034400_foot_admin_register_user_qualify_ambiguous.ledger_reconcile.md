# Ledger Reconcile — T-20260814-foot-ADMINREGUSER-QUALIFY-PORT

**표준**: Migration Ledger Reconciliation — 단일표준. REF=rxlomoozakkjesdqjtvd (foot prod), READ-ONLY.
**SSOT**: women 마이그 `20260810235500_women_admin_register_user_qualify_ambiguous.sql` (commit a148f4c9, up.sql sha 0de1584f) — foot mechanical 이식.

## 3자 대조 (원장 vs prod 실재 vs 파일선언)

- **파일선언**: `20260814034400_foot_admin_register_user_qualify_ambiguous.sql` — CREATE OR REPLACE FUNCTION 1건(function body replace only, 시그니처·GRANT·스키마 무접촉).
- **원장(supabase_migrations.schema_migrations)**: 로컬 최신 등재 파일=`20260810130000`(createdby applypath belt step8). 신규 버전 `20260814034400` = 원장 미등재(**collision 0** 예상) → forward-only monotonic. supervisor DB-GATE 러너가 apply 직전 원장 재대조(230000 계열 < 20260814034400).
- **prod 실재(pg_proc)**: `public.admin_register_user` 단독 arity(6-arg)·SECDEF·prosrc md5=**22f7ee6978c7b9ee71d31c4bf61f2572**
  (supervisor 2026-08-14 03:33~03:35 KST 실측 = 취약본 라이브 잔존 확정, C10 PREFLIGHT 기준선). up 적용 후 prosrc = alias-qualified body 로 교체 예정(md5 22f7ee69→변동 = deployed evidence, arity/SECDEF/GRANT/search_path 불변).

## 판정

- **forward-doc 분기**: 신규 timestamp(20260810130000 < 20260814034400)·미등재·prod 취약본과 무충돌 → 정상 forward migration.
- change-class = function-body replace(시그니처·GRANT·스키마·enum·컬럼·테이블 무접촉) = ADDITIVE-equivalent(파괴 아님) → §3.1 CEO 대표게이트(파괴) 면제(DA bless, INFO MSG-20260811-035537-cdqk).
- RC = cross-fork 선재 잠복결함(women==foot md5 동일 22f7ee69). women canonical fix(20260810235500)를 SSOT 로 확정 → 본 티켓 = foot mechanical 이식(byte-identical fork drift doctrine).
- db-repair/삭제-정정 불요. 3자 divergence 없음.
- ★ apply 는 supervisor DB-GATE 물리 GO-token 이후에만 (apply_before_go 금지). Gate-B(DA) GO ≠ apply 허가.
