import {Router} from 'express';
import pg from 'pg';
import {createNgnEventInbox,createNgnNotificationWorker,verifyNgnEvent,type NgnTransaction} from '../services/ngnAgreementEvents';

/** Separate projection/notification store. Never mutates legacy escrow funding,
 * never provisions accounts, and never invokes a provider or on-chain service.
 */
export function ngnAgreementEventRuntime() {
  const router=Router();
  let pool:pg.Pool|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let stopped=false;
  let current=Promise.resolve();
  const enabled=()=>process.env.NGN_BALANCE_WORKERS_ENABLED==='true';
  function connection() {
    if(!process.env.DATABASE_URL) throw new Error('NGN event database is not configured');
    return pool??=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:5000});
  }
  const transaction:NgnTransaction=async run=>{
    const client=await connection().connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='15s'");
      const result=await run(client);await client.query('COMMIT');return result;
    } catch(error) {await client.query('ROLLBACK').catch(()=>{});throw error;}
    finally {client.release();}
  };
  const receive=createNgnEventInbox(transaction);
  router.post('/api/ngn/balance-agreements/events',async(req,res)=>{
    if(!enabled()) return res.status(503).json({error:'NGN_EVENT_PROCESSING_NOT_ENABLED'});
    const raw=(req as any).rawBody;
    if(typeof raw!=='string'||Buffer.byteLength(raw)>64000) return res.status(400).json({error:'INVALID_EVENT'});
    if(!verifyNgnEvent(raw,String(req.headers['x-ngn-event-timestamp']??''),String(req.headers['x-ngn-event-signature']??''),process.env.NGN_AGREEMENT_EVENT_SECRET??'')) {
      return res.status(401).json({error:'INVALID_EVENT_SIGNATURE'});
    }
    try {return res.json(await receive(JSON.parse(raw)));}
    catch {return res.status(503).json({error:'NGN_EVENT_NOT_COMMITTED'});}
  });
  const deliver=createNgnNotificationWorker(transaction,async(channel,payload)=>{
    const prefix=channel==='whatsapp'?'NGN_WHATSAPP_NOTIFY':'NGN_TELEGRAM_NOTIFY';
    const endpoint=process.env[prefix+'_URL'],secret=process.env[prefix+'_SECRET'];
    if(!endpoint||!secret||secret.length<32) throw new Error('NGN notification destination is not configured');
    const url=new URL(endpoint);
    if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search) throw new Error('Invalid NGN notification destination');
    const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{'content-type':'application/json','x-notify-secret':secret},body:JSON.stringify(payload)});
    if(!response.ok) throw new Error('NGN notification not acknowledged');
  });
  async function start() {
    if(!enabled()) return;
    await transaction(sql=>sql.query('SELECT lease_token,skipped_at FROM ngn_agreement_notifications LIMIT 0'));
    const run=()=>{current=(async()=>{
      try {for(let i=0;i<100&&await deliver();i++);}
      catch {console.error('NGN_NOTIFICATION_WORKER_FAILED');}
      if(!stopped){timer=setTimeout(run,5000);timer.unref();}
    })();};
    run();
  }
  async function stop(){stopped=true;if(timer)clearTimeout(timer);await current;await pool?.end();}
  return {router,start,stop};
}
