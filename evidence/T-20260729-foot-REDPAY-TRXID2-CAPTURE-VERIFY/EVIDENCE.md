# T-20260729-foot-REDPAY-TRXID2-CAPTURE-VERIFY — 캡처 검증 결과

**요청**: 최필경 총괄 P0 — 레드페이 7/28 16:40 오류응답 2건(tid 1047535845 풋1 VAN) DB 저장 여부 즉시 확인 (레드페이 재시도 1/5/30분 3회 → 유실 직전).
**성격**: db_only (화면 변경 없음). 산출물 = 조회 결과 표.
**실행**: `scripts/T-20260729-foot-REDPAY-TRXID2-CAPTURE-VERIFY_probe.mjs` (READ-ONLY, GET-only, write/DDL 0)
**대상 테이블**: `public.redpay_raw_transactions` (Supabase rxlomoozakkjesdqjtvd)
**인증컨텍스트(Cross-CRM 진단 인증컨텍스트 표준 준수)**:
  - ① service_role (RLS 우회) = **권위 판정 컨텍스트** → 2/2 rows returned
  - ② anon (RLS 적용) = 401(permission denied) — RLS 정책상 진단조회 불가, 판정근거로 미사용 (0-row 오독 회피)

## 판정: ✅ 유실 아님 — 2건 모두 정상 저장 (금액·승인번호 일치)

| trxid | 저장 | external_status | amount | 기대금액 | 금액일치 | approval_no | approved_at(KST) | received_at(웹훅수신, KST) |
|---|---|---|---|---|---|---|---|---|
| K104753584526072816401800015160 | ✅ | Y | 8,800 | 8,800 | ✅ | 00015160 | 2026-07-28 16:40:18 | 2026-07-28 16:43:08 |
| K104753584526072816404300699427 | ✅ | Y | 42,000 | 42,000 | ✅ | 00699427 | 2026-07-28 16:40:43 | 2026-07-28 16:44:20 |

- clinic_id = `74967aea-a60b-4da3-a0e7-9c997a930bc8` (foot/종로 풋), tid = `1047535845` (풋1 VAN) — 둘 다 일치.
- **received_at 존재** = 두 건 모두 **웹훅 경로로 정상 수신·적재**됨 (폴러 선적재 NULL 아님). 수신 지연 약 2.5~3.5분(승인시각→웹훅수신).
- external_status = `Y` (승인). cancelled_at = null.

## 부기 (캡처 검증 범위 밖, 참고)
- 두 건 모두 `matched_payment_id = null`, `match_rule = null` → raw 적재는 됐으나 아직 payments 매칭 전 상태(plan B 대기/미매칭). 매출정합·매칭은 별도 트랙(item3/reconcile) 소관.

## 결론
- **영구유실 위험 해소**: redpay_raw_transactions 에 raw 원본 2건 안전 보존 확인. 레드페이 재시도 창(1/5/30분) 만료와 무관하게 데이터 소실 없음.
- 미저장 실증 아님 → item3 재수집/수기보정 P0 승격 **불요**. 단, 매칭(matched_payment_id null) 미완은 reconcile 트랙에서 별도 확인 권고.
