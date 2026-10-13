/**
 * NGN-only v1 client. User authorization must come from the secure confirmation
 * flow; a bot/service secret or phone-number parameter is not a substitute.
 * No default URL, embedded key, automatic write retry, provider or on-chain call.
 * Not wired to chat buttons until the payment runtime rollout gate is complete.
 */
export function createNgnAgreementClient(options: {
  baseUrl: string;
  getUserAccessToken: () => Promise<string>;
  request?: typeof fetch;
}) {
  const base = new URL(options.baseUrl);
  if (base.username || base.password || base.search || base.hash ||
      !(base.protocol === 'https:' || (base.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(base.hostname)))) {
    throw new Error('A configured HTTPS payment API URL is required');
  }
  const request = options.request ?? fetch;
  const root = options.baseUrl.replace(/\/+$/, '') + '/api/ngn/balance-agreements';
  async function call(path: string, body?: unknown) {
    const token = await options.getUserAccessToken();
    if (!token) throw new Error('User authentication is required');
    const response = await request(root + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type':'application/json' },
      ...(body === undefined ? {} : { body:JSON.stringify(body) }),
      signal:AbortSignal.timeout(15000),
      redirect:'error',
    });
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) throw new Error('NGN service response unavailable. Check status before retrying.');
    const payload = await response.json() as { data?: unknown; error?: string };
    if (!response.ok) throw new Error(
      typeof payload.error === 'string' && /^[A-Z0-9_]{1,80}$/.test(payload.error)
        ? payload.error : 'NGN request failed. Check status before retrying.'
    );
    return payload.data;
  }
  function agreementPath(id: string) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid agreement ID');
    return '/' + encodeURIComponent(id);
  }
  return {
    list: () => call(''),
    balance: () => call('/balance'),
    get: (id: string) => call(agreementPath(id)),
    create: (input: { id:string; sellerId:string; title:string; principalKobo:string; credential:string }) => call('',input),
    act: (id: string, action: 'fund'|'accept'|'start'|'deliver'|'release'|'dispute'|'cancel', credential: string) => {
      if (!['fund','accept','start','deliver','release','dispute','cancel'].includes(action)) throw new Error('Invalid NGN action');
      return call(agreementPath(id)+'/'+action,{credential});
    },
  };
}
