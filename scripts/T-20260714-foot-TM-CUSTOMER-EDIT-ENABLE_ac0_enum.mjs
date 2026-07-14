/**
 * T-20260714-foot-TM-CUSTOMER-EDIT-ENABLE — AC-0 선결 게이트 enumeration (READ-ONLY)
 *
 * ⚠️ READ-ONLY — SELECT / auth admin list 만. write 0.
 *
 * 목적: PROD role='tm' 계정을 전수 enumerate 하여 '풋 자체 TM' vs '도파민 TM콜센터'를 파티션.
 *   role 단일 enum 이라 role 만으로 구분 불가 → email/clinic/created_at/source 근거로 판정.
 *
 * 분기:
 *   (a) role=tm 전부 풋 자체 TM  → 그대로 AC-1~3 진행
 *   (b) 도파민 TM 혼재          → 구현중단 + planner FOLLOWUP (파티션 근거 동봉)
 *   ★silent 전체 grant 금지★
 *
 * 실행: node scripts/T-20260714-foot-TM-CUSTOMER-EDIT-ENABLE_ac0_enum.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');

const URL = process.env.VITE_SUPABASE_URL;
const SRK = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SRK) throw new Error('VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env required');

const sb = createClient(URL, SRK, { auth: { persistSession: false } });

// 도파민 TM콜센터 소속 판정 시그널 (근거 기록용)
const DOPAMINE_EMAIL_RE = /(dopamine|tm-?flow|콜센터|callcenter|@dopa)/i;

async function main() {
  // 1) role='tm' user_profiles 전수 (모든 컬럼)
  const { data: profiles, error: pErr } = await sb
    .from('user_profiles')
    .select('*')
    .eq('role', 'tm');
  if (pErr) throw new Error('user_profiles query failed: ' + pErr.message);

  // 2) clinics 조회 (clinic_id → slug/name)
  const { data: clinics } = await sb.from('clinics').select('id, slug, name');
  const clinicMap = new Map((clinics ?? []).map((c) => [c.id, c]));

  // 3) auth.users 전수 → email 매핑 (id → email, created 경로)
  const authUsers = [];
  let page = 1;
  for (;;) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error('auth listUsers failed: ' + error.message);
    authUsers.push(...(data?.users ?? []));
    if (!data || (data.users?.length ?? 0) < 1000) break;
    page += 1;
  }
  const authMap = new Map(authUsers.map((u) => [u.id, u]));

  // 4) 조합 + 판정
  const rows = (profiles ?? []).map((p) => {
    const au = authMap.get(p.id) || authMap.get(p.user_id) || null;
    const email = au?.email ?? p.email ?? null;
    const clinic = clinicMap.get(p.clinic_id) || null;
    const providers = au?.app_metadata?.providers || au?.app_metadata?.provider || null;
    const name = p.name ?? p.full_name ?? null;
    // 풋 회사 내부도메인(@medibuilder.com)이면서 clinic=jongno-foot 이면 풋 자체 TM 신호
    const emailDomain = email ? email.split('@')[1] ?? null : null;
    const dopamineSignal =
      (email && DOPAMINE_EMAIL_RE.test(email)) ||
      (name && DOPAMINE_EMAIL_RE.test(name)) ||
      (clinic?.slug && /dopamine|callcenter|tm-?flow/i.test(clinic.slug)) ||
      (p.source_system && /dopamine/i.test(p.source_system));
    return {
      id: p.id,
      email,
      email_domain: emailDomain,
      name,
      clinic_id: p.clinic_id ?? null,
      clinic_slug: clinic?.slug ?? null,
      clinic_name: clinic?.name ?? null,
      active: p.active,
      approved: p.approved ?? null,
      access_tier: p.access_tier ?? null,
      created_at: p.created_at ?? au?.created_at ?? null,
      auth_created_at: au?.created_at ?? null,
      auth_provider: providers,
      exempt_from_restrictions: p.exempt_from_restrictions ?? null,
      source_system: p.source_system ?? null,
      dopamine_signal: !!dopamineSignal,
    };
  });

  const dopamineSuspects = rows.filter((r) => r.dopamine_signal);

  const summary = {
    ticket: 'T-20260714-foot-TM-CUSTOMER-EDIT-ENABLE',
    ac: 'AC-0 (선결 게이트)',
    total_tm_profiles: rows.length,
    dopamine_suspect_count: dopamineSuspects.length,
    branch: dopamineSuspects.length === 0 ? '(a) 풋 자체 TM only → AC-1~3 진행' : '(b) 도파민 TM 혼재 의심 → 구현중단 + FOLLOWUP',
    profile_columns: profiles?.[0] ? Object.keys(profiles[0]) : [],
    rows,
    dopamine_suspects: dopamineSuspects,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'T-20260714-TM-CUSTOMER-EDIT-ENABLE_ac0.json'), JSON.stringify(summary, null, 2));

  console.log('=== AC-0 role=tm enumeration ===');
  console.log('total role=tm profiles:', rows.length);
  console.log('profile columns:', summary.profile_columns.join(', '));
  console.log('');
  for (const r of rows) {
    console.log(`- id=${r.id}`);
    console.log(`    email=${r.email}  name=${r.name}  active=${r.active}  approved=${r.approved}  tier=${r.access_tier}`);
    console.log(`    clinic=${r.clinic_slug}(${r.clinic_name})  created=${r.created_at}`);
    console.log(`    provider=${JSON.stringify(r.auth_provider)}  source_system=${r.source_system}  DOPAMINE_SIGNAL=${r.dopamine_signal}`);
  }
  // 클리닉/도메인 분포 (파티션 근거)
  const byClinic = {}; const byDomain = {};
  for (const r of rows) { byClinic[r.clinic_slug] = (byClinic[r.clinic_slug]||0)+1; byDomain[r.email_domain] = (byDomain[r.email_domain]||0)+1; }
  console.log('');
  console.log('clinic 분포:', JSON.stringify(byClinic));
  console.log('email 도메인 분포:', JSON.stringify(byDomain));
  console.log('');
  console.log('>>> BRANCH:', summary.branch);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
