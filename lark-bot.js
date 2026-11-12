/**
 * Compatibility shim: the Lark long connection and OpenAPI helpers moved to
 * channels/lark.js (see docs/channels.md).
 */
export {
  addReaction, clearTenantTokenCache, createDedupe, createLarkBot, getBotInfo, getChatInfo, getTenantToken, getUserInfo,
  larkApi, normalizeCardActionEvent, normalizeMessageEvent, replyMessage, replyText, resolveBaseUrl, sendCard, sendText, updateCard,
} from './channels/lark.js'
export { createLarkBot as default } from './channels/lark.js'
