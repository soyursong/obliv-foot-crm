# T-20260725-foot-KOH-SURCHARGE-OVERCOLLECT-REFUND-ASSESS — AC-1~AC-3 READ-ONLY 규모산출 결과

- **일시**: 2026-08-08
- **수행**: dev-foot (자율 픽업, planner VERDICT #12=U 근거)
- **인증컨텍스트**: service_role (RLS 우회) — 0-row = 진짜 부재
- **db_change**: false (SELECT only, write/DDL 0)
- **재현 스크립트**: `scripts/T-20260725-foot-KOH-SURCHARGE-OVERCOLLECT_dryrun.mjs`

## 결론 (AC-1)

**과오납 대상 = 0건 / ₩0.** 과오납 위험이 실현되지 않음. AC-4(실 환불 write) 게이트 불요, 파괴 MONEY-layer 티켓 발번 불요.

## 버그경로·window (배경)

- **버그**: 야간/공휴/토요 30% 진찰료 가산 base 가 급여 전체합(aggregate)으로 잡혀 균검사(KOH) 등 비진찰료 급여에까지 가산 부과 → payments.amount 과다. **FE-only**(service_charges 명세는 DB RPC 진찰료 self-gate로 정확, 커밋 `11c1ebcf` [정합] 절).
- **window (버그 FE 라이브)**: `07458cf6`(SETTLE, 2026-07-25 15:16 KST) ~ `11c1ebcf`(SCOPE-GYUNTEST-EXCLUDE, 2026-07-25 16:39 KST). deploy-ready 마킹시각 기준 ~1h23m, 단일 토요일 오후. (prod CF Pages lag 대비 loose [14:00,19:00] 스캔.)

## 과오납 성립 필요조건 (AND) — 실측 결과

| 조건 | 내용 | 07-25 실측 |
|---|---|---|
| (a) | PMW 보험정산 경로 payment (FE가 amount 계산·가산 fold) | **0건** — window 19 payment 전건 `check_in_id`·`service_charge_id` NULL = 외부영수증 캡처("영수증 수납/업로드(단건)") |
| (b) | checked_in_at=토/야간/공휴 가산발동 | 07-25=토요일(충족) |
| (c) | 급여 covered 비진찰료(KOH) line-item 동반 | **0건** — 07-25 service_charges 1건뿐(비가열레이저-아톰, 비급여 copay 280,000, covered 0) |

→ (a)·(c) 공히 0 → `computeSurcharge`=0 → over-charge 구조적 불성립.

## 교차 검증 (독립 다각도)

1. **service_charges 07월 미사용**: calculated_at 기준 07-18=0, 07-19=0, **07-25=1**(비급여), 07-26=0, 08-01=24 → 보험정산 경로는 08-01부터 가동. 버그 FE 유일 날짜에 급여 명세 없음.
2. **07-25 방문 22건 중 KOH/검사 흔적**(treatment_category/contents/prescription grep) = **0건**.
3. **window payment 고객 ∩ KOH검사 방문 고객** = **0건**.
4. window 19 payment memo 전건 외부영수증 캡처(FE 가산계산 amount 아님).

## 지문 freeze (AC-2/AC-3)

- 대상 셋 = ∅ (freeze할 candidate 없음). 단일 count 기준 blanket 판정 아님 — 지문 교집합(정산경로 ∧ 토/공휴 ∧ 급여 covered 비진찰료)로 필터한 결과 공집합.
- 근거 스냅샷 = 본 리포트 + 재현 스크립트 콘솔출력.

## 후속

- planner: 본 결과로 티켓 VERDICT write(단일권위). scope=0 → **close 후보**(refund 불요).
- BACKFILL 티켓(`T-20260725-foot-SURCHARGE-SERVICECHARGE-BACKFILL`) risk_reason의 'MONEY-layer 무접점' 전제 반증 우려는 **본 window에 한해 무효**(과오납 실현 0). 단 08-01~ 보험정산 경로 가동 이후 신규 과가산은 scope-fix(11c1ebcf, going-forward)로 이미 차단됨.
