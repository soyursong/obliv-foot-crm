/**
 * T-20260530-foot-DASHBOARD-NOTICE-SAVE-FAIL 진단 (REST/service_role, 변경 즉시 롤백)
 * FK 제약은 role과 무관하게 강제되므로 service_role insert로 FK 위반 재현 가능.
 */
const URL = 'https://rxlomoozakkjesdqjtvd.supabase.co';
const SR = '***REMOVED-LEAKED-SERVICE-KEY******REMOVED-LEAKED-SERVICE-KEY***ijD9Amz_czcICgm-eXcyXH4pAPyjoB1BruxGwtoSsHg';
const h = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };

async function g(path) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { headers: h });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
}

// 1) 임의 user_profiles.id (= auth.uid()) 5개
const ups = await g('user_profiles?select=id&limit=5');
console.log('user_profiles 샘플:', JSON.stringify(ups.body));

// 2) 각 uid가 staff에 존재하는지
for (const up of ups.body ?? []) {
  const s = await g(`staff?id=eq.${up.id}&select=id`);
  console.log(`  auth.uid=${up.id} → staff 존재? ${(s.body?.length ?? 0) > 0}`);
}

// 3) clinic 하나
const cl = await g('clinics?select=id&limit=1');
const clinicId = cl.body?.[0]?.id;
const probeUid = ups.body?.[0]?.id;
console.log(`\nclinic_id=${clinicId}, probe auth.uid=${probeUid}`);

async function tryInsert(label, createdBy) {
  const r = await fetch(`${URL}/rest/v1/notices`, {
    method: 'POST',
    headers: { ...h, Prefer: 'return=representation' },
    body: JSON.stringify({ clinic_id: clinicId, title: `[diag] ${label}`, content: null, is_pinned: false, created_by: createdBy }),
  });
  const body = await r.json().catch(() => null);
  if (r.ok) {
    console.log(`INSERT created_by=${label} → 성공 (id=${body?.[0]?.id})`);
    // 롤백: 삭제
    await fetch(`${URL}/rest/v1/notices?id=eq.${body[0].id}`, { method: 'DELETE', headers: h });
    console.log(`  ↳ 삭제(롤백) 완료`);
  } else {
    console.log(`INSERT created_by=${label} → 실패 status=${r.status} code=${body?.code} msg=${body?.message}`);
    console.log(`  detail: ${body?.details ?? ''}`);
  }
}

await tryInsert(`auth.uid(${probeUid})`, probeUid);
await tryInsert('null', null);
