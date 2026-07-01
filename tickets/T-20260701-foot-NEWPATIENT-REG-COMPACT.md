---
id: T-20260701-foot-NEWPATIENT-REG-COMPACT
domain: foot
priority: P1
status: deploy-ready
qa_result: pass
deploy_commit: fe65f720
deployed_at: n/a (NOT yet deployed — supervisor E2E GO 대기, 대표 게이트 면제)
bundle_hash: n/a (NOT yet deployed)
db_change: false
summary: "신규 환자 등록 폼(CreateCustomerDialog, Customers.tsx) 컴팩트화 — 상위 NEWFORM-COMPACT-DEFAULT(deployed) 1순위 대상 ①신규 환자 등록의 현장 confirm(김주연 총괄 '진행ㄱ', ts 1782898969.563039) 실행분(=변경2). AC1: 접속 시 필수(이름·전화번호)만 노출, 부가 필드(생년월일·외국인정보·메모·추천인)는 [선택 정보] 토글(custform-optional-toggle) 뒤로 접기 기본값(showOptional=false, open마다 리셋). AC2: 부가 안내/설명 문구(생년월일 YYYY.MM.DD 미리보기·(선택) 등)를 접힘 뒤로 숨겨 첫 화면 노이즈 제거. AC3(게이트): 접힘=표시만 숨김 — birthDate/foreignInfo/memo/referrer state는 다이얼로그 최상위 useState에 상시 보존되어 접힌 상태로 저장해도 customers.insert payload·is_foreign 파생·필수값(name/phone) 검증 완전 무변경(save 함수 무수정). AC4: 필수 2필드+토글만 첫 화면 → 세로 스크롤 최소화, 태블릿 큰 터치타깃(py-2.5). 공유 컴포넌트 ForeignInfoSection·수정폼(CustomerEditDialog) 미변경(신규 다이얼로그만 래핑, 영역격리). FE-only·DDL 0·DB 무변경. build OK(5.18s). spec 3시나리오 PASS(setup 포함 4 passed 12.1s). 회귀: BIRTHDATE-RRN-GLOBAL.spec 생년월일 필드 접힘 이동 대응 openCreateForm 토글 펼침 forward-update + DATEFMT-YMD-PURGE(deployed) 점표기 정렬, 4 passed/1 skip."
created: 2026-07-01
assignee: dev-foot
owner: agent-fdd-dev-foot
e2e_spec: tests/e2e/T-20260701-foot-NEWPATIENT-REG-COMPACT.spec.ts
medical_confirm_gate: n/a (신규 환자 등록=접수/비의료 화면 — 진료대시보드/진료관리 비대상)
---

## 요청 (현장 — 김주연 총괄)
신규 환자 등록 폼 컴팩트화 — "진행ㄱ" 승인(ts 1782898969.563039). 상위 정책 NEWFORM-COMPACT-DEFAULT(deployed) 1순위 대상 ①신규 환자 등록에 대한 현장 confirm 실행분. 체크인 창은 이미 완료, 등록 화면도 동일 방향.

## AC
- AC1: 신규 환자 등록 폼 접속 시 필수 항목(이름·전화번호)만 표시, 선택/부가 필드(생년월일·외국인정보·메모·추천인)는 접기.
- AC2: 기능 설명 문구·기본 안내 문구를 접힘 뒤로 숨겨 첫 화면 노이즈 제거.
- AC3(게이트): 필드 접힘이 저장 payload 필수값·저장 로직 회귀 없음(표시만 숨기고 값 유지).
- AC4: 컴팩트 레이아웃으로 스크롤 최소화.

## 구현
- `src/pages/Customers.tsx` `CreateCustomerDialog`: `showOptional` state + `[선택 정보]` 토글 버튼. 생년월일 그리드·`ForeignInfoSection`·메모·추천인을 `showOptional` 조건부 블록으로 래핑. open effect에서 `setShowOptional(false)` 리셋. 필수 2필드(이름·전화)와 [등록] 검증(`!name.trim() || !phone.trim()`)·`save()` insert payload 무변경.
- `ChevronDown`(lucide) import 추가.
- 공유 `ForeignInfoSection` 및 수정폼 미변경.

## 검증
- build OK (5.18s), tsc clean.
- E2E `T-20260701-foot-NEWPATIENT-REG-COMPACT.spec.ts` 3시나리오 PASS (setup 포함 4 passed 12.1s).
- 회귀 `T-20260630-foot-CRM-BIRTHDATE-RRN-GLOBAL.spec.ts` forward-update 후 4 passed / 1 skip.

## 배포
- commit fe65f720 (main). Vercel 자동. supervisor E2E GO 후 확정(대표 게이트 면제).
