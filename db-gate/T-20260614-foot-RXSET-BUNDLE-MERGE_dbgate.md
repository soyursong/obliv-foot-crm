# T-20260614-foot-RXSET-BUNDLE-MERGE — 옵션A DB게이트 핸드오프

작성: dev-foot · 2026-06-14 · repo: obliv-foot-crm
상태: **DB-GATE-PENDING — supervisor 데이터게이트 GO 대기** (마이그 패키지 작성·커밋 완료, prod apply 미실행)

---

## 0. 요청 요약 (현장확정 macro-A)
묶음처방(prescription_sets) 탭 **유지**, **단독약(items 1종) 세트만** 처방세트 **'약' 폴더**로 그룹핑.
다종 묶음세트는 대표원장 직접 생성. round4 결정 정합 → **CEO 게이트 불요**.

## 1. AC-1 선행 감사 결과 (READ-ONLY, scripts/T-20260614-foot-RXSET-BUNDLE-MERGE_ac1_audit.mjs)

| 지표 | 값 |
|------|----|
| total prescription_sets | **19** |
| 단독약 (items=1) | **19** |
| 다종 묶음 (items>1) | **0** |
| folder 분포 | **전부 NULL(미분류) 19건** |
| 옵션A UPDATE 대상 (single & folder≠'약') | **19** |
| 이미 folder='약' | 0 |
| quick_rx_buttons 참조 (단독약 세트) | 1건 (FK=prescription_set_id INT ON DELETE CASCADE) |
| NAMEDESC 적용 상태 | items[0].name≠name 19건 → **미적용 추정** |

→ **옵션A 적합 확정.** 19세트 전부 단독약 + folder NULL → folder='약' UPDATE 19건으로 100% 그룹핑.
posology 무손실·set id 불변·FK 보존·완전가역. 다종 0건이라 묶음처방 탭은 빈 상태로 잔존(AC-3 충족).

## 2. 마이그 패키지 (커밋됨)
- `supabase/migrations/20260614120000_rxset_bundle_drugfolder.sql` — 백업 + UPDATE(folder='약') + 검증 DO
- `supabase/migrations/20260614120000_rxset_bundle_drugfolder.rollback.sql` — 백업 folder 원복 + 검증
- `supabase/ops/rxset_bundle_dryrun_20260614.sql` — **READ-ONLY dry-run**(will_update 건수 대조 + 샘플 5 + 다종 + FK)

### 안전 속성
- **folder 컬럼만 UPDATE** (items·dosage·route·frequency·posology 무변경 → 무손실).
- WHERE = `jsonb_array_length(items)=1 AND folder IS DISTINCT FROM '약'` → **멱등**(재실행 no-op), **다종 무접촉**.
- set id 불변 → `quick_rx_buttons.prescription_set_id` FK 보존(AC-4). 옵션B(해체)였다면 CASCADE 삭제 위험.
- BEGIN/COMMIT 트랜잭션 + 백업테이블 + 검증 DO(잔존>0이면 RAISE EXCEPTION, fail-closed).
- 스키마 변경 없음(folder 컬럼은 20260603040000에서 기추가).

## 3. ⚠️ 순서 조율 — NAMEDESC-MODEL 충돌
- NAMEDESC(20260613120000, db-gate-pending)와 **같은 prescription_sets 테이블**.
- **컬럼 비중첩**: NAMEDESC=`items` 컬럼만, 본건=`folder` 컬럼만 → **데이터 충돌 없음**.
- 본건 WHERE는 items **내용 무관**(jsonb_array_length만 판정) → NAMEDESC 적용 전/후 모두 안전.
- 티켓 권고: **NAMEDESC 마이그 게이트 통과 후** 본건 apply 권장(같은 19 row UPDATE 순차화).

## 4. supervisor 데이터게이트 요청
1. `rxset_bundle_dryrun_20260614.sql` 실행 → **will_update=19, already=0, multi=0** 대조(GO 기준).
2. GO 시 dev-foot가 마이그 직접 apply(대시보드 수동 금지 — dev-foot DB 마이그 직접 실행 정책).
3. apply 후 검증: 단독약 세트 folder='약' 19건 + quick_rx 버튼 1건 정상 동작.
4. 이상 시 rollback.sql 즉시 실행(백업 folder 원복).

## 5. FE / E2E
- **FE 코드 변경 불필요** — PrescriptionSetsTab의 기존 folder 그룹핑(`grouped`)이 '약' 폴더 자동 표시.
- E2E: `tests/e2e/T-20260614-foot-RXSET-BUNDLE-MERGE.spec.ts` (9/9 통과) — 마이그 불변식 + FE 그룹핑 + QuickRxBar 회귀.
- 빌드 OK.

## 6. 결정 요청
- **supervisor**: dry-run 건수 대조(19) → GO/NO-GO. (CEO 게이트 불요, round4 정합)
- 옵션A 부적합 판명 시에만 옵션B(해체)로 전환 — 그 경우 마이그게이트 재경유(티켓 re-BLOCK). 단 AC-1상 옵션A 100% 적합이라 전환 불요.
