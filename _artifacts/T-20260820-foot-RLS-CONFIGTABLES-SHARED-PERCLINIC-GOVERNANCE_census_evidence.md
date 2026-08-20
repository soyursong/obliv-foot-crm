# T-20260820-foot-RLS-CONFIGTABLES-SHARED-PERCLINIC-GOVERNANCE — per-table READ-ONLY census evidence

- **when**: 2026-08-20 (prod 실측)
- **method**: READ-ONLY Management API introspection (`scripts/T-20260820-foot-RLS-CONFIGTABLES-SHARED-PERCLINIC-GOVERNANCE_census_readonly.mjs`, `q()` from dryrun_lib). **WRITE 0 · DDL 0**.
- **ref**: rxlomoozakkjesdqjtvd (prod)
- **부모**: T-20260819-foot-RLS-PERMISSIVE-NEWTABLES-SEAL (§C-4 governance leg 해소분)
- **DA SSOT**: `agents/docs/da_replies/da_decision_foot_rls_permissive_newtables_clinicgate_seal_20260819.md` §C-4 / Q2 3-way partition (부모 `da_decision_xcrm_rls_permissive_clinicgate_seal_20260723.md` §A/§C)
- **현장 결정**: 김주연 총괄 "지점마다 다르지" (slack reply ts 1787181267.196129) → config 3테이블 애매분 **전부 (A) per-clinic 격리** → RESTRICTIVE clinic-gate seal.

## clinics (tenancy)
| slug | id | customers | staff | 상태 |
|------|----|-----------|-------|------|
| jongno-foot | 74967aea-a60b-4da3-a0e7-9c997a930bc8 | 2520 | 70 | 🟢 **data-bearing (active)** |
| songdo-foot | b4dc0de5-f007-4a57-8888-aabbccddeeff | 0 | 0 | 🟡 **LATENT (0/0)** |

→ data-bearing=1(jongno). songdo=LATENT → 실 cross-tenant read 대상 데이터 부재 = P0 미충족·**forward-protective**. §A-4 회귀0 전제 성립(전행 자기 clinic-scope).

## helper (술어 의존) 실재
- `current_user_clinic_id()` → uuid, SECURITY DEFINER ✓
- `is_admin_or_manager()` → boolean, SECURITY DEFINER ✓
→ 캐노니컬 §A-3 predicate `(clinic_id = current_user_clinic_id()) OR is_admin_or_manager()` 직접 이식. ⚠️ admin bypass = `is_admin_or_manager()`(foot 캐노니컬) — crm `get_user_role()='admin'` 미사용.

---

## per-table census (DA 판별식 4항: offending permissive 실재 · anchor · NULL clinic_id · write-openness→grain)

### ① form_templates — SELECT read-seal
| 항목 | 실측 |
|------|------|
| clinic_id | **uuid · NOT NULL** · NULL=0 · total=35 · distinct=1(jongno) |
| offending permissive (universal-true) | `form_templates_read` **SELECT {public} true** (→ authenticated read 누수) |
| write path 정책 | `form_templates_admin_all` PERMISSIVE ALL {authenticated} **is_admin_or_manager()** (admin/manager 전용 write) |
| anon | `form_templates_anon_deny` RESTRICTIVE ALL {anon} false **旣봉인**(부모 leg) |
| RESTRICTIVE clinic-gate | ✗ 부재(double-apply 아님) · RLS=ON |
| write-openness | ✗ **wide-open 아님** — write=admin-gated, 非admin authenticated write permissive 0 |
| **grain** | **SELECT** (§A-2: write 非universal-true → 노출축=read → read-seal. room_role_mapping 선례 동형) |
| write path (FE) | `OpinionPhrasesTab.tsx:196/264 from('form_templates').insert` = admin UI(is_admin_or_manager 게이트 하) → SELECT-seal 무영향 |
- **regression**: jongno 전행 clinic_id=jongno → jongno staff 35행 전건 read 유지. admin bypass. anon 旣차단. 회귀0.

### ② treatment_sets — ALL clinic-gate
| 항목 | 실측 |
|------|------|
| clinic_id | **uuid · NULLABLE** · NULL=0(현재) · total=2 · distinct=1(jongno) |
| offending permissive (universal-true) | `authenticated_all_treatment_sets` **ALL {authenticated} true/true** (read+write wide-open) |
| anon | anon 도달 없음(authenticated-only) |
| RESTRICTIVE clinic-gate | ✗ 부재 · RLS=ON |
| write-openness | ✓ **wide-open** (ALL true) → grain=**ALL** (USING+WITH CHECK) |
| **grain** | **ALL** (§A-2: write universal-true 개방 → ALL) |
| write path (FE) | `TreatmentSetsTab.tsx:210-234 upsertTreatmentSet` → **insert payload `clinic_id: clinicId` 항상 stamp**(L211). clinicId=`sets[0]?.clinic_id ?? '74967aea…'`(=jongno) → WITH CHECK `(own)∨admin` 통과. + L420 comment: write 실사용자=`{admin,manager}` → is_admin_or_manager() bypass → WITH CHECK 무lockout |
- **H3(nullable)**: 현 NULL=0. clinic_id nullable → **PREFLIGHT NULL=0 재확인 가드 필수**(seal 시점 drift). NULL 발생 시 백필/재census 선행.
- **regression**: jongno staff 2행 read/write 유지. admin/manager bypass. 회귀0.

### ③ code_availability — SELECT read-seal (방어심층)
| 항목 | 실측 |
|------|------|
| clinic_id | **uuid · NOT NULL** · NULL=0 · total=2 · distinct=**2**(jongno+songdo 각 1행) |
| offending permissive (universal-true) | `code_availability_select` **SELECT {anon,authenticated} true** |
| anon | `code_availability_anon_deny` RESTRICTIVE ALL {anon} false **旣봉인**(부모 leg2 20260820000000) |
| write path 정책 | write permissive **0** (authenticated write RLS 차단 · service_role/SECDEF 만 write) |
| RESTRICTIVE clinic-gate | ✗ 부재 · RLS=ON |
| write-openness | ✗ write permissive 0 → 노출축=read → grain=**SELECT** |
| **grain** | **SELECT** (read-seal) |
| read path (FE) | `useInflowChannels.ts:35 rpc('get_inflow_channels')` · `useVisitNatures.ts` = **SECDEF RPC = RLS-immune** → SELECT seal 무영향. 직접 `.from('code_availability').select()` 소비자=0 |
- ⚠ **실효성 낮음**(ticket 명시): read=SECDEF RPC RLS-immune → seal 은 hypothetical 직접-client-read 에만 작동 = **방어심층(defense-in-depth)**. 총괄 결정=격리 → 착지.
- **regression**: jongno staff 직접 read = 2행 → 1행(자기 clinic only). 단 실 read=RPC(immune) → 앱 무영향. admin bypass. anon 旣차단.

---

## 확정 seal set (3 policy, census-gated)
| # | table | grain | new policy | offending permissive(존치·ADDITIVE) |
|---|-------|-------|-----------|-------------------------------------|
| 1 | form_templates    | SELECT | `form_templates_clinic_read_restrict`    | `form_templates_read` |
| 2 | treatment_sets    | ALL    | `treatment_sets_clinic_gate_restrict`    | `authenticated_all_treatment_sets` |
| 3 | code_availability | SELECT | `code_availability_clinic_read_restrict` | `code_availability_select` |

- predicate(§A-3 캐노니컬 byte-identical): `(clinic_id = current_user_clinic_id()) OR is_admin_or_manager()`
- change-class = **exposure-REDUCING ADDITIVE**: permissive DROP 0 · RESTRICTIVE 신설 · mutation 0 · 신규 컬럼/타입/enum/테이블 0 · 완전가역(DROP 1줄/정책).
- 부모 seal-set 편입(drift-guard baseline §C-5): 기존 11 policy + 본 3 = 14.
- **범위 밖**: `quick_rx_buttons`(0행) = deferred 유지(rows>0 시 재census). anon 축 = 부모 leg 旣봉쇄(form_templates_anon_deny·code_availability_anon_deny) — 본 leg=authenticated per-clinic 격리만.

## 격상 판정 (§C-3)
격상 = clinics>1 LIVE AND wide-open cross-tenant read 확증. songdo=LATENT(0/0) → 두번째 conjunct 미충족 → **P0 격상 미충족(no ESCALATE)**. SEAL = forward-protective + 회귀0.
