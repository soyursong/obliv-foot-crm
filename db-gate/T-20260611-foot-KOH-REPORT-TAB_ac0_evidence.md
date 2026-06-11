# T-20260611-foot-KOH-REPORT-TAB — AC-0 착수 전 DB 조사 (READ-ONLY)

- 작성: dev-foot · 2026-06-12
- 방식: prod DB(rxlomoozakkjesdqjtvd) SELECT-only probe (영속 변경 없음)
- 재현 스크립트: `scripts/T-20260611-foot-KOH-REPORT-TAB_ac0_probe.mjs`, `..._ac0_probe2.mjs`
- 결론: **🔴 BLOCK** — Phase 1 명단 컬럼 6개 중 2개(발톱부위·당일의사명)가 DB 미저장/귀속불가. AC-0 step 3 트리거 발동 → planner 재판정 요청.

---

## AC-0.1 — KOH 균검사 코드 매칭 방식 ✅ 확정

`check_in_services.service_id → services.id` 조인. `check_in_services.service_name`이 denormalized 저장됨.

services 테이블 KOH 관련 행:

| name | service_code | hira_code | active | 비고 |
|------|------|------|------|------|
| 일반진균검사-KOH도말-조갑조직 | **D620300HZ** | null | **true** | ★ 실운영 사용 중 (check_in_services에 등장) |
| KOH 균검사 | null | **D6591** | false | 구 데이터(비활성) |
| KOH도말검사 | D2502001 | null | false | 구 데이터(비활성) |

- 실제 check_in_services에 적재되는 값 = `service_name = '일반진균검사-KOH도말-조갑조직'`.
- 권장 매칭식(denormalized, 안전): `service_name ILIKE '%KOH%' OR service_name ILIKE '%진균검사%'`.
  - 엄밀식: `service_id IN (D620300HZ·D6591·D2502001 서비스 id)` — 단 비활성 2건 포함 시 과매칭 주의.
- 티켓의 3코드(DX-KOH-01 / D6591 / D620300HZ) 중 **DX-KOH-01 은 DB에 존재하지 않음**. D6591=hira_code(비활성), D620300HZ=service_code(활성)만 매칭됨.

## AC-0.2 — 당일 진료 의사 조회 경로 🔴 귀속 불가

- `staff.role` 분포: consultant 7 / coordinator 12 / **director 2** / technician 8 / therapist 19.
  - **`doctor` role 자체가 없음.** 의사 = `director`(문지은, 홍길동) 추정.
- `check_ins` 56컬럼에 **의사(doctor) FK 컬럼 없음.** 존재하는 staff FK: consultant_id, therapist_id, technician_id, assigned_counselor_id.
- director 2명은 check_ins의 위 4개 staff 컬럼 어디에도 **0건** 등장 → 당일 시술/검사한 의사를 check_in에서 역추적할 경로가 구조적으로 없음.
- doctor_note / doctor_confirmed_at / doctor_call_memo 등은 존재하나 KOH 샘플 15건 전부 null(미사용) + staff_id가 아닌 텍스트/타임스탬프.

→ **'당일 의사명' 컬럼 산출 불가.** 의사 귀속 설계(예: check_ins.doctor_id 신규 + 진료 차팅 시점 입력동선)가 선행되어야 함.

## AC-0.3 — '발톱 부위' 저장 위치 🔴 미저장 (BLOCK 트리거)

전 후보 테이블 탐색 결과 **0건**:

| 테이블/컬럼 | nail_locations 키 보유 |
|------|------|
| checklists.checklist_data (jsonb) | 0 |
| check_ins.notes (jsonb) | 0 |
| check_ins.treatment_memo (jsonb) | 0 |
| check_in_services | 발톱부위 컬럼/jsonb 전혀 없음 |

- 코드상 `nail_locations`는 TabletChecklistPage(F10 통증부위)·HealthQ 입력 UI에 존재하나, **DB 실적재 0건** (입력 동선 미사용 또는 미저장).
- 설령 적재되더라도 의미가 다름: checklist의 nail_locations = **환자 자기보고 통증부위** ≠ KOH 검사를 시행한 **검사 대상 발톱부위**(임상 소견).
- KOH 검사 부위를 담는 구조화 컬럼 부재 → **신규 컬럼 + 검사 시점 입력 동선** 필요.

## AC-0 부수 확인 (산출 가능 컬럼) ✅

- 환자이름 = `customers.name` (check_ins.customer_id 조인) ✅
- 생년월일 = `customers.birth_date` ✅
- 차트번호 = `customers.chart_number` ✅
- 검사일 = `check_in_services.created_at` (또는 check_ins.created_date) ✅

→ 6컬럼 중 **4개 산출 가능 / 2개(발톱부위·당일의사명) BLOCK.**

## 탭 컨테이너(dedup) 정보

- '균검사지' 탭 추가 위치 = `src/pages/DoctorTools.tsx` (진료대시보드, 현재 탭 2개: 진료 알림판/진료 환자 목록).
- in-flight `DoctorCallDashboard.tsx`(DOCDASH-TABLEVIEW 663줄 미커밋)는 **탭 콘텐츠**라 컨테이너(DoctorTools.tsx)와 파일 분리 → 신규 탭 추가 시 충돌 낮음.

---

## planner 회신 요지

1. 발톱부위·당일의사명 모두 DB 미저장/귀속불가 → **db_change=true 재판정** 필요.
2. 현장 재확인 필요: (a) KOH 검사 부위를 어디서·언제 입력할지(신규 컬럼+동선), (b) 당일 의사 귀속을 어떻게 잡을지(check_ins.doctor_id 신규? 차팅 시점?).
3. supervisor DB 게이트 + data-architect CONSULT 대상(신규 컬럼·입력동선).
4. 대안 제시: Phase 1을 **산출 가능 4컬럼(이름·생년월일·차트번호·검사일)만 우선 출시** + 발톱부위·의사명은 Phase 1.5(DB설계 후)로 분리하면 즉시 가치 제공 가능. planner 판단 요청.
