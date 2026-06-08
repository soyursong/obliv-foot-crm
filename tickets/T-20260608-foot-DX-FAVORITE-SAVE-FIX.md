---
id: T-20260608-foot-DX-FAVORITE-SAVE-FIX
domain: foot
status: blocked
priority: P2
deploy-ready: false
build-ok: false
db-change: pending-supervisor
regression-risk: none
e2e-spec: null
e2e_spec_exempt_reason: "분기 A — 코드변경 없음(DB 미배포 흡수건). MGMT AC-4 spec로 커버."
created: 2026-06-08
deadline: 2026-06-10
reporter: 문지은 대표원장 (C0ATE5P6JTH)
resolution: absorbed-into T-20260606-foot-DIAGNOSIS-MASTER-MGMT (AC-4)
blocked-on: supervisor SQL 게이트 — 마이그 20260606160000 [C] 부분 prod 적용
---

# T-20260608-foot-DX-FAVORITE-SAVE-FIX — 진단명 즐겨찾기 저장/조회 안됨

현장(문지은 대표원장, C0ATE5P6JTH): "진단명 즐겨찾기 버튼 클릭 시 저장/조회 안됨. DB 저장 함수 확인."

## AC-0 분기 판정 — **분기 A 확정** (prod DB 실측 2026-06-08, 추정 아님)

진단 스크립트: `scripts/_diag_dx_favorite_20260608.mjs` (READ-ONLY)

| 확인 항목 | 결과 |
|----------|------|
| `doctor_diagnosis_favorites` 테이블 (prod) | ❌ **미배포** — `PGRST205 Could not find the table 'public.doctor_diagnosis_favorites'` |
| `services.diagnosis_folder` 컬럼 (prod) | ✅ 배포됨 |
| 코드 저장경로 (`DiagnosisFolderPicker.tsx` `toggleFav`) | ✅ 정상 — `insert/delete` on `doctor_diagnosis_favorites` (staff_id + service_id) |
| `profile.id == auth.uid()` (RLS 정합) | ✅ 정합 (`auth.tsx` `user_profiles.eq('id', s.user.id)`) → RLS WITH CHECK 통과. RLS는 버그 아님 |

### 근본원인
- 즐겨찾기 저장경로(`toggleFav` insert/delete)와 조회(`useFavorites` select)는 **코드상 완전 정상**.
- 대상 테이블 `doctor_diagnosis_favorites`가 **prod 미배포**.
- 핸들러가 모든 에러를 graceful silent-swallow (`catch {}` / `if (error) return new Set()`) → 테이블 없으니 클릭해도 조용히 실패 = 현장 증상 "안됨" 정확히 일치.
- 해당 테이블 SQL은 이미 마이그 `supabase/migrations/20260606160000_diagnosis_folder_and_favorites.sql` [C]부에 작성됨(미적용). 동일 마이그의 [A](diagnosis_folder)는 prod 적용 완료 — [C]만 누락.

## 처리 — 분기 A: 이 티켓에서 fix 금지, MGMT로 흡수
- 이 결함은 T-20260606-foot-DIAGNOSIS-MASTER-MGMT(in_progress) **AC-4(원장별 즐겨찾기 신규 테이블)** 진행분으로 닫혀야 함.
- 이중구현 금지 — dev-foot 코드 변경 없음.
- 필요 액션: **supervisor SQL 게이트** — 마이그 `20260606160000` [C] 부분(`doctor_diagnosis_favorites` 테이블 + RLS + index)을 prod 적용.
  - 적용 후 즐겨찾기 저장/조회/해제 + 원장별 격리(RLS `staff_id = auth.uid()`)가 코드변경 없이 즉시 동작.
- planner FOLLOWUP 발행 완료.

## 회귀/충돌 주의
- surface: T-20260608-foot-DXMGMT-EDIT-SAVE-BUG(상병명 수정 저장)과 동일 화면 — 저장경로 분리됨(즐겨찾기=`doctor_diagnosis_favorites`, 상병편집=`services`). 충돌 없음.
