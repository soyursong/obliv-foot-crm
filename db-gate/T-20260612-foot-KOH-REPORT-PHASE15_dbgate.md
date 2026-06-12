# T-20260612-foot-KOH-REPORT-PHASE15 — DB GATE 증거 (supervisor Gate3 이관)

> dev-foot / 2026-06-12 · db_change=true · 3중 게이트 ALL GO (현장동선/data-architect CONSULT/supervisor DB게이트)
> 근거: NEW-TASK MSG-20260612-205939-d47l (planner, P2) + 티켓 §119~137 확정 스키마

## 0. 게이트 순서 (현 위치 = ②)
1. ✅ dev-foot: Phase1 KOH 엔티티 식별 → A-1 마이그 SQL + 롤백 SQL 작성 (본 문서)
2. ⏳ **supervisor DB게이트(Gate3)**: koh_nail_sites jsonb 1컬럼 ADD (+쓰기 RPC) 검수 → 통과 후 적용
3. ⏳ dev-foot: A-2 입력 UI + B 조인 + C 명단 (코드는 본 커밋에 이미 포함, DB 적용 후 활성)

## 1. Phase1 KOH 엔티티 식별 (게이트①)
- **KOH 검사 인스턴스(1검사=1행) = `check_in_services` 의 한 행.**
  - 근거: Phase1 본체(T-20260611-foot-KOH-REPORT-TAB)는 `check_in_services` 를 read-only 집계.
    KOH row 판정 = `service_name ILIKE '%KOH%' OR '%진균검사%'`(denormalized name SSOT).
  - 발톱부위는 그 '검사 행'의 속성 → `check_in_services` 에 컬럼 ADD.
  - ⚠ `customers.nail_locations`(환자 통증 자기보고)와 **별개** — 재사용 금지(planner 명시) 준수.
- `check_in_services` 정의: `id uuid PK, check_in_id, service_id, service_name, price, ..., created_at`
  (supabase/migrations/20260419000000_initial_schema.sql L161).

## 2. 마이그 내용 (forward)
파일: `supabase/migrations/20260612160000_koh_nail_sites.sql`
1. `ALTER TABLE check_in_services ADD COLUMN IF NOT EXISTS koh_nail_sites jsonb NOT NULL DEFAULT '[]'::jsonb`
   - 원소 shape(closed enum 2축): `{"side":"Rt"|"Lt","toe":1-5}`. **구조만 저장**(표시문자열 저장 금지 — FE 파생).
   - status 필드 없음(drop 확정). UI 단일선택 → 길이 0|1 배열. jsonb 배열 유지(forward-compat).
2. `CREATE FUNCTION set_koh_nail_sites(p_service_id uuid, p_sites jsonb)` — **SECURITY DEFINER 쓰기 RPC**.
   - 왜 RPC: `check_in_services` UPDATE 는 현 RLS 상 **admin/manager/consultant 만**(coordinator/therapist/technician = SELECT only, 20260426 role_separation E.11). 요구 = "치료사 접근 우선, 누구나(승인 사용자) 입력". → 가격(price 등) 쓰기 격리를 깨지 않으면서 koh_nail_sites **한 필드만** 승인 사용자에게 개방.
   - 내부 게이트: `is_approved_user()` (미승인 42501). closed-enum shape 검증(Rt/Lt·1-5 외 예외). side/toe만 남겨 정규화 저장(잡필드 제거 = 구조만 저장 강제).
   - `GRANT EXECUTE TO authenticated` (REVOKE FROM PUBLIC).

롤백: `supabase/migrations/20260612160000_koh_nail_sites.rollback.sql` — RPC DROP + `ALTER TABLE ... DROP COLUMN koh_nail_sites`.

## 3. 안전성
- 컬럼 ADD = DEFAULT '[]' NOT NULL → 기존 행 즉시 백필(전부 빈배열). 신규 쓰기 무영향.
- 테이블 RLS/정책 **무변경**(RPC 1개만 신설) → 가격/패키지 등 기존 쓰기 격리 회귀 0.
- 과거 검사분 backfill **불가**(검사시점 입력동선 부재) → 적용시점 이후만 채워짐. 명단 과거분 발톱부위='—', 당일의사는 기존 medical_charts 조인이라 과거도 표시 가능.
- **FE-DB 순서 안전장치(중요)**: main→Vercel 자동배포 + 마이그는 본 게이트 통과 후 적용 → FE 가 컬럼보다 먼저 prod 도달 가능. `useKohReport` 에 column-missing(42703) 감지 시 koh_nail_sites 제외 select 1회 폴백 구현 → **마이그 적용 전에도 기존 Phase1 탭 안 깨짐**. 적용 후 자동 활성.

## 4. B. 당일 진료의사 — 신규 스키마 ZERO (read-only 조인)
- `medical_charts.signing_doctor_name`(deployed b65357e, cross_crm_data_contract §2-5) 기존 스냅샷 조인.
- 연결키 = `customer_id + visit_date(=검사일 KST)`. live 패턴(DoctorPatientList.useSigningDoctorsByDate) 재사용 — 월 범위판(useKohSigningDoctorsByMonth).
- 1환자 N차트 = 그날 진료의 합집합(Set). 미서명/레거시 NULL/차트없음 = '미정'.
- ❌ check_ins.doctor_id 신설 ❌ staff doctor role 신설 ❌ cross_crm_data_contract 접촉 — 전부 미수행(준수).

## 5. data-architect CONSULT
- 티켓 §119~137 확정 스키마(CONSULT-REPLY) 기반. 신규 컬럼 1개(check_in_services.koh_nail_sites) — foot 로컬 운영 컬럼, cross_crm_data_contract 영향 0(도파민 push/타 CRM 무관). 카디널리티 UI 단일선택(jsonb 배열 길이 0|1, forward-compat) → data-architect 재협의 불요(티켓 명시).

## 6. 코드 변경 (배포 동반, DB 적용 후 활성)
- `src/components/doctor/KohReportTab.tsx`: NailSite 타입/render(formatNailSite), parseNailSites, useKohSigningDoctorsByMonth(B 조인), useSaveNailSites(RPC), NailSiteEditor(R/L+발가락+조갑 단일선택 위젯), 명단 2컬럼(발톱부위·당일진료의사) + column-missing 폴백.
- 빌드: `npm run build` ✅ PASS.

## 7. E2E
- 신규: `tests/e2e/T-20260612-foot-KOH-REPORT-PHASE15.spec.ts` — S1 render / S2 parse closed-enum / S3 단일선택 commit / S4 의사조인 합집합·미정 / S4b KST경계 / S5 RPC shape게이트 / S6 재선택 교체. **8/8 PASS**.
- 회귀: `T-20260611-foot-KOH-REPORT-TAB.spec.ts` **22/22 PASS** (Phase1 무회귀).

## 8. 적용 순서 (supervisor)
1. forward migration apply (supervisor GO 후 dev-foot 직접 실행 — dev-foot DB 마이그 직접 실행 정책).
2. apply 후 검증: `\d check_in_services` 에 koh_nail_sites 존재 / `set_koh_nail_sites` RPC 존재 / 기존 행 전부 `[]`.
3. FE 는 이미 main 반영(폴백 포함) → 적용 즉시 발톱부위 입력·표시 활성.
4. E2E 38 spec 회귀 GREEN 확인.
5. 이상 시 rollback SQL 적용 → RPC+컬럼 DROP(입력분 손실, 의도된 복귀).
