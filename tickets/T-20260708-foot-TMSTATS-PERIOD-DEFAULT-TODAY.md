---
id: T-20260708-foot-TMSTATS-PERIOD-DEFAULT-TODAY
domain: foot
priority: P2
status: deploy-ready
deploy_ready: true
hotfix: false
created: 2026-07-08
completed: 2026-07-08
db_changed: false
e2e_spec: tests/e2e/T-20260708-foot-TMSTATS-PERIOD-DEFAULT-TODAY.spec.ts
risk_verdict: GO
risk_reason: "통계 대시보드 기간 프리셋 초기값만 조정하는 FE-only 변경(read-only). 기존엔 전 탭이 단일 공유 preset('month')을 사용 → TM집계 진입 시에도 '이번 달'. 이번 변경으로 tm 탭 전용 tmPreset('today') 상태를 분리, tm 탭 진입(tab 변화)마다 setTmPreset('today')로 리셋. 활성 프리셋 = tab==='tm' ? tmPreset : preset 로 분기해 매출/치료사 탭 공유 preset 기본값('month')은 완전 불변. 집계 산식·데이터소스(fetchTmAggregate)·컬럼·resolveRange 로직 무변경 — 기간 초기값만 바뀜. 스키마/RPC/migration 0, 어떤 write/승격 없음. 빌드 OK, 신규 spec 9 green(정적 불변식 5 + 브라우저 동작 3 + setup 1) + 기존 TM집계 spec 10 무회귀."
author: dev-foot
build_verified: "2026-07-08 — npm run build → ✓ built in 4.98s"
---

# T-20260708-foot-TMSTATS-PERIOD-DEFAULT-TODAY

## 화면 / 현상
- 화면: obliv-foot-crm 통계 대시보드 > TM집계 탭
- 현상: TM집계 탭 최초 진입 시 기간 필터 기본값이 '이번 달'(전 탭 공유 preset)
- 요구: TM집계 탭만 기간 필터 기본값을 '오늘(당일 00:00~23:59)'로

## 진단
- `src/pages/Stats.tsx` 에 전 탭 공유 `preset` 단일 상태(기본 `'month'`)만 존재.
  탭(매출/치료사/tm)이 하나의 preset을 공유해 TM집계도 '이번 달'로 진입.
- 기간 계산은 `resolveRange(preset, ...)` → `from/to` → 각 fetch. 산식은 탭별 fetch 함수에 있고
  기간 프리셋과 무관 → 초기값만 조정하면 산식/컬럼 영향 없음.

## 구현
- `tmPreset` 상태 신설(기본 `'today'`) — tm 탭 전용.
- `useEffect([tab])`: `tab === 'tm'` 이면 `setTmPreset('today')` → tm 탭 진입(재진입 포함)마다 '오늘'로 리셋.
  tab 변화에만 반응하므로 같은 tm 탭 안에서 사용자가 기간을 바꾸면 리셋되지 않음.
- `activePreset = tab === 'tm' ? tmPreset : preset`, `setActivePreset` 분기.
  데이터 로드 effect·`resolveRange`·프리셋 버튼 UI 모두 `activePreset`/`setActivePreset` 사용.
- 매출/치료사 탭은 기존 공유 `preset`('month') 그대로 → 타 탭 기본값 불변.

## AC 매핑
- AC1 (tm 최초 진입 '오늘' + 당일 집계): tmPreset 기본 'today' + 진입 리셋 → 시나리오1 green
- AC2 (타 탭 기본값 불변): 공유 preset 'month' 유지, activePreset 분기 → 시나리오2 green
- AC3 (재진입 '오늘' 리셋): tab 변화 시 setTmPreset('today') → 시나리오3 green
- AC4 (산식/소스/컬럼 무변경): fetchTmAggregate·resolveRange 불변 정적 가드 green

## 검증
- 빌드: `npm run build` → ✓ built in 4.98s
- 신규 spec: `tests/e2e/T-20260708-foot-TMSTATS-PERIOD-DEFAULT-TODAY.spec.ts`
  - 정적 소스 불변식 5 green
  - 브라우저 동작 3 green (오늘 기본 활성 / 매출탭 이번달 유지 / 재진입 리셋)
- 무회귀: `T-20260610-foot-STATS-TM-AGGREGATE-TAB.spec.ts` 10 green

## DB 변경
- 없음 (FE-only, read-only)
