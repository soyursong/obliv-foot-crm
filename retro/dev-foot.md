## 2026-06-29 — §2-2-1a 등급-인지 NULL 분기 (data-architect INFO, DA-20260629-FOOT-GRADE-AWARE-NULLFIX-XREF)

revenue_insurance_split_spec v1.2 §2-2-1a 신설. NULL hira_score 분기에서 grade를 봐야 함:
- general → 전액본인부담 프리뷰 fallback OK
- capped (medical_aid_1/2·near_poor·veteran) → 전액본인부담 금지 → BLOCK/flag (price 전액=환자 과청구=역방향 환수)
- 정액(C) NHIS 정액표 접지 전 미발동 → BLOCK

### 현 코드 상태 (착수 시 반영 대상)
- 서버 RPC calc_copayment (mig 20260526110000 L64-68): NULL hira → price를 base로 두고 등급률 적용 (full self-pay 아님). 단 capped 등급에 대한 BLOCK/flag 부재.
- **client copayCalc.ts L101-112: NULL hira → copayment_amount=price, applied_rate=1.0 → 등급 무관 전액본인부담 (GRADE-BLIND).** §2-2-1a 위반. capped 환자 NULL hira 시 프리뷰 과청구 + 서버/클라 divergence(CLIENT-ALIGN 이슈).

### 게이트
- 코드 지시 아님(데이터 계약). AC는 planner 경유 NULLFIX/CLIENT-ALIGN/GRADE-ENUM-INSERT-VALIDATE 티켓으로 수신 후 착수.
- §S2.4: enum/컬럼 변경 동반 시 data-architect CONSULT 선행.

## 2026-06-29 T-20260629-foot-DOC-DOCTOR-INFO-MISSING-REGRESS (P1 회귀, 미재현)
- 현장 "서류 의사정보 다 누락" → verify-first 4가설 전부 REFUTED (데이터/fallback/clinic_id/렌더).
- 교훈: 라이브 회귀 신고 시 추정 패치 금지. (1)DB read-only 실측 (2)field_data 스냅샷 시계열 (3)렌더 assert 하니스 3종으로 데이터·바인딩·렌더 분리 진단 → 코드 무결 입증.
- P0 격상은 명시 조건('전 서류 불능+데이터소실') 충족 시만. 미충족 → planner FOLLOWUP + 현장 실기 재확인 요청으로 클로저.
- WIP 격리: 같은 render 파일에 타 티켓(DOCPRINT-CENTER-ALIGN) 미커밋 변경 존재 → 선택적 git add 로 내 진단증빙만 커밋, 타 작업 무손상.

---
## 2026-06-30 — T-20260629-foot-SERIAL-UNIQUE-HARDEN: 발번 모델 실측 (FOLLOWUP MSG-20260630-030104-2cqt)
- **발견**: 서류 연번호(visit_no)는 **최상위 컬럼이 아니라 form_submissions.field_data(JSONB)의 키**다. 발번은 FE(DocumentPrintPanel)에서 count(clinic 전역)+1로 산출. **serial 컬럼/발번 RPC/SEQUENCE 모두 부재.**
- **함의**: DA 권고 "복합 UNIQUE + retry RPC"는 기존 컬럼/RPC를 강화하는 게 아니라 **신설 + 발번 경로 FE→DB 이전 + FE 재배선**을 요구. db_only 단독으로 AC-1 달성 불가(컬럼만 추가하면 inert guard).
- **prod 실측(AC-4)**: visit_no 보유 8행 전부 fallback id-slice(checkIn.id.slice(0,8)), autogen serial 미정착, fallback 중복 3군 존재 → visit_no 문자열 UNIQUE는 기존 데이터 충돌 + DA #1 silent-fail 양쪽으로 불가.
- **교훈**: "유니크 제약 추가" 류 티켓은 *그 값이 실제로 어디에 어떤 grain으로 저장되는지* 코드+prod 실측이 선행. JSONB 내부 값에 대한 무결성 제약은 컬럼 승격이 전제.
- 액션: planner FOLLOWUP로 (1)FE 페어링 (2)DA 신규컬럼+backfill 표면 재확인 요청. 권고 설계(doc_serial_seq 컬럼+row_number backfill+부분 UNIQUE CONCURRENTLY+retry RPC) 첨부. deploy-ready 보류.
