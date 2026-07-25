---
id: T-20260725-foot-HOLIDAY-INITFEE-TAXEXEMPT-MISCLASS
domain: foot
priority: P1
status: diagnosed-blocked
qa_result: n/a
deploy_commit: n/a — 1차 판정만, 구현 미착수(방향확인 대기)
db_change: TBD→YES(데이터 정정, 스키마 무변경)
db_migration: none(mutable-field UPDATE services.is_insurance_covered · MIG 스키마변경 없음)
db_gate: not-required-for-schema — 신규 컬럼/테이블/enum 0 → data-architect 스키마 CONSULT 비대상(§S2.4). mutable-field 데이터정정 SOP 적용(대상셋 freeze·판정근거 스냅샷·롤백 동봉).
build: n/a — 코드 변경 없음(READ-ONLY 진단 + 판정문서만)
blocked_on: 이은상 팀장(U09AT9ARHEF) direction_review_gate — Arch A/B 방향확인. planner FOLLOWUP 발행.
judgment: db-gate/T-20260725-foot-HOLIDAY-INITFEE-TAXEXEMPT-MISCLASS_judgment.md
diag_script: scripts/T-20260725-foot-HOLIDAY-INITFEE-TAXEXEMPT-MISCLASS_diag.mjs (prod SELECT-only)
---

# T-20260725-foot-HOLIDAY-INITFEE-TAXEXEMPT-MISCLASS

## 문제
수납창에서 '공휴일 초진진찰료-의원' 항목이 비급여(면세)로 처리됨 → 급여여야 함.
채널 C0ATE5P6JTH · thread 1784968975.397929 · reporter 코디님(U0B6VLNBR2B).

## 1차 판정 (READ-ONLY 진단 완료)
**원인 = (a) services 마스터 급여/면세 플래그 config 오설정.** FE 분기(getTaxClass) 정상.
- 문제 active row(id 3eb86239) `is_insurance_covered=false` + hira_code/hira_score 전무 → getTaxClass 면세.
- 정상 형제 `초진진찰료-의원`(is_insurance_covered=true, hira_score 197.07)은 급여로 정상 분류.
- 상세·스모킹건·시뮬레이션: judgment 문서 참조.

## db_change = YES (데이터 정정, 스키마 무변경)
`UPDATE services SET is_insurance_covered=true` (freeze셋 = active id 3eb86239). mutable-field SOP.

## ⚠ REDEFINITION_RISK 실증 — naive 급여 flip 단독 배포 불가
'공휴일 초진진찰료-의원' price 24,490 은 30% 가산이 **이미 baked-in**. 급여 flip 시 isConsultationFeeItem에
매칭 → 공휴일 수납 auto-surcharge가 **또** 30% 부과 → 본인부담 +2,190원 과다청구(이중계상). judgment §시뮬레이션.

## 권장 방향 (이은상 direction_review_gate 확인 요청)
Arch A: (1) 데이터 정정 is_insurance_covered=true, (2) isConsultationFeeItem에서 baked-in 휴일항목
(service_code='050'/이름 '공휴일') 제외 → auto-surcharge 이중부과 차단. co-change: scalp2 byte-mirror.

## 상태: diagnosed-blocked — 방향확인 후 구현 착수.
