# T-20260625-foot-GREEN-HARDCODE-SWEEP-UNIFY — 1단계 green 전수 audit

작성: dev-foot / 2026-06-25 / 검증타입 color_token_only
단일 통일 토큰 소스: `tailwind.config.js` `firstvisit` 램프 (앵커 `firstvisit-100 = #DCE9CC`,
보더 `200 = #C7D8AE`, 텍스트 `700 = #546838`, dot `500 = #819C59`).
= T-20260625-foot-COLOR-WARMPASTEL-DESATURATE 가 settle(deploy-ready, commit 7f45fda2)한 따듯 파스텔 그린.

## 진입점 (명시) — 이미 통일 완료
- `src/pages/CustomerChartPage.tsx:5117-5125` 신분증 확인 **완료** 칩
  → 이미 `#DCE9CC / #546838 / #C7D8AE` + dot `bg-firstvisit-500`. **= 통일 앵커 자체. 변경 없음.**
- `신분증 확인 필요` 칩(5127-5137)은 **빨강**(미확인 경고색) — green 아님, 대상 외.

## 핵심 발견 — green은 단일 의미가 아니라 다중 의미색
foot CRM에서 green/emerald 는 서로 다른 의미를 동시에 진다. status.ts 가 SSOT:
- `VISIT_TYPE_COLOR` (status.ts:84-88): **초진=blue / 재진=emerald / 체험=amber**
- 단, 예약관리(Reservations.tsx)는 **초진=firstvisit-green / 재진=blue** (모듈 간 역할 역전 — 별도 이슈)
→ "green 다 동일 색감으로"를 무차별 적용하면 **재진/초진/laser/성공/매출 의미 구분이 소멸**한다.

전수 grep: `(green|emerald|lime)-NNN` tailwind 클래스 **173건 / 60파일** + 신분증칩 인라인 hex.

## 분류

### (a) 통일 대상 = 장식/비의미 green → firstvisit 토큰으로 교체
**거의 없음.** 순수 장식(상태·유형·성공·금액 의미 없이 단지 green 액센트)으로 분류 가능한 건은
사실상 0건. 유일 경계 후보:
- `Reservations.tsx:2053` `bg-green-50 ring-green-400` — 클립보드 붙여넣기 대상 하이라이트(일시 affordance).
  green=유효대상 의미가 약하게 있어 경계적. **현장 의도 확인 후에만 통일.**

### (b) carve-out = 시스템 의미색 → 무차별 recolor 금지 (보류, 현장 확인 대상)

| 분류 | 의미 | 대표 위치 |
|------|------|-----------|
| B1 방문유형 재진=emerald | 환자 유형 구분색 | status.ts:87, doctor/DoctorPatientList:169, doctor/DoctorCallDashboard:147/1761, admin/TreatmentSetsTab:164, insurance/TreatmentSetLoadButton:88 |
| B2 칸반 status | laser=emerald-500, treatment_waiting/preconditioning=teal(pinned), 진료chip | status.ts:73-77, components/MedicalChartPanel:398/404, StatusContextMenu:304-321 |
| B3 성공/완료/완납/issued/confirm/OCR성공 | 긍정 완료 상태색 | ui/badge.tsx:9(success variant), AdminSettings:462/672, treatment/TreatmentStatusPanel:515/798/801/882, doctor/DoctorTreatmentPanel(컨펌완료 다수), ReceiptUpload:405/427, doctor/DocRequestQueue:140-310, doctor/PastHistoryTab:228, admin/HiraInsuranceSyncPanel:109, ConsentFormDialog:276, forms/ChecklistForm:277, TabletChecklistPage:210, CustomerChartPage(완납/상담함/진행중 6402-6683) |
| B4 매출/금액 positive=emerald-700 | 긍정 금액 의미색 | Closing.tsx(1419-2364 다수), DailyHistory:403-473, stats/RevenueSection:55, stats/TmAggregateSection:282-432, stats/NoshowReturningSection:56, sales/SalesDailyTab:388-494, sales/SalesStaffTab:406/506, insurance/InsuranceCopaymentPanel:368, insurance/Chart2InsuranceCalcPanel:316, CustomerChartPage 결제총액:6167-6192 |
| B5 치료사/직군 색 | 직군 구분(therapist=green vs teal) | lib/handover.ts:71/93, pages/Handover.tsx:608/816, status.ts:166 |
| B6 **사용자 선택 색팔레트 (절대 미접촉 — 데이터 의미)** | 사용자가 고르는 리터럴 색 옵션 | lib/quickRxColors.ts:17(sage), lib/rxTagPalette.ts:21('초록'), status.ts:220/234(green 플래그 = 무지개 플래그 팔레트) |
| B7 기타 의미색 | 마케팅동의/보험covered/지정·담당치료사/카메라 before-after/select-tool active/진행중/문서카테고리 등 | CustomerChartPage:5853, admin/InsuranceStatusPanel:36/43, admin/PhrasesTab:85, insurance/InsuranceGradeSelect:164, Reservations:3403-3455, CustomerChartPage:2175, PenChartTab:2892/2899, Waiting:233-335, forms/DocumentViewer:39, lib/formTemplates:717, ProgressPlansTab:75 등 |

## 결론 / 판정
- 진입점(신분증확인 완료 칩·초진 카드)은 **이미** 통일 파스텔 그린. 추가 작업 없음.
- "등"에 해당하는 나머지 green 173건은 **거의 전부 carve-out 의미색**(재진·칸반·성공·매출·직군·사용자팔레트).
- carve-out 보류 규칙 + REDEFINITION_RISK(오늘 foot green 티켓 4건+, WARMPASTEL이 의도적으로 success·재진 emerald 유지) 에 따라 **2단계 무차별 적용 보류**.
- 현장(총괄/대표) 의도 확정 필요: 아래 FOLLOWUP 참조.
