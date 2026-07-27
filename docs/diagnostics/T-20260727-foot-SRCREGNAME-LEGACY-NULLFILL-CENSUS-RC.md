# T-20260727-foot-SRCREGNAME-LEGACY-NULLFILL-DIAG-BACKFILL — census RC (read-only)

- 유형: DIAGNOSE-FIRST census (RO). dopamine RETRIAGE fold 신규 부상분.
- 처리: dev-foot, 2026-07-27. **write=0 (SELECT-only, 코드/DB 무변경).**
- script: `scripts/T-20260727-foot-SRCREGNAME-LEGACY-NULLFILL-DIAG_census.mjs`
- firewall 준수: §416 created_by write 없음 / §963⑥ display-provenance(표시 컬럼)만 관측. 백필 미실행(후속 게이트).
- 참고 RC: tm-flow `docs/diagnostics/T-20260727-REGISTRAR-GROUNDTRUTH-PERROW-VERIFY-RC.md` (314cd790, EMIT-INTACT 12/12).

## 결론 (한 줄)

**불요-CLOSED (NO-OP).** foot 는 backfill 대상 컬럼(`source_registrant_name`)이 애초에 **부재**하고,
실제 표시축(`reservations.registrar_name`)의 **dopamine-origin NULL 코호트 = 0건**.
3 대상상담사(김효신/진운선/이수빈)의 도파민 풋 예약 **526건 전부 마스터명으로 정상 표시**(NULL 0).
→ NULL-fill 백필 lane 은 대상이 없어 실행 불요. 신규 유입도 ingest resolve 로 이미 커버.

## [착수1] 코호트 규모·원인 census

| 항목 | 값 |
|---|---|
| foot `reservations.source_registrant_name` 컬럼 | **ABSENT** (`does not exist`) |
| foot `reservations.source_registrant` 컬럼 | **ABSENT** |
| foot registrar 표시축 실 컬럼 | `registrar_name` (PRESENT) + `registrar_id`(FK, PRESENT) |
| dopamine-origin 풋 예약 total | 537 (전부 clinic=jongno-foot) |
| ├ registrar_name **NULL/빈값** | **0** ← 본 lane 후보 = 없음 |
| ├ `[도파민TM] X` prefix 라벨 | 11 ← prefix-strip lane(별건) 대상 |
| └ 해소된 마스터명(정상표시) | 526 |

3 대상상담사 도파민 예약 표시 실측(전부 정상, NULL 0):
- 이수빈 187 / 진운선 170 / 김효신 169 = **526건 resolved**.

**원인(왜 NULL 코호트가 없나):** 김효신·진운선·이수빈은 foot `reservation_registrars`
TM seed(migration `20260610110000` §2, line 135–137)에 **이미 존재**한다. foot ingest EF
(`reservation-ingest-from-dopamine`)가 push 의 `reservation.registrar_name` 을 이 마스터
(clinic·group_name='TM'·active·name)로 조회 → 매칭 시 `registrar_id`(FK)+마스터명 스냅샷 착지.
세 상담사는 seed 매칭 → 항상 resolved 로 착지, NULL 로 남는 경로가 없음.

## [착수2] body RC(nested source_registrant top-level-only) 동형 여부

**NOT-CONFIRMED / foot 무해당(N/A).** body 의 NULL RC = 도파민이 nested `source_registrant`
객체로 운반한 것을 top-level 로만 파싱해 미착지. foot ingest 는 `reservation.registrar_name`
(top-level of reservation block)을 읽고 **마스터 resolve** 까지 수행하는데, dopamine emit 이
foot 으로는 이 키를 정상 운반 + 3 상담사가 마스터 seed 에 존재 → **foot 에는 NULL 코호트가
생성되지 않음.** body 의 nested-parse RC 는 foot 에서 관측되지 않으며 되돌릴 잔존분도 0.

## [착수3] prefix-strip lane 교집합/disjoint

**DISJOINT (교집합 0).** double-touch 구조적 불가.

| lane | 술어 | 건수 |
|---|---|---|
| 본 lane (NULL-fill) | `registrar_name IS NULL` (btrim='') | **0** |
| 별 lane (prefix-strip, 강솔희) | `registrar_name LIKE '[도파민TM]%'` | 11 |

두 술어는 상호배타(한 행은 NULL 이거나 non-NULL 라벨) → 동일 행 양 lane 동시 진입 불가.
※ prefix 라벨 실측 distinct: `[도파민TM] 박민지` 7 / `[도파민TM] 강솔희` 3 / `[도파민TM] 김수진` 1
  (= seed 미등재 상담사만 fallback 라벨. 강솔희는 11 중 3 — strip lane 은 라벨 전체를 커버).

## 게이트 상태

- **실 UPDATE 미실행.** census 결과 코호트=0 → 백필 자체 불요. DA CONSULT / Backfill SOP /
  사람 확인(박민지) 게이트는 대상 부재로 진입 불필요.
- code/DB 무변경 → deploy-ready 아님. planner FOLLOWUP 으로 census 결과(불요-closed) 반환.

## 미러 lane 참고

- body: T-20260727-body-SRCREGNAME-LEGACY-NULLFILL-BACKFILL (dosu 131, blocked) — body 는
  `source_registrant_name` 컬럼 실재 + NULL 잔존 가능 → 별개 판정(dev-body 소관).
- foot 은 컬럼·코호트 모두 부재라 미러 아님(구조 상이).
