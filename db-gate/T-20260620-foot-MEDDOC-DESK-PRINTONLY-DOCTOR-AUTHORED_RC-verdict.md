# RC Verdict — T-20260620-foot-MEDDOC-DESK-PRINTONLY-DOCTOR-AUTHORED

- **dev**: agent-fdd-dev-foot
- **date**: 2026-06-21
- **gate**: audit-first (ticket §95–100) + L-006 LOGIC-LOCK + HELD dependency
- **verdict**: **HOLD-CODE → FOLLOWUP(planner)**. 추정 코드 미착수. 아키텍처 fork 결정 + HELD 의존 해소 선행 필요.

---

## 1. 코드 전수조사 결과 (누가 소견/진단 본문을 입력/편집하는가)

소견서·진단서는 코드상 **두 개의 분리된 surface**로 존재한다.

### Surface A — `opinion_doc` (원장 작성 모델, 이미 구현됨)
- `src/components/doctor/OpinionDocTab.tsx` + `publish_opinion_doc` RPC.
- 작성/발행 권한: `canPublish = ['director','doctor'].includes(role)` (FE) + RPC `is_doctor_role()` hard-enforce (DB).
- 발행본 = `form_submissions(form_key='opinion_doc', status='published')`, append-only, 비가역 트리거(의료법 §22).
- 실장(데스크) = `useCreateOpinionRequest` → `form_submissions(status='draft', request_origin='staff_consult')` **요청만**. 본문 작성 불가.
- 출력 = `printOpinionDoc.ts`(L-006). 데스크 read-only 출력 가능.
- **→ 티켓이 요구하는 "원장 작성 / 데스크 출력만" 모델이 이 경로엔 이미 구현되어 있음.**

### Surface B — `diag_opinion`(소견서) / `diagnosis`(진단서) (DocumentPrintPanel, 자유 타이핑 루프홀)
- `src/components/DocumentPrintPanel.tsx` `FormSubmitDialog` → `editableFields` 의 `diagnosis_ko`(소견/진단명, multiline) 가 **다이얼로그를 연 누구나(데스크 포함) 자유 입력 가능**(line 2389–2434, `<Textarea>`). 진단서엔 `future_treatment_period` 도 자유 입력.
- 접근 게이트: `formTemplates.ts ALL_ROLE_PRINT_FORM_KEYS` 가 `diag_opinion`/`diagnosis` 를 **전 역할 허용** → 데스크가 본문 작성+인쇄 둘 다 가능.
- **DOCLIST_ORDER_10(데스크 서류출력 목록) 4.소견서=`diag_opinion`, 5.진단서=`diagnosis`** → 데스크 화면은 이 legacy 자유타이핑 경로로 라우팅됨(opinion_doc 아님).
- 원장 작성 본문이 이 폼의 `diagnosis_ko` 로 자동 유입되는 경로 **없음**. (`autoBindContext.ts` 는 `medical_charts.diagnosis` → diag **코드**(diag_code_1/diag_name_1)로만 바인딩, 소견 **본문**은 미바인딩.)

## 2. 핵심 충돌 (왜 코드 강행 불가)

1. **v1 "데스크 본문 read-only" 단독 적용 시 lock-out**: Surface B 의 `diagnosis_ko` 를 비-원장에게 read-only 로 막으면 → 데스크가 본문을 채울 방법이 사라지고, 원장 본문이 이 폼으로 유입되는 경로도 없어 **소견서/진단서를 아예 생성·출력 못함**. = 티켓이 명시 금지한 "출력 동선 무영향" 위반 + 데스크 lock-out.
2. **원장 본문 → diag_opinion/diagnosis 바인딩 = HELD**: 그 바인딩이 바로 `T-20260614-foot-DOCOPINION-AUTOLOAD-FROM-CHART`(status=**blocked**, block_reason=dependency. 김주연 총괄 직접 보류 "이 건 잠시 보류! 로직 픽스되면 작업 요청할게"). source 미존재.
3. **v2 B안 게이트 신호원 미확정**(티켓 §95–100): "작성 완료" 판정 시점·데이터 소스 미확정. 후보 2개(`medical_charts.diagnosis` 텍스트 / published `opinion_doc`) 모두 존재하나 어느 것을 신호로 쓸지 = 제품 결정.
4. **아키텍처 fork**: 데스크 소견서/진단서의 canonical surface 가 (A) legacy `diag_opinion`/`diagnosis`(자유타이핑) 인지 (B) `opinion_doc`(원장 작성, 이미 게이트됨) 인지 미정. DOCLIST 4·5 는 A 로 라우팅 중. 요구사항은 사실상 B 모델로의 통일을 의미 → L-006 락 출력경로 + HELD autoload 를 건드리는 구조 변경.

## 3. 권고 (planner/architect 결정 요청)

- **Q1 (canonical surface)**: 데스크 서류출력의 소견서/진단서를 (A) legacy diag_opinion/diagnosis 유지하되 본문 작성만 원장 게이트로 전환할지, (B) opinion_doc(이미 원장 작성/데스크 출력 모델 완성) 로 라우팅 통일할지?
  - dev 권고: **B 방향**이 요구사항("원장 작성 / 데스크 출력만")과 이미 정합. DOCLIST 4·5 를 opinion_doc 발행본 출력으로 연결하면 신규 게이트·HELD 의존 없이 v1+v2 동시 충족 가능성 큼. 단 DOCLIST/L-006 출력경로 변경 = 현장 승인 게이트.
- **Q2 (B안 신호원)**: "작성 완료" = published `opinion_doc` 존재로 정의할지? (그러면 §95-100 의 DOCOPINION-AUTOLOAD HELD 의존 없이도 게이트 신호 확보 가능.)
- **Q3**: A 방향 고수 시 → DOCOPINION-AUTOLOAD-FROM-CHART(HELD) 선행 해제 없이는 데스크 lock-out 회피 불가. HELD 해제까지 본 티켓도 동반 HOLD 필요.

## 4. 게이트 준수 기록
- L-006: DocumentPrintPanel/formTemplates/printOpinionDoc 변경 = 현장 승인 게이트 → 미착수.
- §11.1: opinion_doc=진료대시보드(의료화면). frontmatter confirm_status=confirmed(권한 축소 방향). 단 surface 통일(B) 시 OpinionDocTab 라우팅 변경은 의료화면 영향 → 결정 확정 후 재확인.
- 원장 lock-out: 미착수(MUNJIEUN-LOCKOUT 패턴 회귀 위험 0).
- DB: 무변경(NO-DDL). 코드 무변경.
