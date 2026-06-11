# T-20260611-foot-DASH-SMS-IMG-BUCKET-NOTFOUND — DB-Gate Evidence

- 작성: dev-foot / 2026-06-11
- 증상: 대시보드 문자(MMS) 발송 모달 이미지 첨부 시 `StorageApiError: Bucket not found`
- 스샷: /Users/domas/file_inbox/20260611/103924_F0B9NTALDSR_20260611_102453.png

## H0 진단 (diagnose-first)

코드 버킷명 확정: `src/lib/mmsImage.ts` → `MMS_BUCKET = 'message-images'`.
prod 직접 연결(pg, pooler) 진단 결과 — 마이그 `20260609200000` 전체가 prod 미적용:

| 항목 | 진단 전(prod) |
|------|--------------|
| storage.buckets `message-images` | **MISSING** |
| RLS `msgimg_*` 정책 | 없음 |
| `notification_templates.image_path` 컬럼 | **MISSING** |
| 헬퍼 `get_user_clinic_id()` | 존재(참조 유효) |

→ 코드≠prod mismatch 아님. **버킷 프로비저닝 누락**(마이그 미적용)이 근인.
→ 임의 신규 버킷 생성 금지 원칙 준수: 기존 마이그(코드와 동일 버킷명)를 그대로 적용.

## 조치

- 기존 idempotent 마이그 `supabase/migrations/20260609200000_notification_templates_image_mms.sql` 를
  prod 에 직접 적용(트랜잭션 래핑) — `scripts/T-20260611-foot-DASH-SMS-IMG-BUCKET-NOTFOUND_apply.mjs`
- 롤백: `supabase/migrations/20260609200000_notification_templates_image_mms.rollback.sql`

## 영속 검증 (별도 연결, ALL PASS)

```
✅ message-images bucket exists
✅ bucket is private (public=false)
✅ msgimg_clinic_read  [SELECT] authenticated, clinic_id 1st-segment 격리
✅ msgimg_clinic_write [ALL]    authenticated, clinic_id 1st-segment 격리
✅ no anon/public open policy (PHI-인접 전체개방 차단 — GO_WARN 요건)
✅ notification_templates.image_path exists
```

## 잔여 / QA

- FE 코드 변경 0건(이미 올바른 버킷명 참조) → 빌드 영향 없음.
- supervisor QA: prod 발송 모달에서 로그인 사용자 기준 이미지 첨부 업로드 정상 확인.
- 부수효과: `image_path` 컬럼도 동시 복구 → 템플릿 이미지 저장(TEMPLATE-IMAGE-SAVE) 정상화.
