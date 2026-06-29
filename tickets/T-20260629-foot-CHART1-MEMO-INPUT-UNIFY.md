---
id: T-20260629-foot-CHART1-MEMO-INPUT-UNIFY
domain: foot
priority: P1
status: deploy-ready
qa_result: pass
deploy_commit: ad314392
deployed_at: 2026-06-29T19:35:38+09:00
bundle_hash: BLy6fncY
summary: "1번차트(CheckInDetailSheet) 메모 입력 통일(현장 A안, 김주연 총괄 MSG-20260629-185639-wlpt): 예약·고객·기타메모 3종 모두 '한 줄 입력창 + [추가] 버튼'(예약메모식 인라인·누적 항목형)으로 통일. 신규 CustomerColumnMemo가 단일 text 컬럼(customer_memo/memo)을 줄 단위 누적 항목으로 파싱·표시 + 한 줄 입력창 + [추가](Ctrl+Enter); [추가] 시 컬럼에 \\n append 후 즉시 persist(예약메모와 동작 일관). 고객/기타메모 textarea+개별저장 패턴 4곳(customerMode·checkIn 양 분기) 이식. 예약메모(ReservationMemoTimeline)는 미변경 — 동작·타 서피스 회귀 0. 하단 일괄 '메모 저장' 버튼 존치. DB 스키마 변경 없이 FE만, 기존 메모값 누락 0(round-trip 무손실). 미사용 Textarea import 제거. 빌드 5.57s OK, E2E 12 passed + 인접 메모 spec 회귀 0."
created: 2026-06-29
assignee: dev-foot
db_change: false
e2e_spec_exempt_reason: n/a
---

# T-20260629-foot-CHART1-MEMO-INPUT-UNIFY — 1번차트 메모 입력 통일 (현장 A안)

## 배경
김주연 총괄 현장 결정(A안, MSG-20260629-185639-wlpt): 1번차트(CheckInDetailSheet)의
예약메모·고객메모·기타메모 입력 방식이 제각각(예약메모=인라인+추가+누적 / 고객·기타메모=
textarea+개별저장) → 3종 모두 "한 줄 입력창 + [추가] 버튼"(예약메모식 인라인·누적 항목형)으로 통일.
하단 일괄 "메모 저장" 버튼은 유지(제거 X).

## 작업범위 (AC-3 확정)
- 고객메모(customers.customer_memo)/기타메모(customers.memo)의 textarea+개별저장 패턴 →
  예약메모와 동일 인라인 입력창 + [추가](Ctrl+Enter 동일) + 누적 리스트형으로 이식.
- 3블록 동일 입력 패턴(한 줄 입력창 + [추가])·동작 일관.
- 하단 "메모 저장" 버튼(saveNotes, check_ins) 존치.

## 구현
- **신규** `src/components/CustomerColumnMemo.tsx`: 단일 text 컬럼을 줄(\n) 단위 누적 항목으로
  파싱(parseColumnMemoItems)·표시 + 한 줄 입력창 + [추가](Ctrl+Enter). ReservationMemoTimeline
  기본(non-unify) 입력 레이아웃·data-testid(memo-add-btn/memo-item) 미러링.
- `CheckInDetailSheet.tsx`: 고객/기타메모 4곳(customerMode 분기 2 + checkIn 분기 2) →
  CustomerColumnMemo로 교체. saveCustomerMemo/saveEtcMemo → appendCustomerMemo/appendEtcMemo
  (컬럼에 \n append 후 즉시 persist, 예약메모와 동작 일관). 2번차트 쌍방연동(localStorage
  foot_crm_customer_refresh) 보존. 미사용 Textarea import 제거.
- 예약메모(ReservationMemoTimeline)는 **미변경** — row-backed(reservation_memo_history) 동작·
  타 서피스(대시보드/예약상세) 회귀 0.

## 가드 (준수)
- **DB 스키마 변경 없이 FE만** — 신규 컬럼/테이블/enum 0. data-architect CONSULT 불요.
- **데이터 보존(마이그 손실 0)**: 기존 customer_memo/memo 값은 줄 단위로 분해되어 누락 없이
  누적 항목으로 표시. append round-trip 무손실(E2E S3 검증).
- **순차화**: ce60942e(PAYKENBO 제거) 旣 origin/main 반영 확인 후 최신 main rebase 위에 작업.

## 현장클릭시나리오 / E2E
tests/e2e/T-20260629-foot-CHART1-MEMO-INPUT-UNIFY.spec.ts (12 passed)
- S1: 3종 메모 동일 인라인+[추가] 패턴·누적 추가
- S2: 하단 "메모 저장" 버튼 존치 + 저장 보존
- S3: 기존 메모 데이터 회귀 0 + 예약메모 기존 동작 유지 + append/parse 무손실
