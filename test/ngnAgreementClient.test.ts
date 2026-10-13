import { describe, it, expect, vi } from 'vitest';
import { createNgnAgreementClient } from '../src/services/ngnAgreementClient';

describe('NGN agreement client contract', () => {
  it('has no remote HTTP or embedded-credential URL fallback', () => {
    for (const baseUrl of ['', 'http://payments.example', 'https://user:secret@payments.example']) {
      expect(() => createNgnAgreementClient({baseUrl,getUserAccessToken:async () => 'test'})).toThrow();
    }
  });
  it('requires a user token before making any request', async () => {
    const request = vi.fn();
    const client = createNgnAgreementClient({baseUrl:'https://payments.example',getUserAccessToken:async () => '',request});
    await expect(client.list()).rejects.toThrow('User authentication');
    expect(request).not.toHaveBeenCalled();
  });
  it('sends an action credential, not caller-selected identity or success flags', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({data:{status:'FUNDED'}}),{headers:{'content-type':'application/json'}}));
    const client = createNgnAgreementClient({baseUrl:'https://payments.example',getUserAccessToken:async () => 'test-user-token',request});
    await expect(client.act('agreement_1','fund','opaque-confirmation')).resolves.toEqual({status:'FUNDED'});
    expect(request).toHaveBeenCalledTimes(1);
    const call = request.mock.calls[0] as unknown as [string,RequestInit];
    expect(call[0]).toBe('https://payments.example/api/ngn/balance-agreements/agreement_1/fund');
    expect(JSON.parse(call[1].body as string)).toEqual({credential:'opaque-confirmation'});
    expect(call[1].redirect).toBe('error');
  });
  it('does not retry ambiguous writes or render HTML gateway bodies as success', async () => {
    const request = vi.fn(async () => new Response('<html>Gateway timeout</html>',{status:504,headers:{'content-type':'text/html'}}));
    const client = createNgnAgreementClient({baseUrl:'https://payments.example',getUserAccessToken:async () => 'test',request});
    await expect(client.act('id','fund','opaque')).rejects.toThrow('Check status before retrying');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('preserves safe machine-readable failure codes', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({error:'INSUFFICIENT_BALANCE'}),{status:409,headers:{'content-type':'application/json'}}));
    const client = createNgnAgreementClient({baseUrl:'https://payments.example',getUserAccessToken:async () => 'test',request});
    await expect(client.act('id','fund','opaque')).rejects.toThrow('INSUFFICIENT_BALANCE');
  });
});
