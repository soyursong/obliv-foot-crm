# db-gate evidence — T-20260730-foot-RRN-CLIPBOARD-COPY-NHIS (AC-4)

**함수**: `public.log_rrn_clipboard_copy(uuid) RETURNS void` (SECDEF, 주민번호 클립보드 반출 감사)
**성격**: 순수 ADDITIVE — 신규 SECDEF 함수 1개. 신규 테이블/컬럼/RLS/GRANT확대 0.
**DA 게이트(G-2)**: GO_ADDITIVE — DA-20260730-foot-RRN-CLIPBOARD-COPY-AUDIT-RPC (MSG-20260730-192214-0i1t). 발산0 확증(형제 대비 access_type 리터럴만 상이).
**mig 파일**: `supabase/migrations/20260730190000_foot_rrn_clipboard_copy_audit_rpc.{sql,rollback.sql,dryrun.sql}`
**introspect 스크립트**: `scripts/T-20260730-foot-RRN-CLIPBOARD-COPY-NHIS_introspect.mjs` (READ-ONLY)
**prod ref**: rxlomoozakkjesdqjtvd · 실측 2026-07-30

---

## ① phi_access_log 실재 + 컬럼 (INSERT 타깃 정합) — ✅ PASS

up.sql 이 INSERT 하는 5개 컬럼 전량 prod 실재. 타입 정합:

| 컬럼 | prod data_type | nullable | up.sql VALUES |
|------|----------------|----------|---------------|
| accessed_by | uuid | YES | `auth.uid()` |
| accessed_role | text | YES | `current_user_role()` (text) |
| access_type | text | NO | `'rrn_clipboard_copy'` (text 리터럴) |
| customer_id | uuid | NO | `p_customer_id` (uuid) |
| clinic_id | uuid | YES | `current_user_clinic_id()` (uuid) |

(`id` uuid NOT NULL / `accessed_at` timestamptz NOT NULL 은 default 자동생성 — INSERT 미지정 안전.)
→ 신규 감사 테이블 신설 없음(C1 준수). 공유 cross-CRM phi_access_log 재사용.

## ② 헬퍼 3종 실재 — ✅ PASS

| proname | args | rettype |
|---------|------|---------|
| current_user_clinic_id | (none) | uuid |
| current_user_role | (none) | text |
| is_admin_or_manager | (none) | boolean |

→ up.sql 이 참조하는 `current_user_clinic_id()`·`current_user_role()` 실재·시그니처 정합. 동등 헬퍼 치환 불요(발산 0).

## ③ 형제 log_nhis_eligibility_lookup 형상 (대조 기준) — ✅ 동일 형상

| 속성 | 형제 log_nhis_eligibility_lookup | 신규 log_rrn_clipboard_copy(up.sql) |
|------|----------------------------------|--------------------------------------|
| prosecdef | true | SECURITY DEFINER |
| proconfig | `search_path=public, pg_temp` | `SET search_path = public, pg_temp` |
| args | `p_customer_id uuid` | `p_customer_id uuid` |
| rettype | void | void |
| 역할 게이트 | 없음(clinic scope anti-IDOR만) | 없음(동일) |
| access_type | `'nhis_eligibility_lookup'` | `'rrn_clipboard_copy'` |

→ **발산 = access_type 리터럴 1개뿐.** REVOKE PUBLIC,anon + GRANT authenticated + EXCEPTION 격리 전부 동일.

## ④ 신규 함수 사전 부재 (CREATE 전제) — ✅ PASS

`log_rrn_clipboard_copy` prod pre-exist count = **0** → 신규 CREATE OR REPLACE 안전(기존 오버라이드 없음).

---

## dryrun (No-Persistence Protocol) — ✅ DRY-RUN PASS

```
$ node scripts/dryrun_lib.mjs supabase/migrations/20260730190000_foot_rrn_clipboard_copy_audit_rpc.sql \
    --absent "log_rrn_clipboard_copy=SELECT (count(*)=0) FROM pg_proc ... proname='log_rrn_clipboard_copy'"

== dry-run 20260730190000_foot_rrn_clipboard_copy_audit_rpc.sql ==
   stripped top-level txn-control (INV-5): (none)
   harness response: []
   post-probe [log_rrn_clipboard_copy] absent? -> [{"?column?":true}]
== DRY-RUN PASS == (txn-control stripped · plpgsql exception-rollback · post-probe absent)
```

- up.sql 에 top-level txn 제어문 없음 → txn-strip 무해(INV-5 stripped=none).
- plpgsql exception-handler 경유 실행 후 post-probe: 대상 함수 prod **부재** 재확인(무영속 확증, INV-3).
- 내장 `.dryrun.sql`(단일 DO 블록, RAISE 강제 unwind) 4항목(함수실재·시그니처(uuid)→void·prosecdef·search_path고정)도 동일 형상.

---

## 종료게이트 (supervisor §16-5)

- **실적용은 supervisor 종료게이트(DDL-diff only)** 에서 수행. dev-foot 는 무영속 dryrun + prod introspection evidence 까지.
- 적용 후 behavioral 검증(authenticated 1행 적재 / anon 거부 / 타clinic skip / 로깅실패 무중단)은 JWT 세션 필요 → supervisor 종료게이트에서.
- 롤백: `DROP FUNCTION IF EXISTS public.log_rrn_clipboard_copy(uuid)` 만. phi_access_log DROP/GRANT재부여 금지(공유 테이블).
