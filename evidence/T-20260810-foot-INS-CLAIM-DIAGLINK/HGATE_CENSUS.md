# T-20260810-foot-INS-CLAIM-DIAGLINK (B-3) — HARD-gate census + diagnosis-link 계약

> 상병(KCD) 청구 연결. DA CONSULT-REPLY **MSG-20260810-203221-2zrw** = 조건부 GO(ADDITIVE).
> apply-order(AC-1 form-A): DA GO(수신) → **dev-foot 구현(본 문서)** → supervisor DDL-diff(up/down)+물리 GO-token → apply → post-verify.
> repo: obliv-foot-crm · branch: `feat/T-20260810-foot-INS-CLAIM-DIAGLINK` · Supabase prod ref `rxlomoozakkjesdqjtvd`
> ★ 본 티켓은 **NOT deploy-ready** — prod DDL apply 는 supervisor 물리 GO-token 후에만(H8, apply_before_go 금지).

---

## 0. 산출물 (dev-foot 소유: 마이그 + census 3종 + precedence)

| 항목 | 파일 | 상태 |
|------|------|------|
| 마이그 ADD (up) | `supabase/migrations/20260811010000_foot_check_ins_kcd_code_b3.sql` | 스테이징(미적용) |
| dry-run (무영속) | `..._b3.dryrun.sql` (sentinel ROLLBACK, No-Persistence Protocol) | 스테이징 |
| rollback (down) | `..._b3.rollback.sql` (DROP COLUMN) | 스테이징 |
| FE 캡처 필드 (Q6 FE leg) | `src/components/insurance/KcdDiagnosisField.tsx` (`isKnownKcdCode` 저장방어) | 커밋됨(ea4e71ab) |
| FE mount | `src/components/CheckInDetailSheet.tsx` (스태프 동선·§11 의사 surface 무접촉) | 커밋됨 |
| type | `src/lib/types.ts` (`CheckIn.kcd_code`) | 커밋됨 |

**★ 마이그 버전 재채번**: `20260811000000` → `20260811010000`. 사유 = B-2(`T-20260810-foot-INS-CLAIM-AUTODRAFT`,
deploy-ready)가 `20260811000000` 를 선점 → migration ledger version 충돌 회피. B-3(check_ins ADD COLUMN) 는
B-2(function+trigger) 와 **DDL 의존 없음** — 적용 순서 무관, distinct version 만 필요.

---

## 3축 분리 (DA 재프레이밍 — collapse 금지)

| 축 | 정의 | 본 티켓 착지 |
|----|------|------------|
| 축1 캡처tier | 의사 `chart_diagnoses`(주/부 authoritative) vs 스태프 `check_ins.kcd_code`(fallback) | **check_ins.kcd_code = 스태프 fallback tier 신설** (body mirror) |
| 축2 청구조립원장 | `insurance_claim_diagnoses` = **산출물**(캡처면 아님), 캡처가 FEED만 | 직서 금지(H1) — B-2 claim-assembly 가 조립 |
| 축3 grain | `check_ins` = 방문 grain = NHIS 방문당 ≥1 정합 | 단일 컬럼 = 방문당 단일 KCD(H9) |

---

## HARD 게이트 census (apply 前 — H1~H9)

### H1 — 캡처면 = check_ins.kcd_code only · insurance_claim_diagnoses 직서 금지 ✅
- 신규 캡처 surface = `check_ins.kcd_code` 단 1컬럼. FE(`KcdDiagnosisField`)는 `check_ins` 로만 write.
- `insurance_claim_diagnoses` 직접 write 경로 **0** (본 티켓 코드/마이그 어디에도 INSERT 없음).
- chart_diagnoses(축1 authoritative)는 존치(Q2 소스)·본 티켓 미변경.

### H2/H3 — precedence deterministic · fallback overwrite 금지 · 결핍=보류/flag (diagnosis-link 계약)
> 런타임 join(claim 생성 시 상병 FEED)은 **B-2 claim-assembly 에 귀속**(B-2 이후 통합). 아래는 그 통합이
> 반드시 준수해야 하는 **결정적 precedence 계약**(본 티켓이 캡처 원천 + 계약을 공급, B-2 가 조립).

```
claim-assembly diagnosis FEED precedence (deterministic):
  ① chart_diagnoses (의사 진료차트 = authoritative 주/부상병)  ← 최우선
  ② check_ins.kcd_code (스태프 캡처 = fallback 단일 주상병)     ← ① 부재 시에만
  ③ 상병결핍표식 (deficiency flag · B-2 귀속)                   ← ①② 부재 → 청구 보류/flag
```
- **H2**: ② fallback 은 ① authoritative 를 **절대 overwrite 금지**. ① 존재 시 ② 무시.
- **H3**: ③ 결핍 → **placeholder/unknown KCD 자동합성 금지**(발명금지). unknown-KCD emit 금지. 사람 resolution 전까지 청구 보류.
- 계약 codify(cross-CRM 문서화)는 **planner 소유(post-GO)**. 본 문서 = dev-foot 측 구현 계약 앵커.

### H4 — check_ins RLS census (clinic-scoped + role-gated) ✅ (READ-ONLY 실측)
- `ALTER TABLE check_ins ENABLE ROW LEVEL SECURITY` — `20260615160000_rls_clinic_isolation_patient_tables.sql:62`.
- 전 정책 **clinic-scoped**(`clinic_id = current_user_clinic_id()`) + **role-gated**:
  - `check_ins_admin_all` (ALL): `is_admin_or_manager() AND clinic_id = current_user_clinic_id()`
  - `check_ins_consult_insert` / `check_ins_coord_insert` (INSERT): `is_*_or_above() AND clinic_id = current_user_clinic_id()`
  - `check_ins_approved_read` (SELECT): `is_approved_user() AND clinic_id = current_user_clinic_id()`
  - `check_ins_consult_update` / `check_ins_coord_update` (UPDATE): role + `clinic_id = current_user_clinic_id()`
  - `check_ins_floor_dashboard_update`(`20260602120000`) / `check_ins_register_unlock_insert`(`20260630210000`): role-set + clinic-scoped.
- **medical_charts.diagnosis 최소동급 비교**: `mc_clinic_isolated`(`20260517000030:9`) = `clinic_id = current_user_clinic_id()` — **동일 clinic 격리 패턴**.
- ∴ 신규 `kcd_code` 컬럼 = **row-level RLS 상속**(전 컬럼 적용) → 별도 컬럼 RLS 불요. **PASS** (H5-census 가정 (H4) 충족).

### H5 — anon-표면 하드가드 (load-bearing · 상병PHI 컬럼 신설 노출벡터) ✅ (pre-existing 방화벽 확인)
- **(1) table-level SELECT**: `20260615180000_rls_clinic_isolation_anon_revoke.sql` (Phase 2b, UN-HELD 2026-07-23,
  KIOSK-READPATH-ANON-CUTOVER=done, supervisor POSTCHECK 4/4 PASS)가 이미:
  - `DROP POLICY IF EXISTS anon_checkin_read ON check_ins` (구 `USING(true)` 정책 제거, line 30)
  - `REVOKE SELECT ON check_ins FROM anon` (line 41)
  - **이후 어떤 마이그도 anon 에 check_ins SELECT 재부여 없음**(grep 확인, 0건).
  - ∴ anon 은 check_ins table-level SELECT **권한 0** → 신규 `kcd_code`(상병PHI) 컬럼 **자동 커버**(§15 2차 백스톱 旣적용).
    "잔존시 REVOKE" 조건 = **불성립**(旣회수) → 신규 REVOKE 마이그 불요. 마이그 = pure ADD COLUMN 유지(DA-reviewed change_class 보존).
- **(2) anon-reachable RPC echo=0**: 셀프체크인 anon RPC(§15-5-1)는 **컬럼 명시 열거**(SELECT * 아님):
  - `fn_prescreen_start(UUID)` (`20260710224000:37`, GRANT anon): 반환 = `status, customer_name, customer_phone, customer_id, clinic_id, visit_type` — **kcd_code 미반환**.
  - `fn_complete_prescreen_checklist` : `{success, checklist_id}` 만 반환 — check_ins 데이터 미echo.
  - `next_queue_number` : queue 번호만.
  - ∴ 신규 컬럼은 명시열거 RPC 에 **자동 미노출** → anon-read 표면 = 0. **스태프-write 전용** 성립.
- **verify-gate(supervisor POSTCHECK)**: prod ledger 에 `20260615180000` applied 확인(anon SELECT check_ins = 0 실측).

### H6 — server-side KCD backstop ✅ (계약 · foot 마스터 미신설 정합)
- FE `isKnownKcdCode`(정적번들 대조) = 저장 직전 방어(`KcdDiagnosisField.persist`) — **필요하나 단독 불충분**(FE 우회 가능·직접 client write 경로).
- foot 는 KCD 마스터 미신설(정적번들 lockdown T-20260611) → **DB FK/CHECK 대조 불가**(Q4 coherent divergence).
- ∴ backstop = **claim-assembly(B-2) 가 unknown/미검증 kcd_code 를 정식청구에서 reject/flag** (DA H6 "최소" 경로).
  draft claim 은 검증 전 상태로 유지 → 정식 NHIS 제출(사람 게이트, 별건) 전 미검증 상병 차단. **placeholder 합성/자동추론 금지**.
- 계약: 본 문서 §H2/H3 precedence 의 ② leg 검증 조건으로 B-2 통합 시 구현.

### H7 — kcd_code = 국가표준 KCD canonical ✅
- 저장값 = foot 정적번들(`src/lib/kcd/kcdData.ts`, `KCD_BUNDLE_VERSION`) 실재 코드만(FE isKnownKcdCode).
- atom-level: 동일 KCD code = body/foot 공히 국가표준 canonical(A10 동일 code=동일 의미). (마스터 메커니즘은 발산해도 atom 은 동일.)
- detect-only(non-blocking): 정적번들 ↔ body 마스터 KCD 개정 drift 감시 = **planner codify(post-GO)**. 본 GO 무저촉.

### H8 — 물리 GO-token 후 apply ✅ (준수 중)
- ADDITIVE·DDL-0 을 GO-token 면제로 **오분류 금지**. up.sql = PROD 미적용 스테이징. supervisor DDL-diff(up/down) + 물리 DB-GATE GO-token 후에만 apply.

### H9 — 단일컬럼 = 방문당 단일 KCD ✅
- `check_ins.kcd_code TEXT` = 방문당 단일 KCD(주상병 fallback) = NHIS 방문당 ≥1 충분.
- 다중상병 구조화(주/부) = 의사 `chart_diagnoses` 전용. 다중상병 스태프 필요 시 **별건 재판정**(단일컬럼→child grain 금지).

---

## change-class / 게이트 요약
- change_class = **ADDITIVE** (신규 컬럼 1 · nullable · DEFAULT 없음 · backfill 0 · 기존행 무변경 · DROP 0 · txn-control 없음).
- §3.1 CEO 파괴 게이트 = **면제**(ADDITIVE + DA GO). BUT DDL-0 carve **아님** → supervisor DDL-diff + 물리 GO-token 선행 REQUIRED.
- 자체 apply(apply_before_go) **금지**(AC-1). DA GO = change-class 판정만 · apply-gate/order = supervisor 물리 GO-token chokepoint.

## 소유 (DA 확정)
- 판정/축분리/change-class = **DA**
- 마이그 + census 3종 + precedence(구현 계약) = **dev-foot** ← 본 문서
- DDL-diff(up/down) + 물리 GO-token + QA = **supervisor**
- precedence 계약 cross-CRM codify + 정적번들 drift note = **planner (post-GO)**

## deadline
2026-08-15 (여유).
