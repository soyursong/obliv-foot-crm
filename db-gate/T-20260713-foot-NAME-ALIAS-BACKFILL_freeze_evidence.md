# T-20260713-foot-NAME-ALIAS-BACKFILL — FREEZE dry-run 스냅샷 (AC-B2)

> **READ-ONLY prod 스캔.** UPDATE/DELETE/INSERT = 0. (`scripts/T-20260713-foot-NAME-ALIAS-BACKFILL_freeze_dryrun.mjs` + `_tierA_enrich.mjs`)
> 실행: 2026-07-13 (dev-foot). PHI 위생(§4): name=성 1자+길이/ascii원문, phone=tail4, rollback name=base64.
> ★ 실 apply 는 **AC-B3 현장(박민지 TM팀장) 사람 GO** 수신 후에만. 본 문서 = freeze 스냅샷 전용.

## 선결 조건 (AC-B1) — 충족 ✅
- ① EF `reservation-ingest-from-dopamine` INGEST-NAME-OVERWRITE-GUARD: prod-LIVE v27 (12:24).
- ② RPC-UPSERT-NAME-OVERWRITE-GUARD: prod-LIVE (APPLY-DONE 22:52, commit d1c52c7c).
- ⇒ 양쪽 가드 LIVE = bleed-stop 확정 → **백필 재오염 위험 제거**.

## freeze 술어 (SOP §2, lead_source 금지)
`reservations.source_system='dopamine'` (+ `customer_id` 조인) **AND** `customers.updated_at ≥ 2026-07-08(KST)`.
- ⚠ **lead_source 미사용** — 앵커(임○옥 ****4470)는 `lead_source=NULL`(AC-F4 인계). source_system 기준이라 앵커 포함됨. ✅

## 모집단 실측
| 단계 | 값 |
|---|---|
| 도파민 예약(source_system='dopamine') | 166건 |
| distinct 도파민-링크 customer | 161명 |
| freeze 후보(updated_at ≥ 7/8) | **160명** |
| ─ **기존고객 소급 overwrite**(created<7/8 & updated≥7/8) | **0명** ← bulk=NO 재확정 |
| ─ HANGUL 정상형 name(len 2~7) | 157명 (foot 자가 별칭판별 불가) |
| ─ **비-한글(ascii) name** = 별칭 강의심 지문 | **3명** ↓ |

**핵심**: 기존고객 소급 mass-overwrite = **0건**. 오염은 전부 7/8 이후 **신규 mint**(created=updated)에 국한 → forensic bulk=NO 결론과 정합. '다 바뀜' 체감의 실제 원인은 트리거 `fn_sync_customer_name` 캐스케이드(1인 정정 시 그 고객 全 예약/체크인 name 소급 전파).

## Tier-A: ascii-지문 3행 (freeze 대상 shortlist + per-row 판정)
| id(8) | 현재 name | phone_tail | visit | created=updated | 예약일 | 판정 | 복원출처 |
|---|---|---|---|---|---|---|---|
| **ac65896b** | `Ok` (2자, 별칭) | **4470** | new | 7/8 03:01 | 2026-07-21 | **★별칭 확정** (현장신고 본명=임○옥) | #4 현장(슬랙 thread에 본명 기존) |
| 5bcf3bd9 | `<영문 2-token, 13자>` | 2932 | new | 7/8 02:12 | 2026-07-18 | ⚠ **외국인 실명 가능성** — 별칭 아님 추정 | 현장 확인 필요(오검출 방지) |
| 151fc672 | `<영문 2-token, 13자>` | 0180 | new | 7/10 03:40 | 2026-07-15 | ⚠ **외국인/영문 실명 가능성** — 별칭 아님 추정 | 현장 확인 필요(오검출 방지) |

> ascii 원문(별칭 판별용)은 git-tracked 문서에 미기재(PHI). responder→현장 relay 시 phone tail + 예약일 키로 현장이 자기 화면에서 대조. 로컬 스냅샷: `_freeze_dryrun.json`(미커밋), `rollback/..._capture.csv`(name=base64, 미커밋).

- 3행 모두 `is_simulation=false`, `customer_real_name=null`(복원소스 #2 없음), `lead_source=NULL`, 캐스케이드=예약 1건·체크인 0건.
- **앵커(****4470) freeze 포함 ✅** — AC-F4 정합.

## ⛔ foot 자가판별 한계 (planner 게이트 필요)
1. **복원소스 #1(cross-CRM phone-match) = UNRESOLVED.** foot 서비스키로 타 CRM(롱레/derm/body) DB 접근 불가(각 프로젝트 service_role 키 부재). 자동 복원 불가 → 현재 복원경로 = **#4 현장 재입력**(+ 필요 시 dev-dopamine cue_cards #3).
2. **HANGUL형 별칭 = foot 탐지 불가.** 별칭이 한글이면(예: 성씨만/닉네임) 정상 한글명과 구분 불가(forensic §2 "정상 성씨로 보여 자가확정 불가"와 동일). 157명 전수 현장제시는 비현실적 → 현장이 '이름 틀린 예약'을 역으로 지목하는 방식 권장.
3. **ascii 오검출 위험.** Tier-A 3행 중 2행(Diksan Mahesh/KyoungLan Son)은 **외국인 실명일 개연성** — 무분별 복원 시 오검출(mis-correction). SOP §2-F: **under-correct ≫ mis-correction** → 현장 per-row 확인 필수.

## 권고 apply 범위 (현장 GO 대기)
- **확정 1건**: `ac65896b` `Ok` → `임○옥`(현장/슬랙 기확보). GO 시 즉시 복원 가능.
- **확인 2건**: `Diksan Mahesh`/`KyoungLan Son` → 현장에 "영문 실명 맞는지 / 별칭인지" 확인 후 결정.
- **추가건**: 현장이 아는 '이름 틀림' 예약 있으면 phone tail 로 지목 → per-row 편입.
- 복원 불가/미확정 = **폐기·추측 금지, 현장 재입력 대기 분리 기록**(AC-B4).

## rollback 번들 (AC-B5)
- `rollback/T-20260713-foot-NAME-ALIAS-BACKFILL_capture.csv` — 대상 3행 현재값(name=base64) 캡처 완료.
- apply = `scripts/..._apply.mjs`(per-row, 멱등 WHERE name=별칭, mass UPDATE 금지). rollback = 캡처값 재-UPDATE → 트리거 재캐스케이드로 예약/체크인 자동 원복.
- 원장 무접점(DDL 0, 데이터 UPDATE only). supervisor QA.

## 다음 단계
1. dev-foot → planner/responder 통보(본 스냅샷). ✅
2. responder → 박민지 TM팀장(U05L44C5P50) relay: 위 3행 per-row 확인 + 현장 인지 오염건 수집 → **사람 GO**.
3. GO 수신 → 확정 매핑 `db-gate/..._confirmed.json` 작성 → `apply.mjs --apply` per-row 실행 → supervisor QA.
