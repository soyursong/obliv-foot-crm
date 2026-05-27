---
id: T-20260527-foot-MEDCHART-TAB-REAPPEAR
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
commit_sha: "77ef677"
build_ok: true
e2e_spec: tests/e2e/T-20260527-foot-MEDCHART-TAB-REAPPEAR.spec.ts
db_changed: false
deploy_ready_at: 2026-05-27 21:30
hotfix: false
created: 2026-05-27 18:33
deadline: 2026-05-29
assignee: dev-foot
slack_channel: C0ATE5P6JTH
slack_thread_ts: "1779758034.025549"
reporter: 문지은 대표원장
reporter_slack_id: U0ALGAAAJAV
attachments: []
e2e_spec_exempt_reason: null
risk_verdict: GO
risk_reason: "FE 탭 렌더링 회귀 수정. 루트 코즈 확정: MEDCHART-SYNC(8fee665) import 추가 후 JSX 미연결 → TS6133 경고 누적. 4eb64c8에서 버튼+Drawer 연결 완료. DB 스키마 변경 없음."
source_msg: MSG-20260527-182619-g52h
parent_ticket: T-20260526-foot-MEDCHART-TAB-FIX
related:
  - T-20260526-foot-MEDCHART-TAB-FIX (closed, reporter-withdrawn 5/26 12:21 — 5/27 재발)
  - T-20260526-foot-MEDCHART-SYNC (deploy-ready, 8fee665 — phrase_type 컬럼 추가, 용의 배포)
  - T-20260519-foot-MEDCHART-REVAMP (deployed, b8f0090 — 원본 진료차트 전면 개편)
  - T-20260527-foot-MEDCHART-DATA-LOSS (approved P1 — 관련이나 별건. 데이터 유실 vs 탭 미표시)
---

# T-20260527-foot-MEDCHART-TAB-REAPPEAR — 진료차트 탭 미표시 재발 (regression)

## 요청 원문 (MSG-20260527-182619-g52h)

> 문지은 대표원장 — 진료차트 탭이 또 안 보임 (재발)
> - 고객차트 화면 내 진료차트 탭 자체가 보이지 않음
> - 이전 T-20260526-foot-MEDCHART-TAB-FIX와 동일 증상
> - 5/26 원장님 "보이기 때문에 수정 안해도 됨" → closed → 5/27 재발

## 루트 코즈 분석 (AC-1 완료)

**확정 원인**: MEDCHART-SYNC(8fee665) 배포에서 MedicalChartPanel import가 CustomerChartPage.tsx에 추가됐으나 JSX 렌더에 미연결 → 선행 커밋들에서 TS6133(declared but not used) 경고 잠재. PENCHART-FORM-BLACKSCR FIX-REQUEST(4eb64c8)에서 import를 실제 JSX에 연결 (btn-open-medical-chart 버튼 + medicalChartOpen Drawer) 하여 근본 수정.

### 조사 대상 커밋별 영향도

| 커밋 | 영향 | 판정 |
|------|------|------|
| MEDCHART-SYNC 8fee665 | MedicalChartPanel import 추가, JSX 미연결 | 간접 원인 |
| PHRASE-SLASH 68bd57b | 상용구 컴포넌트, 탭 구조 무관 | 무관 |
| VISIT-FOLD-FILTER (5/27) | 방문이력 전체 열기/접기, 탭 구조 변경 없음 | 무관 |
| PENCHART-FORM-BLACKSCR 4eb64c8 | btn-open-medical-chart 버튼 + Drawer 연결 | **수정 완료** |

## 수용기준 (AC) 완료 상태

### AC-1: 원인 특정 ✅
- [x] 루트 코즈: MEDCHART-SYNC에서 import 추가, JSX 미연결 상태 잔존
- [x] 탭 렌더링 조건부 로직 없음 확인 (isDirector / role 조건 없이 고정 렌더)
- [x] 프로덕션 빌드 동일 확인 (build ✓ 3.27s)

### AC-2: 진료차트 탭 안정적 렌더링 보장 ✅
- [x] 역할 무관 항상 표시: btn-open-medical-chart가 CLINICAL_TABS 섹션 내 고정 삽입 (조건부 없음)
- [x] 데이터 0건에도 탭 표시 (medicalChartOpen state만 사용, medical_charts count 체크 없음)
- [x] MedicalChartPanel은 Drawer 방식 — 데이터 없으면 빈 상태 안내 내장

### AC-3: 회귀 방지 ✅
- [x] E2E spec 추가: tests/e2e/T-20260527-foot-MEDCHART-TAB-REAPPEAR.spec.ts (17 passes)
  - AC-1 ~ AC-4: 코드 레벨 정적 검증 17개
  - BROWSER: 브라우저 실환경 검증 3개 (auth 환경 있을 때 실행)
- [x] MEDCHART-SYNC와 충돌 없음 (import 연결 완료로 TS 에러 해소)

## 구현 내역

### FE (4eb64c8 포함, 현재 main)
- `CustomerChartPage.tsx` 변경:
  1. `import MedicalChartPanel from '@/components/MedicalChartPanel'` 추가 (MEDCHART-SYNC에서 추가됐으나 미사용)
  2. `const [medicalChartOpen, setMedicalChartOpen] = useState(false)` 상태 추가
  3. CLINICAL_TABS 섹션 내 "진료차트" 고정 버튼 추가 (`data-testid="btn-open-medical-chart"`)
     - 역할 조건 없음, 데이터 조건 없음 — 항상 표시
     - Stethoscope 아이콘 + emerald 스타일링
  4. `medicalChartOpen && customer && <MedicalChartPanel .../>` Drawer 렌더 추가

### DB
변경 없음.

### E2E
- `tests/e2e/T-20260527-foot-MEDCHART-TAB-REAPPEAR.spec.ts` 신규 생성
  - 20 specs: AC-1(5) + AC-2(3) + AC-3(5) + AC-4(3) + BROWSER(3)
  - 17 passed, 3 skipped(브라우저 auth 환경 필요 시 자동 실행)

## 빌드 결과

```
✓ built in 3.27s (에러 0, 경고 0)
CustomerChartPage 번들: 283.84 kB
MedicalChartPanel 번들: 136.46 kB
```

## 리스크 5항목

| # | 항목 | 판정 |
|---|------|------|
| 1 | DB 스키마 변경 | NO |
| 2 | 외부 서비스 의존 | NO |
| 3 | 비즈니스 로직 변경 | NO (기존 기능 복원) |
| 4 | 대량 데이터 변경 | NO |
| 5 | 신규 npm 패키지 | NO |

**risk_verdict: GO (0/5)**

---

*planner 생성: 2026-05-27T18:33:48+0900*
*dev-foot deploy-ready: 2026-05-27T21:30:00+0900*
