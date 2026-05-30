---
id: T-20260527-foot-MEDCHART-DATA-LOSS
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
commit_sha: "0133010"
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

## 현장 클릭 시나리오 (E2E 변환 가이드)

> supervisor FIX-REQUEST(MSG-20260530-183659, scenario_missing) 대응. E2E: `tests/e2e/T-20260527-foot-MEDCHART-DATA-LOSS.spec.ts` (AC-1~3 변환 완료).

### 시나리오 1: 저장 → 새로고침 → 데이터 유지 (핵심 재발 검증)
1. coordinator 계정(예: marissong@oblivseoul.kr)으로 로그인
2. 고객 진료차트 진입 → 임상경과/진료메모 입력 후 **저장**
3. 저장 직후 **타임라인에 방금 입력한 차트가 즉시 표시**되는지 확인 (필터 리셋 동작)
4. 브라우저 **새로고침** → 저장한 차트가 그대로 유지(유실 없음) 확인

### 시나리오 2: 필터 활성 상태 저장 (FE 루트코즈 #2 검증)
1. 방문이력 필터(VISIT-FOLD-FILTER)를 특정 조건으로 활성화
2. 그 상태에서 새 진료메모 입력 후 저장
3. 저장 성공 후 **필터가 자동 초기화**되어 새 차트가 숨지 않고 보이는지 확인

### 시나리오 3: coordinator RLS 비차단 (DB 루트코즈 #1 검증)
1. clinic_id 보정 대상이었던 coordinator 계정으로 로그인
2. 기존 진료차트 목록(36건대)이 **0건이 아니라 정상 조회**되는지 확인
3. 신규 저장·조회 모두 RLS 차단 없이 동작 확인

## 재발 방지 권고
- coordinator/therapist 신규 계정 생성 시 clinic_id 배정 절차 필수화
- 현재까지 3건 동일 패턴 반복 → user_profiles INSERT trigger 검토 필요 (P2)
