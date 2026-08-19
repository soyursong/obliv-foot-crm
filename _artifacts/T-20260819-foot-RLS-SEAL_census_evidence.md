# T-20260819-foot-RLS-PERMISSIVE-CLINIC-GATE-SEAL — AC1 prod 재-census evidence

- **when**: 2026-08-19 (SSOT census 2026-07-23 대비 27일 경과 → git 선언 신뢰 금지·재실측)
- **method**: READ-ONLY Management API introspection (`scripts/…_census.mjs`, `q()` from dryrun_lib). WRITE 0 · DDL 0.
- **ref**: rxlomoozakkjesdqjtvd (prod)
- **SSOT**: da_decision_xcrm_rls_permissive_clinicgate_seal_20260723.md §A/§C

## clinics (LIVE vs latent)
| slug | name | customers | staff | 상태 |
|------|------|-----------|-------|------|
| jongno-foot | 오블리브의원 서울 오리진점 | 2517 | 70 | 🟢 **data-bearing (active)** |
| songdo-foot | 오블리브 풋센터 송도 | 0 | 0 | 🟡 **LATENT (empty)** |

→ clinics=2 provisioned이나 data-bearing=1(jongno). songdo=0/0 = latent(pkgpay census H4b와 일치).

## helper (술어 의존) 실재
- `current_user_clinic_id()` → uuid, SECURITY DEFINER ✓
- `is_admin_or_manager()` → boolean, SECURITY DEFINER ✓
→ 캐노니컬 §A-3 predicate `(clinic_id = current_user_clinic_id()) OR is_admin_or_manager()` 직접 이식 가능.

## authenticated-OPEN surface = 24 (permissive universal-true SELECT/ALL + authenticated-적용 RESTRICTIVE 부재)

### 봉쇄 대상 (본 티켓 — SSOT §C-3 named PHI/금융, self-derive canonical §A)
| # | table | PHI/금융 | offending permissive | grain(§A-2) | H3 total/NULL | H5 clinic_id |
|---|-------|----------|----------------------|-------------|---------------|--------------|
| 1 | clinical_images | PHI | `auth_all` ALL true | **ALL** (wide-open write) | 0/0 | NOT NULL |
| 2 | consent_forms | PHI | `auth_users_all` ALL true | **ALL** | 0/0 | NOT NULL |
| 3 | message_logs | PHI | `message_logs_authenticated` ALL true | **ALL** | 0/0 | NOT NULL |
| 4 | service_charges | 금융(매출명세) | `auth_all` ALL true | **ALL** | 782/0 (distinct=1 jongno) | NOT NULL |
| 5 | packages | 금융 | `packages_read` SELECT true (write=role-gate, non-universal) | **SELECT** (§A-2 SELECT-only branch) | 931/0 (distinct=1 jongno) | NOT NULL |
| 6 | checklists | PHI(사전체크리스트) | `auth_users_all` ALL true | **ALL** | 0/0 | NOT NULL |

- **package_payments** = 이미 SEAL 완료(`package_payments_tenant_isolation` RESTRICTIVE ALL, 20260810200000) → 제외.
- **availability 게이트**: 6테이블 全 `clinic_id` = **NOT NULL** 컬럼 → H3(NULL 잔존 0) 구조적 보장 + H5(write-path clinic_id stamp) 구조적 보장(NOT NULL이 NULL insert 거부 = app-stamp 필수). populated 2테이블(service_charges/packages) distinct_clinics=1(jongno) → **회귀0**(전행 jongno = jongno staff current_user_clinic_id). empty 4테이블 = 회귀 불가·forward-protective.

### 봉쇄 보류 → planner FOLLOWUP (DA CONSULT: §C-3 미명명 신규 테이블 편입)
PHI/금융-인접이나 SSOT §C-3 foot named 7 밖 = "신규 테이블 편입" → DA 1차 CONSULT 필요(자율 self-derive 금지):
- health_maintenance_balances (금융 잔액, clinic_id+customer_id, `auth_all` ALL true)
- payment_audit_logs (`payment_audit_logs_open`)
- receipt_ocr_results (`auth_all`)
- claim_diagnoses (보험 PHI, `claim_diagnoses_auth_all`)
- handover_notes (임상 인계, `handover_notes_select`)

### out-of-scope (config/reference, clinic-shared 의도 가능 — 별 트랙/미봉쇄)
code_availability, diagnosis_folders, diagnosis_sets, form_templates, notices, package_tiers,
quick_rx_buttons, redpay_terminal_registry, redpay_unregistered_line_seen, room_role_mapping,
treatment_sets, timer_records, waiting_board.
(anon 도달분 services/package_tiers/waiting_board 등 anon 축 = lane b T-20260810-foot-RLS-ANON-PERMISSIVE-SEAL 별 트랙)

## 격상 판정 (§C-3)
- 격상 트리거 = **clinics>1 LIVE AND 실제 wide-open PHI/금융 cross-tenant read 확증**.
- clinics=2(provisioned)이나 songdo=0/0 empty → **실제 cross-tenant read 대상 데이터 부재** → 두 번째 conjunct 미충족.
- ⇒ **P0 격상 조건 미충족**(no ESCALATE). SEAL = forward-protective(songdo 활성화 前 격리 봉인) + 회귀0(effective 단일 active clinic). 
  현행 authenticated cross-tenant read 이론적 노출은 존재하나(권한상 열림) 대상 데이터 0(songdo empty)이므로 실측 누수 0.
