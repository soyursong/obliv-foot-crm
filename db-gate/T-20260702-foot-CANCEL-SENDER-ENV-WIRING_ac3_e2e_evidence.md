# T-20260702-foot-CANCEL-SENDER-ENV-WIRING — AC3 e2e (자동 sender 경로) 증거

- 실행: 2026-08-03 05:04 UTC · dev-foot · macstudio
- 대상 canary 예약: `2fb4885d-7a96-4881-8859-c0645724ea75` (is_simulation=TRUE, sentinel MSISDN +821012345678)
- external_id(cue_card): `e2e0a3c3-0000-4000-8000-00000000c301` (c301) · source_system=dopamine
- 경로: 정상 취소 동선(PATCH status=cancelled) → foot sender EF `dopamine-callback`(type=cancelled) 호출.
  receiver-direct(dopamine crm-cancel-callback 직접호출) **미사용** — foot sender EF 만 호출.
- 인증: FE fire-and-forget invoke 미러. 임시 QA auth 유저(service-role admin 생성) 로그인 → user JWT → 사후 삭제.
- 멱등: 실행 전 선행 sent/pending 0건 확인 · 1회만 실행.

## 결과 (NOT ALL PASS — 스키마 블로커)

| AC | 판정 | 캡처 |
|----|------|------|
| **AC1** outbound_log sent+2xx | **FAIL** | `dopamine_outbound_log` INSERT 자체가 실패 → 행 0건 (log 미기록) |
| **AC2** sender resp 2xx (not 401) | **FAIL** (500) | 인증은 통과(401 아님) — 그러나 EF 내부 500 |
| **AC3** resp applied:true | **FAIL** | applied 없음 |

### sender EF 원문 응답 (AC2/AC3)
```
HTTP 500
{"ok":false,"error":"INTERNAL","detail":"outbound_log insert failed: new row for relation \"dopamine_outbound_log\" violates check constraint \"dopamine_outbound_log_callback_type_check\""}
```

### dopamine_outbound_log (AC1)
```
[]   -- event_id=2fb4885d, callback_type=cancelled → 0 rows (INSERT 23514 로 롤백)
```

## Root Cause (env·인증 아님 — DB 스키마 갭)

- 원본 `20260520000040_dopamine_integration_schema.sql:74`:
  `callback_type text NOT NULL CHECK (callback_type IN ('visited', 'paid'))`
- `T-20260527-dopamine-RESV-CANCEL-SYNC` 로 sender EF 에 `'cancelled'` 경로가 추가됐으나
  물리 CHECK 제약이 미갱신 → INSERT(callback_type='cancelled') 시 23514 위반.
- **인증/env 는 정상**: AC2 가 401 이 아니라 500 = JWT 인증·라우팅 통과, DOPAMINE_CANCEL_URL 도달 이전
  outbound_log INSERT 단계에서 제약 위반으로 실패. 즉 secret digest 대칭·양측 코드계약 clean 은 유효,
  결함은 **CHECK 제약 1건**에 국한.

## 판단 정리 (supervisor 회신용)

- AC1 미충족 사유 = **DOPAMINE_CANCEL_URL_NOT_SET / env 미활성 아님**. 순수 스키마 CHECK 갭.
- 결함 범위: `dopamine_outbound_log_callback_type_check` 만. 코드 변경 불필요(EF 는 이미 'cancelled' 처리).
- 수정: 준비된 forward 마이그레이션(ADDITIVE) — 허용값 3종({visited,paid,cancelled})으로 확장.
  코드 전수확인상 outbound_log 에 들어오는 callback_type 은 이 3종뿐(reschedule 은 별도 테이블).
- **적용 보류 사유**: 운영 DB 스키마 변경 = supervisor 사전승인 필수(dev-foot 금지사항). e2e 만 사전승인됨.
  → supervisor GO 후 적용 + AC3 e2e 재구동.
- DA note: 'cancelled' 는 cross_crm_data_contract §6 canonical 값 → 신규 enum 도입이 아니라
  물리 제약을 이미 계약된 값에 맞추는 reconciliation(ADDITIVE). DA CONSULT 필요여부는 supervisor 판단.

## canary 상태
- 검증 후 **원복 완료**: status='confirmed', cancelled_at=NULL (재구동 대비 clean).

## 재현/재구동 스크립트
- `scripts/T-20260702-foot-CANCEL-SENDER-ENV-WIRING_ac3_e2e_sender.mjs` (멱등 보호 내장, 1회)
- 준비 마이그레이션: `supabase/migrations/20260803120000_dopamine_outbound_log_cancelled_callbacktype.sql` (+ .down)
