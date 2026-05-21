---
ticket_id: T-20260521-foot-DOC-PRINT-UNIFY
title: 서류 출력 통일 QA — 12종+ × 4경로 전부 검증
status: deploy-ready
priority: P1
domain: foot
deploy_ready: true
db_changed: false
build_status: "✅ 3.18s"
e2e_spec: "tests/e2e/T-20260521-foot-DOC-PRINT-UNIFY.spec.ts (56/56 pass)"
commit: "1e8bd3d feat(doc-print): 서류 출력 경로 통일 + E2E 락"
deployed_at: 2026-05-21
created_at: 2026-05-21
---

## 배경

PUSH P0 MSG-20260521-202955-pkhd (planner):
> AC-2(DOC-PRINT-UNIFY): 통일 QA도 **12종+ × 4개 경로 전부** 검증 필수 (5종 한정 아님)

CLINIC-INFO-SYNC P0 hotfix(commit 825d9be, a34ce38) 이후 현장 재출력 안정화를 위한 QA 검증 티켓.

## 범위

### 검증 대상 12종+

**HTML 양식 (11종):**
1. bill_detail — 진료비내역서
2. diag_opinion — 소견서
3. diagnosis — 진단서
4. treat_confirm — 진료확인서
5. visit_confirm — 통원확인서
6. rx_standard — 처방전(표준처방전)
7. bill_receipt — 진료비 계산서·영수증
8. payment_cert — 진료비 납입증명서(소득공제용)
9. referral_letter — 진료의뢰서
10. medical_record_request — 의무기록사본발급신청서
11. diag_opinion_v2 — 소견서(보험청구용)

**JPG 양식 (5종):**
12. prescription — 처방전
13. med_record_short — 진료기록사본(1-5매)
14. med_record_long — 진료기록사본(6매 이상)
15. treat_confirm_code — 진료확인서(코드포함)
16. treat_confirm_nocode — 진료확인서(코드불포함)

### 4개 경로

1. 단건 발행 다이얼로그 → 미리보기 → 출력
2. 기본 서류 일괄 출력 (bill_detail)
3. 별도 요청 서류 개별 선택 → 체크 → 일괄 출력
4. 배치 출력 (bill_detail 배치 + items_html 동적 주입)

## AC 체크리스트

- [ ] AC-1: HTML 11종 전부 → 단건 다이얼로그에서 병원정보(이름/전화/팩스/사업자) 정상 표시
- [ ] AC-2: HTML 11종 전부 → 고객정보(환자명/주민번호/연락처) 정상 표시
- [ ] AC-3: JPG 5종 전부 → 미리보기 없이 원본 이미지 출력 정상
- [ ] AC-4: bill_detail 배치 출력 → items_html 동적 주입 정상 (PRINT-FORM-BIND 검증)
- [ ] AC-5: rx_standard → clinic_fax 정상 표시 (DB fax값 '02-6956-3439')
- [ ] AC-6: payment_cert → business_reg_no '511-60-00988' 정상 표시

## 선행 조건

- CLINIC-INFO-SYNC (a34ce38): DB fax 컬럼 + 전종 field_map 완료 ✅
- E2E FULLSUITE (140 tests PASS): 함수 레벨 검증 완료 ✅

## 메모

이 티켓은 현장 실물 대조 QA (supervisor 또는 현장 스태프)가 필요할 수 있음.
E2E FULLSUITE로 함수 레벨은 검증 완료 → 렌더링 레벨 현장 확인 포함.
