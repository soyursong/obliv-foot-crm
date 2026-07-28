# T-20260727-foot-ASSIGN-REVISIT-OVERCOUNT-RECLASS-GATE — Phase 2 구현/재정합 결과

- 도메인: foot / clinic: jongno-foot (`74967aea-…`) / 창: 2026-07-01 ~ 07-27 KST (당월누적)
- 근거: 김주연 총괄 confirm (2026-07-28 19:23 KST) — 확인1(순수초진 214 전량 초진) + 확인2(EDGE 4건).

## 1. Phase 2A — recency 코드 교정 (배포 대상, deploy-ready 아님·게이트 대기)
- **RC**: 초진/재진 판정경계 상한이 '오늘 자정' → 과거날짜 **자기 첫 완료방문**을 "과거 done"으로 잡아 self-contamination(순수초진→재진 오승격).
- **교정**: 판정을 **고객단위 → check_in 레코드단위(시점정합)** 로. 경계 상한 = **판정대상 check_in 자기 `checked_in_at`(strict <)** — 자기·후속 방문 배제.
  - 신규 `resolveVisitTypesByCheckIn(rows, clinicId)` (src/lib/visitRecency.ts). 판정산식 = classifyVisitByRecency 단일 재사용(re-divergence 방지).
  - Assignments.tsx: `axisOf`/`monthAxisOf` 를 per-checkin 맵 소비로 교체(고객단위 override 제거).
- **owner-forced 보존**: `src/lib/visitTypeOverrides.ts` — recency 재파생이 총괄 수동판단을 덮어쓰지 않도록 check_in id 로 pin(no-DDL 큐레이션 맵).
  - ⚠ **반영 방식 = planner FOLLOWUP 확인 대상** (코드-맵 vs 오버라이드 테이블[=DA CONSULT 게이트]).

### 라이브 재정합 (freeze 229행 전량 배포로직 재적용 — READ-ONLY dry-run)
`scripts/..._phase2_reconcile_dryrun.mjs` 결과:

| 지표 | before(Phase1) | after(2A+override) | delta |
|---|---:|---:|---:|
| 재진(returning) | 229 | **10** | -219 |
| 초진(new) | 0 | **219** | +219 |

**per-consultant 재진 카운트 (AC4 근거)**:

| 상담실장 | before 재진 | after 재진 | 초진이관 | owner-forced |
|---|---:|---:|---:|---:|
| 정연주 | 54 | 4 | 50 | 1 (⑦#2601 재진 pin) |
| 엄경은 | 46 | 1 | 45 | 1 (③#7137 재진 pin) |
| 김지윤 | 41 | 2 | 39 | 1 (정명희#4270 초진 pin) |
| 송지현 | 41 | 2 | 39 | 1 (⑥#1242 재진 pin) |
| 강경민 | 38 | 1 | 37 | 0 |
| 김주연 | 6 | 0 | 6 | 0 |
| 김수린 | 3 | 0 | 3 | 0 |
| **합계** | **229** | **10** | **219** | **4** |

## 2. freeze 델타 재정합 (Phase1 freeze=221 RECLASS / 8 KEEP → 확정)
- 확정 decision (총괄): **RECLASS(초진이관)=218** = 214 clean + EDGE ①(9557dec9)·②(85ecbec3)·④(fc8cc7e3)·⑤(71dc0a74).
- **KEEP(재진유지)=11** = 기존 8 + EDGE ③(9b701267)·⑥(ebea2e1f)·⑦(01baf9ea).
- freeze 221 → 218 : EDGE ③⑥⑦ 3건이 RECLASS→KEEP 이동(−3). KEEP 8 → 11(+3).
- ★ **display 그레인 주의**: 정명희(1c2117de)는 KEEP set(11) 내에 있으나 sibling JMH + 총괄 override 로 **owner-forced 초진**.
  → 화면 표시 기준 **초진 219 / 재진 10** (KEEP 11 중 정명희 1건이 초진표시).
- 원장(payments/service_charges) 무접점 — visit_type/consultant_id 축만. visit_type 은 DB write 아님(이미 stored 'new' + 2A 표시교정).

## 3. EDGE #5088 담당축 정정 (APPLIED)
- **커플링 판정(dry-run)**: `payments.check_in_id=85ecbec3` = 0건/₩0 · packages(김지윤 앵커)=0 · 고객 #5088 전체 payments=0 → **매출귀속 무접점(DECOUPLED)**.
  → planner rule: 순수 배정기록 정정 = comp 정책 변경 아님 → 대표 comp 게이트 불요 → 정정 진행.
- **정정**: check_in `85ecbec3`(취소, 동일자 중복접수) consultant_id **김지윤(c23d4491) → 강경민(6ab26d9f)**. backfill SOP 준수: archive-first snapshot / WHERE UUID+AND / rows-affected=1 / POSTCHECK 강경민 확정 / rollback SQL 동봉.
- visit_type(②#5088 재진→초진)은 별도 write 아님 — 이미 'new' + 2A 표시교정.

## 4. Phase 2B (stored customers.visit_type 백필) = 별도 위생티켓 defer (총괄 확정).

## 5. 열린 게이트 (deploy-ready 보류 사유)
- **owner-forced 보존 반영 방식** = planner FOLLOWUP 확인 필요(§1). 확인 후 supervisor QA(AC4 before/after) → deploy.
