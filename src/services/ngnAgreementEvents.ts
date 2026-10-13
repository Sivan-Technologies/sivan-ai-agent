import {createHash,createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {z} from 'zod';

interface Sql {query(sql:string,params?:any[]):Promise<{rows:any[]}>}
export type NgnTransaction=<T>(run:(sql:Sql)=>Promise<T>)=>Promise<T>;
const key=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const eventSchema=z.object({
  id:z.string().min(1).max(300),sequence:z.string().regex(/^[1-9][0-9]{0,18}$/),
  agreement:z.object({id:key,buyer_id:key,seller_id:key,
    status:z.enum(['DRAFT_PENDING_SELLER_KYC','PENDING_PAYMENT','FUNDED_PENDING_ACCEPTANCE','FUNDED','IN_DELIVERY','DELIVERED','DISPUTED','COMPLETED','CANCELLED']),
    principal_kobo:z.string().regex(/^[1-9][0-9]{0,14}$/),fee_kobo:z.string().regex(/^[0-9]{1,15}$/),
    funded_at:z.unknown().optional()}).passthrough(),
  recipients:z.array(z.object({userId:key,whatsapp:z.string().regex(/^(whatsapp:)?\+?[0-9]{7,15}$/).optional(),
    telegramId:z.string().regex(/^[0-9]{1,20}$/).optional()}).strict()).length(2),
}).strict();

export function verifyNgnEvent(raw:string,timestamp:string,signature:string,secret:string,now=Date.now()) {
  if(secret.length<32||!/^\d{13}$/.test(timestamp)||Math.abs(now-Number(timestamp))>300000||!/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected=createHmac('sha256',secret).update(timestamp+'.'+raw).digest();
  return timingSafeEqual(expected,Buffer.from(signature,'hex'));
}
function message(a:z.infer<typeof eventSchema>['agreement']) {
  const summaries:Record<string,string>={
    DRAFT_PENDING_SELLER_KYC:'Seller setup and acceptance are pending. The invitation expires after 48 hours.',
    PENDING_PAYMENT:'The agreement is awaiting balance funding.',
    FUNDED_PENDING_ACCEPTANCE:'Funds are reserved. Seller setup and acceptance are still required.',
    FUNDED:'Funds are reserved and the agreement is accepted.',
    IN_DELIVERY:'Work has started.',DELIVERED:'Delivery was submitted. Buyer review is required.',
    DISPUTED:'A dispute is awaiting authorized human review.',COMPLETED:'Settlement has been recorded in Sivan NGN balances.',
    CANCELLED:a.funded_at?'The agreement was cancelled. Principal and the platform fee were returned to the buyer’s NGN balance.':'The unfunded agreement was cancelled.',
  };
  return `Sivan NGN agreement ${a.id}\n${summaries[a.status]}`;
}

export function createNgnEventInbox(transaction:NgnTransaction) {
  return async (input:unknown)=>{
    const event=eventSchema.parse(input), a=event.agreement;
    if(new Set(event.recipients.map(r=>r.userId)).size!==2 ||
      event.recipients.some(r=>![a.buyer_id,a.seller_id].includes(r.userId)||(!r.whatsapp&&!r.telegramId))) throw new Error('NGN_EVENT_RECIPIENT_MISMATCH');
    const digest=createHash('sha256').update(JSON.stringify(event)).digest('hex');
    return transaction(async sql=>{
      const inserted=await sql.query('INSERT INTO ngn_agreement_event_inbox(id,digest) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING id',[event.id,digest]);
      if(!inserted.rows.length) {
        const prior=(await sql.query('SELECT digest FROM ngn_agreement_event_inbox WHERE id=$1',[event.id])).rows[0];
        if(prior.digest!==digest) throw new Error('NGN_EVENT_ID_CONFLICT');
        return {duplicate:true};
      }
      const updated=await sql.query(`INSERT INTO ngn_agreement_projection(id,sequence,payload) VALUES ($1,$2,$3::jsonb)
        ON CONFLICT(id) DO UPDATE SET sequence=EXCLUDED.sequence,payload=EXCLUDED.payload
        WHERE ngn_agreement_projection.sequence<EXCLUDED.sequence RETURNING id`,[a.id,event.sequence,JSON.stringify(a)]);
      if(!updated.rows.length) return {stale:true};
      for(const r of event.recipients) for(const channel of ['whatsapp','telegram'] as const) {
        const destination=channel==='whatsapp'?r.whatsapp:r.telegramId;
        if(!destination) continue;
        const payload=channel==='whatsapp'?{to:destination,message:message(a)}:{telegramId:destination,message:message(a)};
        await sql.query(`INSERT INTO ngn_agreement_notifications(id,agreement_id,sequence,channel,payload)
          VALUES ($1,$2,$3,$4,$5::jsonb)`,[`${event.id}:${channel}:${r.userId}`,a.id,event.sequence,channel,JSON.stringify(payload)]);
      }
      return {accepted:true};
    });
  };
}

export function createNgnNotificationWorker(transaction:NgnTransaction,send:(channel:string,payload:unknown)=>Promise<void>) {
  return async()=>{
    const token=randomUUID();
    const row=await transaction(async sql=>(await sql.query(`UPDATE ngn_agreement_notifications SET
      lease_token=$1,lease_until=clock_timestamp()+interval '60 seconds',attempts=attempts+1
      WHERE id=(SELECT id FROM ngn_agreement_notifications WHERE delivered_at IS NULL AND skipped_at IS NULL
        AND next_attempt_at<=clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp())
        ORDER BY sequence FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,[token])).rows[0]);
    if(!row) return false;
    try {
      const current=await transaction(async sql=>(await sql.query('SELECT sequence::text FROM ngn_agreement_projection WHERE id=$1',[row.agreement_id])).rows[0]);
      // Do not send an old pending card after a more recent settlement event.
      const fresh=Boolean(current && BigInt(current.sequence)===BigInt(row.sequence));
      if(fresh) await send(row.channel,row.payload);
      await transaction(sql=>sql.query(`UPDATE ngn_agreement_notifications SET
        delivered_at=CASE WHEN $3 THEN clock_timestamp() ELSE NULL END,
        skipped_at=CASE WHEN $3 THEN NULL ELSE clock_timestamp() END,
        lease_token=NULL,lease_until=NULL,last_error_code=NULL WHERE id=$1 AND lease_token=$2`,[row.id,token,fresh]));
    } catch {
      await transaction(sql=>sql.query(`UPDATE ngn_agreement_notifications SET lease_token=NULL,lease_until=NULL,
        next_attempt_at=clock_timestamp()+interval '30 seconds',last_error_code='NOTIFICATION_FAILED'
        WHERE id=$1 AND lease_token=$2`,[row.id,token]));
    }
    return true;
  };
}
