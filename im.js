/**
 * Compatibility shim: IM delivery moved to channels/ (see docs/CHANNELS.md).
 * Platform-neutral helpers live in channels/message.js, Lark cards and push in
 * channels/lark.js. `ImError` is the generic ChannelError.
 */
export { ChannelError, ChannelError as ImError } from './channels/http.js'
export { chartOption, chartable, dualAxis, renderChartPng } from './channels/message.js'
export { RECEIVE_ID_TYPES, actionElement, buildCard, chartElement, larkSign, listBotChats, markdownElements, sendMessage } from './channels/lark.js'
