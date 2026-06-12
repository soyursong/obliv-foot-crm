# DB 게이트 증거 — T-20260610-foot-RXSET-NAMEDESC-MODEL (처방세트 2필드 자동이관)

> dev-foot · 2026-06-12 · **supervisor 게이트 대기 · GO 전 파괴적 write 0.** risk: BLOCK(대량 19세트 JSONB write).

## Stage 0 — READ-ONLY 감사 (scripts/T-20260610-foot-RXSET-NAMEDESC_stage0_readonly.mjs)
- 총 19세트 · 전건 활성 · 전건 단약(item_cnt=1).
- 예외 전수 **0건**: 다약 0 / notes기입 0 / 멱등(item0.name==set.name) 0 / 빈name 0 / code_id연결 0.
- 감사 가설 확정: `set.name`=약이름+용량, `items[0].name`=분류. 19/19 일치.

## Stage 1 — DRY-RUN (BEGIN…ROLLBACK, write 0) (scripts/T-20260610-foot-RXSET-NAMEDESC_dryrun.mjs)
| 지표 | 값(기대) |
|---|---|
| target_rows | 19 (19) |
| UPDATE 영향행수 | 19 (19) |
| migrated_ok (item_name==set_name) | 19 (19) |
| mismatch | 0 (0) |
| empty_notes(AFTER) | 0 (0) |

AFTER 표본: id=12 `에스로반연고(무피로신)10g` → 항목명=약이름, 설명=`항생제 연고`, dosage `소량`·route `외용연고` 보존(숨김). **Bug A 실해소.** ROLLBACK 완료 — prod 무변경.

## supervisor 실행 순서 (불변)
1. `node scripts/T-20260610-foot-RXSET-NAMEDESC_dryrun.mjs` → 영향행수 19 확인.
2. 김주연 총괄(U0ATDB587PV)/대표 건수 제시·확인.
3. GO 후 `migration_packages/T-20260610-foot-RXSET-NAMEDESC-MODEL/datafix.sql` STEP0→STEP1.
4. STEP2 검증(migrated_ok=19). 이상 시 `rollback.sql`.
5. FE merge 동반(같은 배포창).
