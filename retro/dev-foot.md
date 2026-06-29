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
