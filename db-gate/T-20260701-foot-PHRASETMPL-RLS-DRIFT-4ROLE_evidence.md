# T-20260701-foot-PHRASETMPL-RLS-DRIFT-4ROLE — DB-gate evidence

**phrase_templates write RLS 드리프트 복구 + 잔여 4역할 정합 (pen_chart/customer_chart)**
db_change=true · ADDITIVE only · DA GO 확보 · supervisor DDL-diff 게이트 대기

---

## AC-1 — 드리프트 root-cause (Phase A, read-only, 확정)

**RC = 순수 미apply.** (revert 아님 / 20260624180000 덮음 아님)

- `staff_write_staffarea_phrases` (마이그 `20260620120000` / commit `92a95431`) = **PROD phrase_templates 부재**.
- PROD 실측 정책 = `admin_write_phrase_templates{admin,manager,director}` + `staff_read_phrase_templates(true)` 2건뿐.
- **원인**: 6/09 이후 `supabase_migrations.schema_migrations` 원장 미추적(118행, 20260609234500 에서 멈춤) → 마이그는 개별 apply `.mjs` 로만 PROD 반영. `92a95431` 은 **apply 스크립트가 없어 reconcile 경로 자체 부재** → 영구 미반영.
- **혐의 기각①** revert: rollback 실행/커밋 흔적 0, 정책 애초 미생성.
- **혐의 기각②** 20260624180000 덮음: 그 마이그(및 실제 랜딩한 CLINICMGMT-3TAB apply)는 **별개 정책명** `admin_write_phrase_templates` 만 DROP/CREATE. `staff_write_staffarea_phrases` 미참조 → 덮을 수 없음.
- **systemic carry(권고)**: 6/09 이후 전 마이그 원장 미추적 → apply 스크립트 누락분 조용히 미반영 가능. 인접 마이그 PROD 미반영 parity audit 별도 권고(비블로킹).
- 실측 스크립트: `scripts/T-20260701-foot-PHRASETMPL-RLS-DRIFT-4ROLE_phaseA_diag.mjs`

## AC-2 — DA CONSULT-REPLY shape 확정

DA CONSULT-REPLY **MSG-20260701-102354-f5k2** (DA-20260701-PHRASETMPL-RLS-DRIFT, ref 3yo2):

- **shape = (i) 계열 — 기존 `20260620120000` 재적용 (파일 그대로 forward apply). 신규 authoring 0.**
  - 이 정책 role set = `{consultant,coordinator,therapist,part_lead,staff}` = **coordinator + 잔여 4역할 전부** 포함 → "잔여 개별 ADD" 불요.
- **(ii) 통합신설 = 반려** (admin_write 는 director medical 때문에 DROP 불가 → 통합해도 정책 수 동일, 승인SQL 재사용이 리스크 최소, 정책 증식 억제).
- **★coordinator 이중정책 방지**: sibling `20260701030000`(coordinator 단일) = **SUPERSEDED · apply 금지**. coordinator 는 5역할 정책에 흡수. sibling 미apply 상태라 DROP 불요 → ADDITIVE 무결.

## AC-3 — 확정 shape 마이그 + 롤백 (deploy 아티팩트)

- **apply 대상(변경 0, DA 검토필)**: `supabase/migrations/20260620120000_phrase_templates_staff_write_staffarea.sql`
- **apply 스크립트(신규, 드리프트 복구 경로)**: `scripts/T-20260701-foot-PHRASETMPL-RLS-DRIFT-4ROLE_apply.mjs`
  - pre-snap(DDL-diff BEFORE) → 마이그 파일 그대로 실행 → post-snap(AFTER) → 구조검증. 멱등(DROP IF EXISTS + CREATE).
- **롤백**: `supabase/migrations/20260620120000_phrase_templates_staff_write_staffarea.rollback.sql`
  (`DROP POLICY staff_write_staffarea_phrases` → effective write = {admin,manager,director} 원복, 데이터 영향 0).
- **sibling supersede**: `20260701030000_phrase_templates_coordinator_write_staffarea.sql` / `.rollback.sql`
  → `.SUPERSEDED` 로 중립화(마이그 glob `*.sql` 에서 제외 = 이중정책 원천 차단).
- **FE 변경 0**: `PHRASE_STAFFAREA_EDIT_ROLES = ALL_STAFF_ROLES − director` = 7역할, 旣 열림. RLS union 과 정확 일치.

### apply 후 FE↔서버 정합
| 정책 | role | phrase_type |
|------|------|-------------|
| admin_write_phrase_templates | admin, manager, director | 全 (medical 포함) |
| staff_write_staffarea_phrases | consultant, coordinator, therapist, part_lead, staff | pen/customer 한정 |
| **pen/customer write union** | **admin,manager,consultant,coordinator,therapist,part_lead,staff (7역할)** | = FE canEditStaffAreaPhrase 정확 일치 (over-grant 0, gap 0) |

director medical_chart write = admin_write 로 보존(OPINIONPHRASE director-only 무회귀).

## AC-4 — 침투테스트 (supervisor DDL-diff 게이트, apply 후)

apply.mjs 가 수행하는 **구조 검증(자동)**:
- staff 정책 존재 + cmd=ALL + role set 정합
- USING/WITH CHECK 양쪽 phrase_type 가드(pen/customer, no medical) — 변조 hole 차단
- admin_write 무변경 {admin,manager,director}
- ★coordinator_write_staffarea_phrases 미존재(이중정책 부재)

**토큰 기반 침투테스트 3종 (supervisor, 5역할 = consultant/coordinator/therapist/part_lead/staff 토큰 각):**
1. medical_chart INSERT → **deny** (WITH CHECK phrase_type 가드 fail)
2. pen_chart UPDATE 로 phrase_type→medical_chart 변조 → **deny** (신규 row WITH CHECK fail)
3. medical_chart UPDATE/DELETE → **deny** (기존 row USING fail)
+ pen/customer INSERT/UPDATE/DELETE → **성공** (5역할)
+ admin/manager/director/원장 무회귀 + coordinator 정합(이중정책 부재)

---

## 게이트 / 배포 상태
- **DA GO ✅** (ADDITIVE + DA GO → autonomy §3.1 대표 게이트 면제).
- **supervisor DDL-diff GO 대기** → GO 후 apply.mjs forward apply(파일 그대로) → 토큰 침투테스트.
- 타임스탬프 out-of-order(20260620 < 이미 apply된 20260624/20260701) → supabase 툴 skip 가능 → **명시적 forward apply** 로 해결(apply.mjs 가 관리 API 로 직접 실행).
- DB apply 경로는 Vercel FE 배포 동결(VERCEL-DEPLOY-THROTTLE)과 무관(관리 API 독립).
- field_confirm = 전 역할(coordinator + 잔여4) 정합 완료 후 통합 1회(코디 계정 기준). HOLD_UNTIL_ALL_AC_DONE.
