import express from 'express';
import request from 'supertest';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {ngnAgreementRouter} from '../src/routes/ngnAgreements';
import type {Server} from 'node:http';

describe('NGN user-authenticated facade',()=>{
  const saved={enabled:process.env.NGN_BALANCE_AGREEMENTS_ENABLED,url:process.env.NGN_PAYMENT_API_BASE_URL};
  const servers:Server[]=[];
  beforeEach(()=>{process.env.NGN_BALANCE_AGREEMENTS_ENABLED='true';process.env.NGN_PAYMENT_API_BASE_URL='https://payments.example';});
  afterEach(async()=>{
    await Promise.all(servers.splice(0).map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));
    vi.unstubAllGlobals();
    for(const [key,value] of Object.entries({NGN_BALANCE_AGREEMENTS_ENABLED:saved.enabled,NGN_PAYMENT_API_BASE_URL:saved.url})) {
      if(value===undefined) delete process.env[key];else process.env[key]=value;
    }
  });
  async function app(){
    const instance=express();instance.use(express.json());instance.use(ngnAgreementRouter());
    return new Promise<Server>((resolve,reject)=>{
      const server=instance.listen(0,'127.0.0.1',()=>{servers.push(server);resolve(server);});
      server.once('error',reject);
    });
  }
  it('fails closed before any upstream request without enablement or user authentication',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    process.env.NGN_BALANCE_AGREEMENTS_ENABLED='false';
    expect((await request(await app()).get('/api/ngn/balance-agreements')).status).toBe(503);
    process.env.NGN_BALANCE_AGREEMENTS_ENABLED='true';
    expect((await request(await app()).post('/api/ngn/balance-agreements/job/fund').set('x-core-api-key','fixture-service-only').send({credential:'fixture'})).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('forwards the user credential and exact action to the payment authority',async()=>{
    const fetch=vi.fn(async()=>new Response(JSON.stringify({data:{id:'job',status:'FUNDED'}}),{headers:{'content-type':'application/json'}}));
    vi.stubGlobal('fetch',fetch);
    const response=await request(await app()).post('/api/ngn/balance-agreements/job/fund').set('authorization','Bearer user-fixture').send({credential:'bound-fixture'});
    expect(response.status).toBe(200);expect(response.body.data.status).toBe('FUNDED');
    const [url,options]=fetch.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe('https://payments.example/api/ngn/balance-agreements/job/fund');
    expect(options.headers).toMatchObject({authorization:'Bearer user-fixture'});
    expect(JSON.parse(options.body as string)).toEqual({credential:'bound-fixture'});
  });
  it('does not forward caller-selected actor/fee fields',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    expect((await request(await app()).post('/api/ngn/balance-agreements').set('authorization','Bearer fixture').send({buyerId:'victim',feeKobo:'0'})).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('handles invalid configuration and upstream failure without retrying a mutation',async()=>{
    const fetch=vi.fn(async()=>new Response('<html>timeout</html>',{status:504}));vi.stubGlobal('fetch',fetch);
    const response=await request(await app()).post('/api/ngn/balance-agreements/job/accept').set('authorization','Bearer fixture').send({credential:'fixture'});
    expect(response.status).toBe(503);expect(fetch).toHaveBeenCalledTimes(1);
    process.env.NGN_PAYMENT_API_BASE_URL='invalid';
    expect((await request(await app()).get('/api/ngn/balance-agreements').set('authorization','Bearer fixture')).status).toBe(503);
  });
});
