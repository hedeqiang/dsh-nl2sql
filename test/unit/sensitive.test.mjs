// Sensitive-column detection: credentials yes, business "token" columns (crypto currency) no.
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin } from '../lib/env.mjs'
const { SENSITIVE_NAME, classifyColumn, isCredentialToken, maskValue } = await plugin('service/shared.js')
const { reclassifySensitive } = await plugin('service/schema.js')

await test('credential-like names are sensitive', () => {
  for (const n of ['phone', 'mobile', 'mobile_no', 'user_mobile', 'tel', 'tel_no', 'telephone', 'contact_tel', 'email', 'user_email', 'mail', 'id_card', 'identity_no', 'password', 'api_secret', 'secret_enc', 'access_token', 'refresh_token', 'apiToken', 'token_hash', 'bank_card_no', '手机号'])
    assert.ok(SENSITIVE_NAME.test(n), n)
})

await test('business token columns are not sensitive (incl. a bare `token` = currency)', () => {
  for (const n of ['token', 'token_code', 'token_price', 'token_symbol', 'actual_gas_fee_token', 'tokens', 'token_networks', 'amount', 'chain_type', 'whitelist_status', 'hotel', 'telegram_id', 'intel_flag', 'mailbox_count', 'automobile_type', 'identity_type'])
    assert.ok(!SENSITIVE_NAME.test(n), n)
  const col = { name: 'token', dataType: 'varchar', columnType: 'varchar(50)', comment: '货币' }
  assert.ok(!classifyColumn(col, { name: 'order_deposit' }).includes('sensitive'), 'order_deposit.token (货币)')
  assert.ok(!classifyColumn(col, { name: 'token' }).includes('sensitive'), 'token.token (货币)')
})

await test('a bare `token` is still sensitive in credential tables or with a credential comment', () => {
  const col = (comment) => ({ name: 'token', dataType: 'varchar', columnType: 'varchar(255)', comment })
  assert.ok(classifyColumn(col(''), { name: 'user_sessions' }).includes('sensitive'))
  assert.ok(classifyColumn(col(''), { name: 'oauth_access' }).includes('sensitive'))
  assert.ok(classifyColumn(col('登录令牌'), { name: 'users' }).includes('sensitive'))
  assert.ok(classifyColumn(col('JWT'), { name: 'devices' }).includes('sensitive'))
  assert.ok(isCredentialToken('token', 'api_keys', ''))
  assert.ok(!isCredentialToken('token', 'order_deposit', '货币'))
  assert.equal(maskValue('access_token', 'abcdef123456'), '******')
})

await test('cached schemas analysed with the old rule are reclassified on load', () => {
  const schema = { tables: [
    { name: 'order_deposit', columns: [{ name: 'token', dataType: 'varchar', columnType: 'varchar(50)', comment: '货币', roles: ['sensitive'] }, { name: 'phone', dataType: 'varchar', roles: [] }] },
    { name: 'user_sessions', columns: [{ name: 'token', dataType: 'varchar', columnType: 'varchar(255)', comment: '', roles: [] }] },
  ] }
  reclassifySensitive(schema)
  assert.deepEqual(schema.tables[0].columns[0].roles, [], 'currency token unmasked')
  assert.ok(schema.tables[0].columns[1].roles.includes('sensitive'), 'phone becomes sensitive')
  assert.ok(schema.tables[1].columns[0].roles.includes('sensitive'), 'session token stays sensitive')
  assert.ok(schema.sensitiveRules >= 2)
})

summary('sensitive names')
