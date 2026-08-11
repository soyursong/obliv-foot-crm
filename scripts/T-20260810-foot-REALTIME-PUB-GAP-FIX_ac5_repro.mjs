// AC-5 realtime delivery repro — T-20260810-foot-REALTIME-PUB-GAP-FIX
// Non-destructive: same-value UPDATE (SET col = current value) on prod rows of
// newly-published tables. Proves:
//   (M-gap) rooms newly ADDed → realtime UPDATE event now delivered.
//   (F-gap) duty_roster REPLICA IDENTITY FULL → filtered UPDATE delivers old-row
//           WITH non-PK columns (clinic_id present in payload.old). Under DEFAULT
//           payload.old would contain the PK only.
// tables chosen = NO triggers (rooms, duty_roster) → same-value UPDATE = true no-op.
import { createClient } from '@supabase/supabase-js';
import WS from 'ws';

// new-format keys (legacy anon/service_role disabled 2026-08-02 → realtime 401)
const URL = process.env.FOOT_URL;
const SECRET = process.env.FOOT_SECRET; // sb_secret_... (RLS-bypass, mirrors service_role)
if (!URL || !SECRET) { console.error('missing FOOT_URL/FOOT_SECRET'); process.exit(2); }

const CLINIC = '74967aea-a60b-4da3-a0e7-9c997a930bc8';
const ROOM_ID = 'b4edeeed-1182-4b0f-a55a-15528165816e';
const DR_ID = 'cdf59add-1abc-4344-86f9-3554f2f9397e';

const rt = createClient(URL, SECRET, { realtime: { transport: WS, params: { eventsPerSecond: 10 } } });
const db = createClient(URL, SECRET, { auth: { persistSession: false } });

const got = { rooms: null, duty: null };

function waitSub(ch, name) {
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('subscribe timeout ' + name)), 15000);
    ch.subscribe((status, err) => {
      console.log(`[sub:${name}] ${status}`, err ? JSON.stringify(err.message||err) : '');
      if (status === 'SUBSCRIBED') { clearTimeout(to); res(); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(to); rej(err || new Error(status)); }
    });
  });
}

const chRooms = rt.channel('ac5-rooms').on('postgres_changes',
  { event: '*', schema: 'public', table: 'rooms', filter: `clinic_id=eq.${CLINIC}` },
  (p) => { if (!got.rooms) got.rooms = p; });

const chDuty = rt.channel('ac5-duty').on('postgres_changes',
  { event: 'UPDATE', schema: 'public', table: 'duty_roster', filter: `clinic_id=eq.${CLINIC}` },
  (p) => { if (!got.duty) got.duty = p; });

const main = async () => {
  await rt.realtime.setAuth(SECRET);
  await Promise.all([waitSub(chRooms, 'rooms'), waitSub(chDuty, 'duty')]);
  console.log('[sub] both channels SUBSCRIBED');
  await new Promise(r => setTimeout(r, 800)); // settle

  // read current values (to write them back — true no-op)
  const { data: room } = await db.from('rooms').select('id,name').eq('id', ROOM_ID).single();
  const { data: dr } = await db.from('duty_roster').select('id,notes').eq('id', DR_ID).single();

  // same-value UPDATEs (emit WAL, change nothing)
  const u1 = await db.from('rooms').update({ name: room.name }).eq('id', ROOM_ID);
  if (u1.error) throw new Error('rooms update: ' + u1.error.message);
  const u2 = await db.from('duty_roster').update({ notes: dr.notes ?? null }).eq('id', DR_ID);
  if (u2.error) throw new Error('duty update: ' + u2.error.message);
  console.log('[write] same-value UPDATE fired on rooms + duty_roster');

  // wait for delivery
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline && (!got.rooms || !got.duty)) {
    await new Promise(r => setTimeout(r, 300));
  }

  const roomOk = !!got.rooms;
  const dutyOk = !!got.duty;
  const dutyOld = got.duty?.old || {};
  const fullOk = dutyOk && Object.prototype.hasOwnProperty.call(dutyOld, 'clinic_id') && dutyOld.clinic_id === CLINIC;

  console.log('\n===== AC-5 RESULT =====');
  console.log('M-gap  rooms realtime event delivered :', roomOk, got.rooms ? `(${got.rooms.eventType})` : '');
  console.log('membership duty_roster event delivered:', dutyOk, got.duty ? `(${got.duty.eventType})` : '');
  console.log('F-gap  duty_roster payload.old keys   :', Object.keys(dutyOld).join(',') || '(empty)');
  console.log('F-gap  FULL old-row has clinic_id     :', fullOk);
  console.log('=======================\n');

  await rt.removeAllChannels();
  if (roomOk && dutyOk && fullOk) { console.log('AC-5 PASS'); process.exit(0); }
  console.log('AC-5 FAIL'); process.exit(1);
};

main().catch(e => { console.error('AC-5 ERROR', e.message); process.exit(3); });
