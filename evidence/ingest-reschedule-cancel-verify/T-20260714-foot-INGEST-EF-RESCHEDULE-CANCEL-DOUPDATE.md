# T-20260714-foot-INGEST-EF-RESCHEDULE-CANCEL-DOUPDATE — 검증 evidence (판정근거 스냅샷)

- 작성: dev-foot / 2026-07-14 (KST ~12:xx)
- 부모: T-20260629-dopamine-FOOTCAL-DIRECT-WRITE / STATS-RESVCOUNT-FOOTCRM-DESYNC (수신측 fix lane)
- 결론: **원천 fix 는 이미 배포·런타임 실증 완료. 신규 코드 변경 불필요.** AC-0 수동반영 불요(이미 동기 상태). AC-4 백필은 도파민 emit-side 리스트 필요(단독 열거 불가).

## 1. RC 재확인 (AC-1) — 이미 해소·배포됨

- ingest EF `reservation-ingest-from-dopamine`: 기존 external_id 재도착 시 **무조건 duplicate 단락하던 경로는 이미 제거됨**.
  - commit `5a944b08` (2026-07-07 16:35) — EDIT/CANCEL → RPC 라우팅 (duplicate 단락 대체)
  - commit `df59287a` (2026-07-07 18:16) — CANCEL 시 existing-row date 를 RPC 로 (malformed scheduled_at 500 방지)
  - commit `395e3841` (2026-07-13 12:18) — name-overwrite-guard
- **배포 실증**: deployed EF version=27, updated_at=**2026-07-13 12:38 KST**.
  `supabase functions download` 결과가 git HEAD 와 **byte-identical** (IDENTICAL 확인). → 위 3개 commit 전부 라이브.
- 현재 EF 로직: `existing` 발견 시 (a) status='cancelled' → cancel fast-path, (b) date/time 변경 → reschedule,
  둘 다 아님(순수 동일 payload) → 멱등 duplicate no-op. **duplicate 단락은 순수 재push 에만 적용**(정상 멱등).

## 2. RPC `upsert_reservation_from_source` (18-arg, prod live body) — DO UPDATE 정상

- prod `pg_get_functiondef` 확인: cancel fast-path + active-reschedule `ON CONFLICT ... DO UPDATE`(date/time/status 갱신)
  + 가드#5 lifecycle(checked_in/done/no_show → P0001 reject) + name never-downgrade 가드 모두 존재.
- 적용 마이그: 20260713150000 (name guard) applied 확인.

## 3. 런타임 실증 (controlled live test, 합성 external_id, 사후 삭제)

`external_id=VERIFY-DOUPDATE-20260714-fdd` / phone `+821099990007` (합성, 정리 완료 leftover=0):

| step | 입력 | 결과 | 판정 |
|------|------|------|------|
| INSERT | date 2026-08-01 confirmed | rid=475c52d6…, 2026-08-01/14:00/confirmed | ✓ |
| RESCHEDULE | 동일 external_id, date 2026-08-15 09:30 | **동일 rid, 2026-08-15/09:30/confirmed** (중복삽입 아님) | ✓ DO UPDATE |
| CANCEL | status=cancelled | **동일 rid, status=cancelled** | ✓ cancel |
| 가드#5 | checked_in 강제 후 cancel | **P0001 LIFECYCLE_INVALID reject** | ✓ 의도된 거부 |

AC-3 name-guard 공존 (`external_id=VERIFY-NAMEGUARD-20260714-fdd`, 정리완료):
- 기존 고객명 '김진짜' → 도파민 alias 'ok' push(insert) → customers.name='김진짜' 유지, reservations.customer_real_name='ok'.
- RESCHEDULE(alias 'ok', date 2026-09-10) → customers.name **여전히 '김진짜'**, reservation_date=2026-09-10 갱신.
- ⇒ DO UPDATE 는 예약 mutable 필드만 갱신, 고객 이름 미덮어씀. **name bleed 0. 공존 확인.**

## 4. 프로덕션 데이터 실증 (자연 트래픽)

- 오늘(7/14) dopamine-sourced 예약 중 **cancelled 11건 + no_show 4건 + checked_in 다수** 존재.
  cancel/reschedule 가 NO-OP 였다면 dopamine 행에 'cancelled' 상태가 절대 나올 수 없음 → **cancel 경로 실작동 증명**.

## 5. 3 케이스 (전진우·김효신·이미현)

- **이미현**(01041362933 → +821041362933): 7/14 10:30 예약 **존재·checked_in**(external_id a0d7bad0…, source=dopamine, created 7/13 16:06).
  → **AC-0 수동반영 불요**. 오늘 내원분 데스크 노출됨(checked_in). 수동 insert 시 external_id 중복/충돌 유발(AC-0 경고 위반)이므로 **미수행**.
- **전진우**(+821088830842): 7/15 18:30 confirmed. 미래건, 상태 정상. (도파민 현재상태와 최종 대사는 emit-side 크로스체크 대상.)
- **김효신**: reservations 고객행 **없음**. reservation_registrars(TM, active) **등록자(상담원)** — 환자 아님. (이미현 예약의 registrar_name='김효신'.)

## 6. AC-4 백필 — foot 단독 열거 불가 (도파민 emit-side 필요)

- dopamine-sourced 예약 status 분포: confirmed 171 / cancelled 11 / checked_in 5 / no_show 4. 날짜 스팬 2026-07-05~08-01.
- **과거-stale confirmed(date<today, 미 checked_in/cancelled) = 0건** → 과거 누적 dropped-cancel 백로그 없음.
- 잔여 desync 가능성 = 미래건에서 도파민이 fix 배포(≤7/13 12:38) 이전에 발신한 reschedule/cancel 가 단락된 경우.
  이는 foot 상태만으로 판별 불가 → **도파민 outbox(foot-bound external_id + 현재 date/status) 리스트로 교집합 대사** 필요.
  Cross-CRM Data-Correction SOP 준수: 단일 count UPDATE 금지 · 지문 교집합 · 대상셋 freeze · 판정근거 스냅샷 · 원장 무접점.
  → planner/dev-dopamine 크로스체크 FOLLOWUP.
