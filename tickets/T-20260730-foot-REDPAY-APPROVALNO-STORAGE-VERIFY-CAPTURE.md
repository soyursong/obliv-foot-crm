---
id: T-20260730-foot-REDPAY-APPROVALNO-STORAGE-VERIFY-CAPTURE
domain: foot
priority: P1
status: diag-complete
kind: DIAG-VERIFY
db_change: false
da_consult: "AC-1 진단 = 무관(read-only). AC-2 payments.external_approval_no writeback 제안 = 매칭/매출 접점 → DA CONSULT 1차 게이트 선행 필요(미착수, planner 재판정 요청). 신규 컬럼 불요(컬럼 실재)."
evidence:
  - scripts/T-20260730-foot-REDPAY-APPROVALNO-STORAGE-VERIFY_ac1_introspect.mjs
  - scripts/T-20260730-foot-REDPAY-APPROVALNO-STORAGE-VERIFY_ac1_introspect.log
created: 2026-07-30
reporter: planner
requester: 최필경 총괄 (C0ATE5P6JTH, thread 1785371572.244549)
summary: "레드페이 승인번호 DB 저장경로 실측(service_role 권위 introspection). [저장 O] redpay_raw_transactions.approval_no = 웹훅수신 시점 100% 캡처(웹훅경로 182/182·전체 453/453). [gap] payments.external_approval_no = 컬럼 실재하나 auto-match 건 0/405 NULL — reconcile 매처가 매칭 시 external_trxid/external_status/reconciled_at만 쓰고 approval_no writeback 누락. pending_payment(단수)=0행·승인컬럼無(웹훅 관측 무접촉 설계). AC-2 웹훅캡처=이미 존재→신규불요. writeback 개선은 매칭/매출접점→DA CONSULT 게이트."
---

# T-20260730-foot-REDPAY-APPROVALNO-STORAGE-VERIFY-CAPTURE

레드페이 승인번호(approval_no / external_approval_no) DB 저장경로 검증 + (미캡처 시) 웹훅수신 시점 ADDITIVE 캡처.
reporter: 최필경 총괄 — "화면 표시는 없어도 DB엔 반드시 저장" / "승인번호 없어서 매칭 안 됐던 게 근본 문제였을 수 있다".

## AC-1 (read-only) 저장경로 실측 결과 — service_role 권위 introspection

증거: `scripts/T-20260730-foot-REDPAY-APPROVALNO-STORAGE-VERIFY_ac1_introspect.mjs` (+ `.log`)
인증컨텍스트: service_role(RLS 우회, 권위 판정) + anon(대조, 401 → 판정근거 아님). Cross-CRM 진단 인증컨텍스트 표준 준수.

| 경로 | 테이블.컬럼 | 저장 | 실측 |
|------|------------|------|------|
| ③ 원천 캡처 | `redpay_raw_transactions.approval_no` | **O** | 453/453 (100%) NOT NULL. 웹훅 수신경로(received_at NOT NULL) 182/182 채움. **웹훅수신 시점 캡처 확실.** |
| ① 결제 승격 | `payments.external_approval_no` | **컬럼 O / 값 X** | 405건 전건 NULL (0/405, 100% NULL). auto-match 건도 NULL(raw.approval_no="72453660" ↔ payment NULL 6/6 표본 확인). |
| ② 웹훅 임시 | `pending_payment` (단수) | 무관 | 테이블 실재하나 0행. 승인번호 컬럼 없음. 웹훅은 여기 write 안 함(관측 무접촉 설계, verify.ts §buildWebhookRawRow — matched_payment_id 미세팅). ※티켓 원문 `pending_payments`(복수)는 미존재(PGRST205), 정본=단수 `pending_payment`. |

### 근본원인 (로그/코드 실증, 추정 아님)
`redpay-reconcile/index.ts:768-775` — 매처가 raw↔payment 매칭 성공 시 payments UPDATE 컬럼 =
`reconciled_at` / `external_trxid` / `external_status` **3개뿐**. `external_approval_no` **writeback 누락**.
payments의 `external_approval_no`는 현재 **입력(input) 전용** — Tier0에서 스태프 수기입력분(`external_approval_no NOT NULL`)을 raw와 매칭하는 방향으로만 사용(index.ts:685-692, matcher.ts:278 corroborator). raw→payment 자동승격 경로 부재.

### 판정
- **승인번호는 DB에 저장되고 있다** (raw 테이블에 웹훅수신 시점 100%). 유실된 적 없음.
- 다만 대표 표시·조회가 읽는 `payments.external_approval_no`는 auto-match 건에 비어 있어(NULL) "승인번호 없음"으로 보일 수 있음 = 총괄이 지목한 체감 문제의 실제 지점.

## AC-2 (조건부) — 판정: 웹훅 신규 캡처 불요 / payments writeback은 게이트 대기
- **웹훅수신 시점 approval_no 캡처는 이미 존재**(raw 100%) → AC-2의 "웹훅 EF에서 approval_no capture 신설" **조치 불필요**.
- 별개 개선건: `payments.external_approval_no` **raw→payment writeback**(매칭 성공 시 raw.approval_no를 payment로 승격).
  - 신규 컬럼 불요(컬럼 실재) → `db_change=false`.
  - **매칭/매출 접점** payments write → **DA CONSULT 1차 게이트 선행 필요**(NONUNIQUE-GUARD 라인). 미착수.
  - approval_no 전역 비유일(T-20260728) → **매칭 단일키 절대 금지** 불변식 유지. writeback은 이미 composite 매칭 확정(reconciled_at set) 이후이므로 Tier0 재매칭 재유발 없음(설계상 안전), 그러나 정책 판정은 DA·planner 몫.
  - 기저장분(matched 405건) 소급 = `data_correction_backfill_sop` 별도 SOP(단일 count UPDATE 금지).

## AC-3 (fold) — 미배정 결제함 승인번호 표시
신규 발번 안 함. `T-20260729-foot-REDPAY-PLANB-UNASSIGNED-INBOX-BUILD`(in_progress, title '시각·금액·승인번호·단말 표시', deadline 08-05) 스코프에 이미 포함. 진행분으로 회신(§13.1.A anti-ping-pong).
