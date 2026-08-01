# T-20260802-foot-EXAMFEE-AA254-AA222-SEEDSCORE-VERIFY — 대조 결과

- **판정: NO-OP (무정정 close). UPDATE 0.**
- 실행일: 2026-08-02 / dev-foot
- 인증컨텍스트: Supabase Management API `/database/query` = **service_role 등가(RLS bypass, NOT anon)** — anon 0-row wipe 오독 배제(cross-CRM 진단 인증컨텍스트 표준 준수).
- 대상: foot prod `public.services` (project ref rxlomoozakkjesdqjtvd)

## 대조표 (national canonical vs foot 실측)

| 코드 | foot 정식명 행 (active) | foot 실측 hira_score | national canonical (body 확정·배포) | 결과 | 표시액(×95.6 round_10) foot / canon |
|------|------|------|------|------|------|
| AA254 | 재진진찰료-의원 (id 117befad…, active=true) | **139.85** | 139.85 (T-20260728-body-AA254 deployed, body_500) | **MATCH ✅** | 13,370 / 13,370 |
| AA222 | 재진-물리치료,주사 등 시술받은 경우 (id 1a82c70a…, active=true) | **49.09** | 49.09 (T-20260729-body-AA222 DA-STAMP deployed, body_503) | **MATCH ✅** | 4,690 / 4,690 |

national-code 단일값 원칙(seed hira_score = center-independent 국가 상대가치점수) → body 확정값 = foot 정본. foot 저장값이 이미 정본과 동일 → 정정 불요.

## 무접점 노이즈 행 (정정대상 아님)
| 코드 | name | hira_score | active | 판정 |
|------|------|------|------|------|
| AA155 | 재진진찰료 | NULL | false | 비활성·NULL, 표시/과금 무접점 — 무접촉 |
| C2100001 | 재진진찰료(영상판독) | NULL | false | 비활성·NULL, 표시/과금 무접점 — 무접촉 |

## DoD 충족
- [x] foot AA254·AA222 실측 hira_score vs national canonical 대조표 evidence 첨부.
- [x] 일치 → 무정정 close (UPDATE 0). 마이그 산출 없음 → **MIG-GATE evidence N/A** (가드레일 명시대로).
- [x] 금액 대조(정본×95.6 round_10 = AA254 13,370 / AA222 4,690)와 foot 표시액 정합 확인 — 무변.
- [x] AA154(197.12, 부모)·기타 코드 무접촉.
- [x] mnr8 echo blocked-wait 재요청 안 함 — SSOT 수렴 확인됨(§13.1.A REDEFINITION_RISK 차단).

## 배포 영향
- prod write **0건** (SELECT-only probe). CF Pages 재배포 불요. 현장 무영향.
- supervisor DB-gate 불필요(무정정, 마이그 없음).

원시 출력: `T-20260802-foot-EXAMFEE-AA254-AA222-SEEDSCORE-VERIFY_evidence.txt`
