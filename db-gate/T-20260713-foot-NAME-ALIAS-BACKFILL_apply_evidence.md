# T-20260713-foot-NAME-ALIAS-BACKFILL — APPLY evidence (AC-B5)

> **실 apply 완료.** 2026-07-14 (dev-foot). per-row 정정 UPDATE only, DDL 0, 원장 무접점.
> PHI 위생(§4): name=성 1자+길이, phone=tail4, 실명 원문 미기재. 확정 매핑/캡처 = off-git(gitignore).
> 게이트: AC-B3 human 게이트 CLOSED (박민지 TM팀장 U05L44C5P50 GO, ts 1783989287 / 07-13 23:49).

## 실행 전제 (모두 충족 ✅)
- **AC-B1** 양쪽 가드 prod-LIVE — bleed-stop 확정: EF `reservation-ingest-from-dopamine` v27(12:24) AND RPC-UPSERT-NAME-OVERWRITE-GUARD(APPLY-DONE 22:52, commit d1c52c7c). → 백필 후 재오염 위험 제거.
- **AC-B3** 현장 사람 GO 수신: 박민지 TM팀장 3건 확정 (ts 1783989287).
  1. tail4470(임○옥) → **본명복원 GO** → apply 대상(확정 1행).
  2. tail2932 → 외국인, 그대로 → **apply 제외**(미교정 확정, AC-B4 no-action 종결).
  3. tail0180 → 그대로 → **apply 제외**(동일).
- 확정 매핑 파일 `db-gate/..._confirmed.json`(1행, off-git PHI) 작성 완료.
- rollback capture 선행 완료(대상 1행, name=base64).

## apply 대상 = 확정 1행 (per-row, mass UPDATE 금지)
| id(8) | phone_tail | before | after | before_len→after_len | source | 판정근거 |
|---|---|---|---|---|---|---|
| ac65896b | 4470 | 별칭(ascii 2자) | 본명(한글 3자, 임○옥) | 2→3 | field(#4 현장 재입력) | 현장신고 본명 + 박민지 GO(ts 1783989287). freeze Tier-A 앵커. |

- 멱등 WHERE `name='Ok'` 매칭 성공 → APPLIED. (값 불일치 시 abort-safe skip 설계, 실 skip=0.)
- dry-run(PLAN 1) → `--apply`(applied=1 skipped=0 deferred=0).

## 트리거 캐스케이드 재검증 (AC-B5) — PASS
정정 후 read-back:
- `customers.ac65896b.name` = **임○옥**(3자) ✅ (before `Ok` 2자)
- 트리거 `fn_sync_customer_name` 재캐스케이드 → `reservations.7ceffb46.customer_name` = **임○옥** ✅ (before `Ok`) — 예약 1건 자동 정상화.
- `check_ins` = 0건(캐스케이드 대상 없음, freeze와 정합).
- 무손상 확인: `phone(tail4470)` / `lead_source=NULL` / `is_simulation=false` / `created_at(7/8)` 전부 불변. `reservations.source_system='dopamine'` / `status='confirmed'` / `customer_real_name=NULL` 불변. (`updated_at`만 정정시각으로 상승 = 정상.)

## apply 제외 2행 (AC-B4 no-action 종결) — 불변 확인
| id(8) | phone_tail | name | 처리 |
|---|---|---|---|
| 5bcf3bd9 | 2932 | 외국인 영문 실명(2-token) | **미교정 확정**(현장 "그대로") — UPDATE 0, 불변 확인 ✅ |
| 151fc672 | 0180 | 외국인 영문 실명(2-token) | **미교정 확정**(현장 "그대로") — UPDATE 0, 불변 확인 ✅ |

> 재입력 대기 아님 = no-action 종결(현장이 "별칭 아님/그대로" 확정). SOP §2-F under-correct 근거.

## rollback 번들 (AC-B5)
- `rollback/T-20260713-foot-NAME-ALIAS-BACKFILL_capture.csv`(off-git, name=base64) — apply 직전 대상 1행 현재값(`T2s=`=별칭) 캡처.
- rollback 절차: 캡처값을 `customers.name`으로 재-UPDATE(WHERE id=ac65896b) → 트리거 재캐스케이드로 reservations.customer_name 자동 원복. `scripts/..._apply.mjs` 역방향(current_alias↔real_name swap) 또는 수동 1행 UPDATE.

## 안전 요약
- DDL 0 / 데이터 UPDATE only(1행) / 하드삭제 0 / blanket UPDATE 0 / 원장 무접점.
- freeze 대상셋 외 무접촉(제외 2행 불변 확인). 별칭 로컬 데이터·기타 필드 무손상.
- PHI: 실명·JSON·CSV 미커밋(gitignore `*backfill*.json` / `*backfill*.csv` / `*dryrun*.json` 매칭 확인).

## 다음 단계
- supervisor QA (AC-B5): prod read-back 독립 재확인.
- deploy-ready 마킹(db_change=false, db_only e2e 면제 — 실행 evidence 첨부).
