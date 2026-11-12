// Lark card buttons: card.action.trigger normalisation (lark-bot.js) and the
// interactive card elements built by im.js (actionElement / buildCard).
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin } from '../lib/env.mjs'

const { normalizeCardActionEvent } = await plugin('lark-bot.js')
const { buildCard, actionElement } = await plugin('im.js')

// Shape of the card.action.trigger callback (card JSON 2.0), per the Feishu docs and
// the SDK's RawCardActionEvent type (ids under `context`).
function envelope(over = {}) {
  return {
    schema: '2.0',
    header: { event_id: 'f7984f25108f8137722bb63c', token: 'c-xx', create_time: '1606377911000', event_type: 'card.action.trigger', tenant_key: 't', app_id: 'cli_a1b2c3d4e5f60718' },
    event: {
      operator: { tenant_key: 't', user_id: 'u1', open_id: 'ou_click', union_id: 'on_click' },
      token: 'c-token',
      action: { value: { a: 'drill', t: 'tok12345678' }, tag: 'select_static', option: 'chain_type', timezone: 'Asia/Shanghai', ...over.action },
      host: 'im_message',
      context: { url: '', preview_token: '', open_message_id: 'om_card', open_chat_id: 'oc_chat', ...over.context },
    },
  }
}
const flat = (env) => ({ schema: env.schema, ...env.header, ...env.event })

await test('normalize: raw envelope and SDK-flattened form', () => {
  for (const data of [envelope(), flat(envelope())]) {
    const e = normalizeCardActionEvent(data)
    assert.equal(e.eventId, 'f7984f25108f8137722bb63c')
    assert.deepEqual(e.operator, { openId: 'ou_click', userId: 'u1', unionId: 'on_click', name: undefined })
    assert.deepEqual(e.value, { a: 'drill', t: 'tok12345678' })
    assert.equal(e.tag, 'select_static')
    assert.equal(e.option, 'chain_type')
    assert.equal(e.messageId, 'om_card')
    assert.equal(e.chatId, 'oc_chat')
    assert.equal(e.host, 'im_message')
  }
})

await test('normalize: root-level ids, string value, form value', () => {
  const env = envelope({ action: { tag: 'button', option: undefined, value: '{"a":"why","t":"abcdefgh"}', form_value: { f: 'x' } }, context: { open_message_id: undefined, open_chat_id: undefined } })
  env.event.open_message_id = 'om_root'
  env.event.open_chat_id = 'oc_root'
  const e = normalizeCardActionEvent(flat(env))
  assert.deepEqual(e.value, { a: 'why', t: 'abcdefgh' })
  assert.equal(e.option, undefined)
  assert.deepEqual(e.formValue, { f: 'x' })
  assert.equal(e.messageId, 'om_root')
  assert.equal(e.chatId, 'oc_root')
})

await test('normalize: malformed input → null; non-object value wrapped', () => {
  assert.equal(normalizeCardActionEvent(null), null)
  assert.equal(normalizeCardActionEvent({}), null)
  const noOp = flat(envelope()); delete noOp.operator
  assert.equal(normalizeCardActionEvent(noOp), null)
  const noAction = flat(envelope()); delete noAction.action
  assert.equal(normalizeCardActionEvent(noAction), null)
  const e = normalizeCardActionEvent(flat(envelope({ action: { value: 'plain' } })))
  assert.deepEqual(e.value, { raw: 'plain' })
})

const result = {
  resultId: 'r-1', datasourceId: 'd', title: '每日笔数', rowCount: 3,
  columns: [{ name: 'd', kind: 'time' }, { name: 'n', kind: 'number' }],
  rows: [['2026-01-01', 1], ['2026-01-02', 3], ['2026-01-03', 2]],
  chart: { type: 'line', x: 'd', y: ['n'] },
}
const spec = (pin) => ({
  select: { placeholder: '按维度拆分', value: { a: 'drill', t: 'tokAAAAAAAA' }, options: [{ text: '链', value: 'chain_type' }, { text: '状态', value: 'status' }] },
  buttons: [{ text: '为什么变化', value: { a: 'why', t: 'tokAAAAAAAA' } }, { text: '明细', value: { a: 'detail', t: 'tokAAAAAAAA' } }, ...(pin ? [{ text: '固定到看板', value: { a: 'pin', t: 'tokAAAAAAAA' } }] : [])],
})
const walk = (el, out = []) => { if (!el || typeof el !== 'object') return out; if (el.tag) out.push(el); for (const v of Object.values(el)) if (v && typeof v === 'object') walk(v, out); return out }

await test('actionElement: JSON 2.0 select_static + buttons with callback behaviors, opaque values', () => {
  const el = actionElement(spec(true))
  assert.equal(el.tag, 'column_set')
  const all = walk(el)
  const select = all.find(e => e.tag === 'select_static')
  assert.ok(select)
  assert.equal(select.options.length, 2)
  assert.deepEqual(select.behaviors, [{ type: 'callback', value: { a: 'drill', t: 'tokAAAAAAAA' } }])
  const buttons = all.filter(e => e.tag === 'button')
  assert.deepEqual(buttons.map(b => b.text.content), ['为什么变化', '明细', '固定到看板'])
  for (const c of [select, ...buttons]) {
    assert.equal(c.behaviors[0].type, 'callback')
    assert.deepEqual(Object.keys(c.behaviors[0].value).sort(), ['a', 't'], 'only action + opaque token in the value')
    assert.ok(!JSON.stringify(c.behaviors[0].value).includes('r-1'), 'no resultId in client-visible value')
  }
  assert.equal(actionElement({}), undefined)
})

await test('buildCard: buttons under the result; no pin for viewers; actions:false drops them; size bounded', () => {
  const card = buildCard({ title: 'q', text: 'a', results: [{ ...result, cardActions: spec(true) }] })
  assert.equal(card.schema, '2.0')
  const tags = walk(card.body).map(e => e.tag)
  assert.ok(tags.includes('select_static') && tags.includes('button'))
  const viewerCard = buildCard({ title: 'q', text: 'a', results: [{ ...result, cardActions: spec(false) }] })
  assert.ok(!walk(viewerCard.body).some(e => e.tag === 'button' && e.text.content === '固定到看板'))
  const plain = buildCard({ title: 'q', text: 'a', results: [{ ...result, cardActions: spec(true) }] }, { actions: false })
  assert.ok(!walk(plain.body).some(e => e.tag === 'button' || e.tag === 'select_static'))
  assert.ok(!JSON.stringify(card).includes('"resultId"'))
  // Large results + buttons stay under the card limit.
  const big = { ...result, chart: { type: 'table' }, columns: Array.from({ length: 8 }, (_, i) => ({ name: `c${i}`, kind: 'text' })), rows: Array.from({ length: 50 }, () => Array.from({ length: 8 }, () => 'x'.repeat(80))), cardActions: spec(true) }
  const many = buildCard({ title: 'q', text: 'a', results: [big, big, big, big] })
  assert.ok(Buffer.byteLength(JSON.stringify(many)) <= 30000)
})

summary('lark card actions')
