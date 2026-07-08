---
id: T-20260708-dopamine-FOOTRESV-NAILPROB-SUBFILTER-PUSH
domain: foot
priority: P1
status: deploy-ready
qa_result: pending
deploy_commit: b9d0b041
deployed_at: 2026-07-08 (DB 18-arg RPC 적용 완료 + ingest EF deploy(--use-api) 완료[2회: RPC경로+duplicate분기 브리핑노트 보강] — supervisor DDL-diff 게이트 대기. 커밋체인 410a9762 RPC+EF+spec / 7a9c56d5 ticket+signals / b9d0b041 duplicate분기 brief_note 보강+S4)
bundle_hash: n/a (DB RPC + Edge Function 변경 — FE 번들 무변경)
db_change: true
summary: "문제성발톱 간략메모(brief_note) 도파민→풋 수신부 배선 — 4번 미반영 해소. 도파민 CTI 측(발톱무좀/내성발톱 선택 UI + push payload reservation.brief_note 동봉)은 배포 완료(commit 66d661d, 3번 정상)였으나 풋CRM 수신부(ingest EF + upsert RPC)가 brief_note 미read → 풋 예약상세 팝업>간략메모(reservations.brief_note read SoT) 공란(박민지 팀장 현장 확인). 해소: (1) upsert_reservation_from_source RPC 에 p_brief_note TEXT DEFAULT NULL 을 末尾(18th) append — PG 함수 식별자=(name,arg types)이므로 17-arg 명시 DROP → 18-arg CREATE(오버로드 충돌 차단, 190000/rpc17 선례 동일). INSERT VALUES brief_note=NULLIF(btrim(p_brief_note),''); ON CONFLICT DO UPDATE brief_note=COALESCE(NULLIF(btrim(p_brief_note),''), reservations.brief_note)(빈값 재push=보존 no-op, non-empty=갱신). 취소 fast-path·lifecycle 가드#5·timeline(rmh) upsert·나머지 컬럼 upsert 全 불변(strict superset of 20260701020000). (2) ingest EF: reservation.brief_note 추출 → ★신규 INSERT 경로 rsvPayload.brief_note(첫 push 실 write-path) + edit/reschedule RPC p_brief_note 양쪽 배선. 빈값/미동봉→미삽입 NULL(회귀 0). reservations.brief_note=旣존 컬럼(20260624100000 TEXT NULL) → 스키마 무변경 ADDITIVE. 예약메모(rmh timeline)와 직교 독립 축. 게이트=DA GO+ADDITIVE(MSG-tjrg)·대표게이트 면제(autonomy §3.1)·supervisor DDL-diff only. 검증: build OK. DRYRUN(BEGIN…ROLLBACK) green → APPLY, 18-arg 단일 signature+INSERT/ON CONFLICT wiring DB 확인. functest 3/3 green(신규 발톱무좀 착지 / 빈값 재push COALESCE 보존 / 편집 내성발톱 갱신). E2E spec GREEN-or-SKIP(DOPAMINE_CALLBACK_SECRET 미주입 로컬=skip, supervisor 환경 실행)."
created: 2026-07-08
assignee: dev-foot
owner: agent-fdd-dev-foot
e2e_spec: tests/e2e/T-20260708-dopamine-FOOTRESV-NAILPROB-SUBFILTER-PUSH.spec.ts
migration: supabase/migrations/20260708150000_foot_ingest_brief_note_wiring.sql
rollback_sql: supabase/migrations/20260708150000_foot_ingest_brief_note_wiring.rollback.sql
apply_script: scripts/apply_20260708150000_foot_ingest_brief_note_wiring.mjs
functest_script: scripts/functest_20260708150000_brief_note.mjs
edge_function: supabase/functions/reservation-ingest-from-dopamine/index.ts
slack_thread_ts: "1783487360.593369"
slack_channel: C0ATH4JF3E1
reporter_slack_id: U05L44C5P50
da_gate: "GO+ADDITIVE (MSG-tjrg)"
---

# T-20260708 FOOTRESV-NAILPROB-SUBFILTER-PUSH — 문제성발톱 간략메모 배선

## 배경 (responder PUSH, 박민지 팀장 현장 확인)

- 도파민 CTI 측: 문제성발톱 선택 UI + push payload `reservation.brief_note` 동봉 → 배포 완료(commit 66d661d).
- 3번(도파민 CTI 버튼 표시) = 정상.
- 4번(풋CRM 예약상세 간략메모 반영) = **미반영** → 본 티켓으로 해소.

## AC

1. `upsert_reservation_from_source` RPC 에 `p_brief_note TEXT DEFAULT NULL` 末尾(18th) 배선.
2. INSERT: `brief_note = NULLIF(btrim(p_brief_note),'')`.
3. ON CONFLICT DO UPDATE: `brief_note = COALESCE(NULLIF(btrim(p_brief_note),''), reservations.brief_note)`.
4. ingest EF(수신부): `reservation.brief_note` → 신규 INSERT rsvPayload + edit RPC `p_brief_note` 양쪽 배선.

## 검증

- build OK.
- DRYRUN(BEGIN…ROLLBACK) green → APPLY(Status 201). 18-arg 단일 signature 확인(17-arg 잔존 0), INSERT/ON CONFLICT wiring true.
- ingest EF deploy(`--use-api`) 완료.
- functest 3/3 green: 신규 착지(발톱무좀) / 빈값 재push COALESCE 보존 / 편집 갱신(내성발톱). (테스트 데이터 cleanup 포함)
- E2E spec: `tests/e2e/T-20260708-...spec.ts` — GREEN-or-SKIP(DOPAMINE_CALLBACK_SECRET 미주입 로컬=skip).

## 게이트

- DA GO+ADDITIVE (MSG-tjrg) — 스키마 무변경(brief_note 컬럼 20260624100000 旣존).
- 대표게이트 면제 (autonomy §3.1 ADDITIVE+DA GO).
- supervisor = DDL-diff only.
