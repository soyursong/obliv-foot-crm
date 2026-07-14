# T-20260714-foot-OBLIVORIGIN-IDENTITY-4SET — DB-write 게이트 (#1 기관명 strip '점')

- **환경**: prod Supabase `rxlomoozakkjesdqjtvd`
- **적용시각**: 2026-07-14 (Asia/Seoul)
- **by**: agent-fdd-dev-foot
- **db_change**: 있음 (기존 컬럼 값 정정 UPDATE — 스키마 변경 0, DDL 0, 신규 컬럼 0 → DA CONSULT 불요)
- **권위 근거**: CEO 지시 MSG-20260714-110748-waza canonical 기관명 = '오블리브의원 서울 오리진'. body/derm 동일값 deployed(단일 요양기관=세 센터 공통명). foot '점'이 stale 아웃라이어. planner CONFIRM MSG-20260714-135657-35vj. → 기 확정값 적용(신규 결정/라이브 legal mutation 아님).

## DRY-RUN (정확히 1행 매칭)
```
SELECT id, slug, name FROM clinics
WHERE slug='jongno-foot' AND name='오블리브의원 서울 오리진점';
-- → 1행 (id=74967aea-a60b-4da3-a0e7-9c997a930bc8). 예상=1, 실제=1 → PASS
```

## APPLIED (slug + 현재값 이중 조건 가드)
```sql
UPDATE clinics SET name='오블리브의원 서울 오리진'
WHERE slug='jongno-foot' AND name='오블리브의원 서울 오리진점'
RETURNING id, slug, name;
-- → 1행 변경 (jongno-foot: '오블리브의원 서울 오리진')
```

## ROLLBACK SQL (동봉)
```sql
UPDATE clinics SET name='오블리브의원 서울 오리진점'
WHERE slug='jongno-foot' AND name='오블리브의원 서울 오리진';
```

## 스코프 가드 검증 (AC-5)
| slug | name (AFTER) | 판정 |
|------|--------------|------|
| jongno-foot | 오블리브의원 서울 오리진 | ✅ strip 완료 |
| songdo-foot | 오블리브 풋센터 송도 | ✅ 무영향 (미변경) |

## 렌더 실측 (WARN-A 게이트) — PASS
- 하니스: `scripts/T-20260714-foot-OBLIVORIGIN-IDENTITY-4SET_render.mjs`
- 증빙: `evidence/oblivorigin-identity-4set/*.png` (14종 출력서류)
- 결과: 전 14종 신규명 렌더 · stale '점' 0건 · 미치환 0건 · nhis 13328581 유지(#3 회귀 0)
- 회귀 스펙: `tests/e2e/T-20260714-foot-OBLIVORIGIN-IDENTITY-4SET.spec.ts` (16 passed)

## 스코프 밖 (planner 트랙)
- **#2 대표자(박영진)**: DECOUPLED 비블로킹 — DA CONSULT(MSG-20260714-135001-6d7g) + CEO print-재배선 결정 대기. dev 미착수.
- **#4 대표도장**: verify-only PASS(Stage1) — clinic_doctors.seal_image_url leaf 미접촉. 재작업 0.
- **OPEN flag**: `getStampUrl()` slug-비게이트 전역번들 → songdo 폴백 시 jongno 도장 노출 가능성. songdo 비운영·기존 배포동작이라 실害無 → 정식 지점분리 시 재검토(이번 스코프 아님).
