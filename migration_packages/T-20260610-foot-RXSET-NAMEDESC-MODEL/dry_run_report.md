# 처방세트 2필드 모델 자동이관 — T-20260610-foot-RXSET-NAMEDESC-MODEL

> 산출: dev-foot · 2026-06-12 · **supervisor DB 게이트 대기. 건수 확인·GO 전 무변경(파괴적 write 0).**
> DECISION LOCK 완료(dl53 Q1/Q2/Q3) · Q3 = A-1 자동이관 · 동반 해소: Bug A(RXSET-DRUGNAME-DISPLAY)
> risk_verdict: **BLOCK** — 대량데이터(19세트 JSONB 재구조) write. dev-foot 자동 실행 금지.

## TL;DR (supervisor DB 게이트 요청)
- 기존 19세트가 `set.name` 에 **약이름+용량**을, `items[0].name` 에 **분류**를 담은 비표준 구조(Stage0 감사 확정).
- 자동이관: `items[0].name := set.name`(약이름) · `items[0].notes := 기존 items[0].name`(분류 → 설명). 데이터손실0.
- **dry-run(TX BEGIN…ROLLBACK) 영향행수 = 19 / migrated_ok 19 / mismatch 0** — 아래 §검증 표.
- dosage·route·frequency·count·days 보존(미변경, FE 숨김). set.name·is_active·folder·sort_order 미변경.

## ⚠️ supervisor 실행 순서 (불변)
1. **DRY-RUN 단독 실행**(write 0, TX ROLLBACK):
   ```bash
   node scripts/T-20260610-foot-RXSET-NAMEDESC_dryrun.mjs
   ```
   → `UPDATE 영향행수 = ___`(기대 **19**) 를 **김주연 총괄(U0ATDB587PV)/대표에게 제시**.
2. 건수 확인 수신 후에만 `datafix.sql` STEP0(백업) → STEP1(BEGIN/UPDATE/COMMIT) 실행.
   - psql UPDATE 출력이 **19** 가 아니면 즉시 ROLLBACK 후 dev-foot 호출(예외 재검).
3. 실행 후 `datafix.sql` STEP2 검증(주석) 실행 — migrated_ok=19 / single=19 확인.

> **건수 확인 전 UPDATE 절대 금지.** 본 패키지는 BLOCK(대량 write)이라 dev-foot 권한 보유하나 미실행·핸드오프.

## Stage 0 감사 결과 (READ-ONLY, 안전성 검증)
`scripts/T-20260610-foot-RXSET-NAMEDESC_stage0_readonly.mjs` 실행 결과 — 자동이관 룰이 손실0으로 안전 변환됨을 보증하는 예외 전수:

| 예외 축 | 결과 | 함의 |
|---|---|---|
| 총 세트 | **19** (전건 활성, 전건 단약 item_cnt=1) | 균질 |
| [예외A] 다약(item>1) 세트 | **0건** | set.name 1개→첫 item 매핑 모호 없음 |
| [예외B] items[0].notes 기입됨 | **0건** | 설명칸 덮어쓰기 충돌 없음(가드 불발동 전제 안전) |
| [멱등] item0.name == set.name | **0건** | 전건 미이관 = 전건 변환 대상 |
| item0.name 빈값/NULL | **0건** | 옮길 분류값 전건 존재 |
| prescription_code_id 연결 | **0/19 (전건 NULL)** | 마스터 link 보존 이슈 없음 |

→ **예외 0. 19/19 안전.** 감사 가설(set.name=약이름·item.name=분류) 19행 전부 일치.

## 검증 (dry-run TX ROLLBACK 실측)
`scripts/T-20260610-foot-RXSET-NAMEDESC_dryrun.mjs`:

| 지표 | 값 | 기대 |
|---|---|---|
| 변환 대상(target_rows) | **19** | 19 |
| UPDATE 영향행수 | **19** | 19 |
| migrated_ok (item_name==set_name) | **19** | 19 |
| mismatch | **0** | 0 |
| empty_notes (AFTER) | **0** | 0 |

표본(AFTER): id=12 `에스로반연고(무피로신)10g` → 항목명=`에스로반연고(무피로신)10g`(분류/route 아님), 설명=`항생제 연고`, dosage `소량` 보존, route `외용연고` 보존(숨김). **Bug A(RXSET-DRUGNAME-DISPLAY) 실해소 확인.**

## 멱등·롤백 가드
- **멱등**: 재실행 시 `items->0->>'name' IS DISTINCT FROM name` = false → 0행. notes 충돌 가드(`notes=''`)로 분류 이중덮어쓰기 방지.
- **롤백**: STEP0 백업 `_datafix_bk_T20260610_rxset_namedesc`(id+name+items+updated_at 스냅샷) + `rollback.sql`(items/updated_at 원복, 변경행만, 백업없으면 중단).

## FE 병행 (본 PR 동봉, 마이그와 함께 배포)
- **세트 등록 화면**(PrescriptionSetsTab ItemRow): [이름+용량]/[설명] **2칸만**. route·용법·횟수·일수·용량 입력칸 제거(값 보존·숨김, onChange spread 유지). 마스터 선택 시 route/classification 자동채움 유지.
- **세트관리 카드 미리보기**: [이름+용량] + [설명(notes)] 만 노출(메타 제거) — Q2 설명 노출 허용 surface.
- **용법 토큰 입력(#2)**: 묶음·빠른처방 **불러올 때** 용법|횟수|일수 인라인 편집 = MedicalChartPanel 기존 편집표(L2920~) 그대로 충족(비우면 빈칸). **무회귀 공존**(RX-TOKEN-FORMAT `{이름+용량} {1/3/2} *`). MedicalChartPanel 미변경.
- **설명 노출 게이트(#3/Q2)**: 공식문서(처방전 PaymentMiniWindow=약명+용량만 / 차트 타임라인 MedicalChartPanel L2677,2698=약명+용량만) + 미니멀 목록에 notes 미노출 — 기존 구조 유지 확인. 세트관리·MedicalChartPanel 입력 상세표만 노출.

> ⚠️ **배포 순서 권고**: FE 단독 선배포 시 마이그 전 19세트가 [이름+용량] 칸에 분류('외용액' 등) 노출 → 마이그(자동이관)와 **같은 배포창에서 함께 적용**. supervisor 게이트 GO = FE merge + datafix 실행 한 묶음.

## policy_superseded
- **RX-SET-FIELD-SCHEMA**(7필드 모델) · **RX-DOSAGE-3FIELD**(3필드 모델) → 본 2필드 모델로 흡수·폐기.

## 산출물
- `datafix.sql` — STEP0 백업 → STEP1 자동이관(멱등+충돌 가드) → STEP2 검증(주석).
- `rollback.sql` — 백업 원복(변경행만, 백업없으면 중단).
- `scripts/T-20260610-foot-RXSET-NAMEDESC_dryrun.mjs` — TX ROLLBACK 시뮬(write0, 건수 산출).
- `scripts/T-20260610-foot-RXSET-NAMEDESC_stage0_readonly.mjs` — Stage0 감사(예외 전수).
- `dry_run_report.md` — 본 문서.

## 게이트 요청
- **supervisor(DB게이트)**: ① dryrun.mjs 단독 실행 → ② 김주연/대표 건수 제시·확인 → ③ GO 후 datafix.sql → ④ STEP2 검증 → ⑤ FE merge 동반.
- **dev-foot**: 본 패키지 + FE 산출 완료. BLOCK 이므로 게이트 승인·건수 확인 전 **미실행 핸드오프**.
