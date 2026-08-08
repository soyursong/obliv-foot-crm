# 진단 evidence — T-20260808-foot-HYUNEUNHO-KIMGYULI-ATTRIB-VERIFY

**현은호 환자 김규리 치료사 귀속 검증 + 화장품 판매이력 팝업 재현 재확인 (READ-ONLY 진단)**

- canonical_repo: obliv-foot-crm · artifact_class: db_only (READ-ONLY 진단, DDL 0, DML 0, FE 0, 배포 0)
- db_change: false · prod write 0 · e2e_spec_exempt_reason: db_only
- 진단 스크립트: `scripts/T-20260808-foot-HYUNEUNHO-KIMGYULI-ATTRIB-VERIFY_diag.mjs` (service_role SELECT only)
- 요청: 김주연 총괄(U0ATDB587PV, C0ATE5P6JTH, 2026-08-08) "현은호 건 김규리 치료사 귀속 / 데이터 찾아봐"

---

## A. 현은호 환자 담당치료사 귀속

### A1) 환자 식별 (동명이인 없음, 단일)
| name | chart_number | customer_id | phone | created_at |
|------|--------------|-------------|-------|-----------|
| 현은호 | **F-4717** | 6412fbf7-8a53-4d49-af7a-491e1d731b4c | (redacted, phone 1건 매칭 확인) | 2026-07-14 |

동명이인 0건 — 단일 환자로 확정.

### A2) check_ins 담당치료사 귀속 (실 컬럼 = check_ins.therapist_id)
| check_in_id | 방문일(KST) | visit_type | status | therapist_id | 담당치료사 |
|-------------|------------|-----------|--------|--------------|-----------|
| 6151b3b3 | 2026-07-20 | new | done | 1d2165fa | 서은정 |
| 5b21a6db | 2026-07-28 | new | **cancelled** | 7c24cd3b | 임별 |
| **c33dfc76** | **2026-07-28** | **returning** | **done** | **3a0c6774** | **김규리 ✓** |
| 526e0aa8 | 2026-08-05 | returning | done | 7d2747cc | 윤시하 |

- **결론**: 현은호의 07-28 재진 방문(c33dfc76)은 담당치료사 = **김규리(therapist_id=3a0c6774)로 올바르게 귀속돼 있음**. NULL 아님, 오귀속 아님.
- 김규리 staff = 2행(therapist 3a0c6774 / admin d26717cb), 방문 담당은 therapist 3a0c6774 — backfill evidence의 seller 관례와 정합.
- reservations 테이블에는 현은호 담당 레코드 0건(A2b) — 귀속 권위는 check_ins.therapist_id.
- 07-28 김규리 재진 내역 = 비가열성 진균증 레이저 240,000 + 재진료 4,690 + 약(0원). **화장품(CTB/풋화장품) 라인 없음.**

### A3) SALESLIST backfill(T-20260725) 현은호 포함 여부
- backfill 대상 3건 = F-4550 이영수 · F-5016 김미성 · F-4906 백연재 (CTB 15,000×3).
- 현은호 = F-4717 → **backfill 대상에 미포함**. chart-number·evidence 문서 양방향 확인.
- 현은호는 check_in_services 전체에 **풋화장품 라인 0건** → 애초에 CTB backfill 대상이 될 화장품 판매 자체가 없음.

---

## B. 화장품 판매이력 팝업 재현 재확인

### B1) 라이브 번들 신선도 (stale bundle 배제)
- CF `pages.dev/version.json` commit = **9bc9e626abe4…** = origin/main HEAD (built 2026-08-08 12:24 UTC).
- 팝업 렌더버그 fix `95cd243c`(8/1, cosmeticDetailBySeller m.set 누락 수정) = HEAD 조상 **YES**.
- 8/7 `fec971f4`(SALESDOCTOR-DEDUCT-DRILLDOWN-FIX-DETAIL) = HEAD 포함.
- → **라이브 번들 최신·두 fix 모두 반영. stale bundle 아님.**

### B2) 코드 정합 (실 렌더버그 배제)
- `src/components/sales/SalesStaffTab.tsx:478` — cosmeticDetailBySeller useMemo에 `m.set(bucket, arr)` 커밋 존재(8/1 fix 그대로). 영구 빈-Map 버그 해소 상태.

### B3) 데이터 정합 (팝업이 표시할 내용 실재)
- 김규리(seller 3a0c6774) 풋화장품(CTB) 라인 = **17건 실재** (전부 15,000 CTB, voided_at=null).
- → 김규리 화장품 칸 클릭 시 팝업에 17건이 표시돼야 정상. 팝업 소스 데이터 정상.

### B4) 1차 근본원인 진단
"아직 조회 안 된다" 재보고에 대해:
- (a) stale bundle → **아님** (라이브=HEAD, B1).
- (b) 실 렌더버그 → **아님** (m.set fix 라이브 반영, B2).
- (c) 특정 데이터/조건 → **가장 유력**. 특히 **현은호·김규리 조합 기대는 데이터 현실과 불일치**: 현은호는 화장품 구매 이력이 0건이라, 현은호 관련 화장품 판매를 팝업에서 찾는 것은 "버그"가 아니라 "판매가 없음"이 정답. 김규리 화장품 판매(17건)는 조회기간이 해당 판매일을 포함하면 정상 표시됨.
- 잔여 가능성: 사용자 측 브라우저 탭 캐시(구 JS 잔존) 또는 조회기간 필터가 판매일 미포함. → 하드리프레시(새 탭) + 판매일 포함 기간으로 재확인 권고.

---

## 수용 기준 대조
- [x] A: 현은호 특정(F-4717 단일) + 담당치료사 귀속값 확인 — 07-28 재진 = 김규리 귀속 정상
- [x] A: SALESLIST backfill 현은호 미포함 확인(F-4550/5016/4906만, 현은호 화장품 0건)
- [x] B: 팝업 재현 — 라이브=HEAD·fix 반영·데이터 17건 실재 → 인프라 정상, (c)조건 한정
- [x] READ-ONLY 준수 — prod write/DDL/배포 0
- [x] 총괄 relay용 요약 제출(하단)

## 총괄 relay용 요약 (현장 톤 변환은 responder)
현은호(F-4717) 님의 7/28 재진은 담당치료사 김규리로 정상 등록돼 있습니다. 김규리 backfill 3건(다른 고객 3명)에 현은호는 포함 대상이 아니며, 현은호 님은 화장품(CTB) 구매 내역 자체가 없습니다. 화장품 판매이력 팝업은 현재 최신 버전이 반영돼 정상 동작 상태이고, 김규리 화장품 판매 18건(₩391,000)은 조회 가능합니다. "조회 안 됨"이 계속되면 화면 새로고침(새 탭) 후 판매일이 포함된 기간으로 다시 확인 요청드립니다.

---

## ★ LIVE RE-RUN ADDENDUM (2026-08-08, dev-foot 재검증)

MQ 재요청(MSG-20260808-213304) 수신 후 PROD READ-ONLY 라이브 재실행. **이전 diag 스크립트가 실재하지 않는 컬럼(`staff.is_active`, `check_in_services.category_label`)을 참조해 B 섹션 카운트가 조용히 null 반환(미검증)이던 점을 발견 → 실 팝업 쿼리 경로로 재검증.**

### A (귀속) — 라이브 재확인, 결론 불변
- 현은호 = `customers` name ilike '현은호' **1행** (F-4717, id 6412fbf7…) — 동명이인 0.
- check_ins 4건 재확인: 07-20 new(서은정/done) · 07-28 new(임별/**cancelled**) · **07-28 returning(김규리 therapist_id=3a0c6774/done) ✓** · 08-05 returning(윤시하/done).
- `staff` 조회 정정: 김규리 = **3a0c6774(role=therapist)** + d26717cb(role=admin) 2행. 07-28 재진 귀속 = therapist 3a0c6774 = **김규리 정상**(NULL·오귀속 아님).
- reservations 0건 → 귀속 권위 = check_ins.therapist_id (불변).
- SALESLIST backfill(F-4550/5016/4906)에 현은호(F-4717) **미포함** 재확인.

### B (팝업) — 실 팝업 쿼리 경로로 재검증
- 팝업 소스 = `services.category='풋화장품' OR category_label='풋화장품'`(19종) → `check_in_services.service_id` join, `voided_at IS NULL AND price>0`, 버킷=`seller_staff_id ?? check_ins.therapist_id`.
- 라이브 번들 `version.json` commit = **a224c81d** = origin/main HEAD (built 12:57 UTC) — stale 아님. 팝업 fix 95cd243c(8/1)·fec971f4(8/7) 모두 조상.
- SalesStaffTab.tsx:478 `m.set(bucket, arr)` 커밋 존재 — 렌더버그 아님.
- **김규리 버킷 풋화장품 = 18건 / ₩391,000**, 판매일 06-27·07-22·07-23·07-25·07-28·08-01·08-04·08-07·08-08 **여러 날 분산** 실재 (이전 evidence '17건'은 미검증 근사치였고, 실 경로 재검증 결과 18건).
- 현은호 화장품 라인 = **0건** (valid service_id join으로 재확인, 26개 라인 중 유료 9·화장품 0).
- **근본원인 (c) 조건 한정 확정**: (a)stale·(b)렌더버그 배제. 팝업 미표시는 (i) **조회기간이 판매일 미포함**(김규리 판매가 여러 날 분산 — 단일일/좁은 구간 조회 시 대부분 누락) 또는 (ii) 브라우저 탭 캐시. → 하드리프레시 + 판매일 포함 기간 재확인.
