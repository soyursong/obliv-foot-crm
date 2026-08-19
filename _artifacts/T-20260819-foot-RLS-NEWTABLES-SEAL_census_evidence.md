# T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL (leg2) — per-table READ-ONLY census evidence

- **when**: 2026-08-20 (prod 실측)
- **method**: READ-ONLY Management API introspection (`scripts/T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL_census.mjs`, `q()` from dryrun_lib). **WRITE 0 · DDL 0**.
- **ref**: rxlomoozakkjesdqjtvd (prod)
- **DA SSOT**: `agents/docs/da_replies/da_decision_foot_rls_permissive_newtables_clinicgate_seal_20260819.md` (부모 `da_decision_xcrm_rls_permissive_clinicgate_seal_20260723.md` §A/§C)
- **raw dump**: `/tmp/foot_newtables_census.txt` (재현: 위 러너 실행)

## clinics (tenancy)
| slug | name | customers | staff | 상태 |
|------|------|-----------|-------|------|
| jongno-foot | 오블리브의원 서울 오리진점 | 2517 | 70 | 🟢 **data-bearing (active)** |
| songdo-foot | 오블리브 풋센터 송도 | 0 | 0 | 🟡 **LATENT (0/0)** |

→ data-bearing=1(jongno). songdo=LATENT → 실 cross-tenant read 대상 데이터 부재 = P0 미충족·**forward-protective**. §A-4 회귀0 전제 성립.

## helper (술어 의존) 실재
- `current_user_clinic_id()` → uuid, SECURITY DEFINER ✓
- `is_admin_or_manager()` → boolean, SECURITY DEFINER ✓
→ 캐노니컬 §A-3 predicate `(clinic_id = current_user_clinic_id()) OR is_admin_or_manager()` 직접 이식 가능. ⚠️ admin bypass = `is_admin_or_manager()`(foot 캐노니컬) — crm `get_user_role()='admin'` 미사용.

---

## Q1 — 신규 PHI/금융 5테이블 per-table census (DA 판별식)

| # | table | 성격 | offending permissive (실재) | clinic_id (NULL/total) | customer_id | anchor | write-openness | **grain** |
|---|-------|------|------------------------------|------------------------|-------------|--------|----------------|-----------|
| 1 | health_maintenance_balances | 금융 잔액 | `auth_all` ALL true (authenticated) · RESTRICTIVE 부재 | NOT NULL · 0/0 | NOT NULL | direct clinic_id | ALL true (wide-open) | **ALL** |
| 2 | payment_audit_logs | 결제 감사 | `payment_audit_logs_open` ALL true (authenticated) · RESTRICTIVE 부재 | nullable · 0 NULL/10 (distinct=1 jongno) | 부재 | direct clinic_id | ALL true (authenticated app INSERT) | **SELECT (read-seal)** ★ |
| 3 | receipt_ocr_results | 영수증 OCR | `auth_all` ALL true (authenticated) · RESTRICTIVE 부재 | nullable · 0/0 | 부재 | direct clinic_id | ALL true (wide-open) | **ALL** |
| 4 | claim_diagnoses | 보험 PHI(청구진단) | `claim_diagnoses_auth_all` ALL true (authenticated) · RESTRICTIVE 부재 | nullable · 0/0 | 부재 | direct clinic_id | ALL true (client write-path 0, EF/service_role) | **ALL** |
| 5 | handover_notes | 임상 인계 | `handover_notes_select` SELECT true (authenticated) · RESTRICTIVE 부재 | NOT NULL · 0/41 (distinct=1 jongno) | 부재 | direct clinic_id | INSERT check=true(write-open) · UPDATE/DELETE=author-gated | **ALL** |

### anchor 판정
- 5건 전부 **clinic_id 컬럼 실재** → **direct anchor** `(clinic_id = current_user_clinic_id()) OR is_admin_or_manager()`. customers-join 불요(DA advisory "claim_diagnoses customer-join 유력"은 census 로 반증 — claim_diagnoses.clinic_id 실재).

### ★ payment_audit_logs grain = SELECT read-seal (audit immutability — DA §C-4 / H3 게이트)
- **G_pal_triggers census = `[]`**: payment_audit_logs 를 write 하는 SECDEF trigger/system 함수 **부재**. write 경로 = authenticated app 직접 INSERT.
- **FE write-path 실측**: `PaymentEditDialog.tsx:126` + `PaymentMethodChangeDialog.tsx:130` = `supabase.from('payment_audit_logs').insert({ clinic_id: payment.clinic_id ?? null, ... })`. **clinic_id 가 `?? null` 로 NULL 가능**.
- **→ ALL grain WITH CHECK `(clinic_id=current_user_clinic_id()) OR is_admin_or_manager()` 적용 시**: payment.clinic_id NULL 인 정정건에서 일반 staff 감사 INSERT = WITH CHECK false → **INSERT 실패 → 결제 정정/수단변경 파손**(PaymentEditDialog 는 audit INSERT 에러 미-catch → throw). = **H3 REJECT(정당 감사 INSERT 파손)**.
- **∴ SELECT read-seal 채택**(DA "append-only … SELECT read-seal 로 충분" 옵션): cross-tenant **READ 누수(실 노출 벡터)** 봉쇄 + INSERT 경로 **무영향**. 잔여 cross-tenant write pollution = songdo LATENT 로 forward-only·비긴급.

### availability 게이트 (H3/H5)
- ALL-grain 4건(hmb·receipt_ocr·claim_diagnoses·handover_notes): 현 NULL clinic_id = **0** (PREFLIGHT 재확인). NOT NULL 2건(hmb·handover) 구조적 보장. nullable 2건(receipt_ocr·claim_diagnoses) = 0 rows(forward-protective) + write-path clinic_id stamp 실측(`receipt_ocr`: `if(!clinicId) return`+stamp·non-fatal catch / `claim_diagnoses`: client write 0, EF service_role=BYPASSRLS).

---

## Q2 — config/reference 3-way partition (13 테이블 census)

| table | clinic_id (NULL/total·distinct) | anon-reachable SELECT | 기존 anon_deny | legit anon/cross-read | **분류** |
|-------|-------------------------------|----------------------|----------------|----------------------|----------|
| diagnosis_folders | NOT NULL · 0/2 · 1 | 無(authenticated only) | — | 無 | **(A) seal ALL** |
| diagnosis_sets | NOT NULL · 0/1 · 1 | 無(authenticated only) | — | 無 | **(A) seal ALL** |
| notices | NOT NULL · 0/1 · 1 | 無(select=authenticated·insert=clinic-gated) | — | 無(per-clinic insert gate) | **(A) seal ALL** |
| room_role_mapping | NOT NULL · 0/4 · 1 | public SELECT | ✓ `room_role_mapping_anon_deny` | write 이미 clinic-gate(design=per-clinic) | **(A) seal SELECT** |
| code_availability | NOT NULL · 0/2 · **2** | ✓ `{anon,authenticated}` true | ✗ 없음 | anon 소비자 0(hooks=authenticated·RPC=SECDEF) | **(C) anon deny** (+authenticated seal=governance) |
| redpay_unregistered_line_seen | nullable · **1/1** · 0 | ✓ `{public}` true | ✗ 없음 | 소비자 0(dead) | **(C) anon deny** (clinic-gate=(B) org-global) |
| redpay_terminal_registry | nullable · **18/44** · 1 | public SELECT | ✓ `redpay_terminal_registry_anon_deny` | NULL=18 org-global | **(B) carve-out** (anon 旣봉인·무동작) |
| package_tiers | NOT NULL · 0/6 · 1 | anon SELECT | ✓ `package_tiers_anon_deny` | 패키지 tier catalog(DA (B) 예시) | **(B) carve-out** (anon 旣봉인·무동작) |
| form_templates | NOT NULL · 0/35 · 1 | public SELECT | ✓ `form_templates_anon_deny` | org-standard vs per-clinic 애매 | **governance** (anon 旣봉인) |
| treatment_sets | nullable · 0/2 · 1 | 無(authenticated only) | — | shared vs per-clinic 애매 | **governance** |
| quick_rx_buttons | nullable · 0/0 · 0 | 無(authenticated only) | — | 0 rows | **governance** (forward) |
| timer_records | **NOT NULL text** · 0/691 · 1 | 無(authenticated only) | — | clinic_id **TEXT type anomaly**(uuid 아님) | **governance/DA** (cast predicate vs schema-fix 판단 필요) |
| waiting_board | NOT NULL · 0/90 · 1 | ✓ `{anon,authenticated}` true | ✗ 없음 | **LEGIT anon**(`Waiting.tsx:120 anonClient.from('waiting_board')` 공개 대기판) | **lane b** (T-20260810·anon HOLD, blanket 봉쇄 시 공개대기판 파손) |

### 분류 근거
- **(A) seal**: clinic_id uuid NOT NULL · 0 NULL · distinct≤2 · per-clinic 운영/임상 config · legit cross-read 無. 회귀0(전행 jongno) · forward-protective. grain: diagnosis_folders/sets/notices=write ALL true→**ALL**, room_role_mapping=write 이미 clinic-gate·SELECT-only universal→**SELECT**.
- **(C) anon deny**: anon-도달(anon/public SELECT true) + 기존 anon_deny 부재 + legit anon 소비자 0 → 미인증 누수. foot 캐노니컬 anon-deny 패턴 `AS RESTRICTIVE FOR ALL TO anon USING(false) WITH CHECK(false)` 재사용(form_templates/package_tiers 旣존 패턴 동형). 전지점 authenticated read 보존.
- **(B) carve-out(EXCLUDE)**: NULL clinic_id >0(org-global 신호: redpay_terminal_registry 18·redpay_unregistered_line_seen 1) OR shared catalog(package_tiers) → clinic-gate 시 org-global 행 lockout(H4). anon 축은 旣봉인(redpay_terminal_registry·package_tiers) or (C) 처리(redpay_unregistered).
- **governance (planner FOLLOWUP)**: form_templates(org-standard vs per-clinic) · treatment_sets(shared vs per-clinic) · quick_rx_buttons(0 rows) · code_availability authenticated 축(per-center overlay·RPC=SECDEF RLS-immune) · timer_records(clinic_id TEXT type anomaly). songdo LATENT → P0 긴급도 낮음. anon 축(C)은 governance 무관 즉시 착지.

---

## §C-3 정본 census-confirm set (AC3)
**seal 대상 (leg2 확정):**
- Q1: health_maintenance_balances(ALL) · payment_audit_logs(SELECT) · receipt_ocr_results(ALL) · claim_diagnoses(ALL) · handover_notes(ALL)
- Q2 (A): diagnosis_folders(ALL) · diagnosis_sets(ALL) · notices(ALL) · room_role_mapping(SELECT)
- Q2 (C): code_availability(anon_deny) · redpay_unregistered_line_seen(anon_deny)

**EXCLUDE(문서화):** redpay_terminal_registry·package_tiers·form_templates·treatment_sets·quick_rx_buttons·timer_records·waiting_board → (B) carve-out or governance/lane-b. drift-guard baseline: seal-set 11 policy 편입(§C-5).

## 격상 판정 (§C-3)
격상 = clinics>1 LIVE AND wide-open cross-tenant read 확증. songdo=LATENT(0/0) → 두번째 conjunct 미충족 → **P0 격상 미충족(no ESCALATE)**. SEAL = forward-protective + 회귀0.
