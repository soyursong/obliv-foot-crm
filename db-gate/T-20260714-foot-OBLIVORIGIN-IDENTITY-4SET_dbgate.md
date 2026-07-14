# T-20260714-foot-OBLIVORIGIN-IDENTITY-4SET — DB-write 게이트 (#1 기관명 = 옵션B)

- **환경**: prod Supabase `rxlomoozakkjesdqjtvd`
- **적용시각**: 2026-07-14 (Asia/Seoul)
- **by**: agent-fdd-dev-foot
- **db_change**: 있음 (기존 컬럼 값 정정 UPDATE — 스키마 변경 0, DDL 0, 신규 컬럼 0 → DA CONSULT 불요)
- **권위 근거 (⚠ REVERSAL)**: planner #1 前 판정은 '점' strip(옵션A '오블리브의원 서울 오리진')이었으나,
  CEO DECISION MSG-xdax 가 사업자등록증 상호 verbatim = **옵션B '오블리브의원 서울오리진점'**(붙임 + 끝 점) 확정.
  前 옵션A 판정 폐기(policy_superseded). planner FIX-REQUEST MSG-20260714-152258-e9j3.

## 확정값 3형 구분 (혼동 방지)
| 표기 | 문자열 | 상태 |
|------|--------|------|
| 옵션B (확정) | `오블리브의원 서울오리진점` | ✅ 사업자등록 상호 verbatim (붙임+끝점) |
| 옵션A (폐기) | `오블리브의원 서울 오리진` | ✗ strip 오기 (공백·점없음) — CEO REVERSAL |
| 원본 (폐기) | `오블리브의원 서울 오리진점` | ✗ Stage1 원본 (공백+점) |

## DRY-RUN (현재값 확인)
```
SELECT id, slug, name, representative_name, nhis_code FROM clinics WHERE slug='jongno-foot';
-- → 1행 (id=74967aea-...). name='오블리브의원 서울오리진점'(옵션B) · representative_name='박영진' · nhis_code='13328581'
```

## APPLIED (옵션A → 옵션B 재-UPDATE, slug+현재값 이중 가드)
```sql
UPDATE clinics SET name='오블리브의원 서울오리진점'
WHERE slug='jongno-foot' AND name IN ('오블리브의원 서울 오리진','오블리브의원 서울 오리진점')
RETURNING id, slug, name;
-- → 1행 변경 (jongno-foot: '오블리브의원 서울오리진점')
```
> 실측(2026-07-14): prod clinics(jongno-foot).name 이미 옵션B로 반영 확인 (probe 결과 상단 DRY-RUN 참조).
> 앞선 옵션A(strip) write 는 옵션B 로 정정 완료. ADDITIVE·비파괴, 타지점/타필드 무변경.

## ROLLBACK SQL (동봉)
```sql
-- 옵션B → 원본(공백+점) 복원 (rollback 목적지 = Stage1 원본)
UPDATE clinics SET name='오블리브의원 서울 오리진점'
WHERE slug='jongno-foot' AND name='오블리브의원 서울오리진점';
```

## 스코프 가드 검증 (AC-5)
| slug | name (AFTER) | representative_name | 판정 |
|------|--------------|---------------------|------|
| jongno-foot | 오블리브의원 서울오리진점 | 박영진 | ✅ 옵션B 정합 |
| songdo-foot | 오블리브 풋센터 송도 | (null) | ✅ 무영향 (미변경) |

## 렌더 실측 (WARN-A 게이트)
- 하니스: `scripts/T-20260714-foot-OBLIVORIGIN-IDENTITY-4SET_render.mjs`
- 증빙: `evidence/oblivorigin-identity-4set/*.png` (기관명 슬롯 보유 전 출력서류)
- 검증: 전 서류 옵션B 렌더 · stale(옵션A+원본) 0건 · 미치환 0건 · nhis 13328581 유지(#3 회귀 0)
- 회귀 스펙: `tests/e2e/T-20260714-foot-OBLIVORIGIN-IDENTITY-4SET.spec.ts`

## ⚠ OPEN FLAG — 요양기관명(심평원 등록명) vs 사업자등록 상호 축 분기 (planner 재상신)
- 현행 구현: 진료비계산서·영수증(`bill_receipt`)의 "요양기관명", 세부산정내역의 "요양기관 명칭",
  공단/EDI-format 서류가 모두 단일 `{{clinic_name}}` ← `clinics.name`(옵션B) 로 바인딩.
  즉 **사업자등록 상호 축과 요양기관명(심평원 등록명) 축이 현재 UNIFIED**.
- dev 임의 판단 금지 조건(MSG-e9j3): 심평원 등록명이 사업자등록 상호와 별개일 수 있음.
  현 코드/데이터로는 심평원 등록명 == 옵션B 여부를 확인 불가 → **FLAG 재상신**(planner FOLLOWUP `medvhira_orgname_axis`).
  갈리면(≠) 요양기관명 전용 필드 분리 필요 = 후속 티켓.

## 스코프 밖 (본 FIX 미포함)
- **#2 대표자(박영진)**: clinics.representative_name = 박영진 (기 반영·유지). print {{doctor_name}} 재배선은 별개 티켓(진료의 축) — 미접촉. 기존 게이트(MSG-sunb) 유지, 재-ping 금지.
- **#3 요양기관번호(nhis_code/hira_org_code=13328581)**: 유지, 회귀 0.
- **#4 대표도장**: verify-only PASS. leaf 미접촉.
