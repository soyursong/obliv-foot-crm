# Ledger Reconciliation leg — T-20260811-foot-RRN-ENCRYPT-WRITE-TENANT-BINDING-SEAL

> DA CONSULT-REPLY(MSG-20260811-134705-kmfa) firsthand: foot(root) rrn_encrypt = women 동일 shape = systemic.
> 표준: `agents/docs/migration_ledger_reconciliation.md` (정직 수렴 — 정본 = **prod 실재**).
> 소유: 원장 write = **supervisor exec 전속**. 본 문서 = dev-foot 저작 forward-doc 콘텐츠.
>
> ⚠️ **CREATED 2026-08-11 (supervisor MIG-GATE NO-GO 반영 — FIX-REQUEST MSG-20260811-151014-419f)**:
> 초판 seal(commit 0b50c2c4)은 base = `20260520000030_rrn_key_harden`(GUC `app.rrn_key`) 를 byte-preserve
> 전제로 접붙임 → **prod 실재 rrn_encrypt = Vault-V2 body** 와 divergence(stale-base). 본 문서로 정직 수렴.

---

## 0. prod(rxlomoozakkjesdqjtvd) 실재 정본 (supervisor READ-ONLY 실측 반영)

foot 은 **prod == dev 단일 환경**(rxlomoozakkjesdqjtvd). 실측 정본:

| 대상 | prod 실재 상태 | 함의 |
|---|---|---|
| `rrn_encrypt` body (prod 실재) | **Vault-V2 body** — key gate = `vault.decrypted_secrets` WHERE name=`foot_rrn_key_v2` · UPDATE = `rrn_enc` 암호화 + `resident_id=NULL`(평문 scrub) + `rrn_re_encrypted_at=NOW()` + `rrn_encryption_version=2` · `search_path=public,extensions` · seal marker/tenant assert **부재**(pre-seal). prosecdef=true. pg_get_functiondef md5 = `0385d316f5c8d336824ce211ce35281b`. | prod 정본 = Vault-V2 (born via out-of-band apply). GUC 아님. |
| `current_setting('app.rrn_key')` | **NULL** · `pg_db_role_setting` app.rrn_key = 미설정. | GUC 경로는 prod 에서 죽어있음 — GUC base 로 회귀 시 encrypt 전면 P0002 RAISE(write-path 파손). |
| `customers` 컬럼 | `rrn_enc`(bytea)·`clinic_id`(uuid)·`resident_id`·`rrn_re_encrypted_at`·`rrn_encryption_version` **전건 PRESENT**. | 참조컬럼 전부 실재 → C12 fail-closed 없음(women 과 대비되는 지점). apply-base CLEAN. |
| 헬퍼 | `current_user_clinic_id()`·`is_approved_user()` present(foot 네이티브 20260426000000). `is_staff_clinic()` 부재. | tenant/role 술어 해소 가능. |
| Vault | `vault.secrets`/`vault.decrypted_secrets` name=`foot_rrn_key_v2` **실재**. | key gate 통과 가능 = Vault-V2 encrypt 라이브. |
| GRANT | rrn_encrypt anon EXEC=0 / authenticated=1. rrn_decrypt SECDEF 존치. | anon 재개방 0. decrypt READ 무접촉. |
| clinics | **2건** (단일-clinic 아님). | cross-tenant harm = REALIZABLE → 봉합 실효성 높음(올바른 base 위 재저작 우선). |

---

## 1. 성격 — OOB(out-of-band) Vault-V2 def 의 repo 정본화(forward-doc)

### provenance (repo 미추적 → 정직 기술)

prod 실재 Vault-V2 rrn_encrypt 는 정규 마이그(`supabase/migrations/*`)로 착지하지 **않았다**. 적용 경로:

```
근거 SQL : agents/docs/_draft/sql/rrn_stage2_foot_dual_key_functions.sql (216L, commit 4f502d6)
적용 러너: scripts/T-20260530-supv-RRN-STAGE2-DUAL-KEY-FUNCS_apply.mjs
           (BEGIN → c.query(sql 전문) → COMMIT · CREATE OR REPLACE rrn_encrypt/rrn_decrypt)
게이트   : T-20260530-supv-RRN-STAGE2-DUAL-KEY-FUNCS (STAGE2 GO 2/2·supervisor MQ MSG-20260629-031030-ulu0)
```

→ 즉 prod rrn_encrypt 는 **repo migrations 원장에 없는 def**(OOB). repo 의 최종 tracked rrn_encrypt def
   는 `20260520000030_rrn_key_harden`(GUC) 이라, repo 만 읽으면 GUC 가 base 로 보이는 **stale-base 착시**.
   초판 seal 이 정확히 이 착시에 빠짐.

### 3자 divergence 정직 기술 (Migration Ledger Reconciliation 표준)

| 축 | 상태 |
|---|---|
| **파일선언** (repo 최종 tracked rrn_encrypt) | `20260520000030_rrn_key_harden`(GUC `app.rrn_key`). |
| **prod 원장** (schema_migrations) | STAGE2 dual-key = **미기록**(OOB apply script 경유). `20260811020000`(본 seal) = 미기록(미apply). |
| **prod 실재** (pg_proc) | `rrn_encrypt` = **Vault-V2 body**(foot_rrn_key_v2·resident_id NULL·version=2) md5 `0385d316…`. |

→ **divergence 존재**(파일선언 GUC ≠ prod 실재 Vault-V2). 정직 수렴 = 정본(prod 실재 Vault-V2) 기준
   재저작 + forward-doc. db-repair(원장 거짓 마킹) 절대 금지.

---

## 2. 수렴 판정 — Action: base 교체 재저작 (women depends_on 시퀀싱과 다름)

foot 은 women 과 달리 **apply-base 가 지금 CLEAN**(Vault-V2 라이브 · rrn_enc/resident_id/version 컬럼 전건
실재 · foot_rrn_key_v2 Vault 실재). 따라서 women 의 depends_on 2선행(PHI_GATE_HOLD 해제 + versionaware apply)
같은 **시퀀싱 블록 불요**. 순수 **base-교체 재저작**으로 즉시 apply-ready(GO-token 후):

1. **seal body 재저작**(commit 이후): key gate = Vault `foot_rrn_key_v2`(GUC 제거) · UPDATE = V2 하드닝
   write 3종(resident_id NULL·rrn_re_encrypted_at·version=2) 보존 + rrn_enc 암호화 · 그 위 role assert
   (is_approved_user) + tenant assert + UPDATE WHERE tenant belt. → `.sql` REWRITTEN.
2. **rollback 재저작**: Vault-V2 pre-seal body 원복(GUC 아님 · prod def md5 `0385d316` 재현). → `.rollback.sql` REWRITTEN.
3. **dryrun base-body 대조 probe 추가**: apply 前 live rrn_encrypt def == 기대 Vault-V2 pre-seal
   (Vault key 실재 · GUC 부재 · V2 하드닝 3종 · md5 attest) fail-closed. → `.dryrun.mjs` REWRITTEN.
4. **forward-doc(본 문서)**: OOB Vault-V2 def 를 repo 정본으로 명문화 → 차기 마이그 stale-base 재발 차단.

### repo 정본 선언 (forward truth)

> **foot `public.rrn_encrypt(uuid,text)` 의 repo forward-canonical base 는 Vault-V2**
> (key gate=`foot_rrn_key_v2` · V2 하드닝 write 3종 · search_path=public,extensions) 이다.
> `20260520000030_rrn_key_harden`(GUC `app.rrn_key`) 는 **STAGE2 dual-key(OOB, 2026-06-29)로 superseded**.
> 차기 rrn_encrypt 접촉 마이그는 GUC 를 base 로 전제하지 말고 **본 seal(20260811020000) 착지 body**
> (= Vault-V2 + tenant/role seal) 를 base 로 삼는다.

- 원장 row(apply 시점): supervisor exec 가 `20260811020000` append(STAGE2 dual-key 소급 원장화는 별건 —
  본 leg 은 forward-doc 로 divergence 를 봉인, db-repair 아님).
- status: apply-base CLEAN → 재저작 후 즉시 deploy-ready 재마킹 가능(depends_on 없음).

---

## 3. apply-gate (본 leg 무관·prod apply 시점 HARD)

- SECDEF DDL(CREATE OR REPLACE FUNCTION) 실재 → **DDL-0 carve 아님**.
- supervisor **MIG-GATE + DDL-diff + 물리 GO-token** 선행 REQUIRED. `apply_before_go` 금지.
- §3.1 대표(파괴)게이트 = **면제**(exposure-REDUCING ADDITIVE + DA GO + CEO NOTIFY 불요). GO-token/base 대조 면제 아님.
- 본 파일 = authoring + dry-run(base 대조 포함) only. prod DDL/GRANT 선집행 0 (GO-token 미발행).
- POSTCHECK(apply 후 supervisor): (a)cross-tenant deny 실효(타 clinic uuid write 거부) (b)own-clinic write 무회귀
  (c)V2 하드닝 write 3종 실효(resident_id NULL·version=2 스탬프) (d)anon EXECUTE 0.

## 4. cross-fork 무접점

- `T-20260811-women-RRN-ENCRYPT-WRITE-TENANT-BINDING-DAGATE`(sibling·NO-GO mirror-class) = 별 레포·별 트랙.
  women 은 dev↔prod base divergence + depends_on 시퀀싱(PHI_GATE_HOLD). foot 은 apply-base CLEAN =
  base 교체 재저작만. **본 foot 마이그는 women 무접촉.**
- 후보 forks(scalp2/derm/body) rrn_encrypt tenant-binding = `T-20260811-meta-RRN-ENCRYPT-TENANT-BINDING-XFORK-CENSUS`(P3) 별건.
