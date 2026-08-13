# T-20260804-foot-COSMETIC-CORRECTION-CRM — Tier2 dry-run + Gate0 evidence

> prod DB `rxlomoozakkjesdqjtvd` / clinic `74967aea…`(오블리브 서울오리진점). 전부 READ-ONLY 실측. prod write 0.
> SOP: Cross-CRM Data-Correction Backfill SOP + Migration Dry-Run No-Persistence Protocol.
> **apply 안 함.** 3중 게이트(DA CONSULT + 박민지 comp-gate + supervisor dry-run) 통과 전 HOLD.

## Gate 0 — 제외 메커니즘 판정: **is_simulation 재사용 REJECT → 라인레벨 boolean(ADDITIVE) 필요 = DA CONSULT 1차게이트**

`check_in_services` 컬럼 census 결과 **라인레벨 제외 플래그 부재**(is_test/is_voided/deleted_at/excluded 전무. `blood_test_requested`만 정규식 오탐).
Tier1/FE 집계가 유일하게 쓰는 제외 레버 = `customers.is_simulation`(고객전체). 재사용 blast-radius 실측:

| 제외대상 | 실체 | is_simulation 시 blast |
|---|---|---|
| #1 김OO F-01XX | **실환자** — 39방문·213라인·payment 19건 **₩6,921,690**·5~8월 활동 | ~₩7M 실매출/39방문 전면 은닉 = 파괴적 |
| #2b 오렌지족 F-4628 | 1방문·8라인·payment 2건 ₩626,740 | ₩626k 은닉 |
| #4 정가언 F-4981 | 1방문·1라인(=문제 CTB)·payment 3건 ₩30,000 | 실고객, "명단에없음"=오귀속(테스트 아님) |

→ **customers.is_simulation 재사용 = HARD NO.** 제외는 라인레벨 의미(고객 아님). 정정 aggregate(담당치료사별 화장품)는 `v_daily_revenue` 밖 **client-side FE 집계**(check_in_services COALESCE(seller,therapist)·is_simulation·price>0). 라인레벨 boolean 신설(ADDITIVE) + **FE 집계 필터 반영** 필요 → data-architect CONSULT + FE 작업 동반.

## FREEZE SET (per-row PK, blanket UPDATE 금지) — 실측 6행

| tag | 유형 | line_id (check_in_services PK) | 고객 | svc/₩ | 현재 bucket | 조작 |
|---|---|---|---|---|---|---|
| #2a | 재귀속 | `76199926-9be6-44a5-a5dd-fa77bc6c2e33` | 김현수 F-4789 | CTB 15,000 (7/23) | seller NULL→therapist 최다혜 | seller→김규리(3a0c6774) |
| #5 | 재귀속 | `3a8ed9f3-f55f-4afd-a110-72c24eeab5e3` | 김영웅 F-4959 | CTB 15,000 (7/25) | seller 최민지(03642b85) | seller→김규리(3a0c6774) |
| #1a | 제외 | `b81521e2-3e4f-4d41-8c63-971d78f08482` | 김OO F-01XX | 안티펑거스500ml 287,000 (7/3) | therapist 김규리 | 라인레벨 제외(CONSULT) |
| #1b | 제외 | `aaec854c-31e2-4071-b2d8-535cfed6c55d` | 김OO F-01XX | 풋샴푸200ml 42,000 (7/14) | therapist 김규리 | 라인레벨 제외(CONSULT) |
| #2b | 제외 | `81682cf7-317a-4e55-98c5-eeafdda0d605` | 오렌지족 F-4628 | 풋샴푸200ml 42,000 (7/13) | therapist 최다혜 | 라인레벨 제외(CONSULT) |
| #4 | 제외 | `31ea7f5e-fad9-406f-9d50-5bf116b51d23` | 정가언 F-4981 | CTB 15,000 (7/23) | therapist 윤시하 | 라인레벨 제외(CONSULT) |
| #3 | INSERT | (신규) | 김정숙 F-4872 | 풋샴푸200ml 42,000 | 임별 | line+원장접점 판별(supervisor) |

**disambiguation — 김규리 2명**: `3a0c6774`(therapist, active, 6 seller_lines/50 therapist_checkins) = **재귀속 target(HARD-PIN)** · `d26717cb`(admin, 7/20 생성, 판매 0) = 대상 아님. 이름기준 UPDATE 금지.
**김OO 7/4 라인**(`99cdf75b`, 42,000, therapist·seller NULL) = bucket NULL → 이미 집계 제외. 정정 불요(참고).

## 재귀속 dry-run (#2a,#5) — No-Persistence 확인 완료
- DO..UPDATE..RAISE(DRYRUN_SENTINEL)..ROLLBACK: **각 rows=1** (#2a NULL→3a0c6774 / #5 03642b85→3a0c6774).
- **post-probe: 무영속 확인** — 대상 seller_staff_id 원값 유지(#2a=NULL, #5=03642b85).
- **원장 무접점(zero-sum)**: seller_staff_id 축만 이동. payments/service_charges 는 seller 로 키잉 안 됨 → 금액 불변. (대상 check_in의 기존 payments ₩41,200·service_charges ₩18,840 = 해당 방문의 의료/기타 charge, 재귀속과 무관·불변.)
- **박민지 comp-gate 대상**: #2a 최다혜 −15,000 → 김규리 +15,000 · #5 최민지 −15,000 → 김규리 +15,000. #2a 근거=총괄 명시지시 소급귀속(7/23 seller NULL).

## #3 누락 INSERT — 원장 접점 (supervisor gate)
김정숙 F-4872 7월 화장품 라인 0건(원천 미등록). 화장품 판매는 통상 payment 동반(7월 풋샴푸 6라인/7 payment). → **line-only INSERT 시 판매명단엔 뜨나 payment 미동반 = 고객 원장/매출 불일치.** 원장 동반 여부 supervisor 판정 필요(무단 원장 INSERT 금지). host 후보: 7/18 임별 check_in. 멱등 가드 필수.

## 기대 검증 (apply 후 POSTCHECK)
정정 후 담당치료사별 화장품 = **367,000 / 19건 / 5명**(김규리 148,000·임별 99,000·조선미 60,000·박소예 45,000·서은정 15,000). ★ 단 제외(#1/#2b/#4) 반영은 **FE 집계가 신규 라인레벨 flag 를 필터해야** LIVE 집계에 반영됨 → DB flag + FE 동시 배포 전엔 POSTCHECK 불성립.

## 게이트 상태
- [ ] **DA CONSULT (1차/blocking)** — 제외 메커니즘(신규 라인레벨 boolean vs 대안) + FE 필터 반영 범위 + #3 원장 접점 정책.
- [ ] 박민지 per-row comp-gate — 재귀속 2건 인센티브 이동.
- [ ] supervisor dry-run 검토 → apply. **미완 → apply/deploy-ready 금지.**
