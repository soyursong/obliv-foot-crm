# T-20260725-foot-SALESLIST-MISSING-RECORDS-BACKFILL — 대상셋 freeze + 판정근거 스냅샷

- captured_by: agent-fdd-dev-foot
- 방식: READ-ONLY 인벤토리(WRITE 0) → 대상셋 freeze. Cross-CRM Data-Correction 백필 SOP 준수.
- 대상 테이블: **`public.check_in_services`** (화장품 라인 = check_in 에 딸린 서비스 라인).
  화장품 매출집계(SalesStaffTab)는 `services.category='풋화장품'` service_id 를 가진
  `check_in_services` 행을 `check_ins.checked_in_at` 기간·`COALESCE(seller_staff_id, therapist_id)` 버킷으로 집계.
- ⚠ `check_in_services.check_in_id` = **NOT NULL** → 화장품 라인은 반드시 부모 `check_ins` 필요.
  대상 3건 모두 해당일에 기존 check_in 존재 → **부모 신규생성 없이 라인 append** (footprint 최소).

## ★ 핵심 발견 — 티켓 전제(8건 누락) ≠ 실 데이터 (실 백필 = 3건)

멱등성 사전조회 결과 8건 중 **5건은 이미 `check_in_services` 에 존재**(seller_staff_id=NULL,
현재 therapist_id 폴백으로 집계 중). 8건 전량 INSERT 시 **5×15,000=75,000원 이중계상**.
→ 티켓 자체 멱등 가드("존재 건은 대상에서 제외")에 따라 **실 INSERT 대상 = 3건**.

### 실 백필 대상 (3건, INSERT) — rows-affected dry-run 실측 = 3 / 합계 72,000원

| # | 환자(DB명) | chart | 판매일 | 제품 | 금액 | seller | check_in(기존) |
|---|-----------|-------|--------|------|------|--------|----------------|
| 3 | 김정숙 | F-4872 | 2026-07-18 | 풋샴푸 (200ml) | 42,000 | 임별(7c24cd3b) | f6ca21d1 |
| 5 | 이영수 | F-4550 | 2026-07-18 | Care Toe Band (CTB) | 15,000 | 김규리 ⚠pending | 85766c3b |
| 6 | 김미성 | F-5016 | 2026-07-22 | Care Toe Band (CTB) | 15,000 | 김규리 ⚠pending | 39a3361f |

### 기존재 5건 (멱등 제외 — INSERT 금지, double-count 방지)

| # | 환자(DB명 / ticket명) | chart | 판매일 | 폴백 therapist | 폴백=seller? |
|---|----------------------|-------|--------|----------------|--------------|
| 1 | 허유희 / 하유희 | F-4696 | 2026-07-21 | 8d244cee(조선미) | ✓ 일치 |
| 2 | 황보경서 / 황보경시 | F-4582 | 2026-07-15 | 7c24cd3b(임별) | ✓ 일치 |
| 4 | 이동권 | F-4923 | 2026-07-21 | 8d244cee(조선미) | ✓ 일치 |
| 7 | 백연재 | F-4906 | 2026-07-22 | 3a0c6774(김규리 therapist) | ✓ 일치 |
| 8 | 김현수 | F-4789 | 2026-07-23 | 8c21c9ab(최다혜, **inactive**) | ✗ ticket seller=김규리 ≠ 폴백 → **현재 오귀속** |

## 추가 불일치/리스크 (DA/planner 확정 필요)

1. **이름 오탈자 2건** — 이미지/relay vs DB(차트번호로 resolve, DB=신원 SSOT):
   F-4696 하유희→허유희, F-4582 황보경시→황보경서. (동일인 판정: 차트+제품+금액 일치, 문제없음)
2. **김규리 staff 2행 모호** — admin(d26717cb, active) / therapist(3a0c6774, active).
   #5·#6·#8 seller="김규리" 어느 쪽? 운영상 therapist(3a0c6774, check_ins.therapist 로도 등장) 잠정채택.
   → **DA/planner 확정 전 seller_pending=true, apply 게이트로 차단**.
3. **forward-only 정합** — COSMETIC-SELLER-ATTRIB(DA CONSULT-REPLY 2026-07-24)는
   `seller_staff_id` **백필 금지(forward-only, 역오염 방지)** 명시. 신규 INSERT(3건)에 seller 부여는
   "새 행이 seller 를 갖고 태어남"=forward 로 해석하나, **기존재 5건(특히 #8 오귀속)의 seller UPDATE**는
   그 forward-only 정책과 정면 충돌 → 별도 DA 판단 필요(본 백필 apply 범위에서 제외).

## dry-run 증거 (무영속)

- `node scripts/...BACKFILL_dryrun.mjs` → sentinel-abort, total rows-affected=**3**, post-probe 영속 0 확인.
- expected apply rows-affected = 3, 합계 72,000원.

## 실행 게이트 (전부 충족 전 apply 금지)

1. DA CONSULT-REPLY GO (대상테이블 ✓확정 / 매출정합 double-count 방지 / 멱등 / 김규리 확정 / forward-only 정합)
2. planner 재스코프 확정 (8→3 실백필 + 기존재 5건·#8 오귀속 처리방침)
3. supervisor prod 승인
→ `DA_GO=1 PLANNER_GO=1 SUPV_GO=1 node scripts/...BACKFILL_apply.mjs`
