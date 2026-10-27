// Explicit test preload: mock Undici's transport, keeping its real fetch path.
// Production never imports this file or uses synthetic AI observations.
import { appendFileSync } from 'node:fs';
import { EnvHttpProxyAgent, MockAgent } from 'undici';

const transport = new MockAgent();
transport.disableNetConnect();
const failedRequests = new Set();
transport.get('https://api.openai.com').intercept({ path: '/v1/responses', method: 'POST' }).reply(async options => {
  const chunks = [];
  if (typeof options.body === 'string') chunks.push(Buffer.from(options.body));
  else for await (const chunk of options.body) chunks.push(Buffer.from(chunk));
  const body = JSON.parse(Buffer.concat(chunks).toString());
  if (process.env.SKYTILE_TEST_VISION_LOG) appendFileSync(process.env.SKYTILE_TEST_VISION_LOG, JSON.stringify(body) + '\n');
  const context = body.input[1].content[0].text;
  if (context.includes('TEST_QUOTA_ONCE') && !failedRequests.has(context)) {
    failedRequests.add(context);
    return { statusCode: 429, data: JSON.stringify({ error: { code: 'insufficient_quota' } }) };
  }
  const verdict = { verdict: 'possible_difference', confidence: 'medium', visibleStage: 'ongoing', scopeSufficient: true, summary: 'Resposta simulada apenas no teste: área parcialmente revestida.', observations: ['Evidência de teste.'], limitations: ['Não valida aderência.'], requestedPhotos: ['Foto geral.'] };
  return { statusCode: 200, data: JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(verdict) }] }] }) };
}).persist().delay(150);

// Replace only the dispatcher used by vision.mjs, never the local API client.
EnvHttpProxyAgent.prototype.dispatch = function (options, handler) {
  return transport.dispatch(options, handler);
};
