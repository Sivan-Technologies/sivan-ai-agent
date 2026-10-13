import {createHmac} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {verifyNgnEvent} from '../src/services/ngnAgreementEvents';
describe('NGN event signatures',()=>{
  it('authenticates exact body and rejects stale, future or tampered deliveries',()=>{
    const secret='fixture-only-secret-'.repeat(3),now=Date.now(),time=String(now),raw='{"id":"fixture"}';
    const signature=createHmac('sha256',secret).update(time+'.'+raw).digest('hex');
    expect(verifyNgnEvent(raw,time,signature,secret,now)).toBe(true);
    expect(verifyNgnEvent(raw+' ',time,signature,secret,now)).toBe(false);
    expect(verifyNgnEvent(raw,time,signature,secret,now+300001)).toBe(false);
    expect(verifyNgnEvent(raw,time,signature,secret,now-300001)).toBe(false);
    expect(verifyNgnEvent(raw,time,'bad',secret,now)).toBe(false);
    expect(verifyNgnEvent(raw,time,signature,'',now)).toBe(false);
  });
});
