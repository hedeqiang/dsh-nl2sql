// lark-bot.js: im.message.receive_v1 normalisation and message-id dedupe.
// Ported from the larkws/normalize.test.mjs scratch test.
import { test, summary, assert } from '../lib/assert.mjs'
import { plugin } from '../lib/env.mjs'

const { normalizeMessageEvent, createDedupe } = await plugin('lark-bot.js')

const BOT = 'ou_bot000000000000000000000000000'

// Sample from https://open.feishu.cn/document/server-docs/im-v1/message/events/receive
function envelope(over = {}) {
  return {
    schema: '2.0',
    header: { event_id: '5e3702a84e847582be8db7fb73283c02', event_type: 'im.message.receive_v1', create_time: '1608725989000', app_id: 'cli_9f5343c580712544' },
    event: {
      sender: { sender_id: { union_id: 'on_8ed6aa67826108097d9ee143816345', user_id: 'e33ggbyz', open_id: 'ou_84aad35d084aa403a838cf73ee18467' }, sender_type: 'user' },
      message: {
        message_id: 'om_5ce6d572455d361153b7cb51da133945',
        root_id: 'om_root', parent_id: 'om_parent',
        create_time: '1609073151345', chat_id: 'oc_5ce6d572455d361153b7xx51da133945',
        chat_type: 'group', message_type: 'text',
        content: '{"text":"@_user_1 hello"}',
        mentions: [{ key: '@_user_1', id: { union_id: 'on_x', user_id: 'x', open_id: BOT }, mentioned_type: 'bot', name: 'NL2SQL' }],
        ...over,
      },
    },
  }
}
// What the SDK EventDispatcher hands to the handler: header + event flattened.
const flat = (env) => ({ schema: env.schema, ...env.header, ...env.event })

await test('text with bot mention (group) — raw envelope and SDK-flattened form', () => {
  for (const data of [envelope(), flat(envelope())]) {
    const m = normalizeMessageEvent(data, { botOpenId: BOT })
    assert.equal(m.messageId, 'om_5ce6d572455d361153b7cb51da133945')
    assert.equal(m.chatId, 'oc_5ce6d572455d361153b7xx51da133945')
    assert.equal(m.chatType, 'group')
    assert.equal(m.text, 'hello')
    assert.equal(m.mentionedBot, true)
    assert.deepEqual(m.sender, { openId: 'ou_84aad35d084aa403a838cf73ee18467', userId: 'e33ggbyz', unionId: 'on_8ed6aa67826108097d9ee143816345' })
    assert.equal(m.rootId, 'om_root')
    assert.equal(m.parentId, 'om_parent')
    assert.equal(m.createTime, 1609073151345)
    assert.equal(m.messageType, 'text')
    assert.equal(m.eventId, '5e3702a84e847582be8db7fb73283c02')
  }
})

await test('group text mentioning another user only → mentionedBot false; multiple placeholders stripped', () => {
  const m = normalizeMessageEvent(flat(envelope({
    content: '{"text":"@_user_1  上周 GMV 是多少 @_user_2"}',
    mentions: [
      { key: '@_user_1', id: { open_id: 'ou_tom' }, mentioned_type: 'user', name: 'Tom' },
      { key: '@_user_2', id: { open_id: 'ou_amy' }, mentioned_type: 'user', name: 'Amy' },
    ],
  })), { botOpenId: BOT })
  assert.equal(m.text, '上周 GMV 是多少')
  assert.equal(m.mentionedBot, false)
})

await test('bot detection falls back to mentioned_type when bot open_id unknown', () => {
  assert.equal(normalizeMessageEvent(flat(envelope())).mentionedBot, true)
  const m = normalizeMessageEvent(flat(envelope({ mentions: [{ key: '@_user_1', id: { open_id: 'ou_tom' }, mentioned_type: 'user', name: 'Tom' }] })))
  assert.equal(m.mentionedBot, false)
})

await test('p2p: every message is addressed to the bot', () => {
  const m = normalizeMessageEvent(flat(envelope({ chat_type: 'p2p', content: '{"text":"订单数"}', mentions: undefined })), { botOpenId: BOT })
  assert.equal(m.chatType, 'p2p')
  assert.equal(m.mentionedBot, true)
  assert.equal(m.text, '订单数')
  assert.equal(m.rootId, 'om_root')
})

await test('post rich text (sample from message_content doc)', () => {
  const post = {
    title: '我是一个标题',
    content: [
      [{ tag: 'text', text: '第一行:', style: ['bold'] }, { tag: 'a', href: 'http://www.feishu.cn', text: '超链接', style: [] }, { tag: 'at', user_id: '@_user_1', user_name: '', style: [] }],
      [{ tag: 'img', image_key: 'img_47354fbc' }],
      [{ tag: 'text', text: '第二行:', style: ['bold'] }, { tag: 'text', text: '文本测试', style: [] }],
      [{ tag: 'emotion', emoji_type: 'SMILE' }],
      [{ tag: 'hr' }],
    ],
  }
  const m = normalizeMessageEvent(flat(envelope({ message_type: 'post', content: JSON.stringify(post) })), { botOpenId: BOT })
  assert.equal(m.messageType, 'post')
  assert.equal(m.mentionedBot, true)
  assert.ok(!m.text.includes('@_user_'), m.text)
  assert.match(m.text, /我是一个标题/)
  assert.match(m.text, /第一行:超链接/)
  assert.match(m.text, /第二行:文本测试/)
})

await test('post with locale wrapper and no title', () => {
  const post = { zh_cn: { title: '', content: [[{ tag: 'at', user_id: '@_user_1' }, { tag: 'text', text: ' 查询 销售额' }]] } }
  const m = normalizeMessageEvent(flat(envelope({ message_type: 'post', content: JSON.stringify(post) })), { botOpenId: BOT })
  assert.equal(m.text, '查询 销售额')
})

await test('other message types → text "" with messageType', () => {
  const m = normalizeMessageEvent(flat(envelope({ message_type: 'image', content: '{"image_key":"img_x"}' })), { botOpenId: BOT })
  assert.equal(m.text, '')
  assert.equal(m.messageType, 'image')
})

await test('malformed content does not throw', () => {
  const m = normalizeMessageEvent(flat(envelope({ content: '{not json' })), { botOpenId: BOT })
  assert.equal(m.text, '')
})

await test('messages sent by an app/bot are ignored', () => {
  for (const t of ['app', 'bot']) {
    const env = envelope()
    env.event.sender.sender_type = t
    assert.equal(normalizeMessageEvent(flat(env), { botOpenId: BOT }), null)
  }
  assert.equal(normalizeMessageEvent({}), null)
  assert.equal(normalizeMessageEvent(null), null)
})

await test('dedupe LRU of 500 ids', () => {
  const d = createDedupe(500)
  assert.equal(d('om_1'), true)
  assert.equal(d('om_1'), false)
  for (let i = 2; i <= 501; i++) d('om_' + i) // om_1 was refreshed by the duplicate hit, then pushed out
  assert.equal(d('om_501'), false)
  assert.equal(d('om_1'), true) // evicted after 500 newer ids
  const small = createDedupe(2)
  small('a'); small('b'); small('a'); small('c') // 'b' is least recent
  assert.equal(small('a'), false)
  assert.equal(small('b'), true)
})

summary('lark normalize')
