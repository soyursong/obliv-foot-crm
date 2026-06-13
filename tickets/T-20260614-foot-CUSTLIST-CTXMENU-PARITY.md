---
ticket_id: T-20260614-foot-CUSTLIST-CTXMENU-PARITY
status: deploy-ready
priority: P1
domain: foot
created_at: 2026-06-14
deploy_ready_at: 2026-06-14
deploy_ready_by: dev-foot
build_ok: true
spec_added: tests/e2e/T-20260614-foot-CUSTLIST-CTXMENU-PARITY.spec.ts
db_changed: false
rollback_sql: none
risk_level: GO (2/5)
commit_sha: f2aaa6c
---

## 요청

원천: NEW-TASK MSG-20260614-013217-jrkm (planner, P1).
고객관리 우클릭 메뉴 parity 보수.

대상: src/pages/Customers.tsx 로컬 CustomerContextMenu 1곳만.
공통 CustomerQuickMenu / 대시보드 무수정.

## 수행

1. **[문자] 항목 추가** — CustomerQuickMenu의 SMS 항목 패턴 그대로 이식.
   - `onSendSms?` optional prop + 부모 호출부 wire.
   - 권한 게이트: `canAccess(profile?.role, 'manual_sms_send')` — canon SSOT
     권한키 재사용(CustomerQuickMenu/Dashboard/Reservations 동일). 미충족 시
     prop 미전달 → 항목 미노출. (티켓의 "admin/manager 게이트"는 이 canon
     권한키로 해석 — 하드코딩 role 분기는 신규 로직이라 parity·"신규 로직 금지"
     위배이므로 SSOT 권한키 채택.)
   - 발송 핸들러·optout·발신번호 화이트리스트 차단: T-20260606-foot-CTXMENU-SMS-SEND가
     만든 기존 경로(SendSmsDialog) 재사용. 신규 발송 로직 0.
   - Customer→CheckIn 어댑터(customerAsCheckIn): SendSmsDialog가 customer_id로
     phone SSOT refetch하므로 식별 필드만 채움(resvAsCheckIn 패턴 미러).
2. **'예약하기' 라벨 유지** (planner 결정). 동작=신규예약이라 canon
   (T-20260610 ac3_interpretation_verdict)상 "예약하기"가 정확 — "예약상세"로 변경 안 함.

## 검증

- `npm run build` (tsc 포함) 통과.
- E2E spec 3 시나리오:
  - S1: [문자] 노출 + 수납 다음 순서 + 클릭 → SendSmsDialog 오픈.
  - S2: 예약 액션 라벨 "예약하기" 유지("예약상세" 미존재).
  - S3: manual_sms_send 미보유 계정 [문자] 미노출(게이트).

db_change 없음. regression_risk=medium → 단일 메뉴 진입점 추가·기존 경로 재사용으로 GO(2/5).
