# Dry-run Report — T-20260607-foot-CONTRAINDICATION-MGMT AC-3 심각도 enum 축소(주의/금기)

- 작성: dev-foot · 2026-06-07
- 게이트: **supervisor dry-run 게이트** (GO 전 prod apply 금지 · planner MSG-211523-vwhi §3)
- 대상 DB(dev): `rxlomoozakkjesdqjtvd`
- 범위: 본 패키지는 **AC-3 마이그 1지점만** 게이트. AC-0/1/2 + AC-3 FE(버튼화)는 baseline으로 배포 진행(독립).

## 변경 요약

| # | 변경 | 종류 | 무손실 |
|---|------|------|--------|
| 1 | `prescription_contraindications.severity` 2값 外 → '금기' 리매핑 | data update | ✗ (롤백 비복원) |
| 2 | `chk_contra_severity_2val` CHECK 추가 (severity NULL OR IN('주의','금기')) | additive constraint | ✓ |

## Dry-run 실측 (read-only, 2026-06-07 dev)

```
prescription_contraindications 심각도 분포:
  '주의' : 1
  2값 外 : 0
→ STEP 1 리매핑 영향: 0건 (dev no-op)
→ STEP 2 CHECK 추가: 위반행 0 → 즉시 성공
```

### 핵심 발견
- dev 금기증 데이터 1건('주의')뿐, '경고' 등 2값 外 **0건** → dev에서 마이그는 사실상 no-op·무위험.
- **prod는 분포가 다를 수 있음** → prod apply 직전 `distribution.sql` 재실행 필수.
- STEP 1(리매핑)은 **롤백 비복원**(원본 '경고' 유실). 2값 外 행이 있으면 적용 전 백업 CSV 캡처(distribution.sql §3) 권고.

## supervisor 확인 요청 사항
1. **매핑 규칙 승인**: 2값 外('경고' 등) → '금기' 흡수(안전측 over-warn)가 적절한가? '주의'로 내릴지 현장(문지은 대표원장) 확인 필요할 수 있음.
2. prod distribution 결과 공유 후 GO 판정.

## 파일
- forward: `supabase/migrations/20260607220000_contra_severity_reduce.sql`
- rollback: `supabase/migrations/20260607220000_contra_severity_reduce.rollback.sql`
- distribution(read-only): `supabase/migrations/20260607220000_contra_severity_reduce.distribution.sql`

## 적용 순서 (supervisor GO 후)
1. `distribution.sql` §1·§2 prod 실행 → 2값 外 규모 확인
2. (2값 外 >0 이면) §3 백업 CSV 캡처
3. 매핑 규칙 최종 확정 → `..._reduce.sql` apply
4. 검증: 분포 재조회(주의/금기/null 만 잔존)

## 리스크
- FE 버튼화는 이미 배포(마이그 무관 — 레거시 '경고' 행도 badge 안전 표시). 마이그는 **데이터 정합/CHECK 강제**만 담당.
- 유일 위험: STEP 1 리매핑 비복원 → 백업으로 차단.
