---
id: T-20260728-foot-RECEIVER-COORD-DROPDOWN-EMPTY-FIX
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-passed: true
db-change: false
e2e-spec: tests/e2e/T-20260728-foot-RECEIVER-COORD-DROPDOWN-EMPTY-FIX.spec.ts
summary: "치료테이블 피검사 탭(BloodDailyListSection) 접수자명 드롭다운 코디네이터 0명(빈목록) 버그 수정. prior RECEIVER-COORD-ACCT-DROPDOWN-WIDTH(7c38d4ad) field-soak WARN 확증. RC=코드(데이터 정상): useCoordinators 훅 select 에 derm 하드포크 잔재 `display_name` 포함 → foot staff 엔 컬럼 부재 → PostgREST 42703 → 훅 과대 폴백(/42703|column/)이 삼켜 [] 반환=빈드롭다운. FIX: ①select 에서 display_name 제거(name 단일 소스) ②폴백 42P01(undefined_table)로 축소(컬럼오류 throw=silent-empty 재발·field-soak 은닉 방지). no-DDL, staff read-only, 저장경로(field_data.receiver_name) 무변경."
created: 2026-07-28
reporter: planner
risk_verdict: GO
risk_reason: "진단 확정(추정·강제처치 금지 준수): foot Supabase(rxlomoozakkjesdqjtvd) staff 실측(service_role, RLS 우회) — 종로풋센터(clinic 74967aea) 소속 77행, role 원시값 분포 = coordinator 12(active=true 5명: 김민경·데스크·장예지·김지혜·박민석 / active=false 7명), canonical 영문 'coordinator' 정확 저장(cross_crm_data_contract §441/§487 정합). ∴ 필드소크 WARN 가설(영문 enum vs 저장값 불일치)은 데이터로 반증 — DB 오염/코디부재 아님(분기 B·C 불성립). staff 실컬럼=id,clinic_id,name,role,active,user_id,updated_at,assign_sort_order,auto_assign_enabled,slack_user_id — display_name 없음. 훅과 동일 쿼리 재현 시 HTTP 400 42703 column staff.display_name does not exist 확증. 분기 A(코드 필터/select 값 오류) 확정 → 단일 레이어 최소 blast: BloodDailyListSection.tsx 1파일(select 1줄+map 1줄+폴백 조건 1줄) + 신규 spec 1 + prior WIDTH spec 폴백 단언 1건 갱신. DML 0(db_change=false, rows-affected 검증 불요 — 데이터 미변경). 저장·재조회(receiver_name 문자열) 경로·목록밖 값 보존 옵션·완료시 잠금 등 방어폴백 전부 온존. 신규 spec 8 + WIDTH 회귀 10 + BLOODLIST-4FIX 회귀 = 28/28 PASS + npm run build PASS. 의료게이트 §11.1: 치료테이블=치료사 surface(비의료직군) → gate-exempt. da_consult: 불요(신규 컬럼·테이블·enum 0, read-only + 기존 필드 재사용)."
commit: PENDING
bundled_with: T-20260726-foot-RECEIVER-COORD-ACCT-DROPDOWN-WIDTH
---

# T-20260728-foot-RECEIVER-COORD-DROPDOWN-EMPTY-FIX

## 증상 (현장 종로풋센터, 김주연 총괄 blocking)
치료테이블 피검사 탭 접수자명 드롭다운에 코디네이터 0명(빈목록) → 접수자 지정 불가.

## 진단 (강제처치·일괄 UPDATE 금지 준수 — read-only introspection 먼저)
1. **staff 실측(service_role, RLS 우회 — 진단 인증컨텍스트 표준 준수)**: 종로풋센터(clinic `74967aea-a60b-4da3-a0e7-9c997a930bc8`) 77행. role 원시값 분포 = `coordinator` 12, `therapist` 21, `technician` 26, `consultant` 10, `director` 6, `manager` 1, `admin` 1. **모두 canonical 영문**. coordinator active=true **5명**(김민경·데스크·장예지·김지혜·박민석), active=false 7명(전/송/홍코디·중복정리분 등).
2. **cross_crm_data_contract §441/§487**: 코디네이터 정본 문자열 = `coordinator`(영문). 코드 필터값과 일치. → **필드소크 WARN 가설(enum 불일치)은 데이터로 반증.**
3. **RC = 코드(분기 A)**: useCoordinators 훅 select 가 `display_name` 조회 → foot `staff` 에 해당 컬럼 부재(실컬럼: id,clinic_id,name,role,active,user_id,...) → PostgREST **400 42703 `column staff.display_name does not exist`** → 훅 폴백 정규식 `/staff|relation|42P01|42703|column/` 이 이 에러를 삼켜 `[]` 반환 = **빈 드롭다운**. derm ASSIGNEE-DROPDOWN 하드포크 이식 시 derm staff 의 display_name 을 그대로 복사한 fork drift. 과대 폴백이 2일간 field-soak 로부터 은닉.
   - 분기 B(데이터 오염) 불성립 → UPDATE 0. 분기 C(코디 부재) 불성립(active 5명 존재).

## FIX (단일 레이어 A, no-DDL, staff read-only)
`src/components/treatment/BloodDailyListSection.tsx` — useCoordinators 훅:
- ① `.select('id, name, display_name, role, active')` → `.select('id, name, role, active')`. map 도 `r.display_name || r.name` → `r.name` 단일 소스.
- ② 폴백 `if (/staff|relation|42P01|42703|column/...)` → `if (error.code === '42P01' || /relation .* does not exist/i...)`. 테이블 미적용(undefined_table)만 빈목록 폴백, 컬럼/스키마 오류는 throw(silent-empty 재발 방지·field-soak 가시화).
- 저장·재조회(field_data.receiver_name 문자열), 목록밖 값 보존 옵션, 완료시 잠금 등 방어폴백 전부 온존.

## AC
- [x] 드롭다운에 종로풋센터 코디네이터 ≥1명 표시 (active 5명 조회 — 42703 제거로 정상 반환)
- [x] 선택 → 저장 → 새로고침 유지 (receiver_name 경로 무변경)
- [x] db_change=false (DDL 0, staff DML 0 — 데이터 정상이므로 UPDATE 불요)
- [x] 방어폴백 보존 + 컬럼오류 은닉 제거
- [x] 신규 spec 8 + WIDTH·4FIX 회귀 = 28/28 PASS + build PASS
