---
ticket_id: T-20260608-foot-MEDCHART-SIGN-AUDIT
phase: 1 (audit-only, no code change)
author: dev-foot
date: 2026-06-08
status: audit-complete → awaiting-design-decision
---

# Phase 1 Audit — 진료기록 진료의 서명 누락 (의료법 P1)

## 결론 요약
- `medical_charts` 스키마에 **의사 서명 컬럼이 단 하나도 없음**. 저장도 출력도 전무.
- 따라서 **현존 모든 진료기록 레코드(100%)가 서명 누락** 상태. (정확한 N = prod row count, 아래 §3)
- 인터랙티브 저장 경로는 **단 1곳**(`MedicalChartPanel.handleSave`) → 공격면 좁음, Phase 2 강제 적용 용이.
- 풋에는 이미 **의사 직인(`clinic_doctors.seal_image_url`) + Canvas `SignaturePad.tsx` + `{{doctor_seal_html}}` 출력 바인딩** 인프라가 있음 → derm 테이블 복사보다 **자체 인프라 재사용이 정답**(§4).
- **핵심 설계 결정 필요**(Phase 2 착수 전): `created_by`(로그인 이메일)는 진료의가 아닐 수 있음(접수직원 대리입력 가능). "진료의 서명"은 진료의를 명시 확정 + 그 의사 서명을 차트에 귀속해야 함. 등록 직인 자동삽입으로 충분한지 현장(문지은 대표원장) 재확인 필요(§5).

---

## 1. medical_charts 생성·수정 경로 전수 + 서명 필드 포함 여부

| # | 경로 | 종류 | 위치 | 서명 필드 | 비고 |
|---|------|------|------|-----------|------|
| 1 | `MedicalChartPanel.handleSave` insert | FE | `src/components/MedicalChartPanel.tsx:751` | ❌ 없음 | **유일한 신규 작성 경로** |
| 2 | `MedicalChartPanel.handleSave` update | FE | `src/components/MedicalChartPanel.tsx:744` | ❌ 없음 | **유일한 수정 경로** |
| — | Edge Function | — | `supabase/functions/` | N/A | medical_charts 쓰는 EF **없음** |
| — | RPC | — | migrations | N/A | medical_charts insert/update RPC **없음** |
| 3 | 마이그레이션 apply 스크립트 | 운영 | `scripts/apply_*medchart*.mjs` | N/A | 스키마 변경/RLS fix 전용, 임상내용 미작성 |
| 4 | testdata cleanup/profile | 운영 | `scripts/cleanup_*`, `profile_*` | N/A | 테스트 데이터 정리, 정상 저장 경로 아님 |

**payload 실측**(`MedicalChartPanel.tsx:723-738`): customer_id, clinic_id, visit_date, chief_complaint(legacy null), diagnosis, treatment_record, materials_used(legacy null), treatment_result(legacy null), clinical_progress, prescription_items, created_by(이메일), created_by_name(표시명), updated_at. **→ 서명 관련 필드 0개.**

**취약 경로 식별**: 서명 컬럼 자체가 스키마에 없으므로 경로 #1·#2 둘 다 "서명 없이 저장"이 **구조적으로 100% 발생**. 별도 우회 경로 없음(공격면 = FE 1파일 1함수).

## 2. 스키마 현황 (medical_charts 컬럼)
`id, customer_id, clinic_id(TEXT), visit_date, chief_complaint, diagnosis, treatment_record, materials_used, treatment_result, clinical_progress, prescription_items(JSONB), created_by(이메일), created_by_name(표시명 스냅샷), created_at, updated_at`
- 서명 관련 컬럼: **전무**.
- `created_by_name`(T-20260606-RECORDER-NAME): **작성자 표시명**일 뿐 — planner 지적대로 작성자명 ≠ 진료의 전자서명. 또한 로그인 계정 기준이라 대리입력 시 진료의와 불일치 가능.

## 3. 서명 누락 레코드 카운트
- 서명 컬럼이 부재하므로 **정의상 전체 레코드 = 누락**.
- 정확한 N(행 수)은 prod DB `SELECT count(*) FROM medical_charts;` 1회 read 필요(쓰기 아님). prod read는 supervisor 게이트 대상 → 카운트 SELECT 승인 요청 예정.
- **backfill 금지(법적)** 준수: 기존 레코드에 사후 서명 주입 절대 불가. 처리 방침은 audit 후 현장 재확인(티켓 명시).

## 4. 출력/표시 화면 서명 표기 누락 목록

| 화면 | 위치 | 현재 상태 | 진료의 서명 |
|------|------|-----------|-------------|
| 차트 상세/타임라인 | `MedicalChartPanel.tsx:2290` | "작성 {이름}" 텍스트(점선) | ❌ (작성자명 텍스트뿐, 서명 이미지 없음) |
| 고객 차트 페이지 | `CustomerChartPage.tsx` | 타임라인 렌더 | ❌ |
| 진료기록부 인쇄/PDF | — | **진료기록부 전용 출력 자체가 없음** | ❌ (출력물 미존재) |
| 진단서/소견서/처방전/진료의뢰서 | `htmlFormTemplates.ts` + `autoBindContext.ts` | `{{doctor_seal_html}}` 직인 삽입됨 | △ (출력 시 **선택된** 의사 직인 — 차트 귀속 진료의 아님) |

→ medical_charts(진료기록부)의 출력/표시 어디에도 **차트 작성 진료의의 서명**이 표기되지 않음.

## 5. derm 재사용 평가 (T-20260515-derm-KOS-DOCTOR-SIGNATURE)

| 항목 | derm | foot | 재사용 |
|------|------|------|--------|
| 테이블 | `doctor_signatures(clinic_id uuid FK clinics, doctor_user_id uuid FK auth.users)` UNIQUE(clinic,doctor) | clinic_id **TEXT**(clinics FK 없음), 직원=`user_profiles`(staff 아님) | ❌ 마이그레이션 직접 재사용 불가 (스키마 불일치) |
| 모델 | 의사당 1개 **등록 서명** 재사용 | — | △ 개념 차용 |
| Canvas 패드 | react 훅 | **이미 `src/components/forms/SignaturePad.tsx` 존재**(Canvas, toDataURL PNG, npm 무추가) | ✅ 자체 컴포넌트 재사용 |
| 직인 출력 | base64 자동삽입 | **이미 `clinic_doctors.seal_image_url` + `{{doctor_seal_html}}` 바인딩**(autoBindContext) | ✅ 자체 인프라 재사용 |

**판정**: derm `doctor_signatures` 테이블은 **직접 재사용 불가**(clinic_id TEXT vs uuid, user_profiles vs auth.users/staff). 대신 **풋 자체 인프라**(`SignaturePad.tsx` + `clinic_doctors.seal_image_url` + `doctor_seal_html` Storage signed-url 패턴)를 재사용하는 것이 정합적. 개념(등록 서명 → 출력 자동삽입)만 derm에서 차용.

## 6. Phase 2 착수 전 필요한 설계 결정 (현장/planner 확인 요청)

1. **진료의 귀속 모델**: 차트 저장 시 "진료의"를 `created_by`(로그인)와 분리해 명시 선택/확정해야 함. 접수직원 대리입력 케이스 때문에 로그인=진료의 가정 불가. → 차트에 `doctor_id`(진료의) + 서명 귀속 컬럼 추가 필요.
2. **서명 방식 택1**:
   - (A) 등록 직인 자동삽입(derm식·현 직인 모델 확장): 진료의 선택 시 그 의사의 등록 직인을 차트에 스냅샷. 운영 부담 낮음.
   - (B) 저장 시점 Canvas 실시간 서명: 진료의가 매 차트 직접 서명. 의료법 부합도 높으나 운영 마찰 큼.
   - → 문지은 대표원장 선호 확인 필요.
3. **강제 지점**: DB NOT NULL/CHECK constraint(권장) vs 서버/FE validation. constraint 채택 시 기존 NULL 행과 충돌 → 신규행만 강제하는 partial 적용 설계 필요(backfill 금지 준수).
4. **기존 누락 레코드 처리**: backfill 금지 → 표시상 "서명 미보유(레거시)" 라벨링만 가능. 현장 재확인.

## 7. Phase 2 예상 작업(설계 확정 후, supervisor 이관 대상)
- DB: `medical_charts`에 진료의/서명 컬럼 추가 + 신규행 강제 constraint + 롤백 SQL (마이그레이션 동반 → supervisor 이관 필수).
- FE: handleSave에 진료의 선택 + 서명 입력 + 미입력 저장 차단; 타임라인/상세 서명 표기; (진료기록부 출력 신설 시) 서명 자동삽입.
- E2E: 정상 저장 / 서명 미입력 차단 엣지 / 레거시행 표시.
