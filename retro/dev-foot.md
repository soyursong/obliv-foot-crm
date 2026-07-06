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

## 2026-06-30 — DDL 게이트 race: DA CONSULT pending 상태에서 ADDITIVE 마이그 배포 (T-20260630-foot-CUSTOMERS-CONSENT-MARKETING-COL)

**사고**: P0 핫픽스(신규고객 예약 INSERT 500, RC=customers.consent_marketing 부재)에서 §6-1 계약 정합으로 판단해 ADDITIVE 1컬럼 마이그를 작성·적용·deploy-ready(a9f4da16, 09:48:51)까지 직행. 그러나 data-architect가 09:44:59에 이미 CONSULT-REPLY로 **NO-GO**(consent_marketing=비-SSOT 명칭, 7번째 divergent drift, 정본=consent_ad) 회신한 상태였음. 즉 DA NO-GO를 픽업하지 못한 채 게이트를 race로 통과 → 컬럼이 foot 500은 해소했으나 SSOT 수렴을 파괴하는 drift로 prod에 잔존. 후속 정합 fix 2티켓(dopamine REMOVE + foot ROLLBACK) 발생.

**근본 원인**:
1. §S2.4 데이터 정책 자문 게이트 = 신규 컬럼 추가 전 DA CONSULT *회신(GO)* 확인이 deploy-ready 조건인데, `requested` 상태에서 배포 결정을 내림(회신 확인 누락).
2. "§6-1 계약대로 운반=계약 준수"라는 티켓 전제를 무비판 수용. 실제로 §6-1은 consent 필드를 정의하지 않으며 정본 마케팅동의는 consent_ad. 전제 검증을 DA 회신으로 닫았어야 함.

**교훈/가드**:
- 신규 컬럼·테이블·enum 추가 마이그는 P0 핫픽스라도 **DA CONSULT 회신=GO를 눈으로 확인한 뒤** apply/deploy-ready. `requested`/미회신 상태 배포 금지 — 핫픽스 긴급성이 게이트 면제 사유 아님.
- 명칭(naming)은 SSOT 수렴 이슈 = DA 단독 소유. "수신측 컬럼 부재=계약결함 보정"처럼 보여도 *명칭이 SSOT에 있는지*는 내 판단축이 아니라 DA 게이트.
- 롤백은 하류 의존(dopamine 필드제거) 검증 후 게이트. 증상 해소된 drift를 성급히 롤백하면 원 RED 재발 — rollback SQL 헤더 경고를 운영 순서로 준수.

##  — T-20260702-foot-RESVLIST-TREATTYPE-STATUS-LAYOUT (착수보류)
- 스크린샷 SSOT가 티켓 본문 화면명과 불일치할 수 있음. 판독으로 실제 화면 특정 후 착수할 것.
- 판별 지표: '초' 텍스트 배지+폰뒷4+미수 배지+현재시각선 = 대시보드 통합시간표(DashboardTimeline). 예약관리 카드는 색 점(KIND_DOT)만.
- AS-IS 서술("치료유형 중앙정렬+상태 별도 줄")이 코드 어디에도 없으면 추정수정 금지 → planner FOLLOWUP(scope_conflict). 특히 CHART-OPEN-GUARD surface.

## 2026-07-03 — T-20260702-foot-RESVCAL-DAYWEEK-LAYOUT-UNIFY 착수전진단→블로커(코드 미변경)
- REDEFINITION_RISK 진단 의무 수행. 일뷰=이미 RESVGRID 엑셀격자(4행분할)로 전면 재구현됨 / 주뷰=별개 table substrate(셀당 grid-cols-2 = 2×2 미니그리드의 정체).
- 스크린샷 F0BELKUCKKP 헤더 '됨' 뱃지는 git 전 이력에 존재한 적 없음(git log -S) → 스크린샷이 현행 배포본과 불일치. '일뷰 기준=정상카드'도 현행엔 없음(격자화됨).
- 판정: 티켓 §CONFLICT verdict (b) '격자 재구현이 이미 카드뷰 대체 → 요청 무의미/재충돌' 케이스. '일뷰와 동일하게'(AC-1/AC-3)가 (현행격자 vs 구카드) 두 갈래로 모순.
- 조치: 추정 착수 금지. planner FOLLOWUP(MSG-20260703-000149-ic4s, P1)로 기준 재확인 요청 + 안전 부분수정(AC-2: 주뷰 grid-cols-2→단일열 full-width, 주뷰한정·무충돌) 선행 배포 가부 문의. 회신 전까지 코드 미변경.
- 학습: 같은 화면축(/reservations)이 활발히 재아키텍처 중일 때, 스크린샷 SSOT라도 현행 코드와 대조(git log -S)로 기준선 유효성부터 검증. '됨' 같은 미존재 토큰 = 기준선 stale 신호.

## 2026-07-06 — T-20260706-foot-RRN-BIRTHDATE-DERIVE-ISSUE-BLOCK RC규명→블로커(코드 미변경)
- 증상: 균검사 [발급하기] "생년월일 없어 발급불가"(정연주 F-4449, birth_date NULL·rrn_enc PRESENT). 티켓은 "서버 RRN파생 이식하면 해결" 전제.
- 진단: 서버파생(fn_customer_birthdates)·effectiveBirth 폴백은 이미 존재·배포됨(T-20260630). 로직 부재 아님. → 착수 전 prod 런타임 실측(service_role REST)으로 RC 규명.
- RC: 해당 환자 rrn_encryption_version=2(신키, re_encrypted 06-29~07-06). 활성 복호함수 3종(rrn_decrypt/fn_customer_birthdates/RLS decrypt) 전부 app.rrn_key→구키 폴백만 사용, 신키 복호경로 부재. 실측 v1 23명 파생성공 / v2 15명 전원 NULL. 06-29 이후 신규 RRN 14/14 전부 v2 = 라이브 growing gap.
- 판정: RRN 키 로테이션 컷오버 갭(supervisor 단독 도메인). AC3(신규 복호경로 금지)·§5·키 Runbook 저촉 → dev-foot 크립토/키 독단 수정 금지. 신키 없으면 AC5 백필도 불가. FE 파생 지금 넣어도 v2 복호실패로 여전히 막힘 = false fix.
- 조치: 코드 미변경, deploy-ready 안 함. planner FOLLOWUP(MSG-20260706-145053-azk0, P1 상향권고)로 supervisor 라우팅 요청. 현장 우회=생년월일 수기입력.
- 학습: "파생로직만 이식하면 됨" 티켓이라도 착수 전 '복호가 실제로 되는가'를 prod 실측으로 검증. version 컬럼(rrn_encryption_version) 분기 존재 시 = 키 로테이션 진행 신호 → green build 아닌 런타임 복호성공을 종결근거로. green build로 증상만 덮는 false fix 금지(rc_first).
