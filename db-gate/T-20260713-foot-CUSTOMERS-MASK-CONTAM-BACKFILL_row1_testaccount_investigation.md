# row1(0356b229) (A)-first 결정적 test-account 증거 조사

- Ticket: T-20260713-foot-CUSTOMERS-MASK-CONTAM-BACKFILL
- 근거 지시: planner SPLIT FIX-REQUEST MSG-20260714-020001-7xrp §2 (A)-first
- DA 판정: q0fb(MSG-20260714-015408) row1 = NOT-CLEARABLE / uulc addendum(015456) date-무관 강근거 유효 / reconciliation INFO(MSG-20260714-015905-oq42)
- 방식: READ-ONLY 메타데이터 조사 (PHI=실명/전화 stdout·git 미노출, 부울/길이/tail4만)
- 대상: raw `c51dd5e0` + phantom `0356b229` (tail4 9089)

## 조사 결과 (metadata only)

| 항목 | RAW c51dd5e0 | PHANTOM 0356b229 | test-account 방향 |
|------|--------------|------------------|-------------------|
| is_simulation | **false** | **false** | ✗ 시뮬 아님 |
| phone_dummy | **false** | **false** | ✗ 더미폰 아님 |
| lead_source | **"지인소개"** | null | ✗ 실환자 유입경로(지인소개) |
| visit_route | "지인소개" | null | ✗ 실환자 |
| name_test_keyword (test/QA/더미/dummy/샘플/asdf/ㅁㄴㅇ 등) | **false** | **false** | ✗ 테스트 키워드 무 |
| name_len | 3 | 3 | 정상 한국이름 길이 |
| memo_test | null | null | ✗ |
| has_rrn (rrn_enc/vault) | false | **true** | ✗ phantom 실 RRN 보유 |
| has_chart | true | true | 중립 |
| phone_digits | 12 (국가코드형 실형식) | 4 (마스킹) | ✗ raw 실형식 |
| created_kst | 2026-07-10 17:26:45 | 2026-07-11 13:09:47 | 중립(uulc 철회) |

## 판정: **결정적 test-account 증거 없음 → 오히려 실환자 신호 다수**

- ❌ 알려진 QA/스태프-test 계정 플래그 무: `is_simulation=false`·`phone_dummy=false` 양측.
- ❌ 차트 test 플래그·test 키워드 무: name/memo 어디에도 test/QA/dummy/샘플 등 없음, 정상 이름 길이.
- ✅ (역방향) **실환자 신호**: raw `lead_source/visit_route="지인소개"`(실 유입경로) + phantom **실 RRN 보유(has_rrn=true)** + raw 실 전화형식(12자리 국가코드형) + 시뮬/더미 플래그 전무.
- created-date는 uulc addendum이 이미 철회(self_checkin 마스킹 07-11 라이브 가능) → 중립. 단 date와 **무관하게** 위 실환자 신호가 NOT-CLEARABLE을 강화.

## 결론 (planner SPLIT §2 분기)
- **증거 없음** 경로 확정 → **planner FOLLOWUP 회신**. planner가 대표 게이트(human_pending) 선행(autonomy §3.1 실환자 배제불가 PHI 변경).
- dev-foot 임의 fold/apply **금지**. 본 마이그(5건)에 row1 미포함 유지 — G0-hold 가드가 유입 시 ABORT.
- 02594dfa = §2-F 별건 HOLD 유지(본 트랙 무변경).
