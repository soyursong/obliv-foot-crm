# T-20260806-foot-TESTTID-479470-PERSEAT-REGISTER-ENABLE — AC-3 IMPL + VG1~5 (dev-foot)

**Date**: 2026-08-07 · **Author**: agent-fdd-dev-foot · **Scope**: obliv-foot-crm
**DA verdict**: DA-20260806-foot-TESTTID-479470 CONSULT-REPLY (MSG-20260806-234359-634d) = GO(조건부·ADDITIVE) · §3.1 대표게이트 면제.
**정본**: `da_replies/da_decision_foot_testtid_479470_perseat_register_enable_20260806.md` · registry SSOT §15.

---

## 1. 산출물 (gate 순서 step 2 = dev-foot 마이그 + EF)

| 파일 | 역할 |
|------|------|
| `supabase/migrations/20260807040000_foot_redpay_reconcile_excluded_axis.sql` | ADD COLUMN `reconcile_excluded`(nullable default false) + 뷰 2종 CREATE OR REPLACE(배제술어) + 470 단일행 seed |
| `..._axis.rollback.sql` | 470 DELETE + 뷰 이전정의 RESTORE + DROP COLUMN (대칭·손실 0) |
| `..._axis.dryrun.sql` | psql no-persist(BEGIN..ROLLBACK) + VG1~5 assert (supervisor MIG-GATE 실행 lane) |
| `supabase/functions/redpay-reconcile/index.ts` | #3 matcher `loadRegistryTids()` 에 `.not("reconcile_excluded","is",true)` |
| `supabase/functions/redpay-unreg-digest/index.ts` | #5 digest activeSet 조회에 `.not("reconcile_excluded","is",true)` |

집행술어 = `AND NOT COALESCE(reconcile_excluded, false)` (SQL) / `.not("reconcile_excluded","is",true)` (PostgREST, = `IS NOT TRUE` = false/null 포함 = 회귀 0).

---

## 2. 정산-소비처 read-path 전수 census + 처리 (VG1 set-equal oracle)

acceptance oracle = **어떤 reconcile 소비처도 470을 예상단말 열거 OR 470-payment를 unreconciled flag 안 함** (하드코딩 목록 아님).

| # | 소비처 | 파일:위치 | 분류 | 처리 |
|---|--------|-----------|------|------|
| 1 | PERSEAT 게이트(FE) | `src/lib/cband/tidRegistryGate.ts:79` | **firewall(운영 authority)** | 무접촉 — 470 tid∪superseded 로 선택가능(active만) |
| 2 | Plan-B 결제 RPC | `20260802061500_..._record_planb_card_payment_rpc.sql:137` MERNO | **firewall(운영 authority)** | 무접촉 — active만(merchant_id OR tid OR superseded). ★C19 pin body 무변경 |
| 2b | Plan-B pkglink RPC | `20260805171200_..._pkglink.sql:119,142` MERNO | **firewall(운영 authority)** | 무접촉 — active만 |
| 3 | reconcile EF matcher | `redpay-reconcile/index.ts:154` `loadRegistryTids` | **reconcile(matching)** | ✅ `.not(reconcile_excluded,is,true)` |
| 4 | v_redpay_reconciliation_daily 뷰 | `20260803235500`(현 live) redpay앵커 3 + crm앵커 EXISTS 3 = 6 subq | **reconcile(enumeration)** | ✅ 6곳 전부 `AND NOT COALESCE(reconcile_excluded,false)` |
| 5 | 미등록회선 digest EF | `redpay-unreg-digest/index.ts:120` | **reconcile(enumeration)** | ✅ `.not(reconcile_excluded,is,true)` |
| 6 | v_redpay_installverify_pairs 뷰 | `20260803235500`(현 live) foot_raw CTE 3 subq | **reconcile(matching/enum)** | ✅ 3곳 전부 `AND NOT COALESCE(...)` |
| 7 | A11/A12 recon probe | `~/ops/etl/recon/*` (DA-owned) | **reconcile(enumeration)** | ⏳ DA post-apply leg(컬럼 착지 AFTER, §5) |

**뷰 배제술어 총 9 subquery**: installverify_pairs 3(merchant+tid+superseded) + reconciliation_daily 6(redpay앵커 merchant+tid+superseded, crm앵커 EXISTS merchant+tid+superseded). 전수 균일 적용 = partial-fix 0.

### 2.1 ★webhook admit 분류 (census #3~#7 에 없던 read-path — 명시 판정)
- `supabase/functions/redpay-webhook/index.ts:221` `loadFootMerchantsFromRegistry()` 도 registry active(merchant_id) read.
- **판정 = 정산-소비처 아님 → 배제술어 미적용(무접촉).** 근거:
  1. webhook = **raw ingress admit authority**(어느 merchant payload 를 redpay_raw_transactions 로 적재할지) — enumeration('예상단말 열거')도 unreconciled-flag 도 하지 않음 → VG1 oracle 상 **이미 compliant**(470 을 예상단말로 열거하거나 470-payment 를 flag 하지 않음).
  2. 임무축 = 운영 authority side(#1/#2 와 동류, ingest 권한), **정산 스코프 멤버십(임무 b) 아님**.
  3. 470 = **RedPay-blind**(구 bizno 511-60-00988, 전기간 조회 0) → webhook 이 470 payload 를 애초 수신 0 → admit 여부 inert.
  4. DA 는 dev-foot 스코프를 #3~#6 로 명시(webhook 미포함). ingress admit 개정 = DA 미adjudicate 축 + fail-open 적재 semantic 불필요 접촉.
- 정산-layer 배제(#3~#6)가 firewall 을 완결 — 설령 470 raw 가 존재해도(불가) 정산 소비처가 전부 배제.

---

## 3. VG1~VG5 판정

- **VG1 (완전성·dispositive)**: 정산-스코프 소비처 전수(#3 matcher·#4 뷰·#5 digest·#6 installverify) + census 4th+(webhook=classified out) 균일 배제. #7 = DA lane. set-equal oracle 충족. **PASS**(supervisor DDL-diff 재확인 대상).
- **VG2 (firewall purity)**: #1 게이트·#2/#2b Plan-B MERNO 술어 무접촉(여전히 active만, reconcile_excluded 진입 0). git diff 상 tidRegistryGate.ts·record_planb_*.sql·pkglink.sql 변경 0. ★#2 record_planb_card_payment body 무변경 → **C19 re-pin 불요**. **PASS**.
- **VG3 (ADDITIVE safety)**: 컬럼 nullable default false. 기존 25 active foot 단말 → false(fast default) → 정산 스코프 유지·회귀 0. 롤백=DROP COLUMN. dryrun VG3 assert(470 외 excluded=0). **PASS**.
- **VG4 (단일행 seed)**: merchant_id='1047479470' 단일 anchor(ON CONFLICT DO UPDATE 멱등). dryrun rows==1 assert + archive-first before-image + rollback DELETE. active=true·reconcile_excluded=true. **PASS**.
- **VG5 (tenant)**: 470 = foot-tenant(구 bizno 511-60-00988 = foot 자기 구 bizno). domain='foot' seed → #2 MERNO cross-tenant 게이트 통과(오염 아님). **PASS**.

### 3.1 READ-ONLY PRE-PROBE (prod, 2026-08-07, write 0 · Management API)
```
col_reconcile_excluded_present : 0   → 컬럼 부재(ADDITIVE 확정·VG3 pre-state)
row_470_merchant_present       : 0   → 470 registry 부재(신규 seed·VG4)
tid_470_present_anywhere       : 0   → tid 1047479470 registry 전무(=게이트 차단 근본원인 확증)
active_foot_terminals          : 25  → 기존 회귀 대상 base
merchant_id_collision_anytenant: 0   → merchant_id='1047479470' UNIQUE 무충돌(self-anchor 안전)
```

---

## 4. 설계 결정 (craftsman notes)

### 4.1 merchant_id = TID self-anchor '1047479470'
- reporter(최필경)는 **TID만** 제공, 470 의 실 RedPay merchant_id 미제공. registry `merchant_id text NOT NULL UNIQUE`.
- 1047*(tid-format)는 기존 merchant_id(전부 1777*)와 무충돌(pre-probe collision=0). #2 MERNO 게이트 = `merchant_id=v_merno OR tid=v_merno OR superseded` → merchant_id·tid 둘 다 470 self-anchor → merchant 값이 470 로 오면 통과.
- 1777* 번호 **날조 금지**(pattern 추정 288002 가능하나 real 단말 오admit 위험) → self-anchor 가 최저위험·가역(rollback DELETE)·self-documenting. source 컬럼에 provenance 명기.
- ⚠ 물리 단말이 **다른 실 merchant 번호**를 raw_payload.merchant 로 전송해 #2 MERNO 통과가 필요하면 1줄 follow-up UPDATE(실 merchant_id) — 단 470=RedPay-blind→Plan-B raw 경로 미가동으로 inert. AC-4 실결제 시험(현장 최필경) 시 확인.

### 4.2 시퀀싱 (supervisor 유의)
- EF(redpay-reconcile/redpay-unreg-digest)가 신규 컬럼 select → **컬럼 착지 AFTER 에 EF 재배포**(마이그 먼저 apply → EF 배포). 전위 배포 시 registry 조회 오류 → 두 EF 모두 fail-safe 폴백(reconcile=env, digest=전량 미등록취급)로 안전 강하(크래시 0)이나 무의미 회피 위해 마이그-first 권장.
- 뷰 2종은 마이그 §2(installverify_pairs) → §3(reconciliation_daily) 순(후자가 전자 LEFT JOIN). CREATE OR REPLACE = 컬럼 무변경(WHERE 술어만) → 안전.

---

## 5. 잔여 게이트
1. **supervisor**: MIG-GATE = `.dryrun.sql` psql 실행(no-persist VG1~5 assert) + DDL-diff(ADDITIVE) + read-path 완전성(VG1) + seed write-correctness(VG4·rows==1) + #1/#2 무접촉(VG2)·C19 record_planb 무변경 확인. 그 후 apply(마이그 먼저 → EF).
2. **DA (post-apply)**: A11/A12 probe registry-membership 쿼리에 reconcile_excluded 배제 추가(#7·컬럼 착지 AFTER·DA lane).
3. **AC-4 (현장)**: 신규 CRM 에서 470 선택가능(#1) + 결제요청 경로 진입(물리 단말=최필경) + 정산화면 470 미노출(격리) 확인.

---
*change-class = ADDITIVE(컬럼 ADD + read-path 술어 + 단일행 seed) · §3.1 대표게이트 면제 · 잔여 = supervisor DDL-diff/MIG-GATE.*
