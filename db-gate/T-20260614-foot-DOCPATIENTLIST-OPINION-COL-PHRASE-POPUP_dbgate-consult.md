# DB-Gate 선이관(설계 CONSULT, 마이그레이션 미작성) — T-20260614-foot-DOCPATIENTLIST-OPINION-COL-PHRASE-POPUP

> **to**: supervisor (DB 게이트) + data-architect (CONSULT) · **from**: dev-foot · **db_change**: 결정 필요(추정 스키마 미작성)
> **commit**: 없음(코드 변경 0건, AUDIT-ONLY 패스) · **연계 FOLLOWUP**: planner MSG-20260614-185430-bgso
> **상태**: source A/B 미결(DOCOPINION-AUTOLOAD) + 저장모델 미결 → 두 게이트 동시 발동, hold

## 왜 db-gate 선이관인가 (게이트① 발동)
요청 ③ "환자별 루틴 기본값 + 진료의 수정 가능 + 저장"은 소견서 **초안을 발행 전에 보관·수정·재방문 기본값으로 제공**해야 함.
AUDIT 결과 현재 소견서 저장 = `form_submissions.field_data.diagnosis_ko`(**발행 시점 INSERT, status='printed'/printed_at**)뿐 → **발행 전 초안/환자별 기본값을 들고 있는 영속 스토어 부재**.
즉 ③은 **신규 영속 저장모델 필요** = db_change 후보. 추정 스키마 신설 금지(§S2.4) → 설계 결정을 supervisor/data-architect에 선이관.

## 결정 필요 사항 (추정 금지 — 옵션만 제시)
- **(a)** 기존 행 확장: `check_ins` 또는 `medical_charts`에 `opinion_draft`(text) 컬럼 추가 → 방문 단위 초안. 환자단위 routine default 미흡.
- **(b)** 신규 테이블 `patient_opinion_drafts`(customer_id 단위 routine default + 방문 override) → ③ 의도("환자별 루틴 기본값")에 가장 부합. RLS clinic 격리 필요.
- **(c)** 무저장 절충: "마지막 발행 소견(form_submissions 최신 diagnosis_ko)을 불러오기 기본값으로 read-only" → db_change 0. 단 '수정 후 저장(routine default 갱신)' 불가 → reporter 의도와 격차.

## source 의존 (게이트②)
본문 자동채움(body식 전용 의사소견 → 소견서 prefill)은 **T-20260614-foot-DOCOPINION-AUTOLOAD-FROM-CHART source A/B 결정(김주연 총괄 pending)** 전까지 wire 금지. 저장모델(b) 채택 시에도 "기본값을 무엇으로 채우나"는 이 source 결정에 종속.

## dev-foot 요청
1. 저장모델 (a)/(b)/(c) 중 택1 결정(또는 신규 안). (a/b)면 마이그 SQL은 결정 후 dev-foot가 작성(forward+rollback+dry-run) 재이관.
2. data-architect CONSULT: cross_crm_data_contract 상 소견서 초안 PII 적합성(소견 본문 = 진단 소견 텍스트, RRN/연락처 비포함 설계) 사전 확인.
3. 결정 회신 → planner FOLLOWUP(MSG-20260614-185430-bgso)과 합류.

## 무중단/회귀
- 현재 코드 변경 0건 → prod 무영향. 본 문서는 설계 선이관(consult)일 뿐, 적용 마이그레이션 없음.
- 결정 전 추정 컬럼/테이블 신설·추정 wire 일절 없음.
