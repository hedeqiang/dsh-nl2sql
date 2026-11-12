// Sensitive-column detection: credentials yes, business "token" columns (crypto) no.
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin } from '../lib/env.mjs'
const { SENSITIVE_NAME } = await plugin('service/shared.js')

await test('credential-like names are sensitive', () => {
  for (const n of ['phone', 'mobile_no', 'email', 'id_card', 'password', 'api_secret', 'secret_enc', 'access_token', 'refresh_token', 'apiToken', 'token', 'token_hash', 'bank_card_no', '手机号'])
    assert.ok(SENSITIVE_NAME.test(n), n)
})
await test('business token columns are not sensitive', () => {
  for (const n of ['token_code', 'token_price', 'token_symbol', 'actual_gas_fee_token', 'tokens', 'token_networks', 'amount', 'chain_type'])
    assert.ok(!SENSITIVE_NAME.test(n), n)
})
summary('sensitive names')
