---
id: T-20260610-foot-DOCPATIENTLIST-SIGNDOCTOR-FILTER
title: "[진료환자목록] '서명한 의사별' 필터 드롭다운 추가 (medical_charts.signing_doctor read 필터)"
domain: foot
priority: P2
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
spec-added: true
spec-exempt: false
rollback-sql: null
commit_sha: null
created: 2026-06-10
assignee: dev-foot
source_msg: MSG-20260610-115849-vv2l
gate: GO_WARN
related_tickets:
  - T-20260608-foot-MEDCHART-SIGN-AUDIT
  - T-20260609-foot-DOCPATIENTLIST-SORT-LAYOUT
  - T-20260609-foot-DOCPATIENTLIST-DATEMODE-HISTORY
  - T-20260610-foot-DOCPATIENTLIST-QUICKRX-CHARTBTN
  - T-20260610-foot-DOCDASH-DIAGMGMT-6FIX
---

# T-20260610-foot-DOCPATIENTLIST-SIGNDOCTOR-FILTER

## 요청
진료환자목록(DoctorPatientList)에 "서명한 의사별" 필터 드롭다운 추가. 정렬 컨트롤 옆 자연 배치, 기본값 "전체"(현 동작 유지).

## STEP1 그라운딩 — 연결경로 확정
- `signing_doctor_{id,name}` 은 **medical_charts 기존 컬럼**(MEDCHART-SIGN-AUDIT, deployed b65357e) → 신규 스키마 불요, read-only.
- **medical_charts 엔 check_in_id 컬럼 없음**(20260515 원본 + 20260608 sign-audit 확인). check_ins 에도 doctor 귀속 컬럼 없음(DATENAV 주석 근거).
  → check_ins(목록 행) ↔ signing_doctor 의 **유일 연결키 = customer_id + visit_date**(= 선택 날짜).
  DoctorPatientList 는 이미 selectedDate(=visit_date)로 check_ins 를 조회 → 같은 날짜·클리닉 medical_charts 를 customer_id 로 매핑.
- **1환자 N차트**: 그 날짜 진료의 id 들의 합집합(Set). 매칭 = 환자의 차트 집합에 선택 진료의 포함.
- **미서명(NULL)/레거시/차트없음**: 'unsigned' 그룹 → '미서명' 드롭다운 옵션(미서명 행 있을 때만 노출).
- 동일 환자·동일 날짜 복수 check_in = 모두 같은 차트 집합에 매핑(차트의 visit 단위 분해 불가, 허용 근사). 연결키 모호성 없음 → FOLLOWUP 불요.

## 구현
- `useSigningDoctorsByDate(clinicId, selectedDate)` hook — medical_charts(customer_id, signing_doctor_id, signing_doctor_name) read.
  → `{ byCustomer: Map<cid, Set<doctorId>>, signedCustomers: Set<cid>, doctors: [{id,name}] }`.
- 드롭다운: 정렬 셀렉터 좌측, '진료의' 라벨 + native select. 옵션 = [전체] + 진료의(가나다) + [미서명](조건부).
- 필터 술어: 기존 처방상태 필터와 **AND 누적**. 'all'=전체(현 동작), doctor_id=서명환자, '__unsigned__'=서명없음.
- `effectiveDoctorFilter` 폴백: 날짜 이동/stale 선택 시 옵션에 없는 값 → 'all'(전 행 누락 방지). + selectedDate 변경 시 useEffect 로 'all' 초기화.

## AC-0 시퀀싱 가드 (동시편집 zone)
- origin/main 최신 기반(behind 0 확인). 기존 산출 위에 누적:
  - 정렬·원내우선(SORT-LAYOUT) 보존 — sorted comparator 무변경.
  - 처방배지(DIAGMGMT-6FIX) 보존 — PrescriptionStatusBadge 무변경.
  - 치료실명(ROOM-LABEL/6FIX AC-3) 보존 — grid 열 무변경.
  - 이름클릭 drawer / onOpenChart(QUICKRX-CHARTBTN) 보존 — PatientRow 무변경.
- 변경 범위: import(useEffect) + hook 1개 신설 + main 컴포넌트 필터 상태/술어 + 드롭다운 UI. PatientRow·정렬·grid 미접촉.

## 검증
- E2E spec: `tests/e2e/T-20260610-foot-DOCPATIENTLIST-SIGNDOCTOR-FILTER.spec.ts` — 14/14 pass.
- 회귀: `T-20260609-foot-DOCPATIENTLIST-SORT-LAYOUT.spec.ts` — 17/17 pass.
- `npm run build` OK. DB 변경 없음(read-only).
