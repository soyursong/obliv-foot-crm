---
id: T-20260522-foot-MEDCHART-SAVE-ERR
domain: foot
priority: P0
status: deploy-ready
deploy-ready: true
commit_sha: 825e2ca
db_applied: true
db_applied_at: 2026-05-22
build_ok: true
db_changed: true
spec_file: tests/e2e/T-20260522-foot-MEDCHART-SAVE-ERR.spec.ts
risk: low
created_at: 2026-05-22
completed_at: 2026-05-22
---

# T-20260522-foot-MEDCHART-SAVE-ERR — 진료차트 저장 에러 (P0 hotfix)

## 증상
고객차트 → 진료차트 Drawer → 저장 버튼 클릭 시 빨간색 에러 토스트.  
`저장 실패: new row violates row-level security policy for table "medical_charts"`

## 루트 코즈 분석

```
RLS 체인:
  medical_charts.mc_clinic_isolated
    WITH CHECK (clinic_id = current_user_clinic_id())
  ↓
  current_user_clinic_id() = NULL (user_profiles.clinic_id = NULL)
  ↓
  clinic_id = NULL → FALSE (PostgreSQL NULL 비교)
  ↓
  42501: new row violates row-level security policy

영향 대상:
  user_profiles.clinic_id = NULL인 활성+승인 사용자 (1명 확인)
  - 5c031ae1 (gh.lee@medibuilder.com, admin, HQ 계정)

MEDCHART-REVAMP(b8f0090) 관계:
  - V1 코드에 이미 `if (error) throw error` 있었음
  - REVAMP는 이 에러를 새로운 UI에서도 동일하게 노출
  - 근본 원인은 5/17 mc_clinic_isolated 적용 시부터 존재
  - 5/22 최초 사용 시 에러 발견
```

## 수정 내용

### DB 변경 (`migration: 20260522050000_medchart_rls_hq_fix.sql`)

| 항목 | 변경 전 | 변경 후 |
|------|---------|---------|
| `medical_charts` RLS | `mc_clinic_isolated` (NULL 차단) | `mc_clinic_isolated_v2` (admin NULL 허용) |
| `chart_doctor_memos` RLS | `cdm_director_clinic` (NULL 차단) | `cdm_director_clinic_v2` (admin NULL 허용) |
| `gh.lee@medibuilder.com` | clinic_id=NULL | clinic_id=풋센터 UUID |

### RLS 정책 로직

```sql
-- mc_clinic_isolated_v2
USING (
  clinic_id = current_user_clinic_id()::text
  OR (current_user_clinic_id() IS NULL AND current_user_role() IN ('admin','director','manager'))
)
-- 일반 직원: 자기 클리닉만 접근 유지
-- admin/director/manager(HQ): NULL clinic_id면 전체 접근 허용
```

## 검증

- [x] `mc_clinic_isolated_v2` 정책 생성 확인
- [x] `cdm_director_clinic_v2` 정책 생성 확인  
- [x] `gh.lee@medibuilder.com` clinic_id = `74967aea-...` 확인
- [x] 구 정책 `mc_clinic_isolated` 삭제 확인
- [x] 빌드 OK (DB 전용 변경, FE 코드 미변경)
- [x] E2E spec: `tests/e2e/T-20260522-foot-MEDCHART-SAVE-ERR.spec.ts` 3개 시나리오

## 회귀 위험

- `mc_clinic_isolated` 삭제 → SELECT도 v2 정책으로 이관됨
  - 기존 clinic_id 있는 사용자는 동일하게 자기 클리닉만 접근
  - NULL clinic_id admin은 전체 접근 (신규 허용)
- `chart_doctor_memos` 마찬가지로 v2로 이관

## rollback

```bash
# migration rollback
SUPABASE_ACCESS_TOKEN=... node -e "
const sql = \`$(cat supabase/migrations/20260522050000_medchart_rls_hq_fix.rollback.sql)\`;
// (아래 API로 실행)
"
# 또는: supabase/migrations/20260522050000_medchart_rls_hq_fix.rollback.sql 수동 실행
```
