import { Router } from 'express';
import { createNgnAgreementClient, NgnAgreementClientError } from '../services/ngnAgreementClient';

/** User-authenticated NGN facade. Payment remains the financial authority.
 * No service key may replace the user's bearer token/step-up confirmation.
 */
export function ngnAgreementRouter() {
  const router=Router();
  const root='/api/ngn/balance-agreements';
  const actions=new Set(['fund','accept','start','deliver','release','dispute','cancel']);
  router.all([root,root+'/:id',root+'/:id/:action'],async(req,res)=>{
    if(process.env.NGN_BALANCE_AGREEMENTS_ENABLED!=='true') return res.status(503).json({error:'NGN_AGREEMENTS_NOT_ENABLED'});
    const authorization=req.headers.authorization;
    if(!authorization?.startsWith('Bearer ')||authorization.length>8192) return res.status(401).json({error:'AUTHENTICATION_REQUIRED'});
    const baseUrl=process.env.NGN_PAYMENT_API_BASE_URL;
    if(!baseUrl) return res.status(503).json({error:'NGN_PAYMENT_API_NOT_CONFIGURED'});
    const {id,action}=req.params as {id?:string;action?:string};
    try {
      const client=createNgnAgreementClient({baseUrl,getUserAccessToken:async()=>authorization.slice(7)});
      let data:unknown;
      if(req.method==='GET'&&!id) data=await client.list();
      else if(req.method==='GET'&&id==='balance'&&!action) data=await client.balance();
      else if(req.method==='GET'&&id&&!action) data=await client.get(id);
      else if(req.method==='POST'&&!id) {
        if(!req.body || Array.isArray(req.body) ||
          Object.keys(req.body).some(k=>!['id','sellerId','title','principalKobo','credential'].includes(k))) {
          return res.status(400).json({error:'INVALID_REQUEST'});
        }
        data=await client.create(req.body);
      }
      else if(req.method==='POST'&&id&&action&&actions.has(action)) {
        if(!req.body || Object.keys(req.body).some(k=>k!=='credential') || typeof req.body.credential!=='string') {
          return res.status(400).json({error:'INVALID_REQUEST'});
        }
        data=await client.act(id,action as Parameters<typeof client.act>[1],req.body.credential);
      } else return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
      return res.json({data});
    } catch(error) {
      const message=error instanceof Error?error.message:'';
      const code=/^[A-Z0-9_]{1,80}$/.test(message)?message:'NGN_SERVICE_UNAVAILABLE';
      const status=error instanceof NgnAgreementClientError && [400,401,403,404,409,429,503,504].includes(error.status) ? error.status : 503;
      return res.status(status).json({error:code});
    }
  });
  return router;
}
