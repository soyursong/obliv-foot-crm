---
id: T-20260529-foot-RECEPTION-DUMMY-SYNC
domain: foot
priority: P2
status: deployed
deploy_ready_at: 2026-05-29 09:15
commit_sha: d799c9ce (obliv-foot-crm) / 8225a7e2 (happy-flow-queue)
db_changed: true
e2e_spec: tests/e2e/T-20260529-foot-RECEPTION-DUMMY-SYNC.spec.ts
e2e_spec_exempt_reason: null
e2e_result: "6/6 PASS (chromium) — AC-1~5 전항목 통과, 예약 목록 화면 진입 성공(더미 데이터 표시 확인)"
hotfix: false
created: 2026-05-29
deadline: 2026-05-30
slack_channel: C0ATE5P6JTH
reporter: 김주연 총괄
reporter_slack_id: U0ATDB587PV
risk_verdict: GO_WARN
qa_result: pass
qa_grade: Yellow
deployed_at: "2026-05-29T09:49:00+09:00"
deploy_commit: 9910475b44fa183dd4643953620b7ef04ee3a8b5
bundle_hash: 1c499d006d092c4bd958bf4792614158
field_soak_until: "2026-05-30T09:49:00+09:00"
---

# T-20260529-foot-RECEPTION-DUMMY-SYNC — 초진·재진 더미 데이터 접수화면 연동

## 원인 진단 (AC-1)

### 이중 불일치 (두 층위)

| 항목 | 더미 데이터 (DUMMY-DATA-0529) | 접수화면 (happy-flow-queue CheckIn.tsx) |
|------|-------------------------------|----------------------------------------|
| **DB** | obliv-foot-crm (`rxlomoozakkjesdqjtvd`) | happy-flow-queue (`muvcfrgmxlwtidundlre`) |
| **status 값** | `status = 'confirmed'` (obliv-foot-crm 규약) | `get_today_reservations` RPC: `WHERE status = 'reserved'` |

- `happy-flow-queue.pages.dev/jongno-foot` → `CheckIn.tsx` → HFQ Supabase(`muvcfrgmxlwtidundlre`) 사용
- `jongno-foot` 클리닉은 HFQ DB에 20260526 마이그레이션으로 별도 등록됨
- T-20260529-foot-DUMMY-DATA-0529 시드 스크립트는 obliv-foot-crm DB에 삽입 (`status='confirmed'`)
- HFQ `get_today_reservations` RPC는 `status = 'reserved'` 만 반환 → 예약 0건 → 목록 미연동

## 수정 내용

### 대상 파일 (happy-flow-queue repo)
- `scripts/seed_testdata_20260529_hfq.mjs` (신규)
  - HFQ DB (`muvcfrgmxlwtidundlre`) 대상 시드
  - `status = 'reserved'` (HFQ 스키마 기준)
  - customers 80명 + reservations 80건 + 과거check_ins 40건
- `scripts/rollback_testdata_20260529_hfq.mjs` (신규)
  - `[testdata_20260529_hfq]` 태그 기준 롤백

### FK 수정
- 정리 SQL에 `notification_logs.reservation_id` FK 먼저 삭제 추가
  (idempotent 재실행 시 기존 notification_logs 참조 충돌 방지)

## DB 검증 결과

```
DB: muvcfrgmxlwtidundlre (happy-flow-queue)
clinic: 종로 오리진점 풋센터 (jongno-foot, e49b687f-...)

customers:       80건 (초진 40 + 재진 40) ✅
reservations:    80건 (2026-05-29, status=reserved) ✅
check_ins:       40건 (재진 판별용, 2026-05-01, done) ✅
get_today_reservations RPC: 80건 반환 ✅
```

슬롯별 분포:
- 10:00 초진[고양이·강아지·토끼·사자] 재진[사과·딸기·포도·바나나]
- 11:00 초진[호랑이·코끼리·기린·펭귄] 재진[수박·키위·망고·복숭아]
- …(10개 슬롯 × 4+4 = 80건)

셀프접수 테스트 전화번호:
- 초진(동물): 010-0000-2901 ~ 010-0000-2940
- 재진(과일): 010-0000-2941 ~ 010-0000-2980

## AC 체크

- [x] AC-1: 원인 진단 — HFQ DB + status='reserved' 이중 불일치 특정
- [x] AC-2: 초진 동물이름 40건 `get_today_reservations` 정상 연동 (40건 반환 확인)
- [x] AC-3: 재진 과일이름 40건 `get_today_reservations` 정상 연동 (40건 반환 확인)
- [x] AC-4: 기존 실 데이터 접수 흐름 영향 없음 (테스트 데이터는 `[testdata_20260529_hfq]` memo 태그로 격리, 실 고객과 전화번호 대역 분리: +821000002901~2980)
- [x] AC-5: `npm run build` ✅ (obliv-foot-crm 3.42s, 에러 0)

## 빌드

```
obliv-foot-crm: npm run build → ✓ built in 3.42s (에러 0)
happy-flow-queue: 코드 변경 없음 (scripts only), 빌드 불필요
```

## 롤백

```bash
cd ~/Documents/GitHub/happy-flow-queue
node scripts/rollback_testdata_20260529_hfq.mjs
```

## 참고

- 접수화면 URL: https://happy-flow-queue.pages.dev/jongno-foot
- jongno-foot HFQ DB 등록 티켓: T-20260522-foot-SELFCHECKIN-UX (happy-flow-queue/tickets/)
- DUMMY-DATA-0529 롤백 (obliv-foot-crm): `node scripts/rollback_testdata_20260529.mjs`
- 원 시드 스크립트 (obliv-foot-crm): `scripts/seed_testdata_20260529.mjs` — 별도 롤백 불필요

## 변경 이력

- 2026-05-29 09:15: 신규 생성 + deploy-ready 마킹
- 2026-05-29 09:49: supervisor QA PASS — qa_grade: Yellow / deployed
  - Phase 1 빌드: timeout 60 npm run build → ✓ 3.44s (exit 0)
  - Phase 1.5 env: VITE_SUPABASE_URL(muvcfrgmxlwtidundlre) bundle 매치 ✅
  - Runtime null safety: src/ 변경 없음 — 신규 패턴 없음 ✅
  - E2E: chromium 6/6 PASS (AC-1~5 전항목) — firefox/webkit Playwright 미설치(브라우저 이슈, 코드 이슈 아님)
  - Browser: diag-browser.mjs → 예약하셨나요? 화면 렌더, 예약 목록 화면 진입 성공(더미 데이터 표시 확인)
  - CF Pages: HFQ origin/main=9910475 최신 (자동 배포 완료), bundle_hash=1c499d006d092c4bd958bf4792614158
  - field_soak_until: 2026-05-30T09:49:00+09:00
