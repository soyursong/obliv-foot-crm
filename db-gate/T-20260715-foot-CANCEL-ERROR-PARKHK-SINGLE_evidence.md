# T-20260715-foot-CANCEL-ERROR-PARKHK-SINGLE — 진단 증거 (READ-ONLY 재현)

원문(김주연 총괄): "다른 고객 건은 금일날짜로 취소 처리 됐는데 박형규 고객 건만 에러 뜸"

착수: 2026-07-16 / author: dev-foot
방식: prod(rxlomoozakkjesdqjtvd) 읽기전용 introspection + self-rollback(DO $$ ... RAISE) 재현. 데이터 무변경(순소실 0).

## 결론 (한 줄)
**박형규 고객의 "무좀체험권" 패키지(₩10,000)는 이미 2026-07-15 06:59:51 에 전액 환불 완료됨.**
오후의 재환불 시도는 서버의 **중복/과다환불 방지 가드가 정상 차단** → 에러 표시. 타 고객은 미환불 상태 → 첫 환불 성공. **코드 결함 아님 = 데이터 상태(이미 환불) + 가드 정상동작.**

## 1) 대상 지문
- customer: 박형규 / id `4c7fcad8-115d-4e80-a88d-65e2e24e81d4` / chart `F-4646` / clinic `74967aea...`
- reservations 1건: `54f04d7b...` status=`checked_in`, source=`dopamine`, external_id 有 (07-14 내원 완료)
- check_ins 1건: `92de48ce...` status=`done`(레이저 완료)
- payments(단건) 테이블: **0건**
- packages 1건: `3ba632cd...` "무좀체험권" total=₩10,000 / paid=₩10,000 / **status=`refunded`** / updated_at 2026-07-15 06:59:51
- package_payments 2건:
  1. `753b6d2d...` payment ₩10,000 accounting_date **2026-07-14** (memo: 일마감 수기결제 정본화 opt-A/pkg)
  2. `ba243787...` **refund** ₩10,000 accounting_date **2026-07-15** parent_payment_id=`753b6d2d...` (net_paid=0)

## 2) 정상 취소 경로 무결(차이 아님) — 재현으로 배제
- reservations 취소 UPDATE(status→cancelled): superuser + **admin RLS 임퍼소네이션** 양쪽 성공(트리거 `enqueue_dopamine_callback`/`notify_reservation_messaging`/`set_updated_at` 정상). RLS 정책은 role+clinic 스코프(레코드별 아님) → 타 고객과 동일.
- check_ins 취소(done→cancelled) UPDATE: 성공(트리거 `fn_checkin_cancel_restore_reservation` 등 정상).
- ⇒ 예약/체크인 취소는 박형규 단건 에러의 원인 아님.

## 3) 진짜 실패 경로 = 패키지 환불(일마감 Closing) 재현
RPC `refund_package_payment(p_payment_id, p_method)` (mig 20260714200000) 을 admin RLS 임퍼소네이션 + self-rollback 으로 호출:

- 원결제행 `753b6d2d`(이미 환불됨) 재환불 시도 →
  `{"error":"환불 가능 잔여금액(0원)을 초과합니다. (원결제 10000원 / 기환불 10000원)"}`
  (RPC step5 누적환불 상한: Σ기환불 10000 + 신규 10000 > 원결제 10000 → 거부)
- 환불행 `ba243787`(payment_type=refund) 대상 →
  `{"error":"원결제 내역을 찾을 수 없습니다."}` (RPC step2 `WHERE payment_type='payment'` NOT FOUND)

FE(`src/pages/Closing.tsx` handleSubmit): `result.error` → `toast.error(...)` = 관리자가 본 "에러".
사전가드(line 2454) `singleRemaining<=0 → "이미 전액 환불된 결제입니다."` 는 priorRefunded 조회(parent_payment_id 전역)가 refund 를 찾을 때 발화. 경합/교차일 조회 시 우회되면 위 RPC 원문 에러 노출.

## 4) 왜 박형규만? (타 고객 무회귀)
- 서버 가드는 **기환불이 존재할 때만** 발화. 타 고객(미환불) 첫 환불 → 통과.
- clinic 07-15 package_payments 9건 중 refund 1건 = 박형규뿐. ⇒ 박형규만 "이미 환불" 상태.

## 5) 원인 계층 특정
- FE가드: 有(단, 아래 교차일 표기 공백으로 사전 경고 미흡).
- RPC/트리거: **정상**(중복·과다환불 방지 설계대로 동작).
- DB제약/상태전이: 무관.
- 데이터: **이미 환불 완료(정상 데이터로 보임)** — 데이터 정정 불요로 판단(현장 확인 필요).

## 6) 권고 최소수정 (planner 확인 요청 — 머니패스/공유 Closing 면)
교차일 환불 표기 공백: 원결제(07-14)를 그 날짜 일마감에서 보면 07-15 환불이 같은날 목록에 없어 "환불" 배지 미표기 → 관리자가 재환불 시도. 
FE-only 안(스키마·데이터·서버 무변경, 무회귀):
- (a) 당일 원결제행에 대해 **처리일 무관** linked refund 를 조회·annotate → "환불" 배지 노출.
- (b) 완전환불 행은 환불버튼(line 1742) 숨김(`&& !r.fullyRefunded`).
→ 타 고객(미환불) 경로 무영향(AC-3).

## 부록: 재현 스크립트
/tmp/*.mjs (Supabase Management API `/database/query`, self-rollback). prod 무변경.
