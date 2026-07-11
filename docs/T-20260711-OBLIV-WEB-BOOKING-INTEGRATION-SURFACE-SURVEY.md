# 오블리브(웹) 예약 → 풋CRM 연동 표면 조사 메모

- 티켓: T-20260711-foot-OBLIV-WEB-BOOKING-INTEGRATION-SURFACE-SURVEY
- 유형: INVESTIGATION-READONLY (코드/DB/UI 변경 0)
- 문의자: 오블리브 에이전트 '월E' (U0BAB7TCU4A)
- 성격: "표면(API/RPC/문서)이 있다/없다"만 확인하는 read-only 가늠. 개발 요청 아님.
- 근거: obliv-foot-crm 코드베이스 (Edge Functions / migrations / src). 키/시크릿 **값**은 미기재(방식만).

---

## 결론 요약 (월E용)

현재 풋CRM의 예약 연동 표면은 **전부 "도파민 TM 채널" 전용**으로 설계돼 있음(공유시크릿 게이트).
- 웹(홈페이지) 유입 예약을 **직접 받는 공개 anon 엔드포인트는 없음**.
- **센터·날짜별 '가용 슬롯(빈자리)' 조회 표면도 없음** (기존 건 "이미 잡힌 예약 밀도" 집계일 뿐).
- 예약 status 모델(대기/확정)과, 상태를 외부가 받는 경로(read API 폴링 + 라이프사이클 push 콜백)는 **있음**.

→ 웹 연동을 실제로 하려면 (a) 웹→풋 **예약생성 표면 신규**(기존 도파민 ingest 패턴 재사용 가능), (b) **가용슬롯 조회 표면 신규** 2가지가 필요. 인증은 기존처럼 공유시크릿 헤더 방식이 표준.

---

## 문항별 사실확인

### Q1. 외부(웹)에서 예약을 생성하는 공개 API/RPC가 있는가?
**부분적으로 있음 — 단 도파민 전용, 공개 anon 아님.**
- 위치: `supabase/functions/reservation-ingest-from-dopamine/index.ts`
- 성격: 도파민 TM이 예약 확정 후 풋으로 push하는 **Forward 수신부**(Edge Function). `POST`.
- 시그니처: body `{ source_system:'dopamine', external_id, clinic_slug, customer{phone_e164,name,...}, reservation{scheduled_at, slot_type, service_code, memo,...} }` → 200 `{ ok, reservation_id, applied }`.
- 특징: `clinic_slug`→`clinics.id` DB 조회, `UNIQUE(source_system, external_id)` 멱등(중복 시 기존 id 반환).
- **웹(홈페이지) 유입용 공개 예약생성 엔드포인트는 없음.** 셀프등록/셀프체크인(`FOREIGN-SELFREG`, foot-checkin.pages.dev)은 **원내 키오스크 접수**이지 웹 예약 표면이 아님.

### Q2. 센터·날짜별 가용 슬롯 조회 표면이 있는가? (근무스케줄 기반 availability)
**없음.**
- `src/components/ReservationDayTimeslotPanel.tsx` + `src/lib/resvSlotAgg.ts`는 **이미 잡힌 예약의 30분 단위 시간대별 밀도**(초진/재진/힐러 카운트) 집계일 뿐, "빈 슬롯/예약가능 여부"를 계산·노출하지 않음.
- 근무스케줄은 `supabase/functions/duty-sheet-read`(구글시트 gviz CSV 프록시)로 read 가능하나, 이는 근무자 명단 read일 뿐 **예약 가용량 계산과 연결돼 있지 않음**.
- 외부(웹)가 호출할 수 있는 availability API/RPC는 **존재하지 않음** → 연동 시 신규 구축 필요.

### Q3. 예약 status(대기/확정) 모델 + 외부에서 확정 여부를 받을 방법?
**status 모델 있음 + 수신 경로 있음(폴링 + push 콜백).**
- status 값(migrations CHECK): `reservations.status IN ('confirmed','reserved','checked_in','cancelled','done','noshow','no_show')` — 대기(`reserved`)/확정(`confirmed`) 구분 존재.
- 외부가 상태를 받는 경로:
  - **폴링(Read API)**: `reservations-read-api`(external_id/phone/status/date 조회, PII 마스킹), `foot-calendar-read`(direct/walk-in 예약 read).
  - **Push 콜백(webhook, 풋→도파민)**: `dopamine-callback` / `dopamine-callback-dispatch`(outbox 패턴) — `visited`/`paid`/`cancelled` 라이프사이클 이벤트를 수신처 EF로 push, DLQ·재시도(백오프 7회)·멱등 UNIQUE 보장.
  - ⚠ 단 현재 push 수신처는 **도파민 EF로 하드와이어**(계약). 임의 외부 webhook URL 등록 기능은 없음 → 웹 측이 받으려면 read API 폴링이 현실적, 또는 수신처 확장 필요.

### Q4. 위 표면들의 인증 방식은?
**커스텀 공유시크릿 헤더 방식이 표준(값 자체는 비공개).** CORS `Access-Control-Allow-Origin: '*'`.
| 표면 | 인증 헤더/방식 |
|------|----------------|
| reservation-ingest-from-dopamine (write) | `X-Callback-Secret` (공유시크릿) |
| reservations-read-api (read) | `X-ReadAPI-Secret` (write 시크릿과 분리) |
| foot-calendar-read (read) | `X-Foot-Read-Secret` (write 시크릿과 물리 분리) |
| dopamine-callback (풋→외부 push) | Supabase Bearer JWT |
| duty-sheet-read | Supabase `verify_jwt`(anon/user JWT) + gid 화이트리스트 |
- DB 접근은 내부적으로 service role. 외부 노출 표면은 anon key 직결이 아니라 **EF 앞단 공유시크릿 게이트**로 통제.

### Q5. 관련 스펙/문서 위치
- `~/claude-sync/memory/_handoff/spec_foot_dopamine_integration_20260520.md` — 도파민↔풋 연동 스펙(§3 ingest, §5 read, §6 body, §7). 위 EF들의 근거 문서.
- `agents/docs/cross_crm_data_contract.md` — reservations 표준·`source_system`·도파민 push RPC 계약.
- `agents/docs/_draft/dopamine_callback_receive_pattern.md` — 콜백 수신 패턴 / outbox·DLQ 표준.
- `~/claude-sync/memory/_handoff/tickets/T-20260702-foot-FOREIGN-SELFREG-FLOW-CONSENT-SPEC.md` — 외국인 셀프접수(원내 키오스크, 웹 예약 아님).
- 레포 내: `docs/ENV-MATRIX.md`.

---

## 민감정보 주의
외부(월E)에 전달되는 답변에는 **시크릿/키 값 자체를 담지 않음** — 인증 "방식"(헤더명·공유시크릿 사용 여부)만 기술.
