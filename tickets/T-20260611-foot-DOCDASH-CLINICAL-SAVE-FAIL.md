---
id: T-20260611-foot-DOCDASH-CLINICAL-SAVE-FAIL
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
hotfix: true
created: 2026-06-11 16:25
completed: 2026-06-11
db_changed: false
db_migration: none
db_gate: N/A
scenario_count: 4
commit: PENDING
spec: tests/e2e/T-20260611-foot-DOCDASH-CLINICAL-SAVE-FAIL.spec.ts
build: pass
---

# T-20260611-foot-DOCDASH-CLINICAL-SAVE-FAIL

진료대시보드(DoctorCallDashboard) 임상경과 인라인 패널 "저장해도 저장 안 됨"(데이터 미저장) 핫픽스.

## 신고

문지은 대표원장 (6/11): 임상경과 토글 펼침 → 입력 → 저장해도 저장 안 됨(데이터 미저장).

## 진단 (DB 증거 기반)

planner 의 "★회귀 강의심"(06-10 INLINE-REFINE 7195e5b / UX-REFINE 0701301) 두 커밋을 먼저 역추적함:
**두 커밋은 presentation-only** (textarea rows/min-h, flex-wrap, 라벨 텍스트 제거) — onChange/onSave 바인딩,
formClinical·formSigningDoctorId 상태, handleSave 저장로직 **무변경**. 저장 wiring 자체는 정상.

실DB(rxlomoozakkjesdqjtvd) medical_charts 조회 결과 — **저장은 정상 적재되고 있었음**:
- 동일 환자(`8c0c157c`)에게 today(2026-06-11) 차트가 **16초 간격 2건 '신규 INSERT'**
  (`ca4d1d7f` 07:08:52 "말이너무 많으심", `2b47470d` 07:09:08) — 둘 다 created_at == updated_at = UPDATE 아님.

### 루트코즈 — clinicalInit 레이스 (데이터 무결성 + UX 오인)

`MedicalChartPanel`(variant='clinical') 의 today-차트 자동선택 effect(`clinicalInit`)가,
`loadData`가 charts 를 서버에서 받기 **전(초기 빈 배열)** 에 한 번 돌고 `clinicalInitRef`로 **영구 latch**:
- `loading` 초기값 = `false` → 초기 렌더에서 게이트(`if (loading || ref) return`) 통과
- 그 시점 `charts = []` → today-차트 못 찾음 → `clinicalInitRef.current = true` 로 굳음
- 이후 loadData 완료로 charts 가 채워져도 effect 는 `ref` 가드로 early-return → **today-차트 영영 미선택**

→ 재펼침 시 기존 today-차트 미로드(빈 textarea) → 다음 저장이 `selectedChartId=null` 이라 **신규 INSERT**.
현장 체감: 첫 입력이 "사라짐" = "저장 안 됨" + 같은날 중복차트 누적.

## 수정 (DELTA — 신규 저장로직 0, 자동선택 게이트만 가산)

`src/components/MedicalChartPanel.tsx`:
1. **`chartsLoadedRef`**(신규 ref): loadData 가 charts 서버조회를 최초 성공 반영했는지 신호.
   - loadData 시작 시 `false`(재게이트), 성공 반영 직후 `true`.
2. **`clinicalInit` 게이트**: `if (!chartsLoadedRef.current) return;` 추가 → charts 로드 전엔 latch 금지.
   loadData 완료(charts state 변경) 시 effect 재실행 → 비로소 today-차트 자동선택 → 재펼침 시 기존 기록 표시 +
   다음 저장이 UPDATE 경로.
3. **handleSave 표면화**(planner 가드): `if (!customerId || !clinicId || !formDate) return;` 의 silent return →
   `toast.error('아직 차트 정보를 불러오는 중입니다 — 잠시 후 다시 저장해주세요')` 로 변경.

## 회귀가드

- **진료의 NOT NULL 강제(MEDCHART-SIGN-AUDIT AC-P2-6, 의료법)** 무변경 — FE `if (!formSigningDoctorId)` 가드 +
  DB `enforce_medchart_signing_doctor` BEFORE INSERT/UPDATE 트리거 보존.
- presentation 커밋(INLINE/UX-REFINE) 영향 없음. DoctorCallDashboard 인라인 open/onSaved 동선 불변.
- medical_charts write 경로는 handleSave 단일 SSOT(insert 1 + update 1) — 신규 write 경로 신설 0.

## AC

- **AC-1**: 재펼침 시 기존 today-차트 자동선택(빈 textarea 아님) — charts 로드 완료 후에만 latch.
- **AC-2**: 같은날 중복 INSERT 방지 — today-차트 존재 시 selectedChartId 세팅 → 저장이 UPDATE 경로.
- **AC-3**: 저장 차단을 silent fail 아닌 toast 로 표면화.
- **AC-4**: 진료의 NOT NULL 강제(AC-P2-6) 회귀 금지 — FE 가드 + DB 트리거 보존.

## 현장 클릭 시나리오 (E2E)

- **S1 (AC-1)**: 의사호출 대시보드 행 → '임상경과' 펼침 → 입력 → 저장(접힘) → **다시 펼침 → 방금 저장한
  임상경과가 그대로 보임**(빈칸 아님).
- **S2 (AC-2)**: S1 재펼침 상태에서 추가 입력 → 저장 → DB에 **같은날 새 행 생성 없이 기존 차트 UPDATE**.
- **S3 (AC-3)**: 차트 로드 완료 전 저장 시도 → "불러오는 중" 안내 toast(조용히 무시 X).
- **S4 (AC-4)**: 진료의 미선택 저장 시도 → "진료의가 필요합니다" 차단 유지(의료법).

## 검증

- build: `npm run build` pass
- E2E: 본 spec 14/14 pass
- 회귀: INLINE-REFINE + UX-REFINE + DOCPATIENTLIST-EXPAND-CLINICAL 57/57 pass
- 데이터: 실DB에서 저장 정상 적재 확인(루트코즈 = 자동선택 누락에 의한 중복차트, 저장로직 정상)
