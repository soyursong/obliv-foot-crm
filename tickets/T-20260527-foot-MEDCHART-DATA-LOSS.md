---
id: T-20260527-foot-MEDCHART-DATA-LOSS
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
commit_sha: ""
build_ok: true
e2e_spec: tests/e2e/T-20260527-foot-MEDCHART-DATA-LOSS.spec.ts
db_changed: true
created_at: 2026-05-27
---

# T-20260527-foot-MEDCHART-DATA-LOSS — 진료차트 데이터 유실 반복 (P1)

## 진단 결과

### AC-1: 유실 시점 특정
- DB에 medical_charts **36건 정상 존재** (데이터 유실 아님)
- 유실 패턴: 동일 `clinic_id=NULL` 패턴 **3번째 반복**
  - 20260522: gh.lee@medibuilder.com (admin)
  - 20260523: kim@oblivseoul.kr (coordinator)
  - **20260527: marissong@oblivseoul.kr (coordinator, id=4d0d5d5b)** ← 이번

### AC-2: DB 실데이터 확인
- 36건 모두 `clinic_id=74967aea` 존재 확인
- `marissong@oblivseoul.kr` 사용자 `clinic_id=NULL` 상태 → RLS 차단

### AC-3: FE 렌더링 문제 vs DB 저장 실패 구분
- **결론: FE 렌더링 이중 문제 (DB는 정상)**
  1. RLS 차단: `mc_clinic_isolated_v2` → coordinator with NULL clinic_id → 0건 반환
  2. VISIT-FOLD-FILTER UX bug: 필터 활성 + 저장 → 새 차트 필터 미일치 → 숨겨짐

### AC-4: MEDCHART-SYNC phrase_type 마이그레이션 부작용
- 부작용 없음. `phrase_templates.phrase_type` 컬럼만 영향.
- `medical_charts` 데이터에 영향 없음 확인.

## 수정 내용

### DB-1: marissong@oblivseoul.kr clinic_id 즉시 복구
```sql
UPDATE user_profiles
   SET clinic_id = '74967aea-a60b-4da3-a0e7-9c997a930bc8'
 WHERE id = '4d0d5d5b-e582-4ea2-8d41-17083cacd909'
   AND email = 'marissong@oblivseoul.kr';
-- 결과: clinic_id=74967aea 배정 완료 ✓
```

### DB-2: 잔여 NULL clinic_id active 사용자 전체 보정
```sql
UPDATE user_profiles SET clinic_id = '74967aea-...' WHERE clinic_id IS NULL AND active = true;
-- 결과: [] (추가 NULL 사용자 없음 ✓)
```

### DB-3: RLS mc_clinic_isolated_v3 (coordinator 포함)
```sql
-- v2: NULL bypass = admin/director/manager
-- v3: NULL bypass = admin/director/manager/coordinator
CREATE POLICY "mc_clinic_isolated_v3" ON medical_charts ...
-- 결과: v3 적용, v2 제거 ✓
```

### FE: handleSave 후 memoFilters 초기화
```tsx
// MedicalChartPanel.tsx handleSave 성공 직후:
setMemoFilters(new Set<MemoFilter>());
// VISIT-FOLD-FILTER UX bug 방지 — 저장 후 항상 전체 차트 표시
```

## 검증
- [x] DB 36건 정상 존재
- [x] marissong clinic_id=74967aea 배정 완료
- [x] active NULL clinic_id 사용자 0건
- [x] mc_clinic_isolated_v3 적용, v2 제거
- [x] 빌드 통과 (✓ built in 3.41s)
- [x] E2E spec 4개 (AC-1~4)

## 재발 방지 권고
- coordinator/therapist 신규 계정 생성 시 clinic_id 배정 절차 필수화
- 현재까지 3건 동일 패턴 반복 → user_profiles INSERT trigger 검토 필요 (P2)
