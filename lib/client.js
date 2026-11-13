window.__ModuleLoader__.load({
  id: '@hedeqiang/dsh-nl2sql',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    // createRoot for the global feedback layer; older loaders only share react-dom.
    const ReactDOMClient = (() => { try { return require('react-dom/client') } catch { return null } })() ?? ReactDOM
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore } = React

    const PKG = '@hedeqiang/dsh-nl2sql'
    const PANEL_ID = 'nl2sql'
    const NS = 'nl2sql'
    const PRESET = 'nl2sql'
    const RPC_ROUTE = 'api/nl2sql.rpc'

    // ------------------------------------------------------------ locale

    const zh = {
      'fq.admin.fOffNote': "数据新鲜度已关闭：不检查、不推送，页面上也不显示。需要时在下方「设置」中开启。",
      'fq.set.gFresh': "数据新鲜度",
      'fq.set.gQuality': "数据质量巡检",
      'fq.set.fEnabledShort': "启用",
      'fq.set.fEnabledHint': "定时检查各表最新数据时间，滞后时推送通知；Agent 回答「今天 / 昨天」等近期数据前会先检查。关闭后以上全部停止，页面上也不再显示。",
      'fq.set.showShort': "在页面上显示",
      'fq.set.showHint': "查询结果下方的「数据滞后」提示和表结构页的新鲜度面板。隐藏后仍会定时检查和推送通知。",
      'fq.set.staleHint': "超过这个时长没有新数据即视为滞后；每张表可在上方表格单独设置，0 表示不监控。",
      'fq.set.fChannelHint': "每次滞后只推送一次，恢复时再推送一次。",
      'fq.set.qEnabledHint': "每天定时检查空值、重复键、异常值、未来时间与负值，并给出健康分。",
      'fq.set.on': "已开启",
      'fq.set.off': "已关闭",
      'fq.set.shown': "显示",
      'fq.set.hidden': "已隐藏",
      'mcp.client.claudeCode': 'Claude Code', 'mcp.client.cline': 'Cline', 'mcp.client.windsurf': 'Windsurf', 'mcp.client.codex': 'Codex CLI', 'mcp.client.gemini': 'Gemini CLI', 'mcp.client.zed': 'Zed', 'mcp.client.continue': 'Continue',
      'mcp.where.claudeCode': '在终端运行（HTTP 直连；下方为 stdio 桥接写法）。', 'mcp.where.cline': '写入 cline_mcp_settings.json（Cline 面板 → MCP Servers → Configure）。', 'mcp.where.windsurf': '写入 Windsurf 的 mcp_config.json（Cascade → MCP → 打开配置文件）。', 'mcp.where.codex': '写入 ~/.codex/config.toml（或项目的 .codex/config.toml）。', 'mcp.where.gemini': '写入 ~/.gemini/settings.json 或项目的 .gemini/settings.json。', 'mcp.where.zed': '写入 Zed 的 settings.json。', 'mcp.where.continue': '保存为工作区 .continue/mcpServers/nl2sql.yaml。',
      'mcp.test': '测试连接', 'mcp.testOk': '连接正常：发现 {n} 个工具。', 'mcp.testFail': '连接失败：{error}', 'mcp.testFailSteps': '连接测试未通过：',
      'mcp.expiry': '过期时间（可选）', 'mcp.noExpiry': '不过期', 'mcp.expiryHint': '到期当天结束后令牌失效（401）。', 'mcp.toolsAllow': '允许的工具', 'mcp.allTools': '全部工具', 'mcp.rateLimit': '频率限制（可选）', 'mcp.unlimited': '不限', 'mcp.perMinute': '次 / 分钟，超过返回 429',
      'mcp.err.tools': '请至少勾选一个工具', 'mcp.edit': '编辑', 'mcp.editTitle': '编辑令牌「{name}」', 'mcp.save': '保存', 'mcp.saved': '已保存',
      'mcp.rotate': '轮换密钥', 'mcp.rotateConfirm': '轮换令牌「{name}」的密钥？', 'mcp.rotateHint': '旧密钥立即失效，新密钥只显示一次；权限和限制保持不变。', 'mcp.rotated': '已生成新密钥',
      'mcp.col.limits': '限制', 'mcp.noLimits': '无', 'mcp.expired': '已过期', 'mcp.expiresOn': '{date} 到期', 'mcp.toolsN': '{n} 个工具', 'mcp.rateN': '{n} 次/分',
      'mcp.callLog': '调用记录', 'mcp.log.token': '令牌', 'mcp.log.allTokens': '全部令牌', 'mcp.log.status': '状态', 'mcp.log.all': '全部', 'mcp.log.filter': '按工具或数据源筛选', 'mcp.log.refresh': '刷新', 'mcp.log.empty': '还没有调用记录', 'mcp.log.time': '时间', 'mcp.log.tool': '工具 / 方法', 'mcp.log.datasource': '数据源', 'mcp.log.ms': '耗时 ms', 'mcp.log.rows': '行数',
      'hist.status.cancelled': '已取消', 'mcp.log.status.ok': '成功', 'mcp.log.status.error': '失败', 'mcp.log.status.cancelled': '已取消', 'mcp.log.status.rate-limited': '限流',
      'admin.group.insight': "洞察与自动化",
      'admin.group.connect': "集成",
      "fq.title": "数据新鲜度",
      "fq.refresh": "刷新",
      "fq.checkedAt": "检查于 {time}",
      "fq.staleCount": "{n} 张表数据滞后",
      "fq.warnCount": "{n} 张表更新偏慢",
      "fq.allFresh": "数据均为最新",
      "fq.lagMin": "{n} 分钟",
      "fq.lagHour": "{n} 小时",
      "fq.lagDay": "{n} 天",
      "fq.today": "今天 {time}",
      "fq.yesterday": "昨天 {time}",
      "fq.barItem": "{table} 最新数据停在 {when}（滞后 {lag}）",
      "fq.barMore": "另有 {n} 张表",
      "fq.st.error": "检查失败",
      "fq.st.empty": "无数据",
      "fq.running": "正在检查数据新鲜度…",
      "fq.failed": "检查失败",
      "fq.noTime": "无时间字段",
      "fq.notAnalyzed": "该数据源尚未分析表结构，请先在「表结构」中分析。",
      "fq.noTables": "没有带时间字段的表。",
      "fq.col.table": "表",
      "fq.col.column": "时间字段",
      "fq.col.latest": "最新数据",
      "fq.col.lag": "滞后",
      "fq.col.threshold": "阈值（小时）",
      "fq.thresholdFor": "{table} 的滞后阈值（小时）",
      "fq.events": "最近的延迟事件",
      "fq.evStale": "数据滞后 {lag}",
      "fq.evRecovered": "已恢复",
      "fq.pushed": "已推送",
      "fq.q.title": "数据质量巡检",
      "fq.q.lastRun": "上次巡检 {time}",
      "fq.q.run": "立即巡检",
      "fq.q.running": "巡检中…",
      "fq.q.empty": "还没有巡检记录，点击「立即巡检」开始。",
      "fq.q.done": "巡检完成，健康分 {score}",
      "fq.q.history": "近期分数",
      "fq.q.score": "健康分",
      "fq.q.rows": "行数",
      "fq.q.issues": "问题",
      "fq.q.noIssues": "未发现问题",
      "fq.more": "还有 {n} 条",
      "fq.less": "收起",
      "fq.admin.nav": "数据健康",
      "fq.admin.title": "数据健康",
      "fq.admin.desc": "监控各表数据是否按时更新，并定期巡检空值、重复键、异常值、未来时间与负值。",
      "fq.admin.nextF": "下次新鲜度检查 {time}",
      "fq.admin.fOff": "新鲜度定时检查已关闭",
      "fq.admin.nextQ": "每天 {time} 质量巡检",
      "fq.admin.qOff": "每日质量巡检已关闭",
      "fq.admin.noDs": "请先添加数据源",
      "fq.set.title": "设置",
      "fq.set.qEnabled": "每日数据质量巡检",
      "fq.set.interval": "新鲜度检查间隔（分钟）",
      "fq.set.time": "质量巡检时间",
      "fq.set.staleHours": "默认滞后阈值（小时）",
      "fq.set.drop": "健康分下降超过（分）时推送",
      "fq.set.fChannel": "数据延迟通知渠道",
      "fq.set.qChannel": "健康分下降通知渠道",
      "fq.set.noPush": "不推送",
      "fq.saved": "已保存",
      'pro.close': '关闭', 'pro.sendNow': '立即推送', 'pro.sent': '已推送', 'pro.deleteConfirm': '删除「{name}」？', 'pro.weekday': '星期',
      'pro.wd.0': '周日', 'pro.wd.1': '周一', 'pro.wd.2': '周二', 'pro.wd.3': '周三', 'pro.wd.4': '周四', 'pro.wd.5': '周五', 'pro.wd.6': '周六',
      'pro.fc.menu': '预测未来 {n} 天', 'pro.fc.title': '预测', 'pro.fc.heading': '未来 {n} 期预测', 'pro.fc.running': '正在预测…', 'pro.fc.forecast': '预测', 'pro.fc.band': '95% 区间', 'pro.fc.lower': '下限', 'pro.fc.upper': '上限',
      'pro.fc.hw': 'Holt-Winters · 周季节性', 'pro.fc.holt': 'Holt 线性趋势', 'pro.fc.horizon': '预测期数', 'pro.fc.nDays': '{n} 期', 'pro.fc.filled': '补齐 {n} 天', 'pro.fc.filledHint': '没有数据的日期按 0 计入',
      'pro.fc.note': '基于历史数据的统计外推，未考虑促销、节假日等已知事件；阴影为 95% 预测区间。',
      'pro.goals.title': '目标', 'pro.goals.desc': '为指标设定月 / 季 / 年目标：按已完成天数的日均（区分工作日与周末）预测期末值，并在看板上显示进度。', 'pro.goals.add': '新建目标',
      'pro.goals.name': '名称', 'pro.goals.namePh': '例如：11 月交易量', 'pro.goals.period': '周期', 'pro.goals.target': '目标值', 'pro.goals.direction': '方向', 'pro.goals.dashboard': '显示在看板', 'pro.goals.anyBoard': '使用同一数据源的看板',
      'pro.goals.empty': '还没有目标', 'pro.goals.emptyHint': '先在业务知识 → 指标库定义指标，再为它设定目标。', 'pro.goals.actual': '已完成', 'pro.goals.projected': '预计期末', 'pro.goals.proj': '预计 {v}（{p}）', 'pro.goals.weekdayAware': '按星期估算',
      'pro.goals.weekly': '目标周报', 'pro.goals.weeklyOn': '每周推送目标进度', 'pro.goals.weeklyHint': '在所选时间把所有目标的进度与预测推送到渠道。',
      'pro.period.month': '月', 'pro.period.quarter': '季度', 'pro.period.year': '年', 'pro.dir.up': '不低于', 'pro.dir.down': '不高于',
      'pro.st.on-track': '进度正常', 'pro.st.at-risk': '有风险', 'pro.st.achieved': '已达成', 'pro.st.missed': '未达成', 'pro.st.error': '出错',
      'pro.dg.title': '每日简报', 'pro.dg.desc': '每天定时对比昨天与近 7 日均值、上周同期，找出明显变化并自动归因，推送一段简短摘要和图表。', 'pro.dg.add': '新建简报',
      'pro.dg.name': '名称', 'pro.dg.namePh': '例如：交易日报', 'pro.dg.source': '内容来源', 'pro.dg.src.metrics': '指标库指标', 'pro.dg.src.dashboard': '看板中的趋势图', 'pro.dg.metrics': '指标', 'pro.dg.dashboard': '看板',
      'pro.dg.language': '语言', 'pro.dg.threshold': '变化阈值（%）', 'pro.dg.hint': '昨天的值偏离近 7 日均值超过 2 个标准差，或变化幅度超过阈值时，标记为值得关注并归因到主要维度。',
      'pro.dg.empty': '还没有每日简报', 'pro.dg.emptyHint': '选择几个核心指标，每天早上自动推送到群里。', 'pro.dg.preview': '预览', 'pro.dg.previewing': '正在生成预览…', 'pro.dg.dailyAt': '每天 {time}',
      "pre.working": "正在生成，请稍候…", "pre.exported": "已导出", "pre.exportPpt": "导出 PPT", "pre.exportImage": "导出长图", "pre.sendImage": "发送长图到 IM", "pre.sendImageHint": "把整个看板渲染成一张长图，发送到飞书应用机器人或 Telegram 机器人渠道。", "pre.noImageChannel": "没有可以发送图片的渠道：请先在「管理 → 渠道」添加飞书应用机器人或 Telegram 机器人。", "pre.channel": "渠道", "pre.send": "发送", "pre.imageSent": "长图已发送到「{channel}」", "pre.mode": "大屏模式", "pre.loading": "加载中…", "pre.lastRefresh": "最后刷新 {time}", "pre.clock": "当前时间", "pre.refresh": "自动刷新", "pre.rotate": "轮播看板", "pre.rotateOff": "不轮播", "pre.everySec": "每 {s} 秒", "pre.prev": "上一个看板（←）", "pre.next": "下一个看板（→）", "pre.exit": "退出大屏模式", "pre.exitHint": "退出（Esc）", "pre.bt.nav": "多维表格同步", "pre.bt.title": "多维表格同步", "pre.bt.desc": "把看板组件或 SQL 的查询结果写入飞书多维表格：缺少的字段自动创建（文本 / 数字 / 日期），可每天定时同步。", "pre.bt.add": "新建同步", "pre.bt.empty": "还没有同步任务", "pre.bt.emptyHint": "例如：每天早上把「按渠道的成交额」同步到运营团队的多维表格。", "pre.bt.name": "名称", "pre.bt.namePh": "如：渠道日报 → 运营多维表格", "pre.bt.channel": "飞书应用（提供 App 凭据）", "pre.bt.noChannel": "请先添加一个飞书应用机器人渠道", "pre.bt.channelMissing": "渠道已删除", "pre.bt.appTokenPh": "粘贴多维表格链接或 app_token", "pre.bt.source": "数据来源", "pre.bt.src.widget": "看板组件", "pre.bt.src.sql": "SQL 查询", "pre.bt.widget": "组件", "pre.bt.mode": "写入方式", "pre.bt.mode.replace": "覆盖", "pre.bt.mode.append": "追加", "pre.bt.modeHint.replace": "每次先删除表中全部记录，再写入最新结果。", "pre.bt.modeHint.append": "每次把结果追加到表末尾，保留已有记录。", "pre.bt.schedule": "定时", "pre.bt.daily": "每天同步", "pre.bt.dailyAt": "每天 {time}", "pre.bt.permHint": "需要在多维表格「… → 更多 → 添加文档应用」中添加该应用（可编辑），并为应用开通 bitable:app 权限。", "pre.bt.run": "立即同步", "pre.bt.ran": "同步完成：写入 {created} 条，删除 {deleted} 条", "pre.bt.lastOk": "成功 · {n} 条", "pre.bt.lastErr": "失败", "pre.bt.never": "未运行", "pre.bt.deleteConfirm": "删除同步任务「{name}」？",
      'mcp.nav': 'MCP 接入', 'mcp.title': 'MCP 接入', 'mcp.desc': '让 Claude Desktop、Cursor、Cline、VS Code 等 AI 工具通过 Model Context Protocol 使用这里的数据源：只读准入、访问控制、成员范围、行级权限与审计同样生效。',
      'mcp.enabled': '已启用', 'mcp.disabled': '未启用', 'mcp.running': '运行中', 'mcp.stopped': '未运行', 'mcp.port': '端口', 'mcp.applyPort': '应用',
      'mcp.endpoint': '端点', 'mcp.localOnly': '服务只监听本机 127.0.0.1，并拒绝非本机的 Origin / Host 请求；每个请求都需要令牌。', 'mcp.copy': '复制', 'mcp.copied': '已复制',
      'mcp.tokens': '访问令牌', 'mcp.newToken': '新建令牌', 'mcp.tokenName': '名称', 'mcp.tokenNamePh': '例如：我的 Cursor', 'mcp.create': '创建令牌',
      'mcp.scope': '权限范围', 'mcp.scope.owner': '本机用户（全部权限）', 'mcp.scope.member': '某个成员', 'mcp.scope.role': '角色 + 数据源',
      'mcp.scopeHint.owner': '与在本页提问相同的权限，仍受访问控制策略约束。', 'mcp.scopeHint.member': '跟随该成员的角色、数据源范围和行级规则；成员被停用后令牌失效。', 'mcp.scopeHint.role': '只能访问所选数据源，可附加一条行级规则。',
      'mcp.member': '成员', 'mcp.pickMember': '选择成员…', 'mcp.noMembers': '还没有成员，请先在「成员」中添加。', 'mcp.memberMissing': '成员已删除', 'mcp.memberDisabled': '成员已停用',
      'mcp.role': '角色', 'mcp.role.admin': '管理员', 'mcp.role.analyst': '分析师', 'mcp.role.viewer': '只读', 'mcp.datasources': '数据源', 'mcp.allDs': '全部数据源',
      'mcp.rowRule': '行级规则（可选）', 'mcp.rowColumn': '字段名', 'mcp.rowValues': '允许的值，逗号分隔', 'mcp.rowRuleHint': '查询含该字段的表时自动加上「字段 IN (值)」过滤。', 'mcp.rowRulesN': '{n} 条行级规则',
      'mcp.err.name': '请填写令牌名称', 'mcp.err.member': '请选择成员', 'mcp.err.ds': '请至少选择一个数据源',
      'mcp.freshTitle': '令牌「{name}」已创建', 'mcp.freshHint': '令牌只显示这一次，请立即复制保存。系统只保存它的哈希值，丢失后只能重新创建。', 'mcp.done': '我已保存',
      'mcp.col.name': '名称', 'mcp.col.scope': '范围', 'mcp.col.created': '创建时间', 'mcp.col.lastUsed': '最近使用', 'mcp.never': '从未',
      'mcp.revoke': '吊销', 'mcp.revokeConfirm': '吊销令牌「{name}」？', 'mcp.revokeHint': '使用该令牌的客户端将立即无法访问。', 'mcp.revoked': '令牌已吊销',
      'mcp.noTokens': '还没有令牌', 'mcp.noTokensHint': '创建一个令牌，再把下面的配置填入 AI 工具。',
      'mcp.setup': '客户端配置', 'mcp.client.claude': 'Claude Desktop', 'mcp.client.cursor': 'Cursor', 'mcp.client.vscode': 'VS Code',
      'mcp.where.claude': '写入 claude_desktop_config.json（通过 stdio 桥接 npx nl2sql-mcp，需要 Node.js 18+）。', 'mcp.where.cursor': '写入 ~/.cursor/mcp.json 或项目的 .cursor/mcp.json（直接走 HTTP）。', 'mcp.where.vscode': '写入 .vscode/mcp.json（直接走 HTTP）。',
      'mcp.placeholderHint': '把 <YOUR_TOKEN> 替换为你的令牌。', 'mcp.docsHint': '详细说明见插件文档 docs/mcp.md。使用期间请保持 DeepSeek Harness 运行。',
      'rc.title': "对账", 'rc.hint': "对比两个数据源（或两条查询）的结果：按键列把行对上，找出只在一侧存在的行和值不一致的列；可每天定时运行并推送差异。", 'rc.add': "新建对账", 'rc.empty': "还没有对账任务", 'rc.emptyHint': "例如：核对订单库与财务库每天的笔数和金额。", 'rc.name': "名称", 'rc.namePh': "如：订单 vs 财务 · 日金额", 'rc.left': "左侧", 'rc.right': "右侧", 'rc.leftCol': "左侧列", 'rc.rightCol': "右侧列（同名可留空）", 'rc.keys': "键列", 'rc.keysHint': "用来把两边的行对上的列（如订单号，或 日期 + 渠道）。", 'rc.addKey': "添加键列", 'rc.compare': "比较列", 'rc.compareHint': "需要一致的值；数值可设置容差（绝对值，或相对比例如 0.001 = 0.1%）。", 'rc.addCompare': "添加比较列", 'rc.tolerance': "容差", 'rc.tolMode': "容差类型", 'rc.tolAbs': "绝对", 'rc.tolRel': "相对", 'rc.trim': "比较文本前去掉首尾空格", 'rc.ignoreCase': "忽略大小写", 'rc.daily': "每天定时运行", 'rc.dailyAt': "每天 {time}", 'rc.manual': "手动", 'rc.noPush': "不推送", 'rc.notifyOn': "推送时机", 'rc.notify.diff': "有差异时", 'rc.notify.always': "每次运行", 'rc.dryRun': "试运行", 'rc.dryResult': "试运行结果（未保存）", 'rc.saved': "已保存对账任务", 'rc.runNow': "立即运行", 'rc.pushed': "已推送", 'rc.history': "运行记录", 'rc.historyOf': "运行记录 · {name}", 'rc.allRuns': "全部任务", 'rc.runOf': "对账结果 · {name}", 'rc.close': "关闭", 'rc.deleteConfirm': "删除对账任务「{name}」？", 'rc.detail': "详情", 'rc.push': "推送", 'rc.scheduled': "定时", 'rc.never': "未运行", 'rc.status.ok': "一致", 'rc.status.diff': "有差异", 'rc.status.error': "失败", 'rc.matchRate': "一致率", 'rc.matched': "匹配的键", 'rc.mismatched': "值不一致的行", 'rc.rowsOf': "{side} 行数", 'rc.onlyIn': "仅{side}", 'rc.totalOf': "{side} 合计", 'rc.col': "比较列", 'rc.mismatchRows': "不一致行", 'rc.diff': "差值", 'rc.hasDiff': "发现差异，一致率 {rate}", 'rc.noDiff': "两边一致，一致率 {rate}", 'rc.incomplete': "结果不完整（已截断）", 'rc.short.onlyLeft': "仅左侧 {n}", 'rc.short.onlyRight': "仅右侧 {n}", 'rc.short.mismatch': "不一致 {n} 行", 'rc.tab.summary': "汇总", 'rc.tab.mismatches': "值不一致", 'rc.tab.only': "仅{side}", 'rc.tool': "对账", 'rc.toolRunning': "正在对账",
      "sub.nav": "群订阅",
      "sub.title": "群订阅",
      "sub.desc": "IM 群里通过机器人创建的定时订阅和告警，按群分组；推送发回原来的群。",
      "sub.refresh": "刷新",
      "sub.empty": "还没有群订阅",
      "sub.emptyHint": "在群里 @机器人 说「每天 9 点把这个发到群里」或「超过 1000 提醒我」即可创建。",
      "sub.col.item": "内容",
      "sub.col.creator": "创建人",
      "sub.col.schedule": "时间",
      "sub.col.last": "最近推送",
      "sub.col.status": "状态",
      "sub.kind.subscription": "订阅",
      "sub.kind.alert": "告警",
      "sub.status.active": "运行中",
      "sub.status.paused": "已暂停",
      "sub.status.suspended": "已停用",
      "sub.next": "下次",
      "sub.pause": "暂停",
      "sub.resume": "恢复",
      "sub.delete": "删除",
      "sub.deleteConfirm": "删除「{name}」？",
      "sub.done.pause": "已暂停",
      "sub.done.resume": "已恢复",
      "sub.done.delete": "已删除",
      'mb.pick.people': "从和机器人说过话的人中选择",
      'mb.pick.chats': "从机器人所在的群中选择",
      'mb.pick.refresh': "刷新",
      'mb.pick.noPeople': "还没有人和机器人说过话。先让对方在群里 @机器人 或私聊发一句话（会提示未开通），这里就会出现，点一下即可添加。",
      'mb.pick.noChats': "还没有可选的群。把机器人拉进群并 @它一次，或确认应用已开通「获取群信息」权限。",
      'mb.pick.peopleHint': "点选即可自动填入账号 ID 和名称，也可以在下方手动填写。",
      'mb.pick.chatsHint': "点选群即可自动填入群 ID 和群名；群内所有成员按该群的权限使用。",
      'mb.pick.via': "来自渠道：{name}",
      'mb.pick.taken': "已是成员「{name}」",
      'mb.pick.refused': "曾因未开通被拒绝",
      'mb.pick.pending': "待开通",
      'mb.pick.added': "已添加",
      'mb.pending.title': "有 {n} 个人或群向机器人提问时因未开通被拒绝，点一下即可添加为成员：",
      'mb.pending.add': "添加",
      'dash.sourceOf': "数据源",
      'dash.sourceMissing': "该图表的数据源已删除，无法刷新",
      'dash.sourceMissingShort': "数据源已删除",
      'dash.scope': "显示范围",
      'dash.scopeAll': "全部数据源",
      'dash.scopeCurrent': "仅 {name}",
      'dash.sources': "包含数据源：{list}",
      'dash.scopeEmpty': "这个看板里没有「{name}」的图表",
      'dash.scopeEmptyHint': "另有 {n} 个其他数据源的图表被隐藏。",
      'im.attachFull': "超过 {n} 行的结果附带完整数据 Excel",
      'im.rowsLimit': "消息中每个结果最多显示 {n} 行，超出部分会注明；完整数据可在页面导出 Excel",
      'im.sentFile': "已附带完整数据 Excel",
      "settings.botDefaultRole": "未登记的用户",
      "settings.larkDefaultRole": "未登记的用户",
      "ch.savedTestFailedMsg": "已保存，但测试失败：{msg}",
      "ch.p.lark": "飞书",
      "ch.p.telegram": "Telegram",
      "ch.p.wecom": "企业微信",
      "ch.p.dingtalk": "钉钉",
      "ch.p.lark.mark": "飞",
      "ch.p.telegram.mark": "TG",
      "ch.p.wecom.mark": "企",
      "ch.p.dingtalk.mark": "钉",
      "ch.k.lark_webhook": "在群设置里添加的自定义机器人，复制 Webhook 地址即可，只能推送。",
      "ch.k.lark_app": "企业自建应用机器人：可发给群或个人、列出群聊，并能在飞书里 @机器人 提问。",
      "ch.f.signSecret": "开启「签名校验」后填写；不填则不签名。",
      "ch.f.receiveId": "群聊可点「选择群聊」自动填写。",
      "ch.desc": "渠道是与一个 IM 平台的连接，用于推送查询结果、看板、定时报告和告警；支持的渠道还能作为机器人，在群里或私聊中直接提问。",
      "ch.emptyHint": "添加飞书、Telegram、企业微信或钉钉渠道，把结果推送到群里，或开启机器人在 IM 里提问。",
      "ch.addTitle": "添加渠道",
      "ch.addSub": "选择平台和接入方式，下一步填写凭据。",
      "ch.editTitle": "编辑渠道「{name}」",
      "ch.back": "返回上一步",
      "ch.step.pick": "选择平台",
      "ch.step.config": "填写配置",
      "ch.pickPlatform": "平台",
      "ch.pickKind": "{platform} 的接入方式",
      "ch.kindsN": "{n} 种接入方式",
      "ch.noCatalog": "没有可用的渠道类型。",
      "ch.unknownKind": "当前版本不支持渠道类型「{type}」。",
      "ch.noPublicUrl": "无需公网地址",
      "ch.cap.native": "原生图表",
      "ch.cap.image": "图片图表",
      "ch.cap.none": "仅表格",
      "ch.cap.buttons": "按钮",
      "ch.cap.bot": "机器人",
      "ch.bot.state.off": "未启用",
      "ch.bot.state.connecting": "连接中",
      "ch.bot.state.connected": "已连接",
      "ch.bot.state.error": "连接失败",
      "ch.bot.state.stopped": "已停止",
      "ch.secretKeep": "已设置，留空不修改",
      "ch.secretSet": "已设置",
      "ch.err.required": "必填",
      "ch.err.pattern": "格式不正确",
      "ch.err.url": "请输入以 http(s):// 开头的地址",
      "ch.setupSteps": "配置步骤（{n} 步）",
      "ch.pickHint": "用当前填写的凭据列出机器人所在的群，不会保存。",
      "ch.tablesOnly": "该渠道只能发送表格。",
      "ch.cmImage": "图表会渲染成图片发送。",
      "ch.botSection": "机器人",
      "ch.botSectionHint": "启用后，群里 @机器人 或私聊即可提问；机器人在 Harness 中开一个数据问答会话作答并回复。成员权限见「成员与权限」。",
      "ch.botEnable": "启用机器人",
      "ch.testSavesFirst": "测试前会先保存。",
      "ch.testConn": "测试连接",
      "ch.testOk": "测试成功",
      "ch.savedTestFailed": "已保存，但测试失败",
      "ch.saved": "渠道已保存",
      "ch.deleted": "渠道已删除",
      "ch.defaultSet": "已设为默认渠道",
      "ch.actionsFor": "「{name}」的操作",
      "ch.botSettings": "机器人设置",
      "ch.deleteBotWarn": "这个渠道的机器人也会停止。",
      "ch.failedN": "{n} 条失败",
      "ch.bots": "机器人",
      "ch.botsHint": "在 IM 里 @机器人 或私聊提问，按下方成员权限作答。",
      "ch.bots.empty": "还没有支持机器人的渠道",
      "ch.bots.emptyHint": "添加飞书应用机器人、Telegram、企业微信或钉钉的机器人渠道后，就能在 IM 里直接提问，无需公网地址。",
      "ch.bots.goAdd": "去添加渠道",
      "ch.botToggle": "启用「{name}」的机器人",
      "ch.botOn": "「{name}」的机器人已启用",
      "ch.botOff": "「{name}」的机器人已停用",
      "ch.restart": "重连",
      "ch.convsN": "最近对话 {n}",
      "ch.p2pOn": "允许私聊",
      "ch.sum.on": "{on} / {total} 个已启用",
      "ch.sum.err": "{n} 个连接失败",
      "mb.kind2.person": "个人",
      "mb.kind2.chat": "群聊",
      "mb.ids.person": "IM 身份",
      "mb.ids.chat": "群聊 ID",
      "mb.ids.personHint": "用于识别在 IM 里提问的人；可以添加多个平台的身份。",
      "mb.ids.chatHint": "这个群里的人 @机器人 时按群的权限作答。",
      "mb.ids.add": "添加身份",
      "mb.ids.platformN": "身份 {n} 的平台",
      "mb.ids.idN": "身份 {n} 的 ID",
      "mb.ids.emailN": "身份 {n} 的邮箱（可选）",
      "mb.ids.emailPh": "邮箱（可选）",
      "mb.ids.remove": "删除身份 {n}",
      "mb.ids.empty": "请填写 ID 或邮箱，或删除这一行",
      "mb.ids.needOne": "至少需要一个身份，用于识别成员",
      "mb.ids.none": "未设置身份",
      "mb.idHelp.lark.person": "飞书 open_id（ou_ 开头），可在开放平台 API 调试台或机器人收到的消息事件里找到；也可只填邮箱。",
      "mb.idHelp.lark.chat": "飞书群 chat_id（oc_ 开头），可在「渠道」编辑应用机器人时用「选择群聊」查看。",
      "mb.idHelp.telegram.person": "Telegram 数字用户 ID，可让对方给 @userinfobot 发消息获取。",
      "mb.idHelp.telegram.chat": "Telegram 群 chat id（通常是 -100 开头的负数），可在「渠道」里用「选择群聊」查看。",
      "mb.idHelp.wecom.person": "企业微信 userid（通讯录 → 成员详情里的「账号」）。",
      "mb.idHelp.wecom.chat": "企业微信群聊 chatid，可在机器人收到的消息里找到。",
      "mb.idHelp.dingtalk.person": "钉钉 userId（管理后台 → 通讯录 → 成员详情）。",
      "mb.idHelp.dingtalk.chat": "钉钉群 openConversationId（cid 开头），可在机器人收到的消息里找到。",
      "set.l.unknownUser": "未登记的用户",
      "set.h.botDefaultRole": "不在「成员」列表中的人在群里 @机器人 或私聊时的权限，适用于所有平台的机器人。",
      "set.h.defaultChannel": "Agent 推送、看板发送等未指定渠道时使用。修改会立即生效。",
      'ask.shuffle': "换一批",
      'ask.deleteRecent': "删除这条提问记录",
      'ask.deleteRecentMsg': "将删除「{q}」的全部历史记录（不影响会话本身）。",
      'ask.deletedN': "已删除 {n} 条记录",
      'ask.moreRecent': "显示更多",
      'hist.deleteOne': "删除这条记录",
      'hist.deleted': "已删除",
      'bot.step7': '「事件与回调 → 回调配置」同样选择「使用长连接接收回调」，并添加回调「卡片回传交互（card.action.trigger）」，否则回答卡片上的「按维度拆分 / 为什么变化 / 明细 / 固定到看板」按钮点击无效。', 'bot.actionsHint': '回答卡片带有交互按钮：按维度拆分、为什么变化、明细、固定到看板（仅管理员/分析师）。点击者会按成员权限重新校验。',
      'sg.section': '建议', 'sg.hint': '根据查询历史和反馈自动整理的候选知识，确认后才会加入业务知识。', 'sg.refresh': '刷新',
      'sg.kind.example': '样例问答', 'sg.kind.metric': '指标', 'sg.kind.note': '字段备注', 'sg.kind.glossary': '业务词',
      'sg.accept': '采纳', 'sg.acceptEdit': '编辑后采纳', 'sg.acceptDirect': '直接采纳', 'sg.dismiss': '忽略', 'sg.dismissConfirm': '忽略这条建议？忽略后不会再出现。',
      'sg.accepted': '已加入业务知识', 'sg.dismissed': '已忽略', 'sg.evidence': '依据（{count} 条）', 'sg.score': '置信度 {score}',
      'sg.src.feedback': '反馈', 'sg.src.agent': '助手', 'sg.src.ui': '页面',
      'sg.empty': '暂时没有建议',
      'sg.emptyHint': '建议来自：被点 👍 或已修正的反馈 → 样例问答；助手反复执行的同结构查询 → 样例问答；在至少 3 条查询里重复出现的聚合口径 → 指标；CASE WHEN / 别名里的取值映射 → 字段备注；在多个问题标题中反复出现的词 → 业务词。多问几次问题后再来看看。',
      'ds.needsSecret': "需要填写密码",
      'ds.needsSecretHint': "这是导入的配置，不含密码或密钥，请编辑并填写后才能使用。",
      'ph.dsName': "生产库-订单",
      'ph.channelName': "数据日报群",
      'ov.suffix': "概览",
      'up.uploading': "正在上传 {p}%",
      'up.resultOk': "{table}（{rows} 行）",
      'set.l.scanGuard': "大表扫描保护（行）",
      'set.l.cacheTtl': "查询缓存（秒）",
      'set.l.mask': "敏感字段脱敏",
      'set.l.timeout': "查询超时（毫秒）",
      'set.l.maxRows': "最多返回行数",
      'set.l.daily': "每日自动检查",
      'set.l.notify': "变更通知",
      'set.l.watch': "检测表结构变更",
      'set.l.unknownLark': "未登记的飞书用户",
      'ask.heroSubShort': '正在使用「{name}」。用自然语言提问，Agent 会写 SQL、执行并画图。',
      'mb.defaultRole.none.desc': '未添加为成员的人 @机器人 时会收到提示，需要管理员先添加。最安全。',
      'mb.defaultRole.viewer.desc': '可以查询指标库、已验证的样例问答和看板，不能让 Agent 自由写 SQL。',
      'mb.defaultRole.analyst.desc': '可以自由提问。仅限可信的企业内群使用。',
      'fb2.required': "请填写内容",
      'fb2.ok': "确定",
      'tab.admin': "管理",
      'admin.sources': "数据源",
      'admin.members': "成员与权限",
      'admin.automation': "告警与报告",
      'admin.push': "渠道",
      'admin.settings': "设置",
      'ds.empty': "还没有数据源",
      'ds.emptyHint': "先连接一个数据库（MySQL / PostgreSQL / Elasticsearch），或上传一个 CSV / Excel 文件。",
      'ds.goAdd': "去添加数据源",
      'type.sqlite': "本地文件",
      'mb.chatShort': "群",
      'ob.title': "三步开始使用",
      'ob.sub': "完成后就可以用自然语言提问、生成图表和看板。",
      'ob.doneTitle': "准备就绪",
      'ob.doneSub': "还可以配置飞书推送，把结果和告警发到群里。",
      'ob.dismiss': "不再显示",
      'ob.stepDone': "已完成",
      'ob.analyzed': "表结构分析完成",
      'ob.connect': "连接数据源",
      'ob.connect.desc': "连接数据库或上传 CSV / Excel；查询始终只读。",
      'ob.connect.cta': "添加数据源",
      'ob.analyze': "分析表结构",
      'ob.analyze.desc': "识别表的用途、字段含义和表之间的关系，Agent 写 SQL 时会参考。",
      'ob.analyze.cta': "开始分析",
      'ob.ask': "试问一个问题",
      'ob.ask.desc': "用下面推荐的问题试一下，Agent 会写 SQL、执行并画图。",
      'ob.ask.cta': "试一个问题",
      'ob.push': "配置推送渠道（可选）",
      'ob.push.desc': "把查询结果、看板、定时报告和告警发到飞书、Telegram、企业微信或钉钉群。",
      'ob.push.cta': "去配置",
      'ask.ex.tables': "这个库里有哪些核心业务表？分别是做什么的？",
      'ask.ex.biggest': "数据量最大的 10 张表是哪些？",
      'ask.heroSubNoSchema': "正在使用「{name}」。建议先分析表结构，回答会更准确。",
      'ask.tablePrompt': "分析一下 {name}{comment} 这张表：它记录什么、关键字段含义、和哪些表关联，并给出 2~3 个有代表性的统计图表。",
      'ask.try': "试试这些问题",
      'ask.recent': "最近的提问",
      'ask.allHistory': "全部历史",
      'ask.openSession': "打开会话",
      'ask.askAgain': "再问一次",
      'up.short': "上传文件",
      'time.dayAgo': "{n} 天前",
      'dash.dragHint': "拖动调整顺序（也可用方向键）",
      'dash.dragLabel': "移动图表「{title}」",
      'dash.dragTip': "拖动图表左上角的 ⋮⋮ 调整顺序；在「⋯」菜单里切换宽度。",
      'dash.loading': "加载中",
      'dash.retry': "重试",
      'dash.goAsk': "去提问",
      'dash.loadingN': "{n} 个图表加载中…",
      'dash.lastRefresh': "最后刷新 {time}",
      'dash.cachedN': "{n} 个来自缓存",
      'dash.cachedHint': "这些图表使用了缓存结果，点击强制刷新全部",
      'dash.errorN': "{n} 个出错",
      'dash.removed': "已移除",
      'dash.copied': "已复制到其他看板",
      'dash.moved': "已移动到其他看板",
      'dash.width.third': "宽度：1/3",
      'dash.width.half': "宽度：1/2",
      'dash.width.full': "宽度：整行",
      'set.desc': "这些设置对所有数据源生效；数据源可以单独覆盖隐私设置。",
      'set.changeInSettings': "在设置中修改",
      'set.g.privacy': "模型可见数据",
      'set.g.query': "查询",
      'set.g.automation': "自动任务",
      'set.g.lark': "渠道与机器人",
      'set.g.storage': "数据与存储",
      'set.g.about': "关于",
      'set.gd.privacy': "决定哪些数据会发给模型。查询结果始终完整显示在页面上。",
      'set.gd.query': "查询的行数、时间和保护。",
      'set.gd.automation': "告警调度和表结构变更检测。",
      'set.gd.lark': "默认渠道、未登记用户的权限和各平台机器人。",
      'set.gd.storage': "本地存储、日志保留和配置备份。",
      'set.gd.about': "版本和运行环境信息。",
      'settings.sample.off.desc': "模型只看到表名、字段名和类型。",
      'settings.sample.enum.desc': "对枚举类字段（状态、类型等）抽取取值，帮助模型写出正确的过滤条件。",
      'settings.sample.all.desc': "允许模型查看各表的少量样例行，适合字段含义不清楚的库。",
      'settings.result.none.desc': "模型只知道查询是否成功、返回了多少行。",
      'settings.result.summary.desc': "模型看到每列的统计摘要（最小、最大、合计、常见值），不含明细行。推荐。",
      'settings.result.rows.desc': "模型看到前若干行明细，回答最具体，但数据会发给模型。",
      'set.h.sampleMode': "只影响发给模型的上下文，不影响查询。",
      'set.h.resultToModel': "用于 Agent 总结结论；页面和推送始终显示完整结果。",
      'set.h.modelRows': "「明细行」模式下最多发给模型的行数。",
      'set.h.maskSensitive': "手机号、邮箱、身份证、密钥等字段在结果和样例中打码显示。",
      'set.on': "开",
      'set.off': "关",
      'set.overrides': "以下数据源单独覆盖了这些设置：",
      'set.noOverrides': "没有数据源单独覆盖这些设置。可在数据源的编辑表单中为单个数据源单独设置。",
      'set.h.maxRows': "单次查询最多返回的行数，超出部分截断（数据库只读取到上限就停止）。",
      'set.h.timeoutMs': "单次查询的最长执行时间（毫秒），超时后数据库端取消查询。",
      'set.h.scanGuardRows': "EXPLAIN 预估要全表扫描超过这么多行时，需要确认后才执行。0 表示关闭。",
      'set.h.cacheTtl': "相同查询在这段时间内直接复用结果（看板、重跑）。0 表示关闭。",
      'set.schemaOverviewMax': "大库阈值（表数）",
      'set.h.schemaOverviewMax': "表数超过这个值时，发给模型的表结构只展开与问题相关的表，其他表只列名称，节省上下文。",
      'set.h.schemaDaily': "每天在这个时间自动重新分析所有数据源并检测变更。Harness 关闭期间错过的检查会在下次打开时补做。",
      'set.turnOff': "关闭",
      'set.h.schemaNotify': "检测到表结构变更时推送通知（含可能受影响的看板、指标和告警）。",
      'set.schedOn': "调度器运行中",
      'set.schedOff': "调度器未运行",
      'set.openAlerts': "查看告警",
      'set.h.larkDefaultRole': "不在「成员」列表中的飞书用户在群里 @机器人 或私聊时的权限。选择允许时，他们只能访问下方「成员与权限」中设定的默认数据源范围。",
      'set.configure': "配置",
      'set.defaultChannel': "默认渠道",
      'set.noDefaultChannel': "未设置默认渠道",
      'set.noChannels': "还没有渠道",
      'set.resultsDb': "结果库",
      'set.resultsDbSub': "{results} 个结果 · {cache} 条缓存",
      'set.stateFile': "配置文件",
      'set.retention': "日志保留",
      'set.h.retention': "每类记录最多保留的条数，超出后自动删除最旧的。",
      'set.rkCol': "记录类型",
      'set.rkCount': "当前条数",
      'set.rkKeep': "最多保留",
      'set.purge': "清空",
      'set.retentionNote': "保存后会立即按新的上限清理。",
      'set.rk.history': "查询历史 / 审计",
      'set.rk.feedback': "结果反馈",
      'set.rk.delivery': "推送记录",
      'set.rk.alertEvent': "告警记录",
      'set.rk.admin': "管理日志",
      'set.rk.evalRun': "评测记录",
      'set.rk.schemaChange': "表结构变更",
      'set.purgeConfirm': "清空全部「{kind}」？此操作不可撤销。",
      'set.purged': "已清空",
      'set.backup': "备份与迁移",
      'set.h.backup': "导出数据源（不含密码）、业务知识、看板、告警、定时报告、推送渠道（不含密钥）、成员和设置为一个 JSON 文件，可在另一台电脑导入。",
      'set.export': "导出全部配置",
      'set.import': "导入配置",
      'set.exported': "已导出",
      'set.importFrom': "导出时间：{time}。导入前请确认以下内容。",
      'set.section': "内容",
      'set.toAdd': "新增",
      'set.toUpdate': "更新",
      'set.note': "说明",
      'set.needsSecret': "需要重新填写密码：{names}",
      'set.reportsPaused': "定时报告将以暂停状态导入",
      'set.skipped': "跳过 {n} 项",
      'set.sec.settings': "设置",
      'set.sec.datasources': "数据源",
      'set.sec.knowledge': "业务知识",
      'set.sec.dashboards': "看板",
      'set.sec.alerts': "告警",
      'set.sec.reports': "定时报告",
      'set.sec.channels': "推送渠道",
      'set.sec.users': "成员",
      'set.importReplaceConfirm': "覆盖导入？",
      'set.importReplaceMsg': "覆盖会用导入文件替换现有的同类配置（数据源、看板、告警等）。",
      'set.imported': "导入完成",
      'set.importedNeedsSecret': "导入完成，{n} 个数据源需要重新填写密码",
      'settings.reset': "恢复默认",
      'settings.resetConfirm': "恢复默认值？",
      'settings.resetConfirmMsg': "「{group}」中的设置将恢复为默认值。",
      'settings.resetDone': "已恢复默认值",
      'set.unsaved': "有未保存的修改",
      'set.unsavedN': "{n} 项修改未保存",
      'set.discard': "放弃修改",
      'set.about.version': "插件版本",
      'set.about.dataDir': "数据目录",
      'set.about.runtime': "运行环境",
      'set.about.tests': "运行测试",
      'set.about.docs': "开发说明",
      panel: '数据问答',
      'page.title': '数据问答',
      'page.subtitle': '连接 MySQL / PostgreSQL / Elasticsearch，用自然语言查询并自动生成图表',
      'tab.ask': '问答',
      'tab.schema': '表结构',
      'tab.dashboard': '看板',
      'tab.sources': '数据源',
      'tab.settings': '设置',
      'tab.knowledge': '业务知识',
      'tab.history': '历史',
      'tab.reports': '定时报告',
      'tab.push': '推送',
      'ev.status.interrupted': '已中断',
      'mb.rowRules': '行级权限',
      'mb.rowRulesHint': '只允许看到字段取值在列表中的数据行，例如 merchant_code ∈ {A001}。查询会自动加上过滤；无法安全加过滤的复杂查询（子查询、CTE、UNION）会被拒绝。',
      'mb.anyDs': '所有数据源',
      'mb.ruleColumn': '字段',
      'mb.ruleValues': '允许的值（逗号分隔）',
      'mb.addRule': '添加规则',
      'mb.roleHint.admin': '可以提问、保存样例等全部操作。',
      'mb.roleHint.analyst': '可以自由提问（Agent 可写 SQL），不能保存样例。',
      'mb.roleHint.viewer': '只能使用指标库、已验证的样例问答和看板，不能让 Agent 自由写 SQL。',
      'al.lastTick': '上次检查 {time}（执行 {n} 项）',
      'al.noTickYet': '调度器尚未运行（启动后约 20 秒开始）',
      'al.nextDue': '下一个：{name} {time}',
      'al.schedulerNote': 'Harness 关闭期间不检查，重新打开后会补查一次',
      'hist.source.alert': '告警',
      'hist.source.eval': '评测',
      'hist.source.larkbot': '飞书机器人',
      'im.src.alert': '告警',
      'im.src.schema': '表结构变更',
      'im.src.larkbot': '飞书机器人',
      'kb.synonymsLabel': '同义词',
      'up.button': '上传文件',
      'up.title': '上传 CSV / Excel',
      'up.drop': '拖放文件到这里，或点击选择',
      'up.formats': '支持 .csv / .tsv / .xlsx（每个工作表导入为一张表），最大 200 MB；中文 CSV（GBK）会自动识别编码',
      'up.parsing': '正在解析…',
      'up.target': '导入到',
      'up.newSource': '新建本地文件数据源',
      'up.newName': '数据源名称',
      'up.mode': '同名表',
      'up.mode.create': '报错',
      'up.mode.replace': '替换',
      'up.mode.append': '追加',
      'up.table': '表名',
      'up.rows': '{rows} 行 · {cols} 列',
      'up.truncated': '已截断',
      'up.type.TEXT': '文本',
      'up.type.INTEGER': '整数',
      'up.type.REAL': '小数',
      'up.type.DATE': '日期',
      'up.type.DATETIME': '时间',
      'up.import': '导入',
      'up.done': '已导入到「{name}」：',
      'up.privacy': '文件只保存在本机（Harness 数据目录），按只读方式查询。',
      'up.addFile': '追加上传文件',
      'up.localDesc': '本地文件（SQLite），只读查询',
      'up.dropConfirm': '删除表「{name}」？',
      'up.askLink': '上传 CSV / Excel 来提问',
      'up.askHint': '导入完成，已切换到新的数据源，可以直接提问了。',
      'tab.alerts': '告警',
      'tab.members': '成员',
      'result.excel': '导出 Excel',
      'drill.title': '下钻',
      'drill.whyTitle': '变化归因',
      'drill.wholeResult': '整个结果',
      'drill.detail': '查看明细',
      'drill.splitBy': '按维度拆分：',
      'drill.noDims': '没有可用的维度',
      'drill.why': '为什么变化？',
      'drill.breakdownAll': '按维度拆分',
      'drill.nonAdditive': '该指标不可加（如平均值、去重计数），各分组贡献仅供参考。',
      'drill.failedDims': '未能分析的维度',
      'dash.export': '导出',
      'dash.snapshot': '保存快照',
      'dash.snapshotDone': '已保存快照（{n} 个图表）',
      'dash.cached': '缓存',
      'dash.cachedAt': '来自 {time} 的缓存结果，点刷新获取最新数据',
      'dash.manage': '管理看板',
      'dash.new': '新建看板',
      'dash.newName': '看板名称',
      'dash.duplicate': '复制当前看板',
      'dash.renameBoard': '重命名看板',
      'dash.deleteBoard': '删除看板',
      'dash.deleteBoardConfirm': '删除看板「{name}」及其中的图表？',
      'dash.copyTo': '复制到「{name}」',
      'dash.moveTo': '移动到「{name}」',
      'kb.dimensions': '允许的维度',
      'kb.synonyms': '同义词',
      'kb.io': '导入 / 导出',
      'kb.exportThis': '导出当前数据源的知识',
      'kb.exportAll': '导出全部数据源',
      'kb.import': '导入业务知识',
      'kb.importInto': '将导入到当前数据源「{name}」',
      'kb.importByName': '按数据源名称匹配导入',
      'kb.src': '来源',
      'kb.target': '目标',
      'kb.invalid': '无效',
      'kb.merge': '合并导入',
      'kb.replace': '覆盖导入',
      'kb.replaceConfirm': '覆盖会清空目标数据源现有的业务知识，确定吗？',
      'kb.imported': '导入完成',
      'ds.close': '关闭',
      'ev.section': '评测',
      'ev.hint': '把「样例问答」当作评测集：Agent 模式会让 Agent 从零回答每个问题（看不到对应样例），再与样例 SQL 的结果比对；SQL 模式只重放样例 SQL，用于检查数据源和表结构是否还兼容。修改业务知识或更换模型后跑一次，看准确率变化。',
      'ev.mode.agent': 'Agent 回答',
      'ev.mode.sql': '仅回放 SQL',
      'ev.cases': '{count} 个用例',
      'ev.run': '开始评测',
      'ev.running': '评测中 {done}/{total}',
      'ev.status.pass': '通过',
      'ev.status.fail': '不一致',
      'ev.status.error': '出错',
      'ev.sim': 'SQL 相似度 {p}%',
      'ev.compareSql': '对比 SQL（左：样例，右：Agent）',
      'ev.include': '纳入评测',
      'sc.title': '表结构有 {count} 处变化（{time}）',
      'sc.ack': '知道了',
      'sc.impacts': '可能受影响',
      'sc.table-added': '新增表',
      'sc.table-removed': '删除表',
      'sc.column-added': '新增字段',
      'sc.column-removed': '删除字段',
      'sc.column-type': '类型变更',
      'sc.imp.widget': '看板图表',
      'sc.imp.example': '样例',
      'sc.imp.metric': '指标',
      'sc.imp.note': '备注',
      'sc.imp.alert': '告警',
      'al.hint': '按计划检查指标或 SQL 结果，满足条件时推送到飞书。支持阈值、环比变化、异常波动（Z 分数）和无数据检测，恢复正常时会发送恢复通知。',
      'al.add': '新建告警',
      'al.empty': '还没有告警',
      'al.emptyHint': '例如：日交易额环比下降超过 20% 时通知运营群。',
      'al.name': '名称',
      'al.namePh': '例如：日交易额骤降',
      'al.source': '数据来源',
      'al.src.metric': '指标库',
      'al.src.sql': '自定义 SQL',
      'al.metric': '指标',
      'al.noMetrics': '指标库为空，请先在「业务知识 → 指标库」定义指标',
      'al.grain': '时间粒度',
      'al.grain.hour': '按小时',
      'al.grain.day': '按天',
      'al.grain.week': '按周',
      'al.grain.month': '按月',
      'al.sql': 'SQL（第一列为时间，最后一个数值列为指标值）',
      'al.condition': '触发条件',
      'al.cond.threshold': '阈值',
      'al.cond.change': '环比变化',
      'al.cond.anomaly': '异常波动',
      'al.cond.missing': '无数据',
      'al.condHint.threshold': '最新一个值与阈值比较。',
      'al.condHint.change': '最新值相对上一个值的变化幅度。',
      'al.condHint.anomaly': '最新值偏离过去 14 个点均值的标准差倍数，Z ≥ 3 一般视为异常。',
      'al.condHint.missing': '查询没有返回数据或最新值为空时触发。',
      'al.anomalyHint': '（过去 14 个点）',
      'al.dir.any': '上升或下降',
      'al.dir.up': '上升',
      'al.dir.down': '下降',
      'al.every': '检查频率',
      'al.every.15m': '每 15 分钟',
      'al.every.hour': '每小时',
      'al.every.day': '每天',
      'al.cooldown': '重复提醒间隔（分钟）',
      'al.noPush': '只记录，不推送',
      'al.mentionAll': '推送时 @所有人',
      'al.test': '试运行',
      'al.wouldFire': '会触发',
      'al.wouldNotFire': '不会触发',
      'al.firing': '告警中',
      'al.ok': '正常',
      'al.never': '未检查',
      'al.last': '最新',
      'al.checkNow': '立即检查',
      'al.pushed': '已推送',
      'al.events': '告警记录',
      'al.message': '内容',
      'al.deleteConfirm': '删除告警「{name}」？',
      'mb.hint': "为 IM 里的同事或群开通数据问答：按成员 / 群限定可访问的数据源，审计记录会归属到具体的人。本机页面始终拥有全部权限。",
      'mb.add': '添加成员',
      'mb.empty': '还没有成员',
      'mb.emptyHint': "添加同事（飞书、Telegram、企业微信或钉钉的用户 ID）或群聊，再启用上方的机器人，大家就能在 IM 里 @机器人 提问。",
      'mb.kind': '类型',
      'mb.kind.person': '飞书用户',
      'mb.kind.chat': '飞书群',
      'mb.role': '角色',
      'mb.role.admin': '管理员',
      'mb.role.analyst': '分析师',
      'mb.role.viewer': '只读',
      'mb.email': '邮箱',
      'mb.scope': '可访问的数据源',
      'mb.allDs': '全部数据源',
      'mb.noDs': '无数据源',
      'mb.disabled': '已停用',
      'mb.enable': '启用',
      'mb.disable': '停用',
      'mb.deleteConfirm': '删除成员「{name}」？',
      'mb.queries': '近 30 天 {n} 次查询',
      'mb.noUsage': '近 30 天无查询',
      'mb.usage': '使用情况（近 30 天）',
      'mb.user': '成员',
      'mb.lastActive': '最近使用',
      'mb.default': "未登记的用户：",
      'mb.defaultRole.none': '拒绝（需要先添加为成员）',
      'mb.defaultRole.viewer': '允许，只读',
      'mb.defaultRole.analyst': '允许，分析师',
      'bot.title': '飞书机器人（@提问）',
      'bot.hint': '通过飞书长连接接收消息，不需要公网地址。群里 @机器人 或私聊提问，机器人在 Harness 中开一个数据问答会话作答，并把结论和图表卡片回复到飞书。',
      'bot.enable': '启用',
      'bot.channel': '使用的应用机器人',
      'bot.noAppChannel': '先在「推送」添加应用机器人渠道',
      'bot.scope': '会话范围',
      'bot.scope.chat': '每个群一个会话（共享上下文）',
      'bot.scope.user': '每人每群一个会话',
      'bot.p2p': '允许私聊提问',
      'bot.state.idle': '未启用',
      'bot.state.connecting': '连接中',
      'bot.state.connected': '已连接',
      'bot.state.error': '连接失败',
      'bot.state.stopped': '已停止',
      'bot.setup': '飞书开放平台配置步骤',
      'bot.step1': '在开发者后台创建企业自建应用，记下 App ID / App Secret，并在「推送」页添加为应用机器人渠道。',
      'bot.step2': '「添加应用能力」开启机器人。',
      'bot.step3': '「权限管理」开通：im:message、im:message.p2p_msg:readonly、im:message.group_at_msg:readonly、im:message:send_as_bot、im:resource、im:chat:readonly、contact:user.base:readonly（需要按邮箱识别成员时再加 contact:user.email:readonly）。',
      'bot.step4': '在这里勾选「启用」使长连接在线，然后到「事件与回调 → 事件配置」选择「使用长连接接收事件」并保存。',
      'bot.step5': '添加事件「接收消息 v2.0（im.message.receive_v1）」，创建版本并发布。',
      'bot.step6': '把机器人拉进群；群里需要 @机器人 才会响应。发送「帮助」查看命令（数据源、切换 <名称>、新对话）。',
      'bot.convs': '最近的飞书对话',
      'bot.chat': '聊天',
      'bot.lastQ': '最近问题',
      'bot.p2pShort': '私聊',
      'settings.cacheTtl': '查询缓存时长（秒，0 = 关闭）',
      'settings.cacheStats': '结果存储',
      'settings.cacheStatsText': '{results} 个结果 · {mb} MB · {cache} 条缓存',
      'settings.clearCache': '清空缓存',
      'settings.schemaWatch': '表结构变更检测',
      'settings.schemaWatchOn': '重新分析表结构时对比上一次的结果，提示新增 / 删除 / 类型变更的字段，以及受影响的看板、样例、指标和告警',
      'settings.schemaDaily': '每天自动检查的时间（留空 = 不自动检查）',
      'settings.schemaNotify': '变更时推送到',
      'chart.label': '图表',
      'schema.analyzedAt': '{time} 分析',
      'schema.mode': '视图',
      'schema.notAnalyzedHint': '分析会读取表、字段、索引与外键，并推断字段含义和表之间的关系。',
      'schema.tablesLabel': '表',
      'schema.colCount': '{count} 个字段',
      'schema.copyName': '复制表名',
      'schema.th.name': '字段',
      'schema.th.type': '类型',
      'schema.th.meaning': '含义',
      'schema.th.values': '取值示例',
      'schema.inferred': '推断 {p}%',
      'ds.sectionDesc': '查询始终只读执行。密码、私钥保存在 Harness 凭据库中。',
      'ds.statusOk': '已连接',
      'ds.statusFail': '连接失败',
      'ds.statusWrite': '有写权限',
      'im.hintShort': '把查询结果、看板或 Agent 回复发送到飞书 / Lark 群或个人；图表以飞书原生图表展示。',
      'im.statusOk': '正常',
      'im.statusNew': '未发送过',
      'im.sentOk': '已送达',
      'filter.notAppliedShort': '未筛选',
      'filter.addShort': '筛选',
      'filter.activeN': '{count} 个筛选已生效',
      'filter.from': '开始日期',
      'filter.to': '结束日期',
      'dash.count': '{count} 个图表',
      'dash.autoShort': '自动刷新',
      'dash.updatedAt': '更新时间',
      'hist.all': '全部',
      'hist.untitled': '未命名查询',
      'hist.emptyHint': '页面、Agent 和看板执行的查询都会记录在这里。',
      'time.justNow': '刚刚',
      'time.minAgo': '{n} 分钟前',
      'time.hourAgo': '{n} 小时前',
      'ask.heroTitle': '想了解什么数据？',
      'ask.heroSub': '正在使用「{name}」· {tables} 张表。用自然语言提问，Agent 会写 SQL、执行并画图。',
      'ask.enterHint': '提问',
      'ask.newline': '换行',
      'ask.readonly': '只读执行',
      'result.copySql': '复制 SQL',
      'result.chartType': '图表类型',
      'result.more': '更多操作',
      'result.data': '数据',
      'im.sendReply': "发送这条回复到 IM",
      'im.chartMode': '图表形式',
      'im.cm.default': '跟随渠道',
      'im.cm.native': '原生图表',
      'im.cm.image': '图片',
      'im.cm.table': '表格',
      'im.cmHint': '原生图表在飞书中可交互（需客户端 7.1+），群机器人和应用机器人都支持；图片只适用于应用机器人。',
      'im.md.edit': '编辑',
      'im.md.preview': '预览',
      'im.md.empty': '（空）',
      'im.md.bold': '加粗',
      'im.md.heading': '标题',
      'im.md.list': '列表',
      'im.md.quote': '引用',
      'im.md.green': '绿字',
      'im.md.red': '红字',
      'im.md.table': '表格',
      'im.md.link': '链接',
      'im.md.atAll': '@所有人',
      'im.hint': '把 Markdown 内容、查询结果、图表、概览或整个看板发送到飞书 / Lark。图表以飞书原生可交互图表发送，群机器人和应用机器人都支持；应用机器人还能发给个人。对话中每条 Agent 回复下方也有「发送到飞书」按钮。密钥都保存在 Harness 凭据库中。Agent 也可以在对话或定时报告中通过 nl2sql_send 推送。',
      'im.add': '添加渠道',
      'im.empty': '还没有推送渠道',
      'im.emptyHint': '在飞书群设置 → 群机器人 → 添加「自定义机器人」，复制 Webhook 地址即可。',
      'im.kind': '渠道类型',
      'im.type.lark_webhook': '群机器人（Webhook）',
      'im.type.lark_app': '应用机器人',
      'im.help.lark_webhook': '飞书群 → 设置 → 群机器人 → 添加机器人 → 自定义机器人。建议开启「签名校验」并填写密钥；若设置了关键词，消息标题需包含该关键词。图表以飞书原生图表发送。',
      'im.help.lark_app': '在飞书开放平台创建企业自建应用，开启机器人能力，开通 im:message:send_as_bot、im:resource（发送图片）、im:chat:readonly（列出群聊）权限并发布版本，然后把机器人拉进目标群。',
      'im.name': '名称',
      'im.description': '备注（可选）',
      'im.webhookUrl': 'Webhook 地址',
      'im.signSecret': '签名校验密钥',
      'im.optional': '可选',
      'im.domain': '版本',
      'im.domain.feishu': '飞书（open.feishu.cn）',
      'im.domain.lark': 'Lark 国际版（open.larksuite.com）',
      'im.appId': 'App ID',
      'im.appSecret': 'App Secret',
      'im.receiveIdType': '接收者类型',
      'im.rid.chat_id': '群聊 chat_id',
      'im.rid.email': '用户邮箱',
      'im.rid.open_id': '用户 open_id',
      'im.rid.user_id': '用户 user_id',
      'im.rid.union_id': '用户 union_id',
      'im.receiveId': '接收者',
      'im.pickChat': '选择群聊',
      'im.chats': '机器人所在的群（{count}）',
      'im.noChats': '机器人还不在任何群里，请先把应用机器人拉进群',
      'im.setDefault': '设为默认渠道',
      'im.saveTest': '保存并发送测试',
      'im.testOk': '测试消息已发送，请在飞书中查看',
      'im.test': '发送测试',
      'im.default': '默认',
      'im.makeDefault': '设为默认',
      'im.signed': '已签名',
      'im.lastFailed': '上次失败',
      'im.lastSent': '上次发送',
      'im.webhookHidden': 'Webhook 地址已加密保存',
      'im.deleteConfirm': '删除推送渠道「{name}」？使用它的定时报告将不再推送。',
      'im.log': '推送记录',
      'im.col.time': '时间', 'im.col.channel': '渠道', 'im.col.title': '标题', 'im.col.source': '来源', 'im.col.status': '结果',
      'im.src.ui': '页面', 'im.src.agent': 'Agent', 'im.src.dashboard': '看板', 'im.src.test': '测试',
      'im.resultsN': '{count} 个结果', 'im.imagesN': '{count} 张图',
      'im.share': "发送到 IM",
      'im.shareAll': '全部发送到 IM',
      'im.shareDashboard': '发送看板',
      'im.dashboardTitle': '数据看板',
      'im.sendTitle': "发送到 IM 渠道",
      'im.noChannel': "还没有渠道，请先在「管理 → 渠道」添加。",
      'im.channel': '发送到',
      'im.msgTitle': '标题',
      'im.text': '正文（Markdown）',
      'im.textPh': '支持 Markdown：## 标题、**加粗**、- 列表、> 引用、| 表格 |、```代码```、[链接](https://…)、<font color=\'green\'>彩色</font>',
      'im.attach': '附带 {count} 个查询结果。',
      'im.dashboardHint': '将按当前全局筛选重新查询看板中的所有图表（最多 10 个）后发送。',
      
      'im.includeSql': '附带 SQL',
      'im.send': '发送',
      'im.sent': '已发送到 {channel}（{images} 张图片）',
      'rep.push': '完成后推送到',
      'rep.pushNone': '不推送',
      'policy.button': '访问控制',
      'policy.title': '访问控制',
      'policy.badge': '访问控制',
      'policy.hint': '限定模型和页面能查询的表与字段。被排除的表不会出现在模型看到的表结构里，查询时也会被拒绝；隐藏字段从表结构和结果中移除，强制脱敏字段在结果中打码。系统目录（information_schema、pg_catalog 等）在启用后一律禁止。这是应用层控制，最可靠的边界仍是数据库账号权限。',
      'policy.mode': '表范围',
      'policy.mode.all': '全部表',
      'policy.mode.allow': '仅允许列表中的表',
      'policy.mode.deny': '排除列表中的表',
      'policy.allowTables': '允许的表（每行一个，支持 * 通配）',
      'policy.denyTables': '排除的表（每行一个，支持 * 通配）',
      'policy.hiddenColumns': '隐藏字段（表.字段，支持 *.salary）',
      'policy.maskedColumns': '强制脱敏字段（表.字段）',
      'policy.preview': '可访问 {allowed} / {total} 张表',
      'policy.clickHint': '点击表名可加入或移出列表',
      'policy.blocked': '禁止',
      'policy.hidden': '隐藏',
      'policy.masked': '脱敏',
      'policy.hiddenCount': '{count} 列已隐藏',
      'policy.hiddenInResult': '访问控制隐藏了部分结果列',
      'fb.label': '结果反馈',
      'fb.up': '结果正确',
      'fb.down': '结果有问题',
      'fb.whatWrong': '哪里不对？',
      'fb.reason.wrongTable': '用错了表',
      'fb.reason.wrongMetric': '指标口径不对',
      'fb.reason.wrongFilter': '过滤条件不对',
      'fb.reason.wrongTime': '时间范围不对',
      'fb.reason.chart': '图表不合适',
      'fb.commentPh': '描述正确的口径或期望的结果（会进入问题清单，并填入输入框方便让 Agent 修正）',
      'fb.submit': '提交',
      'fb.thanksUp': '已记录：结果正确。可在「业务知识 → 反馈」中存为样例。',
      'fb.thanksDown': '已记录到问题清单。',
      'fb.followup': '上面的「{title}」结果不对：{comment}。请修正查询并重新给出结果。',
      'fb.followupDefault': '请检查表、口径和过滤条件',
      'fb.section': '反馈',
      'fb.hint': '👎 进入问题清单；修正后可直接存为样例问答，同类问题以后会复用正确的 SQL。',
      'fb.filter.open': '待处理',
      'fb.filter.resolved': '已处理',
      'fb.filter.all': '全部',
      'fb.empty': '没有反馈',
      'fb.noQuestion': '（未记录问题）',
      'fb.status.open': '待处理',
      'fb.status.resolved': '已处理',
      'fb.status.ignored': '已忽略',
      'fb.fix': '修正',
      'fb.ignore': '忽略',
      'fb.correctedSql': '正确的 SQL',
      'fb.resolution': '处理说明',
      'fb.resolutionPh': '例如：补充了 GMV 口径到指标库',
      'fb.markResolved': '标记已处理',
      'fb.saveFix': '保存为样例并标记已处理',
      'fb.stat.up': '👍 正确',
      'fb.stat.down': '👎 有问题',
      'fb.stat.open': '待处理',
      'fb.stat.rate': '好评率',
      'filter.title': '全局筛选',
      'filter.range': '时间范围',
      'filter.timeColumn': '时间字段',
      'filter.noTime': '不限时间',
      'filter.range.today': '今天',
      'filter.range.yesterday': '昨天',
      'filter.range.last7d': '近 7 天',
      'filter.range.last30d': '近 30 天',
      'filter.range.last90d': '近 90 天',
      'filter.range.thisMonth': '本月',
      'filter.range.lastMonth': '上月',
      'filter.range.thisYear': '今年',
      'filter.range.custom': '自定义',
      'filter.add': '+ 添加筛选',
      'filter.remove': '移除筛选',
      'filter.clear': '清除',
      'filter.hint': '筛选条件会注入到包含对应字段的图表查询中（外层 WHERE）；不含该字段或结构复杂（UNION、子查询作为主表）的图表保持原样。',
      'filter.appliedCount': '已筛选 {count}',
      'filter.notApplied': '此图表不包含筛选字段，未应用全局筛选',
      'ds.type': '数据库类型',
      'ds.indexPattern': '索引（逗号分隔，可用通配符）',
      'ds.userOptional': '用户名（可选）',
      'ds.apiKey': 'API Key（可选，优先于用户名密码）',
      'ds.apiKeyHint': 'Base64 编码的 id:api_key',
      'ds.schemas': 'Schema（逗号分隔，留空=全部用户 schema）',
      'ds.https': '使用 HTTPS',
      'ds.sshTitle': 'SSH 隧道',
      'ds.sshEnable': '通过 SSH 跳板机连接（主机/端口填写跳板机可访问的数据库地址）',
      'ds.sshHost': 'SSH 主机',
      'ds.sshAuth': '认证方式',
      'ds.sshAuth.password': '密码',
      'ds.sshAuth.key': '私钥',
      'ds.sshKey': '私钥（PEM / OpenSSH 格式）',
      'ds.sshPassphrase': '私钥口令（可选）',
      'ds.sshHint': '密码、私钥都保存在 Harness 凭据库中，不会写入配置文件，也不会发送给模型。',
      'ds.viaSsh': '经 SSH 隧道',
      'ds.privacyTitle': '本数据源的模型可见数据',
      'ds.privacyEnable': '使用单独设置（覆盖全局设置）',
      'ds.privacyCustom': '单独隐私设置',
      'schema.overviewPin': '生成概览并固定到看板',
      'schema.overviewPinConfirm': '将为这张表生成 4~6 个概览图表并全部固定到看板，继续吗？',
      'schema.overviewPinned': '概览图表已固定到看板',
      'tool.overviewRunning': '正在生成概览…',
      'tool.overviewTitle': '{table} · 自动概览',
      'tool.overviewCount': '{count} 个图表',
      'rep.hint': '按时启动一个「数据问答」会话，由 Agent 查询数据、写出摘要，并可推送到飞书。',
      'rep.add': '新建报告',
      'rep.openSchedules': '打开定时任务',
      'rep.empty': '还没有定时报告',
      'rep.emptyHint': '例如：每天 9 点汇总昨天的订单量、GMV 和异常波动。',
      'rep.title': '报告名称',
      'rep.titlePh': '订单日报',
      'rep.scope': '报告内容',
      'rep.scope.question': '按分析要求',
      'rep.scope.dashboard': '刷新看板图表',
      'rep.question': '分析要求',
      'rep.questionPh': '昨天的订单量、GMV、客单价，与前一天对比，按渠道拆分',
      'rep.instructions': '补充要求（可选）',
      'rep.instructionsPh': '例如：只看已支付订单；金额以万元为单位',
      'rep.period': '频率',
      'rep.period.daily': '每天',
      'rep.period.weekly': '每周',
      'rep.time': '时间',
      'rep.weekdays': '星期',
      'rep.wd.1': '一', 'rep.wd.2': '二', 'rep.wd.3': '三', 'rep.wd.4': '四', 'rep.wd.5': '五', 'rep.wd.6': '六', 'rep.wd.7': '日',
      'rep.target': '投递到',
      'rep.target.new_once': '同一个会话（持续追加）',
      'rep.target.new': '每次新建会话',
      'rep.status.active': '运行中',
      'rep.status.paused': '已暂停',
      'rep.status.ended': '已结束',
      'rep.status.missing': '定时任务已被删除',
      'rep.next': '下次',
      'rep.last': '上次投递',
      'rep.openLast': '查看上次报告',
      'rep.runNow': '立即执行',
      'rep.started': '已开始执行，稍后可在会话列表中查看',
      'rep.pause': '暂停',
      'rep.resume': '恢复',
      'rep.deleteConfirm': '删除报告「{title}」及其定时任务？',
      'schema.modeList': '列表',
      'schema.modeEr': '关系图',
      'er.onlyLinked': '只显示有关联的表',
      'er.inferred': '包含推断关联',
      'er.hint': '拖动节点调整布局，滚轮缩放，双击节点查看表详情；实线=外键，虚线=推断',
      'sql.explain': '执行计划',
      'sql.plan': '执行计划（EXPLAIN）',
      'sql.edit': '编辑并重新执行',
      'sql.confirmScan': '仍要执行这个查询吗？',
      'kb.hint': '业务知识会作为上下文提供给模型：词表解释业务术语，指标库固定口径，字段备注补充取值含义，样例问答让同类问题直接复用经过验证的 SQL。',
      'kb.glossary': '业务词表',
      'kb.metrics': '指标库',
      'kb.notes': '表/字段备注',
      'kb.examples': '样例问答',
      'kb.add': '新增',
      'kb.term': '术语',
      
      'kb.definition': '含义',
      'kb.sqlHint': 'SQL 片段（可选）',
      'kb.metricName': '指标名称',
      'kb.unit': '单位',
      'kb.expression': '计算表达式（如 SUM(pay_amount)）',
      'kb.table': '主表',
      'kb.timeColumn': '时间字段',
      'kb.filter': '默认过滤条件（WHERE 片段）',
      'kb.description': '口径说明',
      'kb.question': '问题',
      'kb.sql': '经过验证的 SQL',
      'kb.note': '备注',
      'kb.noteKey': '表名 或 表名.字段名',
      'kb.noteText': '备注内容（如状态取值含义）',
      'kb.notesHint': '为表或字段补充数据库注释里没有的业务含义。',
      'kb.draft': '根据枚举字段生成草稿',
      'kb.drafts': '{count} 条待补充的字段',
      'kb.noDrafts': '没有需要补充的枚举字段',
      'kb.glossaryEmpty': '还没有业务术语。例如：GMV = 已支付订单金额之和。',
      'kb.metricsEmpty': '还没有指标。固定口径的指标会被模型优先使用。',
      'kb.notesEmpty': '还没有备注。',
      'kb.examplesEmpty': '还没有样例问答。在查询结果上点「存为样例」即可添加。',
      'kb.deleteConfirm': '确定删除这一项？',
      'kb.saveExample': '存为样例',
      'kb.exampleSaved': '已存为样例',
      'kb.exampleHint': '把这个问题和 SQL 存入样例问答，供以后同类问题复用',
      'kb.examplePrompt': '这条 SQL 回答的问题是：',
      'dash.refreshOne': '刷新',
      'dash.moveUp': '上移',
      'dash.moveDown': '下移',
      'dash.full': '通栏',
      'dash.half': '半宽',
      'dash.rename': '重命名',
      'dash.removeConfirm': '从看板移除「{title}」？',
      'dash.auto': '自动刷新',
      'dash.autoOff': '关闭',
      'dash.autoEvery': '每 {min} 分钟',
      'settings.scanGuardRows': '大表全表扫描保护：执行计划显示全表扫描超过该行数时需要确认（0 = 关闭）',
      'hist.search': '搜索 SQL 或标题',
      'hist.allSources': '全部数据源',
      'hist.allStatus': '全部状态',
      'hist.allSource': '全部来源',
      'hist.status.ok': '成功',
      'hist.status.error': '失败',
      'hist.status.blocked': '已拦截',
      'hist.source.agent': 'Agent',
      'hist.source.ui': '页面',
      'hist.source.dashboard': '看板',
      'hist.export': '导出审计 CSV',
      'hist.clear': '清空',
      'hist.clearConfirm': '确定清空全部查询历史？',
      'hist.total': '查询次数',
      'hist.errors': '失败',
      'hist.blocked': '拦截',
      'hist.avg': '平均耗时',
      'hist.empty': '没有符合条件的记录',
      'hist.openSession': '打开会话',
      'ds.none': '还没有数据源',
      'ds.noneHint': '先添加一个数据源（MySQL 5.7+ / PostgreSQL / Elasticsearch），再开始用自然语言提问。',
      'ds.add': '新建数据源',
      'ds.edit': '编辑',
      'ds.delete': '删除',
      'ds.deleteConfirm': '确定删除数据源「{name}」？绑定它的看板组件也会删除。',
      'ds.test': '测试连接',
      'ds.testing': '正在测试…',
      'ds.save': '保存',
      'ds.cancel': '取消',
      'ds.name': '名称',
      'ds.host': '主机',
      'ds.port': '端口',
      'ds.database': '数据库',
      'ds.user': '用户名',
      'ds.password': '密码',
      'ds.passwordKeep': '留空则保持原密码',
      'ds.charset': '字符集',
      'ds.ssl': '使用 SSL',
      'ds.description': '描述（会提供给模型作为业务背景）',
      'ds.current': '当前',
      'ds.select': '选择数据源',
      'ds.setCurrent': '设为当前',
      'ds.testOk': '连接成功 · MySQL {version} · {tables} 张表 · {latency}ms',
      'ds.testFail': '连接失败：{error}',
      'ds.readonlyWarn': '该账号有写权限，建议使用只读账号',
      'ds.readonlyOk': '只读账号',
      'ds.passwordSet': '已保存密码',
      'schema.analyze': '分析表结构',
      'schema.refresh': '重新分析',
      'schema.analyzing': '正在分析…',
      'schema.search': '搜索表或字段',
      'schema.tables': '{count} 张表',
      'schema.relations': '{count} 个关联',
      'schema.notAnalyzed': '尚未分析该数据源的表结构',
      'schema.pickTable': '在左侧选择一张表查看详情',
      'schema.columns': '字段',
      'schema.indexes': '索引',
      'schema.relationsOf': '关联关系',
      'schema.preview': '预览数据',
      'schema.overview': '自动概览',
      'schema.askAbout': '提问',
      'schema.rows': '约 {rows} 行',
      'role.fact': '事实表',
      'role.dimension': '维度表',
      'role.log': '日志表',
      'role.config': '配置表',
      'role.view': '视图',
      'role.other': '其他',
      'col.time': '时间',
      'col.measure': '度量',
      'col.enum': '枚举',
      'col.id': 'ID',
      'col.geo': '地区',
      'col.sensitive': '敏感',
      'col.flag': '标志',
      'col.text': '文本',
      'ask.placeholder': '用自然语言提问，例如：最近 30 天每天的订单量和金额趋势',
      'ask.start': '提问',
      'ask.hint': '问题会在一个绑定当前数据源的「数据问答」会话中由 Agent 回答，结果以图表形式显示在对话里。',
      'ask.examples': '试试这些问题',
      'ask.sql': '直接写 SQL',
      'ask.run': '执行',
      'ask.running': '执行中…',
      'ask.noWorkspace': '请先在左侧打开或创建一个工作区',
      'result.rows': '{count} 行',
      'result.truncated': '（已截断）',
      'result.elapsed': '{ms} ms',
      'result.sql': 'SQL',
      'result.copy': '复制',
      'result.copied': '已复制',
      'result.csv': '导出 CSV',
      'result.png': '导出图片',
      'result.pin': '固定到看板',
      'result.pinned': '已固定',
      'result.expired': '结果缓存已过期，点击重新执行',
      'result.rerun': '重新执行',
      'result.empty': '查询没有返回数据',
      'result.masked': '已脱敏',
      'chart.auto': '自动',
      'chart.line': '折线',
      'chart.area': '面积',
      'chart.bar': '柱状',
      'chart.barh': '条形',
      'chart.stacked': '堆叠',
      'chart.pie': '饼图',
      'chart.funnel': '漏斗',
      'chart.scatter': '散点',
      'chart.kpi': '指标卡',
      'chart.table': '表格',
      'chart.loading': '正在加载图表…',
      'dash.empty': '看板还是空的',
      'dash.emptyHint': '在对话或查询结果中点击「固定到看板」添加图表。',
      'dash.refresh': '刷新全部',
      'dash.remove': '移除',
      'settings.title': '模型可见数据',
      'settings.hint': '查询结果完整保存在本机，只在页面上展示。以下设置决定发送给大模型的数据范围。',
      'settings.sampleMode': '表结构抽样',
      'settings.sample.off': '关闭（只发送表结构）',
      'settings.sample.enum': '只抽样枚举字段取值',
      'settings.sample.all': '允许抽样数据行',
      'settings.resultToModel': '查询结果发送给模型',
      'settings.result.none': '不发送（只发送列名和行数）',
      'settings.result.summary': '统计摘要',
      'settings.result.rows': '前 N 行',
      'settings.modelRows': '发送行数上限 N',
      'settings.maskSensitive': '敏感字段脱敏（手机号、邮箱、证件号、密码等）',
      'settings.limits': '查询限制',
      'settings.maxRows': '单次最多返回行数',
      'settings.timeoutMs': '查询超时（毫秒）',
      'settings.save': '保存设置',
      'settings.saved': '已保存',
      'composer.none': '未选数据源',
      'composer.title': '本会话查询的数据源',
      'tool.query': '数据查询',
      'tool.chart': '图表',
      'tool.running': '正在查询…',
      'tool.failed': '查询失败',
      'error.generic': '操作失败：{message}',
      'dash.copyName': '{name} 副本',
      'set.leaveTitle': '放弃未保存的设置？',
      'set.leaveMsg': '设置中有未保存的修改，离开后这些修改会丢失。',
      'set.leaveOk': '放弃并离开',
      'fb.deleteConfirm': '删除这条反馈？',
      'hist.source.telegrambot': 'Telegram 机器人',
      'hist.source.wecombot': '企业微信机器人',
      'hist.source.dingtalkbot': '钉钉机器人',
      'hist.source.unknown': '未知来源',
      'hist.source.genericBot': '{platform} 机器人',
      'filter.valuesPh': '值，用逗号分隔',
      'policy.tablesLabel': '可访问的表',
    }
    const en = {
      'fq.admin.fOffNote': "Data freshness is off: no checks, no notifications, nothing shown on the page. Turn it on in Settings below.",
      'fq.set.gFresh': "Data freshness",
      'fq.set.gQuality': "Data quality patrol",
      'fq.set.fEnabledShort': "Enabled",
      'fq.set.fEnabledHint': "Checks the latest timestamp of every table on a schedule and notifies when data stops updating; the agent checks it before answering about recent periods. When off, all of this stops and nothing is shown on the page.",
      'fq.set.showShort': "Show on the page",
      'fq.set.showHint': "Stale-data bars under results and the freshness panel in Schema. Checks and notifications keep running when hidden.",
      'fq.set.staleHint': "Data older than this counts as stale; set per-table thresholds in the table above (0 = not monitored).",
      'fq.set.fChannelHint': "One notification per stale episode, and one when it recovers.",
      'fq.set.qEnabledHint': "Daily check of null rates, duplicate keys, outliers, future timestamps and negative amounts, with a health score.",
      'fq.set.on': "On",
      'fq.set.off': "Off",
      'fq.set.shown': "Shown",
      'fq.set.hidden': "Hidden",
      'mcp.client.claudeCode': 'Claude Code', 'mcp.client.cline': 'Cline', 'mcp.client.windsurf': 'Windsurf', 'mcp.client.codex': 'Codex CLI', 'mcp.client.gemini': 'Gemini CLI', 'mcp.client.zed': 'Zed', 'mcp.client.continue': 'Continue',
      'mcp.where.claudeCode': 'Run in a terminal (HTTP; the stdio bridge variant is below).', 'mcp.where.cline': 'Add to cline_mcp_settings.json (Cline panel → MCP Servers → Configure).', 'mcp.where.windsurf': 'Add to Windsurf\'s mcp_config.json (Cascade → MCP → open config file).', 'mcp.where.codex': 'Add to ~/.codex/config.toml (or the project\'s .codex/config.toml).', 'mcp.where.gemini': 'Add to ~/.gemini/settings.json or the project\'s .gemini/settings.json.', 'mcp.where.zed': 'Add to Zed\'s settings.json.', 'mcp.where.continue': 'Save as .continue/mcpServers/nl2sql.yaml in the workspace.',
      'mcp.test': 'Test connection', 'mcp.testOk': 'Connected: {n} tools discovered.', 'mcp.testFail': 'Connection failed: {error}', 'mcp.testFailSteps': 'Connection test failed:',
      'mcp.expiry': 'Expires (optional)', 'mcp.noExpiry': 'Never', 'mcp.expiryHint': 'The token stops working (401) after the end of that day.', 'mcp.toolsAllow': 'Allowed tools', 'mcp.allTools': 'All tools', 'mcp.rateLimit': 'Rate limit (optional)', 'mcp.unlimited': 'unlimited', 'mcp.perMinute': 'requests / minute; above it → 429',
      'mcp.err.tools': 'Select at least one tool', 'mcp.edit': 'Edit', 'mcp.editTitle': 'Edit token "{name}"', 'mcp.save': 'Save', 'mcp.saved': 'Saved',
      'mcp.rotate': 'Rotate secret', 'mcp.rotateConfirm': 'Rotate the secret of token "{name}"?', 'mcp.rotateHint': 'The old secret stops working at once; the new one is shown once. Scope and limits stay the same.', 'mcp.rotated': 'New secret generated',
      'mcp.col.limits': 'Limits', 'mcp.noLimits': 'none', 'mcp.expired': 'Expired', 'mcp.expiresOn': 'expires {date}', 'mcp.toolsN': '{n} tools', 'mcp.rateN': '{n}/min',
      'mcp.callLog': 'Call log', 'mcp.log.token': 'Token', 'mcp.log.allTokens': 'All tokens', 'mcp.log.status': 'Status', 'mcp.log.all': 'All', 'mcp.log.filter': 'Filter by tool or data source', 'mcp.log.refresh': 'Refresh', 'mcp.log.empty': 'No calls yet', 'mcp.log.time': 'Time', 'mcp.log.tool': 'Tool / method', 'mcp.log.datasource': 'Data source', 'mcp.log.ms': 'ms', 'mcp.log.rows': 'Rows',
      'hist.status.cancelled': 'Cancelled', 'mcp.log.status.ok': 'OK', 'mcp.log.status.error': 'Failed', 'mcp.log.status.cancelled': 'Cancelled', 'mcp.log.status.rate-limited': 'Rate limited',
      'admin.group.insight': "Insight & automation",
      'admin.group.connect': "Integrations",
      "fq.title": "Data freshness",
      "fq.refresh": "Refresh",
      "fq.checkedAt": "Checked {time}",
      "fq.staleCount": "{n} stale table(s)",
      "fq.warnCount": "{n} table(s) lagging",
      "fq.allFresh": "All data up to date",
      "fq.lagMin": "{n} min",
      "fq.lagHour": "{n} h",
      "fq.lagDay": "{n} days",
      "fq.today": "today {time}",
      "fq.yesterday": "yesterday {time}",
      "fq.barItem": "{table}: latest data from {when} ({lag} behind)",
      "fq.barMore": "+{n} more tables",
      "fq.st.error": "Check failed",
      "fq.st.empty": "No data",
      "fq.running": "Checking data freshness…",
      "fq.failed": "Check failed",
      "fq.noTime": "No time column",
      "fq.notAnalyzed": "This data source has not been analyzed yet; analyze it under Schema first.",
      "fq.noTables": "No tables with a time column.",
      "fq.col.table": "Table",
      "fq.col.column": "Time column",
      "fq.col.latest": "Latest data",
      "fq.col.lag": "Lag",
      "fq.col.threshold": "Threshold (h)",
      "fq.thresholdFor": "Lag threshold for {table} (hours)",
      "fq.events": "Recent delay events",
      "fq.evStale": "stale for {lag}",
      "fq.evRecovered": "recovered",
      "fq.pushed": "pushed",
      "fq.q.title": "Data quality patrol",
      "fq.q.lastRun": "Last run {time}",
      "fq.q.run": "Run now",
      "fq.q.running": "Running…",
      "fq.q.empty": "No runs yet. Click \"Run now\" to start.",
      "fq.q.done": "Patrol finished, health score {score}",
      "fq.q.history": "Recent scores",
      "fq.q.score": "Score",
      "fq.q.rows": "Rows",
      "fq.q.issues": "Issues",
      "fq.q.noIssues": "No issues found",
      "fq.more": "{n} more",
      "fq.less": "Show less",
      "fq.admin.nav": "Data health",
      "fq.admin.title": "Data health",
      "fq.admin.desc": "Watch whether tables keep receiving new data, and patrol them for nulls, duplicate keys, outliers, future timestamps and negative amounts.",
      "fq.admin.nextF": "Next freshness check {time}",
      "fq.admin.fOff": "Scheduled freshness checks are off",
      "fq.admin.nextQ": "Quality patrol daily at {time}",
      "fq.admin.qOff": "Daily quality patrol is off",
      "fq.admin.noDs": "Add a data source first",
      "fq.set.title": "Settings",
      "fq.set.qEnabled": "Daily data quality patrol",
      "fq.set.interval": "Freshness check interval (min)",
      "fq.set.time": "Quality patrol time",
      "fq.set.staleHours": "Default lag threshold (hours)",
      "fq.set.drop": "Push when the score drops by more than (points)",
      "fq.set.fChannel": "Delay notification channel",
      "fq.set.qChannel": "Score drop notification channel",
      "fq.set.noPush": "Do not push",
      "fq.saved": "Saved",
      'pro.close': 'Close', 'pro.sendNow': 'Send now', 'pro.sent': 'Sent', 'pro.deleteConfirm': 'Delete "{name}"?', 'pro.weekday': 'Weekday',
      'pro.wd.0': 'Sunday', 'pro.wd.1': 'Monday', 'pro.wd.2': 'Tuesday', 'pro.wd.3': 'Wednesday', 'pro.wd.4': 'Thursday', 'pro.wd.5': 'Friday', 'pro.wd.6': 'Saturday',
      'pro.fc.menu': 'Forecast next {n} days', 'pro.fc.title': 'Forecast', 'pro.fc.heading': 'Forecast, next {n} periods', 'pro.fc.running': 'Forecasting…', 'pro.fc.forecast': 'Forecast', 'pro.fc.band': '95% interval', 'pro.fc.lower': 'Lower', 'pro.fc.upper': 'Upper',
      'pro.fc.hw': 'Holt-Winters · weekly', 'pro.fc.holt': 'Holt linear trend', 'pro.fc.horizon': 'Horizon', 'pro.fc.nDays': '{n} periods', 'pro.fc.filled': '{n} days filled', 'pro.fc.filledHint': 'Days without data count as 0',
      'pro.fc.note': 'A statistical extrapolation of the history; promotions, holidays and other known events are not taken into account. The band is the 95% prediction interval.',
      'pro.goals.title': 'Goals', 'pro.goals.desc': 'Monthly / quarterly / yearly targets for metrics: the period end is projected from the daily run rate (weekday-aware), and progress shows on dashboards.', 'pro.goals.add': 'New goal',
      'pro.goals.name': 'Name', 'pro.goals.namePh': 'e.g. November transactions', 'pro.goals.period': 'Period', 'pro.goals.target': 'Target', 'pro.goals.direction': 'Direction', 'pro.goals.dashboard': 'Show on dashboard', 'pro.goals.anyBoard': 'Dashboards using the same data source',
      'pro.goals.empty': 'No goals yet', 'pro.goals.emptyHint': 'Define a metric in Knowledge → Metrics first, then set a goal for it.', 'pro.goals.actual': 'Actual', 'pro.goals.projected': 'Projected', 'pro.goals.proj': 'Projected {v} ({p})', 'pro.goals.weekdayAware': 'weekday-aware',
      'pro.goals.weekly': 'Weekly goal report', 'pro.goals.weeklyOn': 'Push goal progress every week', 'pro.goals.weeklyHint': 'At the chosen time, progress and projections of all goals are pushed to the channel.',
      'pro.period.month': 'Month', 'pro.period.quarter': 'Quarter', 'pro.period.year': 'Year', 'pro.dir.up': 'At least', 'pro.dir.down': 'At most',
      'pro.st.on-track': 'On track', 'pro.st.at-risk': 'At risk', 'pro.st.achieved': 'Achieved', 'pro.st.missed': 'Missed', 'pro.st.error': 'Error',
      'pro.dg.title': 'Daily digest', 'pro.dg.desc': 'Every day, compares yesterday with the 7-day average and the same day last week, explains notable changes and pushes a short summary with charts.', 'pro.dg.add': 'New digest',
      'pro.dg.name': 'Name', 'pro.dg.namePh': 'e.g. Daily transactions', 'pro.dg.source': 'Content', 'pro.dg.src.metrics': 'Library metrics', 'pro.dg.src.dashboard': 'Dashboard trend charts', 'pro.dg.metrics': 'Metrics', 'pro.dg.dashboard': 'Dashboard',
      'pro.dg.language': 'Language', 'pro.dg.threshold': 'Change threshold (%)', 'pro.dg.hint': 'A metric is notable when yesterday deviates from the 7-day average by more than 2 standard deviations or by more than the threshold; notable changes are attributed to the main dimension.',
      'pro.dg.empty': 'No daily digests yet', 'pro.dg.emptyHint': 'Pick a few key metrics and get them in your group chat every morning.', 'pro.dg.preview': 'Preview', 'pro.dg.previewing': 'Generating preview…', 'pro.dg.dailyAt': 'Daily at {time}',
      "pre.working": "Generating…", "pre.exported": "Exported", "pre.exportPpt": "Export PPT", "pre.exportImage": "Export long image", "pre.sendImage": "Send long image to IM", "pre.sendImageHint": "Render the whole dashboard as one tall image and send it to a Lark app bot or Telegram bot channel.", "pre.noImageChannel": "No channel can receive images: add a Lark app bot or Telegram bot under Admin → Channels first.", "pre.channel": "Channel", "pre.send": "Send", "pre.imageSent": "Long image sent to \"{channel}\"", "pre.mode": "Presentation mode", "pre.loading": "Loading…", "pre.lastRefresh": "Last refresh {time}", "pre.clock": "Current time", "pre.refresh": "Auto refresh", "pre.rotate": "Rotate boards", "pre.rotateOff": "Off", "pre.everySec": "Every {s} s", "pre.prev": "Previous dashboard (←)", "pre.next": "Next dashboard (→)", "pre.exit": "Exit presentation mode", "pre.exitHint": "Exit (Esc)", "pre.bt.nav": "Bitable sync", "pre.bt.title": "Bitable sync", "pre.bt.desc": "Write a dashboard widget or SQL result into a Lark Bitable: missing fields are created (text / number / date); optionally synced daily.", "pre.bt.add": "New sync", "pre.bt.empty": "No syncs yet", "pre.bt.emptyHint": "For example: every morning, sync \"revenue by channel\" to the ops team's Bitable.", "pre.bt.name": "Name", "pre.bt.namePh": "e.g. Channel daily → Ops Bitable", "pre.bt.channel": "Lark app (provides app credentials)", "pre.bt.noChannel": "Add a Lark app bot channel first", "pre.bt.channelMissing": "Channel deleted", "pre.bt.appTokenPh": "Paste the Bitable link or app_token", "pre.bt.source": "Source", "pre.bt.src.widget": "Dashboard widget", "pre.bt.src.sql": "SQL query", "pre.bt.widget": "Widget", "pre.bt.mode": "Write mode", "pre.bt.mode.replace": "Replace", "pre.bt.mode.append": "Append", "pre.bt.modeHint.replace": "Delete all records first, then write the latest result.", "pre.bt.modeHint.append": "Append the result each time, keeping existing records.", "pre.bt.schedule": "Schedule", "pre.bt.daily": "Sync daily", "pre.bt.dailyAt": "Daily {time}", "pre.bt.permHint": "Add the app to the Bitable (… → More → Add document app, with edit access) and grant it the bitable:app scope.", "pre.bt.run": "Sync now", "pre.bt.ran": "Synced: {created} written, {deleted} deleted", "pre.bt.lastOk": "OK · {n} rows", "pre.bt.lastErr": "Failed", "pre.bt.never": "Never run", "pre.bt.deleteConfirm": "Delete sync \"{name}\"?",
      'mcp.nav': 'MCP access', 'mcp.title': 'MCP access', 'mcp.desc': 'Let AI tools such as Claude Desktop, Cursor, Cline and VS Code use these data sources through the Model Context Protocol. Read-only admission, access policies, member scopes, row-level rules and audit apply as usual.',
      'mcp.enabled': 'Enabled', 'mcp.disabled': 'Disabled', 'mcp.running': 'Running', 'mcp.stopped': 'Not running', 'mcp.port': 'Port', 'mcp.applyPort': 'Apply',
      'mcp.endpoint': 'Endpoint', 'mcp.localOnly': 'The server listens on 127.0.0.1 only and rejects non-local Origin / Host headers; every request needs a token.', 'mcp.copy': 'Copy', 'mcp.copied': 'Copied',
      'mcp.tokens': 'Access tokens', 'mcp.newToken': 'New token', 'mcp.tokenName': 'Name', 'mcp.tokenNamePh': 'e.g. My Cursor', 'mcp.create': 'Create token',
      'mcp.scope': 'Scope', 'mcp.scope.owner': 'Local owner (full access)', 'mcp.scope.member': 'A member', 'mcp.scope.role': 'Role + data sources',
      'mcp.scopeHint.owner': 'Same access as asking on this page; access policies still apply.', 'mcp.scopeHint.member': 'Follows the member\'s role, data source scope and row-level rules; the token stops working when the member is disabled.', 'mcp.scopeHint.role': 'Only the selected data sources, with an optional row-level rule.',
      'mcp.member': 'Member', 'mcp.pickMember': 'Choose a member…', 'mcp.noMembers': 'No members yet; add one under Members first.', 'mcp.memberMissing': 'Member deleted', 'mcp.memberDisabled': 'Member disabled',
      'mcp.role': 'Role', 'mcp.role.admin': 'Admin', 'mcp.role.analyst': 'Analyst', 'mcp.role.viewer': 'Viewer', 'mcp.datasources': 'Data sources', 'mcp.allDs': 'All data sources',
      'mcp.rowRule': 'Row-level rule (optional)', 'mcp.rowColumn': 'Column', 'mcp.rowValues': 'Allowed values, comma-separated', 'mcp.rowRuleHint': 'Queries on tables with this column get "column IN (values)" added automatically.', 'mcp.rowRulesN': '{n} row-level rules',
      'mcp.err.name': 'Enter a token name', 'mcp.err.member': 'Choose a member', 'mcp.err.ds': 'Select at least one data source',
      'mcp.freshTitle': 'Token "{name}" created', 'mcp.freshHint': 'The token is shown only once — copy it now. Only its hash is stored; if lost, create a new one.', 'mcp.done': 'I saved it',
      'mcp.col.name': 'Name', 'mcp.col.scope': 'Scope', 'mcp.col.created': 'Created', 'mcp.col.lastUsed': 'Last used', 'mcp.never': 'Never',
      'mcp.revoke': 'Revoke', 'mcp.revokeConfirm': 'Revoke token "{name}"?', 'mcp.revokeHint': 'Clients using this token lose access immediately.', 'mcp.revoked': 'Token revoked',
      'mcp.noTokens': 'No tokens yet', 'mcp.noTokensHint': 'Create a token, then add the configuration below to your AI tool.',
      'mcp.setup': 'Client configuration', 'mcp.client.claude': 'Claude Desktop', 'mcp.client.cursor': 'Cursor', 'mcp.client.vscode': 'VS Code',
      'mcp.where.claude': 'Add to claude_desktop_config.json (stdio bridge via npx nl2sql-mcp; needs Node.js 18+).', 'mcp.where.cursor': 'Add to ~/.cursor/mcp.json or the project\'s .cursor/mcp.json (HTTP).', 'mcp.where.vscode': 'Add to .vscode/mcp.json (HTTP).',
      'mcp.placeholderHint': 'Replace <YOUR_TOKEN> with your token.', 'mcp.docsHint': 'See docs/mcp.md in the plugin for details. Keep DeepSeek Harness running while you use it.',
      'rc.title': "Reconciliation", 'rc.hint': "Compare the results of two data sources (or two queries): rows are matched on key columns to find rows present on one side only and values that differ; run daily and push the differences.", 'rc.add': "New reconciliation", 'rc.empty': "No reconciliations yet", 'rc.emptyHint': "For example: check daily order counts and amounts between the order database and the finance database.", 'rc.name': "Name", 'rc.namePh': "e.g. Orders vs finance · daily amount", 'rc.left': "Left", 'rc.right': "Right", 'rc.leftCol': "Left column", 'rc.rightCol': "Right column (blank = same name)", 'rc.keys': "Key columns", 'rc.keysHint': "Columns that match rows across both sides (an order number, or date + channel).", 'rc.addKey': "Add key", 'rc.compare': "Compare columns", 'rc.compareHint': "Values that must agree; numbers can have a tolerance (absolute, or relative such as 0.001 = 0.1%).", 'rc.addCompare': "Add compare column", 'rc.tolerance': "Tolerance", 'rc.tolMode': "Tolerance type", 'rc.tolAbs': "Absolute", 'rc.tolRel': "Relative", 'rc.trim': "Trim spaces before comparing text", 'rc.ignoreCase': "Ignore case", 'rc.daily': "Run daily", 'rc.dailyAt': "Daily {time}", 'rc.manual': "Manual", 'rc.noPush': "Do not push", 'rc.notifyOn': "Push when", 'rc.notify.diff': "Differences found", 'rc.notify.always': "Every run", 'rc.dryRun': "Dry run", 'rc.dryResult': "Dry run result (not saved)", 'rc.saved': "Reconciliation saved", 'rc.runNow': "Run now", 'rc.pushed': "pushed", 'rc.history': "Run history", 'rc.historyOf': "Run history · {name}", 'rc.allRuns': "All jobs", 'rc.runOf': "Reconciliation result · {name}", 'rc.close': "Close", 'rc.deleteConfirm': "Delete reconciliation \"{name}\"?", 'rc.detail': "Details", 'rc.push': "Push", 'rc.scheduled': "scheduled", 'rc.never': "Never run", 'rc.status.ok': "Consistent", 'rc.status.diff': "Differences", 'rc.status.error': "Failed", 'rc.matchRate': "Match rate", 'rc.matched': "Matched keys", 'rc.mismatched': "Rows with different values", 'rc.rowsOf': "{side} rows", 'rc.onlyIn': "Only in {side}", 'rc.totalOf': "{side} total", 'rc.col': "Column", 'rc.mismatchRows': "Different rows", 'rc.diff': "Difference", 'rc.hasDiff': "Differences found, match rate {rate}", 'rc.noDiff': "Both sides agree, match rate {rate}", 'rc.incomplete': "incomplete (truncated)", 'rc.short.onlyLeft': "left only {n}", 'rc.short.onlyRight': "right only {n}", 'rc.short.mismatch': "{n} rows differ", 'rc.tab.summary': "Summary", 'rc.tab.mismatches': "Different values", 'rc.tab.only': "Only in {side}", 'rc.tool': "Reconciliation", 'rc.toolRunning': "Reconciling",
      "sub.nav": "Chat subscriptions",
      "sub.title": "Chat subscriptions",
      "sub.desc": "Scheduled deliveries and alerts created from IM chats through a bot, grouped by chat; they are delivered back to that chat.",
      "sub.refresh": "Refresh",
      "sub.empty": "No chat subscriptions yet",
      "sub.emptyHint": "In a chat, @-mention the bot with \"send this here every day at 9\" or \"tell me when it exceeds 1000\".",
      "sub.col.item": "Item",
      "sub.col.creator": "Created by",
      "sub.col.schedule": "Schedule",
      "sub.col.last": "Last delivery",
      "sub.col.status": "Status",
      "sub.kind.subscription": "Subscription",
      "sub.kind.alert": "Alert",
      "sub.status.active": "Active",
      "sub.status.paused": "Paused",
      "sub.status.suspended": "Suspended",
      "sub.next": "Next",
      "sub.pause": "Pause",
      "sub.resume": "Resume",
      "sub.delete": "Delete",
      "sub.deleteConfirm": "Delete \"{name}\"?",
      "sub.done.pause": "Paused",
      "sub.done.resume": "Resumed",
      "sub.done.delete": "Deleted",
      'mb.pick.people': "Pick someone who talked to a bot",
      'mb.pick.chats': "Pick a group the bot is in",
      'mb.pick.refresh': "Refresh",
      'mb.pick.noPeople': "Nobody has talked to a bot yet. Ask them to @-mention the bot or DM it once (they will be told they have no access); they then appear here for one-click adding.",
      'mb.pick.noChats': "No groups to pick yet. Add the bot to a group and @-mention it once, or check the app can read chat info.",
      'mb.pick.peopleHint': "Picking fills in the account id and name; you can also type them below.",
      'mb.pick.chatsHint': "Picking fills in the chat id and name; everyone in the group uses its access.",
      'mb.pick.via': "via channel: {name}",
      'mb.pick.taken': "already member \"{name}\"",
      'mb.pick.refused': "was refused (no access)",
      'mb.pick.pending': "pending",
      'mb.pick.added': "added",
      'mb.pending.title': "{n} people or groups were refused by a bot because they are not members. Click to add:",
      'mb.pending.add': "Add",
      'dash.sourceOf': "Data source",
      'dash.sourceMissing': "This chart's data source was deleted; it cannot refresh",
      'dash.sourceMissingShort': "source deleted",
      'dash.scope': "Show",
      'dash.scopeAll': "All sources",
      'dash.scopeCurrent': "Only {name}",
      'dash.sources': "Sources: {list}",
      'dash.scopeEmpty': "No charts from \"{name}\" on this dashboard",
      'dash.scopeEmptyHint': "{n} charts from other sources are hidden.",
      'im.attachFull': "Attach full data as Excel for results over {n} rows",
      'im.rowsLimit': "Messages show up to {n} rows per result and say when rows are omitted; export Excel on the page for full data",
      'im.sentFile': "full data attached as Excel",
      "settings.botDefaultRole": "Unregistered users",
      "settings.larkDefaultRole": "Unregistered users",
      "ch.savedTestFailedMsg": "Saved, but the test failed: {msg}",
      "ch.p.lark": "Lark",
      "ch.p.telegram": "Telegram",
      "ch.p.wecom": "WeCom",
      "ch.p.dingtalk": "DingTalk",
      "ch.p.lark.mark": "L",
      "ch.p.telegram.mark": "TG",
      "ch.p.wecom.mark": "W",
      "ch.p.dingtalk.mark": "D",
      "ch.k.lark_webhook": "A custom bot added in group settings. Paste its webhook URL; push only.",
      "ch.k.lark_app": "A custom app bot: message groups or people, list chats, and answer questions when @-mentioned in Lark.",
      "ch.f.signSecret": "Fill in when signature verification is on; leave empty to send unsigned.",
      "ch.f.receiveId": "For groups, use \"Pick chat\" to fill this in.",
      "ch.desc": "A channel is one connection to an IM platform. It delivers results, dashboards, scheduled reports and alerts; channels that support it can also run a chat bot that answers questions in groups or DMs.",
      "ch.emptyHint": "Add a Lark, Telegram, WeCom or DingTalk channel to push results to a group, or turn on a bot to ask questions from IM.",
      "ch.addTitle": "Add channel",
      "ch.addSub": "Pick a platform and connection type; credentials come next.",
      "ch.editTitle": "Edit channel \"{name}\"",
      "ch.back": "Back",
      "ch.step.pick": "Platform",
      "ch.step.config": "Configure",
      "ch.pickPlatform": "Platform",
      "ch.pickKind": "How to connect {platform}",
      "ch.kindsN": "{n} connection types",
      "ch.noCatalog": "No channel types are available.",
      "ch.unknownKind": "Channel type \"{type}\" is not supported by this version.",
      "ch.noPublicUrl": "No public URL needed",
      "ch.cap.native": "Native charts",
      "ch.cap.image": "Chart images",
      "ch.cap.none": "Tables only",
      "ch.cap.buttons": "Buttons",
      "ch.cap.bot": "Bot",
      "ch.bot.state.off": "Off",
      "ch.bot.state.connecting": "Connecting",
      "ch.bot.state.connected": "Connected",
      "ch.bot.state.error": "Error",
      "ch.bot.state.stopped": "Stopped",
      "ch.secretKeep": "Set; leave empty to keep",
      "ch.secretSet": "Set",
      "ch.err.required": "Required",
      "ch.err.pattern": "Invalid format",
      "ch.err.url": "Enter an address starting with http(s)://",
      "ch.setupSteps": "Setup steps ({n})",
      "ch.pickHint": "Lists the chats the bot is in using the credentials above; nothing is saved.",
      "ch.tablesOnly": "This channel can only send tables.",
      "ch.cmImage": "Charts are rendered and sent as images.",
      "ch.botSection": "Bot",
      "ch.botSectionHint": "When on, people @-mention the bot in a group or DM it to ask; it answers in a Data Q&A session here. Access follows Members & access.",
      "ch.botEnable": "Enable bot",
      "ch.testSavesFirst": "Testing saves the channel first.",
      "ch.testConn": "Test connection",
      "ch.testOk": "Test succeeded",
      "ch.savedTestFailed": "Saved, but the test failed",
      "ch.saved": "Channel saved",
      "ch.deleted": "Channel deleted",
      "ch.defaultSet": "Default channel set",
      "ch.actionsFor": "Actions for \"{name}\"",
      "ch.botSettings": "Bot settings",
      "ch.deleteBotWarn": "The bot on this channel stops too.",
      "ch.failedN": "{n} failed",
      "ch.bots": "Bots",
      "ch.botsHint": "@-mention or DM a bot in IM to ask; answers follow the member permissions below.",
      "ch.bots.empty": "No bot-capable channels yet",
      "ch.bots.emptyHint": "Add a Lark app bot, Telegram, WeCom or DingTalk bot channel to ask questions from IM, no public URL needed.",
      "ch.bots.goAdd": "Add a channel",
      "ch.botToggle": "Enable the bot of \"{name}\"",
      "ch.botOn": "Bot of \"{name}\" enabled",
      "ch.botOff": "Bot of \"{name}\" disabled",
      "ch.restart": "Reconnect",
      "ch.convsN": "Recent chats {n}",
      "ch.p2pOn": "DMs allowed",
      "ch.sum.on": "{on} / {total} enabled",
      "ch.sum.err": "{n} failing",
      "mb.kind2.person": "Person",
      "mb.kind2.chat": "Group chat",
      "mb.ids.person": "IM identities",
      "mb.ids.chat": "Group chat IDs",
      "mb.ids.personHint": "Identifies this person when they ask from IM; add one per platform.",
      "mb.ids.chatHint": "People in this group get the group's access when they @-mention the bot.",
      "mb.ids.add": "Add identity",
      "mb.ids.platformN": "Platform of identity {n}",
      "mb.ids.idN": "ID of identity {n}",
      "mb.ids.emailN": "Email of identity {n} (optional)",
      "mb.ids.emailPh": "Email (optional)",
      "mb.ids.remove": "Remove identity {n}",
      "mb.ids.empty": "Enter an ID or email, or remove this row",
      "mb.ids.needOne": "Add at least one identity so the member can be recognized",
      "mb.ids.none": "No identity",
      "mb.idHelp.lark.person": "Lark open_id (starts with ou_), from the API explorer or a message event; an email alone also works.",
      "mb.idHelp.lark.chat": "Lark chat_id (starts with oc_); use \"Pick chat\" when editing the app bot channel.",
      "mb.idHelp.telegram.person": "Numeric Telegram user id; the person can get it from @userinfobot.",
      "mb.idHelp.telegram.chat": "Telegram group chat id (usually negative, starting with -100); use \"Pick chat\" on the channel.",
      "mb.idHelp.wecom.person": "WeCom userid (the \"Account\" in the contact details).",
      "mb.idHelp.wecom.chat": "WeCom group chatid, found in messages the bot receives.",
      "mb.idHelp.dingtalk.person": "DingTalk userId (admin console → Contacts → member details).",
      "mb.idHelp.dingtalk.chat": "DingTalk group openConversationId (starts with cid), found in messages the bot receives.",
      "set.l.unknownUser": "Unregistered users",
      "set.h.botDefaultRole": "Access for people not in the member list when they @-mention or DM a bot, on every platform.",
      "set.h.defaultChannel": "Used when the agent or a dashboard send names no channel. Applies immediately.",
      'ask.shuffle': "Shuffle",
      'ask.deleteRecent': "Delete this question from history",
      'ask.deleteRecentMsg': "All history entries of \"{q}\" will be deleted (the conversation itself is kept).",
      'ask.deletedN': "Deleted {n} entries",
      'ask.moreRecent': "Show more",
      'hist.deleteOne': "Delete this entry",
      'hist.deleted': "Deleted",
      'bot.step7': 'In Events & Callbacks → Callback configuration, also choose the persistent connection and add the callback "card.action.trigger" (card interaction); otherwise the Breakdown / Why / Details / Pin buttons on answer cards do nothing.', 'bot.actionsHint': 'Answer cards have buttons: breakdown by dimension, why it changed, details, pin to dashboard (admins/analysts only). The clicking member\'s permissions are re-checked.',
      'sg.section': 'Suggestions', 'sg.hint': 'Candidate knowledge mined from query history and feedback. Nothing is added until you accept it.', 'sg.refresh': 'Refresh',
      'sg.kind.example': 'Examples', 'sg.kind.metric': 'Metrics', 'sg.kind.note': 'Column notes', 'sg.kind.glossary': 'Terms',
      'sg.accept': 'Accept', 'sg.acceptEdit': 'Edit, then accept', 'sg.acceptDirect': 'Accept as is', 'sg.dismiss': 'Dismiss', 'sg.dismissConfirm': 'Dismiss this suggestion? It will not come back.',
      'sg.accepted': 'Added to business knowledge', 'sg.dismissed': 'Dismissed', 'sg.evidence': 'Evidence ({count})', 'sg.score': 'Confidence {score}',
      'sg.src.feedback': 'Feedback', 'sg.src.agent': 'Assistant', 'sg.src.ui': 'Page',
      'sg.empty': 'No suggestions yet',
      'sg.emptyHint': 'Suggestions come from: 👍 or corrected feedback → examples; query shapes the assistant runs repeatedly → examples; aggregates repeated in 3+ queries → metrics; CASE WHEN / alias value mappings → column notes; words recurring in question titles → glossary terms. Ask a few more questions and check back.',
      'ds.needsSecret': "Password needed",
      'ds.needsSecretHint': "Imported without secrets; edit it and enter the password or secret.",
      'ph.dsName': "prod-orders",
      'ph.channelName': "Daily data group",
      'ov.suffix': "overview",
      'up.uploading': "Uploading {p}%",
      'up.resultOk': "{table} ({rows} rows)",
      'set.l.scanGuard': "Full-scan guard (rows)",
      'set.l.cacheTtl': "Query cache (s)",
      'set.l.mask': "Mask sensitive columns",
      'set.l.timeout': "Query timeout (ms)",
      'set.l.maxRows': "Max rows",
      'set.l.daily': "Daily check",
      'set.l.notify': "Change notices",
      'set.l.watch': "Detect schema changes",
      'set.l.unknownLark': "Unregistered Lark users",
      'ask.heroSubShort': 'Using "{name}". Ask in plain language; the agent writes the SQL, runs it and charts it.',
      'mb.defaultRole.none.desc': 'Unregistered people get a notice and must be added by an admin. Safest.',
      'mb.defaultRole.viewer.desc': 'Metric library, verified examples and dashboards only; no free SQL.',
      'mb.defaultRole.analyst.desc': 'Free questions. Only for trusted internal groups.',
      'fb2.required': "Required",
      'fb2.ok': "OK",
      'tab.admin': "Manage",
      'admin.sources': "Data sources",
      'admin.members': "Members & access",
      'admin.automation': "Alerts & reports",
      'admin.push': "Channels",
      'admin.settings': "Settings",
      'ds.empty': "No data sources yet",
      'ds.emptyHint': "Connect a database (MySQL / PostgreSQL / Elasticsearch) or upload a CSV / Excel file.",
      'ds.goAdd': "Add a data source",
      'type.sqlite': "Local file",
      'mb.chatShort': "G",
      'ob.title': "Get started in three steps",
      'ob.sub': "Then ask in plain language and build charts and dashboards.",
      'ob.doneTitle': "All set",
      'ob.doneSub': "Optionally set up Lark push to send results and alerts to a group.",
      'ob.dismiss': "Don't show again",
      'ob.stepDone': "done",
      'ob.analyzed': "Schema analyzed",
      'ob.connect': "Connect a data source",
      'ob.connect.desc': "Connect a database or upload CSV / Excel. Queries are always read-only.",
      'ob.connect.cta': "Add data source",
      'ob.analyze': "Analyze the schema",
      'ob.analyze.desc': "Detect table purposes, column meanings and relations for better SQL.",
      'ob.analyze.cta': "Analyze",
      'ob.ask': "Ask a question",
      'ob.ask.desc': "Try a suggested question below; the agent writes SQL, runs it and charts it.",
      'ob.ask.cta': "Try one",
      'ob.push': "Set up a push channel (optional)",
      'ob.push.desc': "Send results, dashboards, scheduled reports and alerts to Lark, Telegram, WeCom or DingTalk groups.",
      'ob.push.cta': "Set up",
      'ask.ex.tables': "What are the core business tables in this database and what do they do?",
      'ask.ex.biggest': "Which 10 tables have the most rows?",
      'ask.heroSubNoSchema': "Using \"{name}\". Analyze the schema first for better answers.",
      'ask.tablePrompt': "Analyze the table {name}{comment}: what it records, key column meanings, related tables, and 2-3 representative charts.",
      'ask.try': "Try these",
      'ask.recent': "Recent questions",
      'ask.allHistory': "All history",
      'ask.openSession': "Open",
      'ask.askAgain': "Ask again",
      'up.short': "Upload",
      'time.dayAgo': "{n} d ago",
      'dash.dragHint': "Drag to reorder (or use arrow keys)",
      'dash.dragLabel': "Move chart \"{title}\"",
      'dash.dragTip': "Drag ⋮⋮ at the top-left of a chart to reorder; change width in the ⋯ menu.",
      'dash.loading': "Loading",
      'dash.retry': "Retry",
      'dash.goAsk': "Ask a question",
      'dash.loadingN': "Loading {n} charts…",
      'dash.lastRefresh': "Last refreshed {time}",
      'dash.cachedN': "{n} from cache",
      'dash.cachedHint': "These charts used cached results; click to force-refresh all",
      'dash.errorN': "{n} failed",
      'dash.removed': "Removed",
      'dash.copied': "Copied to the other dashboard",
      'dash.moved': "Moved to the other dashboard",
      'dash.width.third': "Width: 1/3",
      'dash.width.half': "Width: 1/2",
      'dash.width.full': "Width: full row",
      'set.desc': "These settings apply to all data sources; a data source can override privacy settings.",
      'set.changeInSettings': "Change in settings",
      'set.g.privacy': "Data shown to the model",
      'set.g.query': "Queries",
      'set.g.automation': "Automation",
      'set.g.lark': "Channels & bots",
      'set.g.storage': "Data & storage",
      'set.g.about': "About",
      'set.gd.privacy': "What data is sent to the model. Results always show in full on the page.",
      'set.gd.query': "Row limits, time limits and protection.",
      'set.gd.automation': "Alert scheduling and schema change detection.",
      'set.gd.lark': "Default channel, access for unregistered users, and bots per platform.",
      'set.gd.storage': "Local storage, log retention and configuration backup.",
      'set.gd.about': "Version and runtime.",
      'settings.sample.off.desc': "The model sees table names, column names and types only.",
      'settings.sample.enum.desc': "Sample values of categorical columns (status, type) so filters are written correctly.",
      'settings.sample.all.desc': "Let the model see a few sample rows per table; useful when column meanings are unclear.",
      'settings.result.none.desc': "The model only learns whether the query succeeded and how many rows it returned.",
      'settings.result.summary.desc': "Per-column statistics (min, max, sum, top values), no rows. Recommended.",
      'settings.result.rows.desc': "The first rows are sent to the model: most specific answers, but data leaves the machine.",
      'set.h.sampleMode': "Only affects context sent to the model, not queries.",
      'set.h.resultToModel': "Used by the agent to write conclusions; the page and pushes always show full results.",
      'set.h.modelRows': "Rows sent to the model in \"rows\" mode.",
      'set.h.maskSensitive': "Phone numbers, emails, IDs, secrets etc. are masked in results and samples.",
      'set.on': "On",
      'set.off': "Off",
      'set.overrides': "These data sources override the settings:",
      'set.noOverrides': "No data source overrides these settings. Override them per data source in its edit form.",
      'set.h.maxRows': "Maximum rows per query; the database stops reading at the limit.",
      'set.h.timeoutMs': "Maximum execution time per query (ms); the database cancels it afterwards.",
      'set.h.scanGuardRows': "Ask for confirmation when EXPLAIN estimates a full scan above this many rows. 0 = off.",
      'set.h.cacheTtl': "Identical queries reuse results within this window (dashboards, reruns). 0 = off.",
      'set.schemaOverviewMax': "Large-schema threshold (tables)",
      'set.h.schemaOverviewMax': "Above this many tables, only tables relevant to the question are expanded for the model; others are listed by name.",
      'set.h.schemaDaily': "Re-analyze all data sources daily at this time and detect changes. A check missed while Harness was closed runs on next start.",
      'set.turnOff': "Turn off",
      'set.h.schemaNotify': "Push a notice when the schema changes (with affected charts, metrics and alerts).",
      'set.schedOn': "Scheduler running",
      'set.schedOff': "Scheduler not running",
      'set.openAlerts': "View alerts",
      'set.h.larkDefaultRole': "Permission for Lark users not in the member list when they @ the bot or DM it.",
      'set.configure': "Configure",
      'set.defaultChannel': "Default channel",
      'set.noDefaultChannel': "No default channel",
      'set.noChannels': "No channels yet",
      'set.resultsDb': "Results database",
      'set.resultsDbSub': "{results} results · {cache} cached",
      'set.stateFile': "Configuration file",
      'set.retention': "Log retention",
      'set.h.retention': "Maximum records kept per kind; the oldest are deleted beyond it.",
      'set.rkCol': "Kind",
      'set.rkCount': "Records",
      'set.rkKeep': "Keep at most",
      'set.purge': "Clear",
      'set.retentionNote': "Trimmed to the new limits when saved.",
      'set.rk.history': "Query history / audit",
      'set.rk.feedback': "Result feedback",
      'set.rk.delivery': "Push log",
      'set.rk.alertEvent': "Alert log",
      'set.rk.admin': "Admin log",
      'set.rk.evalRun': "Evaluation runs",
      'set.rk.schemaChange': "Schema changes",
      'set.purgeConfirm': "Clear all \"{kind}\"? This cannot be undone.",
      'set.purged': "Cleared",
      'set.backup': "Backup & migration",
      'set.h.backup': "Export data sources (without passwords), knowledge, dashboards, alerts, reports, channels (without secrets), members and settings to one JSON file to import elsewhere.",
      'set.export': "Export configuration",
      'set.import': "Import configuration",
      'set.exported': "Exported",
      'set.importFrom': "Exported at {time}. Review before importing.",
      'set.section': "Section",
      'set.toAdd': "New",
      'set.toUpdate': "Update",
      'set.note': "Notes",
      'set.needsSecret': "Passwords needed: {names}",
      'set.reportsPaused': "Reports are imported paused",
      'set.skipped': "{n} skipped",
      'set.sec.settings': "Settings",
      'set.sec.datasources': "Data sources",
      'set.sec.knowledge': "Knowledge",
      'set.sec.dashboards': "Dashboards",
      'set.sec.alerts': "Alerts",
      'set.sec.reports': "Reports",
      'set.sec.channels': "Push channels",
      'set.sec.users': "Members",
      'set.importReplaceConfirm': "Replace on import?",
      'set.importReplaceMsg': "Existing configuration of the same kinds (data sources, dashboards, alerts…) is replaced by the file.",
      'set.imported': "Imported",
      'set.importedNeedsSecret': "Imported; {n} data sources need their password",
      'settings.reset': "Restore defaults",
      'settings.resetConfirm': "Restore defaults?",
      'settings.resetConfirmMsg': "Settings in \"{group}\" will be restored to defaults.",
      'settings.resetDone': "Defaults restored",
      'set.unsaved': "Unsaved changes",
      'set.unsavedN': "{n} unsaved changes",
      'set.discard': "Discard",
      'set.about.version': "Plugin version",
      'set.about.dataDir': "Data directory",
      'set.about.runtime': "Runtime",
      'set.about.tests': "Run tests",
      'set.about.docs': "Developer notes",
      panel: 'Data Q&A',
      'page.title': 'Data Q&A',
      'page.subtitle': 'Connect enterprise databases, ask in natural language and get charts',
      'tab.ask': 'Ask', 'tab.schema': 'Schema', 'tab.dashboard': 'Dashboard', 'tab.sources': 'Data sources', 'tab.settings': 'Settings',
      'policy.button': 'Access control', 'policy.title': 'Access control', 'policy.badge': 'Access control',
      'policy.hint': 'Restrict which tables and columns the model and the page may query. Excluded tables disappear from the schema the model sees and are refused at query time; hidden columns are removed from schema and results; forced-mask columns are masked. System catalogs are always blocked once enabled. This is an application-level control; database grants remain the strict boundary.',
      'policy.mode': 'Tables', 'policy.mode.all': 'All tables', 'policy.mode.allow': 'Only listed tables', 'policy.mode.deny': 'Exclude listed tables',
      'policy.allowTables': 'Allowed tables (one per line, * wildcard)', 'policy.denyTables': 'Excluded tables (one per line, * wildcard)',
      'policy.hiddenColumns': 'Hidden columns (table.column, *.salary)', 'policy.maskedColumns': 'Forced-mask columns (table.column)',
      'policy.preview': '{allowed} / {total} tables accessible', 'policy.clickHint': 'Click a table to add or remove it', 'policy.blocked': 'blocked', 'policy.hidden': 'hidden', 'policy.masked': 'masked',
      'policy.hiddenCount': '{count} columns hidden', 'policy.hiddenInResult': 'Access control hid some result columns',
      'fb.label': 'Feedback', 'fb.up': 'Correct', 'fb.down': 'Something is wrong', 'fb.whatWrong': 'What is wrong?',
      'fb.reason.wrongTable': 'Wrong table', 'fb.reason.wrongMetric': 'Wrong metric definition', 'fb.reason.wrongFilter': 'Wrong filter', 'fb.reason.wrongTime': 'Wrong time range', 'fb.reason.chart': 'Unsuitable chart',
      'fb.commentPh': 'Describe the correct definition or expected result (added to the issue list and to the composer)', 'fb.submit': 'Submit',
      'fb.thanksUp': 'Recorded as correct. Save it as an example under Knowledge → Feedback.', 'fb.thanksDown': 'Added to the issue list.',
      'fb.followup': 'The "{title}" result above is wrong: {comment}. Please fix the query and answer again.', 'fb.followupDefault': 'check the tables, metric definition and filters',
      'fb.section': 'Feedback', 'fb.hint': '👎 results enter the issue list; once fixed, save them as examples so similar questions reuse the correct SQL.',
      'fb.filter.open': 'Open', 'fb.filter.resolved': 'Resolved', 'fb.filter.all': 'All', 'fb.empty': 'No feedback', 'fb.noQuestion': '(question not recorded)',
      'fb.status.open': 'Open', 'fb.status.resolved': 'Resolved', 'fb.status.ignored': 'Ignored', 'fb.fix': 'Fix', 'fb.ignore': 'Ignore',
      'fb.correctedSql': 'Correct SQL', 'fb.resolution': 'Resolution', 'fb.resolutionPh': 'e.g. added the GMV definition to Metrics', 'fb.markResolved': 'Mark resolved', 'fb.saveFix': 'Save as example and resolve',
      'fb.stat.up': '👍 Correct', 'fb.stat.down': '👎 Wrong', 'fb.stat.open': 'Open', 'fb.stat.rate': 'Approval',
      'filter.title': 'Global filters', 'filter.range': 'Time range', 'filter.timeColumn': 'Time column', 'filter.noTime': 'Any time',
      'filter.range.today': 'Today', 'filter.range.yesterday': 'Yesterday', 'filter.range.last7d': 'Last 7 days', 'filter.range.last30d': 'Last 30 days', 'filter.range.last90d': 'Last 90 days',
      'filter.range.thisMonth': 'This month', 'filter.range.lastMonth': 'Last month', 'filter.range.thisYear': 'This year', 'filter.range.custom': 'Custom',
      'filter.add': '+ Add filter', 'filter.remove': 'Remove filter', 'filter.clear': 'Clear',
      'filter.hint': 'Filters are injected into the outer WHERE of charts whose tables have the column; other charts (or UNION/derived-table queries) stay unchanged.',
      'filter.appliedCount': '{count} filters', 'filter.notApplied': 'This chart has none of the filter columns; global filters not applied',
      'im.sendReply': "Send this reply to IM", 'im.chartMode': 'Charts as', 'im.cm.default': 'Channel default', 'im.cm.native': 'Native chart', 'im.cm.image': 'Image', 'im.cm.table': 'Table',
      'im.cmHint': 'Native charts are interactive in Lark (client 7.1+) and work for both bot types; images need an app bot.',
      'im.md.edit': 'Edit', 'im.md.preview': 'Preview', 'im.md.empty': '(empty)', 'im.md.bold': 'Bold', 'im.md.heading': 'Heading', 'im.md.list': 'List', 'im.md.quote': 'Quote',
      'im.md.green': 'Green', 'im.md.red': 'Red', 'im.md.table': 'Table', 'im.md.link': 'Link', 'im.md.atAll': '@all',
      'ask.heroTitle': 'What do you want to know?', 'ask.heroSub': 'Using "{name}" · {tables} tables. Ask in plain language; the agent writes the SQL, runs it and charts it.',
      'ask.enterHint': 'ask', 'ask.newline': 'new line', 'ask.readonly': 'read-only', 'result.copySql': 'Copy SQL', 'result.chartType': 'Chart type', 'result.more': 'More actions', 'result.data': 'Data',
      'hist.all': 'All', 'hist.untitled': 'Untitled query', 'hist.emptyHint': 'Queries from the page, the agent and dashboards are recorded here.', 'time.justNow': 'just now', 'time.minAgo': '{n} min ago', 'time.hourAgo': '{n} h ago',
      'filter.addShort': 'Filter', 'filter.activeN': '{count} filters active', 'filter.from': 'From', 'filter.to': 'To', 'dash.count': '{count} charts', 'dash.autoShort': 'Auto refresh', 'dash.updatedAt': 'Updated at',
      'filter.notAppliedShort': 'unfiltered',
      'ds.sectionDesc': 'Queries always run read-only. Passwords and keys live in the Harness credential store.', 'ds.statusOk': 'Connected', 'ds.statusFail': 'Connection failed', 'ds.statusWrite': 'Has write access',
      'im.hintShort': 'Send results, dashboards or agent replies to Lark / Feishu groups or people; charts render as native Lark charts.', 'im.statusOk': 'Healthy', 'im.statusNew': 'Never sent', 'im.sentOk': 'Delivered',
      'schema.analyzedAt': 'analyzed {time}', 'schema.mode': 'View', 'schema.notAnalyzedHint': 'Analysis reads tables, columns, indexes and foreign keys, and infers column meaning and table relations.', 'schema.tablesLabel': 'Tables', 'schema.colCount': '{count} columns', 'schema.copyName': 'Copy table name',
      'schema.th.name': 'Column', 'schema.th.type': 'Type', 'schema.th.meaning': 'Meaning', 'schema.th.values': 'Sample values', 'schema.inferred': 'inferred {p}%',
      'chart.label': 'Chart',
      'tab.alerts': 'Alerts', 'tab.members': 'Members', 'result.excel': 'Export Excel',
      'drill.title': 'Drill down', 'drill.whyTitle': 'Why did it change', 'drill.wholeResult': 'whole result', 'drill.detail': 'Show rows', 'drill.splitBy': 'Split by:', 'drill.noDims': 'No dimensions available', 'drill.why': 'Why did it change?', 'drill.breakdownAll': 'Split by dimension', 'drill.nonAdditive': 'Non-additive measure (average, distinct count): contributions are indicative.', 'drill.failedDims': 'Dimensions not analyzed',
      'dash.export': 'Export', 'dash.snapshot': 'Save snapshot', 'dash.snapshotDone': 'Snapshot saved ({n} charts)', 'dash.cached': 'cached', 'dash.cachedAt': 'Cached result from {time}; refresh for fresh data', 'dash.manage': 'Manage dashboards', 'dash.new': 'New dashboard', 'dash.newName': 'Dashboard name', 'dash.duplicate': 'Duplicate dashboard', 'dash.renameBoard': 'Rename dashboard', 'dash.deleteBoard': 'Delete dashboard', 'dash.deleteBoardConfirm': 'Delete dashboard "{name}" and its charts?', 'dash.copyTo': 'Copy to "{name}"', 'dash.moveTo': 'Move to "{name}"',
      'kb.dimensions': 'Allowed dimensions', 'kb.synonyms': 'Synonyms', 'kb.io': 'Import / export', 'kb.exportThis': 'Export this data source', 'kb.exportAll': 'Export all data sources', 'kb.import': 'Import knowledge', 'kb.importInto': 'Imports into "{name}"', 'kb.importByName': 'Matched by data source name', 'kb.src': 'Source', 'kb.target': 'Target', 'kb.invalid': 'Invalid', 'kb.merge': 'Merge', 'kb.replace': 'Replace', 'kb.replaceConfirm': 'Replacing clears existing knowledge of the target. Continue?', 'kb.imported': 'Imported', 'ds.close': 'Close',
      'ev.section': 'Evaluation', 'ev.hint': 'Verified examples form the evaluation set. Agent mode answers each question from scratch (without seeing its example) and compares results with the example SQL; SQL mode only replays the example SQL to check compatibility.', 'ev.mode.agent': 'Agent answers', 'ev.mode.sql': 'Replay SQL only', 'ev.cases': '{count} cases', 'ev.run': 'Run evaluation', 'ev.running': 'Running {done}/{total}', 'ev.status.pass': 'pass', 'ev.status.fail': 'mismatch', 'ev.status.error': 'error', 'ev.sim': 'SQL similarity {p}%', 'ev.compareSql': 'Compare SQL (left: example, right: agent)', 'ev.include': 'Include',
      'sc.title': '{count} schema changes ({time})', 'sc.ack': 'Dismiss', 'sc.impacts': 'May affect', 'sc.table-added': 'table added', 'sc.table-removed': 'table removed', 'sc.column-added': 'column added', 'sc.column-removed': 'column removed', 'sc.column-type': 'type changed', 'sc.imp.widget': 'chart', 'sc.imp.example': 'example', 'sc.imp.metric': 'metric', 'sc.imp.note': 'note', 'sc.imp.alert': 'alert',
      'al.hint': 'Check metrics or SQL on a schedule and push to Lark when a condition holds: threshold, change, anomaly (z-score) or missing data. Recovery is notified too.', 'al.add': 'New alert', 'al.empty': 'No alerts yet', 'al.emptyHint': 'e.g. notify ops when daily GMV drops more than 20%.', 'al.name': 'Name', 'al.namePh': 'e.g. GMV drop', 'al.source': 'Source', 'al.src.metric': 'Metric library', 'al.src.sql': 'Custom SQL', 'al.metric': 'Metric', 'al.noMetrics': 'No metrics defined yet', 'al.grain': 'Grain', 'al.grain.hour': 'Hourly', 'al.grain.day': 'Daily', 'al.grain.week': 'Weekly', 'al.grain.month': 'Monthly', 'al.sql': 'SQL (first column time, last numeric column value)', 'al.condition': 'Condition', 'al.cond.threshold': 'Threshold', 'al.cond.change': 'Change', 'al.cond.anomaly': 'Anomaly', 'al.cond.missing': 'No data', 'al.condHint.threshold': 'Compares the latest value.', 'al.condHint.change': 'Latest vs previous value.', 'al.condHint.anomaly': 'Deviation of the latest value from the last 14 points, in standard deviations.', 'al.condHint.missing': 'Fires when no rows or the latest value is empty.', 'al.anomalyHint': '(last 14 points)', 'al.dir.any': 'up or down', 'al.dir.up': 'up', 'al.dir.down': 'down', 'al.every': 'Check every', 'al.every.15m': '15 minutes', 'al.every.hour': 'hour', 'al.every.day': 'day', 'al.cooldown': 'Repeat interval (min)', 'al.noPush': 'Record only', 'al.mentionAll': '@all when pushing', 'al.test': 'Dry run', 'al.wouldFire': 'Would fire', 'al.wouldNotFire': 'Would not fire', 'al.firing': 'Firing', 'al.ok': 'OK', 'al.never': 'Not checked', 'al.last': 'last', 'al.checkNow': 'Check now', 'al.pushed': 'pushed', 'al.events': 'Alert log', 'al.message': 'Message', 'al.deleteConfirm': 'Delete alert "{name}"?',
      'mb.hint': "Give colleagues or groups in IM access: scope data sources per person or group; audit entries are attributed. This page always has full access.", 'mb.add': 'Add member', 'mb.empty': 'No members yet', 'mb.emptyHint': "Add people (Lark, Telegram, WeCom or DingTalk user IDs) or group chats, then enable a bot above to ask from IM.", 'mb.kind': 'Type', 'mb.kind.person': 'Lark user', 'mb.kind.chat': 'Lark group', 'mb.role': 'Role', 'mb.role.admin': 'Admin', 'mb.role.analyst': 'Analyst', 'mb.role.viewer': 'Viewer', 'mb.email': 'Email', 'mb.scope': 'Data sources', 'mb.allDs': 'All data sources', 'mb.noDs': 'none', 'mb.disabled': 'disabled', 'mb.enable': 'Enable', 'mb.disable': 'Disable', 'mb.deleteConfirm': 'Delete member "{name}"?', 'mb.queries': '{n} queries in 30 days', 'mb.noUsage': 'No queries in 30 days', 'mb.usage': 'Usage (30 days)', 'mb.user': 'Member', 'mb.lastActive': 'Last active', 'mb.default': "Unregistered users:", 'mb.defaultRole.none': 'Refuse (add as member first)', 'mb.defaultRole.viewer': 'Allow, viewer', 'mb.defaultRole.analyst': 'Allow, analyst',
      'bot.title': 'Lark bot (@ to ask)', 'bot.hint': 'Receives messages over the Lark long connection (no public URL). @ the bot in a group or DM it; it answers in a Data Q&A session here and replies with a card.', 'bot.enable': 'Enabled', 'bot.channel': 'App bot', 'bot.noAppChannel': 'Add an app bot channel on the Push tab first', 'bot.scope': 'Session scope', 'bot.scope.chat': 'One session per chat', 'bot.scope.user': 'One session per person per chat', 'bot.p2p': 'Allow direct messages', 'bot.state.idle': 'Off', 'bot.state.connecting': 'Connecting', 'bot.state.connected': 'Connected', 'bot.state.error': 'Error', 'bot.state.stopped': 'Stopped', 'bot.setup': 'Lark console setup', 'bot.step1': 'Create a custom app, note App ID / Secret, add it as an app bot channel on the Push tab.', 'bot.step2': 'Enable the bot capability.', 'bot.step3': 'Grant im:message, im:message.p2p_msg:readonly, im:message.group_at_msg:readonly, im:message:send_as_bot, im:resource, im:chat:readonly, contact:user.base:readonly (plus contact:user.email:readonly to match by email).', 'bot.step4': 'Enable the bot here so the long connection is online, then choose "Receive events through persistent connection" in Events & Callbacks.', 'bot.step5': 'Subscribe to im.message.receive_v1, create and publish a version.', 'bot.step6': 'Add the bot to groups; @ it to ask. Send "帮助" for commands.', 'bot.convs': 'Recent Lark conversations', 'bot.chat': 'Chat', 'bot.lastQ': 'Last question', 'bot.p2pShort': 'DM',
      'settings.cacheTtl': 'Query cache TTL (s, 0 = off)', 'settings.cacheStats': 'Result store', 'settings.cacheStatsText': '{results} results · {mb} MB · {cache} cached', 'settings.clearCache': 'Clear cache', 'settings.schemaWatch': 'Schema change detection', 'settings.schemaWatchOn': 'Compare with the previous analysis and flag added/removed/changed columns and affected charts, examples, metrics and alerts', 'settings.schemaDaily': 'Daily automatic check at (empty = off)', 'settings.schemaNotify': 'Notify via',
      'up.button': 'Upload file', 'up.title': 'Upload CSV / Excel', 'up.drop': 'Drop a file here or click to choose', 'up.formats': '.csv / .tsv / .xlsx (each sheet becomes a table), up to 200 MB; GBK CSV detected automatically', 'up.parsing': 'Parsing…', 'up.target': 'Import into', 'up.newSource': 'New local file data source', 'up.newName': 'Data source name', 'up.mode': 'Existing table', 'up.mode.create': 'Fail', 'up.mode.replace': 'Replace', 'up.mode.append': 'Append', 'up.table': 'Table', 'up.rows': '{rows} rows · {cols} columns', 'up.truncated': 'truncated', 'up.type.TEXT': 'Text', 'up.type.INTEGER': 'Integer', 'up.type.REAL': 'Decimal', 'up.type.DATE': 'Date', 'up.type.DATETIME': 'Datetime', 'up.import': 'Import', 'up.done': 'Imported into "{name}": ', 'up.privacy': 'Files stay on this machine and are queried read-only.', 'up.addFile': 'Upload more files', 'up.localDesc': 'Local files (SQLite), read-only', 'up.dropConfirm': 'Delete table "{name}"?', 'up.askLink': 'Upload a CSV / Excel to ask about', 'up.askHint': 'Imported and selected; ask away.',
      'hist.source.alert': 'Alert', 'hist.source.eval': 'Eval', 'hist.source.larkbot': 'Lark bot', 'im.src.alert': 'Alert', 'im.src.schema': 'Schema change', 'im.src.larkbot': 'Lark bot', 'kb.synonymsLabel': 'Synonyms',
      'ev.status.interrupted': 'interrupted', 'mb.rowRules': 'Row-level access', 'mb.rowRulesHint': 'Only rows whose column value is in the list are visible, e.g. merchant_code ∈ {A001}. Queries get the filter injected; complex queries that cannot be filtered safely (subqueries, CTEs, UNION) are refused.', 'mb.anyDs': 'Any data source', 'mb.ruleColumn': 'Column', 'mb.ruleValues': 'Allowed values (comma separated)', 'mb.addRule': 'Add rule',
      'mb.roleHint.admin': 'Everything, including saving examples.', 'mb.roleHint.analyst': 'Free questions (the agent writes SQL); cannot save examples.', 'mb.roleHint.viewer': 'Only metric library, verified examples and dashboards; no free SQL.',
      'al.lastTick': 'Last check {time} ({n} jobs)', 'al.noTickYet': 'Scheduler not run yet (starts ~20 s after launch)', 'al.nextDue': 'Next: {name} {time}', 'al.schedulerNote': 'Not checked while Harness is closed; catches up once on start',
      'tab.push': 'Push', 'im.hint': 'Send results, charts, overviews or the whole dashboard to Lark / Feishu. Group bots (webhook) are simplest but send tables only; app bots render charts as images and can message individuals. Secrets live in the Harness credential store. The agent can push too via nl2sql_send, in chat or in scheduled reports.',
      'im.add': 'Add channel', 'im.empty': 'No channels yet', 'im.emptyHint': 'In a Lark group: Settings → Bots → Add a custom bot, then copy its webhook URL.', 'im.kind': 'Channel type',
      'im.type.lark_webhook': 'Group bot (webhook)', 'im.type.lark_app': 'App bot',
      'im.help.lark_webhook': 'Lark group → Settings → Bots → Add bot → Custom bot. Enable signature verification and paste the secret; if you set keywords, the message title must contain one. Group bots cannot upload images, so charts are sent as tables.',
      'im.help.lark_app': 'Create a custom app on the Lark developer console, enable the bot, grant im:message:send_as_bot, im:resource (images) and im:chat:readonly (list chats), publish a version, and add the bot to the target group. Charts are sent as images.',
      'im.name': 'Name', 'im.description': 'Note (optional)', 'im.webhookUrl': 'Webhook URL', 'im.signSecret': 'Signing secret', 'im.optional': 'optional', 'im.domain': 'Edition',
      'im.domain.feishu': 'Feishu (open.feishu.cn)', 'im.domain.lark': 'Lark (open.larksuite.com)', 'im.appId': 'App ID', 'im.appSecret': 'App Secret', 'im.receiveIdType': 'Recipient type',
      'im.rid.chat_id': 'Group chat_id', 'im.rid.email': 'User email', 'im.rid.open_id': 'User open_id', 'im.rid.user_id': 'User user_id', 'im.rid.union_id': 'User union_id',
      'im.receiveId': 'Recipient', 'im.pickChat': 'Pick chat', 'im.chats': 'Chats with the bot ({count})', 'im.noChats': 'The bot is in no chat yet; add it to a group first', 'im.setDefault': 'Default channel',
      'im.saveTest': 'Save and send test', 'im.testOk': 'Test message sent; check Lark', 'im.test': 'Send test', 'im.default': 'Default', 'im.makeDefault': 'Make default', 'im.signed': 'Signed',
      'im.lastFailed': 'Last send failed', 'im.lastSent': 'Last sent', 'im.webhookHidden': 'Webhook URL stored encrypted', 'im.deleteConfirm': 'Delete channel "{name}"? Reports using it stop pushing.',
      'im.log': 'Delivery log', 'im.col.time': 'Time', 'im.col.channel': 'Channel', 'im.col.title': 'Title', 'im.col.source': 'From', 'im.col.status': 'Result',
      'im.src.ui': 'Page', 'im.src.agent': 'Agent', 'im.src.dashboard': 'Dashboard', 'im.src.test': 'Test', 'im.resultsN': '{count} results', 'im.imagesN': '{count} images',
      'im.share': 'Send to IM', 'im.shareAll': 'Send all to IM', 'im.shareDashboard': 'Send dashboard', 'im.dashboardTitle': 'Dashboard', 'im.sendTitle': "Send to IM channel",
      'im.noChannel': "No channels yet; add one under Admin → Channels.", 'im.channel': 'Send to', 'im.msgTitle': 'Title', 'im.text': 'Message (Markdown, optional)', 'im.textPh': 'e.g. GMV +12% day over day, mostly from the east region',
      'im.attach': 'Attaching {count} results.', 'im.dashboardHint': 'Re-runs every dashboard chart (max 10) with the current global filters, then sends.',
      'im.includeSql': 'Include SQL', 'im.send': 'Send', 'im.sent': 'Sent to {channel} ({images} images)', 'rep.push': 'Push to', 'rep.pushNone': 'Do not push',
      'tab.reports': 'Reports', 'ds.type': 'Database type', 'ds.indexPattern': 'Indices (comma separated, wildcards allowed)', 'ds.userOptional': 'User (optional)',
      'ds.apiKey': 'API key (optional, preferred over user/password)', 'ds.apiKeyHint': 'Base64 encoded id:api_key', 'ds.schemas': 'Schemas (comma separated; empty = all user schemas)', 'ds.https': 'Use HTTPS',
      'ds.sshTitle': 'SSH tunnel', 'ds.sshEnable': 'Connect through an SSH bastion (host/port above as seen from the bastion)', 'ds.sshHost': 'SSH host', 'ds.sshAuth': 'Authentication',
      'ds.sshAuth.password': 'Password', 'ds.sshAuth.key': 'Private key', 'ds.sshKey': 'Private key (PEM / OpenSSH)', 'ds.sshPassphrase': 'Key passphrase (optional)',
      'ds.sshHint': 'Passwords and keys are stored in the Harness credential store, never in configuration or model context.', 'ds.viaSsh': 'via SSH tunnel',
      'ds.privacyTitle': 'Model visibility for this data source', 'ds.privacyEnable': 'Use dedicated settings (override global)', 'ds.privacyCustom': 'Custom privacy',
      'schema.overviewPin': 'Overview to dashboard', 'schema.overviewPinConfirm': 'Generate 4–6 overview charts for this table and pin them all to the dashboard?', 'schema.overviewPinned': 'Overview charts pinned to the dashboard',
      'tool.overviewRunning': 'Generating overview…', 'tool.overviewTitle': '{table} · overview', 'tool.overviewCount': '{count} charts',
      'rep.hint': 'Scheduled reports use Harness schedules to start a Data Q&A session on time; the agent queries the data and writes a summary. Reports appear in the session list and on the Schedules page.',
      'rep.add': 'New report', 'rep.openSchedules': 'Open schedules', 'rep.empty': 'No scheduled reports yet', 'rep.emptyHint': 'Example: every day at 9:00 summarize yesterday\'s orders, GMV and anomalies.',
      'rep.title': 'Report name', 'rep.titlePh': 'Daily orders', 'rep.scope': 'Content', 'rep.scope.question': 'Analysis request', 'rep.scope.dashboard': 'Refresh dashboard charts',
      'rep.question': 'Analysis request', 'rep.questionPh': 'Yesterday\'s orders, GMV and AOV vs the previous day, split by channel', 'rep.instructions': 'Extra instructions (optional)', 'rep.instructionsPh': 'e.g. paid orders only; amounts in thousands',
      'rep.period': 'Frequency', 'rep.period.daily': 'Daily', 'rep.period.weekly': 'Weekly', 'rep.time': 'Time', 'rep.weekdays': 'Weekdays',
      'rep.wd.1': 'Mon', 'rep.wd.2': 'Tue', 'rep.wd.3': 'Wed', 'rep.wd.4': 'Thu', 'rep.wd.5': 'Fri', 'rep.wd.6': 'Sat', 'rep.wd.7': 'Sun',
      'rep.target': 'Deliver to', 'rep.target.new_once': 'One ongoing session', 'rep.target.new': 'A new session each time',
      'rep.status.active': 'Active', 'rep.status.paused': 'Paused', 'rep.status.ended': 'Ended', 'rep.status.missing': 'Schedule deleted', 'rep.next': 'next', 'rep.last': 'Last delivered',
      'rep.openLast': 'Open last report', 'rep.runNow': 'Run now', 'rep.started': 'Started; the report will appear in the session list', 'rep.pause': 'Pause', 'rep.resume': 'Resume',
      'rep.deleteConfirm': 'Delete report "{title}" and its schedule?',
      'tab.knowledge': 'Knowledge', 'tab.history': 'History & audit', 'schema.modeList': 'List', 'schema.modeEr': 'Graph',
      'er.onlyLinked': 'Only linked tables', 'er.inferred': 'Include inferred', 'er.hint': 'Drag nodes, scroll to zoom, double-click a table for details; solid = FK, dashed = inferred',
      'sql.explain': 'Explain', 'sql.plan': 'Query plan (EXPLAIN)', 'sql.edit': 'Edit and rerun', 'sql.confirmScan': 'Run this query anyway?',
      'kb.hint': 'Business knowledge is given to the model as context: glossary terms, fixed metric definitions, column notes, and verified question→SQL examples.',
      'kb.glossary': 'Glossary', 'kb.metrics': 'Metrics', 'kb.notes': 'Notes', 'kb.examples': 'Examples', 'kb.add': 'Add',
      'kb.term': 'Term', 'kb.definition': 'Meaning', 'kb.sqlHint': 'SQL hint (optional)',
      'kb.metricName': 'Metric name', 'kb.unit': 'Unit', 'kb.expression': 'Expression (e.g. SUM(pay_amount))', 'kb.table': 'Table', 'kb.timeColumn': 'Time column',
      'kb.filter': 'Default filter (WHERE fragment)', 'kb.description': 'Definition notes', 'kb.question': 'Question', 'kb.sql': 'Verified SQL', 'kb.note': 'Note',
      'kb.noteKey': 'table or table.column', 'kb.noteText': 'Note (e.g. meaning of status values)', 'kb.notesHint': 'Add business meaning missing from database comments.',
      'kb.draft': 'Draft from enum columns', 'kb.drafts': '{count} columns to describe', 'kb.noDrafts': 'No enum columns need notes',
      'kb.glossaryEmpty': 'No terms yet. Example: GMV = sum of paid order amounts.', 'kb.metricsEmpty': 'No metrics yet. The model prefers these fixed definitions.',
      'kb.notesEmpty': 'No notes yet.', 'kb.examplesEmpty': 'No examples yet. Use "Save as example" on a result.', 'kb.deleteConfirm': 'Delete this item?',
      'kb.saveExample': 'Save as example', 'kb.exampleSaved': 'Saved', 'kb.exampleHint': 'Store this question and SQL for reuse', 'kb.examplePrompt': 'Which question does this SQL answer?',
      'dash.refreshOne': 'Refresh', 'dash.moveUp': 'Move up', 'dash.moveDown': 'Move down', 'dash.full': 'Full width', 'dash.half': 'Half width', 'dash.rename': 'Rename',
      'dash.removeConfirm': 'Remove "{title}" from the dashboard?', 'dash.auto': 'Auto refresh', 'dash.autoOff': 'Off', 'dash.autoEvery': 'Every {min} min',
      'settings.scanGuardRows': 'Large-table scan guard: confirm when the plan scans more rows than this (0 = off)',
      'hist.search': 'Search SQL or title', 'hist.allSources': 'All data sources', 'hist.allStatus': 'All statuses', 'hist.allSource': 'All origins',
      'hist.status.ok': 'OK', 'hist.status.error': 'Failed', 'hist.status.blocked': 'Blocked', 'hist.source.agent': 'Agent', 'hist.source.ui': 'Page', 'hist.source.dashboard': 'Dashboard',
      'hist.export': 'Export audit CSV', 'hist.clear': 'Clear', 'hist.clearConfirm': 'Clear all query history?', 'hist.total': 'Queries', 'hist.errors': 'Failed',
      'hist.blocked': 'Blocked', 'hist.avg': 'Avg time', 'hist.empty': 'No matching records', 'hist.openSession': 'Open session',
      'ds.none': 'No data sources yet', 'ds.noneHint': 'Add a data source (MySQL 5.7+, PostgreSQL, Elasticsearch) to start asking questions.',
      'ds.add': 'New data source', 'ds.edit': 'Edit', 'ds.delete': 'Delete', 'ds.deleteConfirm': 'Delete data source "{name}"? Dashboard widgets that use it are removed too.',
      'ds.test': 'Test connection', 'ds.testing': 'Testing…', 'ds.save': 'Save', 'ds.cancel': 'Cancel',
      'ds.name': 'Name', 'ds.host': 'Host', 'ds.port': 'Port', 'ds.database': 'Database', 'ds.user': 'User', 'ds.password': 'Password',
      'ds.passwordKeep': 'Leave empty to keep the saved password', 'ds.charset': 'Charset', 'ds.ssl': 'Use SSL',
      'ds.description': 'Description (given to the model as business context)', 'ds.current': 'Current', 'ds.select': 'Choose data source',
      'ds.setCurrent': 'Make current', 'ds.testOk': 'Connected · MySQL {version} · {tables} tables · {latency}ms', 'ds.testFail': 'Connection failed: {error}',
      'ds.readonlyWarn': 'This account can write; a read-only account is recommended', 'ds.readonlyOk': 'Read-only account', 'ds.passwordSet': 'Password saved',
      'schema.analyze': 'Analyze schema', 'schema.refresh': 'Re-analyze', 'schema.analyzing': 'Analyzing…', 'schema.search': 'Search tables or columns',
      'schema.tables': '{count} tables', 'schema.relations': '{count} relations', 'schema.notAnalyzed': 'The schema of this data source has not been analyzed',
      'schema.pickTable': 'Pick a table on the left to see details', 'schema.columns': 'Columns', 'schema.indexes': 'Indexes', 'schema.relationsOf': 'Relations',
      'schema.preview': 'Preview rows', 'schema.overview': 'Auto overview', 'schema.askAbout': 'Ask about this table', 'schema.rows': '~{rows} rows',
      'role.fact': 'Fact', 'role.dimension': 'Dimension', 'role.log': 'Log', 'role.config': 'Config', 'role.view': 'View', 'role.other': 'Other',
      'col.time': 'time', 'col.measure': 'measure', 'col.enum': 'enum', 'col.id': 'id', 'col.geo': 'geo', 'col.sensitive': 'sensitive', 'col.flag': 'flag', 'col.text': 'text',
      'ask.placeholder': 'Ask in natural language, e.g. daily order count and revenue over the last 30 days',
      'ask.start': 'Ask in a conversation', 'ask.hint': 'The question is answered by the agent in a Data Q&A session bound to the current data source; results render as charts in the conversation.',
      'ask.examples': 'Try these', 'ask.sql': 'Run SQL directly', 'ask.run': 'Run', 'ask.running': 'Running…', 'ask.noWorkspace': 'Open or create a workspace first',
      'result.rows': '{count} rows', 'result.truncated': ' (truncated)', 'result.elapsed': '{ms} ms', 'result.sql': 'SQL', 'result.copy': 'Copy', 'result.copied': 'Copied',
      'result.csv': 'Export CSV', 'result.png': 'Export image', 'result.pin': 'Pin to dashboard', 'result.pinned': 'Pinned',
      'result.expired': 'The cached result expired; click to run again', 'result.rerun': 'Run again', 'result.empty': 'The query returned no rows', 'result.masked': 'masked',
      'chart.auto': 'Auto', 'chart.line': 'Line', 'chart.area': 'Area', 'chart.bar': 'Bar', 'chart.barh': 'Horizontal bar', 'chart.stacked': 'Stacked', 'chart.pie': 'Pie',
      'chart.funnel': 'Funnel', 'chart.scatter': 'Scatter', 'chart.kpi': 'KPI', 'chart.table': 'Table', 'chart.loading': 'Loading chart…',
      'dash.empty': 'The dashboard is empty', 'dash.emptyHint': 'Use "Pin to dashboard" on a result to add charts.', 'dash.refresh': 'Refresh all', 'dash.remove': 'Remove',
      'settings.title': 'Data visible to the model', 'settings.hint': 'Full results stay on this machine and are only shown in the page. These settings decide what is sent to the model.',
      'settings.sampleMode': 'Schema sampling', 'settings.sample.off': 'Off (schema only)', 'settings.sample.enum': 'Enum column values only', 'settings.sample.all': 'Allow sample rows',
      'settings.resultToModel': 'Query results sent to the model', 'settings.result.none': 'None (column names and row count)', 'settings.result.summary': 'Statistical summary',
      'settings.result.rows': 'First N rows', 'settings.modelRows': 'Row limit N', 'settings.maskSensitive': 'Mask sensitive columns (phone, email, ID numbers, passwords…)',
      'settings.limits': 'Query limits', 'settings.maxRows': 'Max rows per query', 'settings.timeoutMs': 'Query timeout (ms)', 'settings.save': 'Save settings', 'settings.saved': 'Saved',
      'composer.none': 'No data source', 'composer.title': 'Data source queried by this session',
      'tool.query': 'Data query', 'tool.chart': 'Chart', 'tool.running': 'Querying…', 'tool.failed': 'Query failed', 'error.generic': 'Failed: {message}',
      'dash.copyName': '{name} copy',
      'set.leaveTitle': 'Discard unsaved settings?', 'set.leaveMsg': 'You have unsaved setting changes; they will be lost if you leave.', 'set.leaveOk': 'Discard and leave',
      'fb.deleteConfirm': 'Delete this feedback?',
      'hist.source.telegrambot': 'Telegram bot', 'hist.source.wecombot': 'WeCom bot', 'hist.source.dingtalkbot': 'DingTalk bot', 'hist.source.unknown': 'Unknown source', 'hist.source.genericBot': '{platform} bot',
      'filter.valuesPh': 'Values, comma-separated',
      'policy.tablesLabel': 'Accessible tables',
    }

    // --------------------------------------------------------------- RPC

    async function call(method, payload) {
      const response = await fetch(RPC_ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, payload: payload ?? {} }),
        credentials: 'same-origin',
      })
      let result
      try {
        result = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (!result.ok) {
        const err = new Error(result.error.message)
        err.code = result.error.code
        throw err
      }
      return result.value
    }

    // -------------------------------------------------------- tiny store

    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get: () => state,
        set(patch) {
          state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
          for (const l of [...listeners]) l()
        },
        subscribe(l) { listeners.add(l); return () => listeners.delete(l) },
      }
    }
    const store = createStore({ datasources: [], loaded: false, error: null, schemas: {}, version: 0 })
    function useStore(selector) {
      const get = () => selector(store.get())
      return useSyncExternalStore(store.subscribe, get, get)
    }
    async function refreshDatasources() {
      try {
        const datasources = await call('listDatasources')
        store.set({ datasources, loaded: true, error: null })
      } catch (error) {
        store.set({ loaded: true, error: error.message })
      }
    }
    const sessionInfoCache = createStore({})
    async function loadSessionInfo(sessionId) {
      try {
        const info = await call('sessionInfo', { sessionId })
        sessionInfoCache.set({ [sessionId]: info })
      } catch {}
    }

    // -------------------------------------------------------------- CSS

    const CSS = `
.n2s-page{--n2s-radius:12px;--n2s-radius-sm:8px;--n2s-muted:var(--dsw-alias-label-secondary);--n2s-faint:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));--n2s-line:var(--dsw-alias-border-l1);--n2s-line-2:var(--dsw-alias-border-l2);--n2s-hover:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));--n2s-fill:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.05));--n2s-accent:#3b82f6;--n2s-ok:var(--dsw-alias-state-success-primary);--n2s-warn:var(--dsw-alias-state-warn-primary);--n2s-err:var(--dsw-alias-state-error-primary);width:100%;height:100%;min-height:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:14px;line-height:1.55;overflow:hidden}
.n2s-page,.n2s-toolcard,.n2s-modal,.n2s-menu{--n2s-muted:var(--dsw-alias-label-secondary);--n2s-faint:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));--n2s-line:var(--dsw-alias-border-l1);--n2s-line-2:var(--dsw-alias-border-l2);--n2s-hover:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.06));--n2s-fill:var(--dsw-alias-interactive-bg-hover,rgba(38,49,72,.05));--n2s-accent:#3b82f6;--n2s-ok:var(--dsw-alias-state-success-primary);--n2s-warn:var(--dsw-alias-state-warn-primary);--n2s-err:var(--dsw-alias-state-error-primary)}
.n2s-scroll{flex:1;min-height:0;overflow:auto;scrollbar-gutter:stable}
.n2s-content{max-width:1120px;margin:0 auto;padding:0 clamp(20px,4vw,40px) 64px;box-sizing:border-box}

/* header */
.n2s-top{position:sticky;top:0;z-index:5;background:var(--dsw-alias-bg-base);padding-top:24px}
[data-platform=darwin] .n2s-top{padding-top:calc(24px + var(--dsh-frame-top-clearance,0px))}
.n2s-heading{display:flex;align-items:center;gap:12px;margin-bottom:14px}
.n2s-heading h1{margin:0;font-size:20px;font-weight:600;letter-spacing:-.01em;line-height:28px}
.n2s-dspill{position:relative;display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 10px 0 8px;border-radius:999px;border:.5px solid var(--n2s-line-2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;cursor:pointer;max-width:340px}
.n2s-dspill:hover{background:var(--n2s-hover)}
.n2s-dspill select{position:absolute;inset:0;opacity:0;cursor:pointer;font-size:13px}
.n2s-dspill .name{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.n2s-dspill .meta{color:var(--n2s-faint);white-space:nowrap}
.n2s-dot{width:7px;height:7px;border-radius:50%;background:var(--n2s-ok);flex:none;box-shadow:0 0 0 3px color-mix(in srgb,var(--n2s-ok) 18%,transparent)}
.n2s-dot.off{background:var(--n2s-faint);box-shadow:none}
.n2s-dot.err{background:var(--n2s-err);box-shadow:0 0 0 3px color-mix(in srgb,var(--n2s-err) 18%,transparent)}
.n2s-tabs{display:flex;align-items:center;gap:2px;border-bottom:.5px solid var(--n2s-line-2);overflow-x:auto;scrollbar-width:none}
.n2s-tabs::-webkit-scrollbar{display:none}
.n2s-tab{position:relative;height:36px;padding:0 12px;border:0;background:transparent;color:var(--n2s-muted);font:inherit;font-size:14px;cursor:pointer;white-space:nowrap}
.n2s-tab:hover{color:var(--dsw-alias-label-primary)}
.n2s-tab[aria-selected=true]{color:var(--dsw-alias-label-primary);font-weight:500}
.n2s-tab[aria-selected=true]::after{content:'';position:absolute;left:12px;right:12px;bottom:-.5px;height:2px;border-radius:2px;background:var(--dsw-alias-label-primary)}
.n2s-tabsep{width:1px;height:16px;margin:0 8px;background:var(--n2s-line-2);flex:none}
.n2s-body{padding-top:20px}

/* controls */
.n2s-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;border-radius:var(--n2s-radius-sm);border:.5px solid var(--n2s-line-2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap;transition:background .12s,opacity .12s}
.n2s-btn:hover:not(:disabled){background:var(--n2s-hover)}
.n2s-btn:focus-visible,.n2s-tab:focus-visible,.n2s-iconbtn:focus-visible,.n2s-chip:focus-visible,.n2s-seg button:focus-visible{outline:2px solid var(--n2s-accent);outline-offset:1px}
.n2s-btn:disabled{opacity:.45;cursor:default}
.n2s-btn.primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);border-color:transparent}
.n2s-btn.primary:hover:not(:disabled){opacity:.86;background:var(--dsw-alias-label-primary)}
.n2s-btn.small{height:28px;padding:0 10px;font-size:12px}
.n2s-btn.ghost{border-color:transparent;background:transparent;font-weight:400;color:var(--n2s-muted)}
.n2s-btn.ghost:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.n2s-btn.danger{color:var(--n2s-err)}
.n2s-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:0;border-radius:var(--n2s-radius-sm);background:transparent;color:var(--n2s-faint);cursor:pointer;flex:none}
.n2s-iconbtn:hover:not(:disabled){background:var(--n2s-hover);color:var(--dsw-alias-label-primary)}
.n2s-iconbtn:disabled{opacity:.35;cursor:default}
.n2s-iconbtn[aria-pressed=true]{color:var(--dsw-alias-label-primary);background:var(--n2s-hover)}
.n2s-iconbtn.danger:hover:not(:disabled){color:var(--n2s-err)}
.n2s-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.n2s-grow{flex:1;min-width:0}
.n2s-muted{color:var(--n2s-muted)}
.n2s-faint{color:var(--n2s-faint)}
.n2s-small{font-size:12px}
.n2s-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.n2s-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}

/* surfaces */
.n2s-card{border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius);background:var(--dsw-alias-bg-layer-1);padding:16px}
.n2s-cards{display:grid;gap:10px}
.n2s-section{margin-top:28px}
.n2s-section>h2,.n2s-h2{font-size:14px;font-weight:600;margin:0 0 10px}
.n2s-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.n2s-empty{border:.5px dashed var(--n2s-line-2);border-radius:var(--n2s-radius);padding:40px 24px;text-align:center;color:var(--n2s-muted)}
.n2s-empty h3{margin:0 0 6px;font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}
.n2s-empty .n2s-btn{margin-top:14px}

/* forms */
.n2s-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 16px}
.n2s-form .full{grid-column:1/-1}
.n2s-field{display:grid;gap:6px;font-size:13px;align-content:start}
.n2s-field>span{color:var(--n2s-muted);font-size:12px}
.n2s-input,.n2s-select,.n2s-textarea{box-sizing:border-box;width:100%;min-width:0;height:34px;padding:0 10px;border-radius:var(--n2s-radius-sm);border:.5px solid var(--n2s-line-2);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;outline:none;transition:border-color .12s,box-shadow .12s}
.n2s-textarea{height:auto;min-height:72px;padding:9px 10px;resize:vertical;line-height:1.55}
.n2s-input:focus,.n2s-select:focus,.n2s-textarea:focus{border-color:var(--n2s-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--n2s-accent) 16%,transparent)}
.n2s-input::placeholder,.n2s-textarea::placeholder{color:var(--n2s-faint)}
.n2s-check{display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer}
.n2s-check input,.n2s-page input[type=radio],.n2s-page input[type=checkbox]{accent-color:var(--dsw-alias-label-primary)}
.n2s-select.inline{width:auto;height:30px}

/* status */
.n2s-badge{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border-radius:6px;font-size:11px;font-weight:500;line-height:20px;background:var(--n2s-fill);color:var(--n2s-muted);white-space:nowrap}
.n2s-badge.ok{color:var(--n2s-ok);background:color-mix(in srgb,var(--n2s-ok) 12%,transparent)}
.n2s-badge.warn{color:color-mix(in srgb,var(--n2s-warn) 85%,black);background:color-mix(in srgb,var(--n2s-warn) 14%,transparent)}
.n2s-badge.err{color:var(--n2s-err);background:color-mix(in srgb,var(--n2s-err) 10%,transparent)}
.n2s-badge.brand{color:var(--dsw-alias-label-primary)}
.n2s-badge.blue{color:var(--n2s-accent);background:color-mix(in srgb,var(--n2s-accent) 12%,transparent)}
.n2s-notice{font-size:12.5px;padding:8px 12px;border-radius:var(--n2s-radius-sm);background:var(--n2s-fill);color:var(--n2s-muted);line-height:1.55}
.n2s-notice.ok{color:var(--n2s-ok);background:color-mix(in srgb,var(--n2s-ok) 10%,transparent)}
.n2s-notice.err{color:var(--n2s-err);background:color-mix(in srgb,var(--n2s-err) 8%,transparent)}
.n2s-notice.warn{color:color-mix(in srgb,var(--n2s-warn) 80%,black);background:color-mix(in srgb,var(--n2s-warn) 12%,transparent)}
.n2s-statusdot{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--n2s-muted);white-space:nowrap}
.n2s-statusdot::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor}
.n2s-statusdot.ok::before{background:var(--n2s-ok)}
.n2s-statusdot.err{color:var(--n2s-err)}
.n2s-statusdot.warn{color:color-mix(in srgb,var(--n2s-warn) 85%,black)}

/* segmented */
.n2s-seg{display:inline-flex;flex-wrap:wrap;gap:2px;padding:2px;border-radius:var(--n2s-radius-sm);background:var(--n2s-fill)}
.n2s-seg button{height:26px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--n2s-muted);font:inherit;font-size:12px;cursor:pointer}
.n2s-seg button:hover{color:var(--dsw-alias-label-primary)}
.n2s-seg button[aria-pressed=true]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:500;box-shadow:0 1px 2px rgba(0,0,0,.06),0 0 0 .5px var(--n2s-line-2)}
.n2s-seg button:disabled{opacity:.45;cursor:default}

/* lists */
.n2s-split{display:grid;grid-template-columns:260px minmax(0,1fr);gap:16px;min-height:480px;align-items:start}
@media (width<=860px){.n2s-split{grid-template-columns:1fr}.n2s-form{grid-template-columns:1fr}}
.n2s-list{display:flex;flex-direction:column;gap:1px;max-height:calc(100vh - 260px);overflow:auto}
.n2s-item{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:var(--n2s-radius-sm);border:0;background:transparent;color:inherit;font:inherit;font-size:13px;text-align:left;cursor:pointer;width:100%}
.n2s-item:hover{background:var(--n2s-hover)}
.n2s-item[aria-selected=true]{background:var(--n2s-fill);font-weight:500}
.n2s-item .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* tables */
.n2s-table-wrap{overflow:auto;max-height:420px;border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius-sm)}
.n2s-table{border-collapse:separate;border-spacing:0;width:100%;font-size:12.5px;line-height:1.5}
.n2s-table th,.n2s-table td{padding:7px 12px;border-bottom:.5px solid var(--n2s-line);text-align:left;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis}
.n2s-table th{position:sticky;top:0;background:var(--dsw-alias-bg-layer-1);color:var(--n2s-muted);font-weight:500;font-size:12px;z-index:1;border-bottom-color:var(--n2s-line-2)}
.n2s-table tbody tr:hover td{background:var(--n2s-hover)}
.n2s-table tbody tr:last-child td{border-bottom:0}
.n2s-table td.num{text-align:right;font-variant-numeric:tabular-nums}
.n2s-table th.num{text-align:right}
.n2s-table td.null{color:var(--n2s-faint);font-style:italic}
.n2s-code{margin:0;padding:12px 14px;border-radius:var(--n2s-radius-sm);background:var(--n2s-fill);font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;max-height:280px;overflow:auto;color:var(--dsw-alias-label-primary)}
.n2s-code.oneline{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-height:none;padding:0;background:transparent;color:var(--n2s-muted)}

/* result */
.n2s-result{display:grid;gap:12px;min-width:0}
.n2s-result-head{display:flex;align-items:center;gap:10px;min-width:0}
.n2s-result-head .title{font-weight:600;font-size:14px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.n2s-result-meta{display:flex;align-items:center;gap:6px;color:var(--n2s-faint);font-size:12px;white-space:nowrap}
.n2s-result-meta .sep{opacity:.5}
.n2s-result-foot{display:flex;align-items:center;gap:4px;margin:-4px -4px -6px}
.n2s-chart{width:100%;height:300px}
.n2s-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;container-type:inline-size}
.n2s-kpi{min-width:0;padding:14px 16px;border-radius:var(--n2s-radius-sm);background:var(--n2s-fill)}
.n2s-kpi .v{font-size:clamp(18px,4.2cqi,26px);font-weight:600;line-height:1.25;font-variant-numeric:tabular-nums;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.n2s-kpi .k{margin-top:2px;font-size:12px;color:var(--n2s-muted)}
.n2s-dropdown{position:relative;display:inline-flex}
.n2s-menu{position:fixed;z-index:1000;min-width:180px;max-width:320px;padding:4px;border-radius:10px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--n2s-line-2);box-shadow:0 10px 30px rgba(0,0,0,.14),0 2px 6px rgba(0,0,0,.06)}
.n2s-menu button{display:flex;width:100%;align-items:center;gap:8px;height:32px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;text-align:left;cursor:pointer;white-space:nowrap}
.n2s-menu button:hover,.n2s-menu button:focus-visible{background:var(--n2s-hover);outline:none}
.n2s-menu button[aria-checked=true]{font-weight:500}
.n2s-menu button.danger{color:var(--n2s-err)}
.n2s-menu .check{width:14px;display:inline-flex;color:var(--dsw-alias-label-primary)}
.n2s-menu hr{border:0;border-top:.5px solid var(--n2s-line-2);margin:4px 2px}
.n2s-menu .n2s-ico{color:var(--n2s-faint);display:inline-flex}

/* ask */
.n2s-hero{margin:8px 0 24px}
.n2s-hero h2{margin:0 0 4px;font-size:22px;font-weight:600;letter-spacing:-.01em}
.n2s-hero p{margin:0;color:var(--n2s-muted);font-size:13.5px}
.n2s-askbox{position:relative;border:.5px solid var(--n2s-line-2);border-radius:16px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.04);transition:border-color .12s,box-shadow .12s}
.n2s-askbox:focus-within{border-color:color-mix(in srgb,var(--n2s-accent) 55%,var(--n2s-line-2));box-shadow:0 0 0 4px color-mix(in srgb,var(--n2s-accent) 12%,transparent)}
.n2s-askbox textarea{display:block;width:100%;box-sizing:border-box;min-height:96px;padding:16px 18px 8px;border:0;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:15px;line-height:1.6;resize:none}
.n2s-askbox textarea::placeholder{color:var(--n2s-faint)}
.n2s-askbar{display:flex;align-items:center;gap:8px;padding:8px 10px 10px 16px}
.n2s-kbd{display:inline-flex;align-items:center;height:18px;padding:0 5px;border-radius:4px;border:.5px solid var(--n2s-line-2);font-size:11px;color:var(--n2s-faint);font-family:inherit}
.n2s-examples{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;margin-top:14px}
.n2s-example{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border-radius:var(--n2s-radius);border:.5px solid var(--n2s-line-2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.5;text-align:left;cursor:pointer;transition:background .12s,border-color .12s}
.n2s-example:hover{background:var(--n2s-hover);border-color:var(--n2s-line-2)}
.n2s-example .n2s-ico{margin-top:1px;color:var(--n2s-faint);flex:none}
.n2s-collapse{border-top:.5px solid var(--n2s-line-2);margin-top:32px;padding-top:16px}
.n2s-collapse>button{display:inline-flex;align-items:center;gap:6px;padding:0;border:0;background:transparent;color:var(--n2s-muted);font:inherit;font-size:13px;font-weight:500;cursor:pointer}
.n2s-collapse>button:hover{color:var(--dsw-alias-label-primary)}
.n2s-collapse>button svg{transition:transform .15s}
.n2s-collapse>button[aria-expanded=true] svg{transform:rotate(180deg)}
.n2s-sqlbox{margin-top:12px;border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius);overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.n2s-sqlbox textarea{display:block;width:100%;box-sizing:border-box;min-height:110px;padding:12px 14px;border:0;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical}
.n2s-sqlbar{display:flex;align-items:center;gap:8px;padding:8px 10px;border-top:.5px solid var(--n2s-line);background:var(--n2s-fill)}
.n2s-chips{display:flex;flex-wrap:wrap;gap:6px}
.n2s-chip{height:28px;padding:0 12px;border-radius:999px;border:.5px solid var(--n2s-line-2);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;cursor:pointer}
.n2s-chip:hover{background:var(--n2s-hover)}
.n2s-chip[aria-pressed=true]{border-color:var(--dsw-alias-label-primary);font-weight:500}

/* history */
.n2s-hist{border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius);overflow:hidden;background:var(--dsw-alias-bg-layer-1)}
.n2s-hist-row{border-bottom:.5px solid var(--n2s-line)}
.n2s-hist-row:last-child{border-bottom:0}
.n2s-hist-head{display:flex;align-items:center}
.n2s-hist-head:hover{background:var(--n2s-hover)}
.n2s-hist-head .n2s-rowdel{flex:none;margin-right:10px}
.n2s-hist-main{display:grid;grid-template-columns:76px minmax(0,1fr) 150px 84px 20px;align-items:center;gap:14px;flex:1;min-width:0;width:100%;padding:11px 6px 11px 16px;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.n2s-hist-main:focus-visible{outline:2px solid var(--n2s-accent);outline-offset:-2px}
.n2s-hist-what{display:grid;gap:2px;min-width:0}
.n2s-hist-title{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.n2s-hist-title.none{color:var(--n2s-muted);font-weight:400}
.n2s-hist-sql{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--n2s-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.n2s-hist-when{display:grid;gap:1px;font-size:12px;color:var(--n2s-muted);text-align:right;white-space:nowrap}
.n2s-hist-when .src{color:var(--n2s-faint)}
.n2s-hist-num{font-size:12px;color:var(--n2s-muted);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.n2s-hist-chev{color:var(--n2s-faint);display:inline-flex;transition:transform .15s}
.n2s-hist-main[aria-expanded=true] .n2s-hist-chev{transform:rotate(180deg)}
.n2s-hist-detail{display:grid;gap:10px;padding:2px 16px 16px 106px}
@media (width<=760px){.n2s-hist-main{grid-template-columns:64px minmax(0,1fr) 20px}.n2s-hist-when,.n2s-hist-num{display:none}.n2s-hist-detail{padding-left:16px}}
.n2s-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:16px}
.n2s-stat{padding:12px 14px;border-radius:var(--n2s-radius);border:.5px solid var(--n2s-line-2)}
.n2s-stat .v{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
.n2s-stat .k{font-size:12px;color:var(--n2s-muted)}
.n2s-search{position:relative;flex:1;min-width:200px;max-width:320px}
.n2s-search .n2s-input{padding-left:30px}
.n2s-search .n2s-ico{position:absolute;left:9px;top:50%;transform:translateY(-50%);color:var(--n2s-faint);display:inline-flex}

/* dashboard */
.n2s-dash{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
@media (width<=980px){.n2s-dash{grid-template-columns:1fr}}
.n2s-widget{position:relative;display:flex;flex-direction:column;gap:10px;min-width:0;padding:16px;border-radius:var(--n2s-radius);border:.5px solid var(--n2s-line-2);background:var(--dsw-alias-bg-layer-1)}
.n2s-widget-head{display:flex;align-items:center;gap:8px;min-height:28px}
.n2s-widget-head .title{font-size:14px;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.n2s-widget-actions{display:flex;align-items:center;gap:2px;margin-left:auto;opacity:0;transition:opacity .12s}
.n2s-widget:hover .n2s-widget-actions,.n2s-widget:focus-within .n2s-widget-actions{opacity:1}
@media (hover:none){.n2s-widget-actions{opacity:1}}
.n2s-filterbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;margin-bottom:16px;border-radius:var(--n2s-radius);background:var(--n2s-fill)}
.n2s-filterbar .n2s-select,.n2s-filterbar .n2s-input{height:30px;width:auto;background:var(--dsw-alias-bg-layer-1)}
.n2s-ftag{display:inline-flex;align-items:center;gap:4px;height:30px;padding:0 4px 0 10px;border-radius:var(--n2s-radius-sm);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--n2s-line-2);font-size:12.5px}
.n2s-ftag .n2s-select{border:0;height:26px;padding:0 4px;box-shadow:none}

/* tool card in chat */
.n2s-toolcard{margin:6px 0;border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius,12px);background:var(--dsw-alias-bg-layer-1);padding:14px 16px;font-size:13px;--n2s-radius:12px;--n2s-radius-sm:8px}
.n2s-toolcard .n2s-chart{height:260px}
.n2s-toolcard-head{display:flex;align-items:center;gap:8px;color:var(--n2s-muted);font-size:12.5px}

/* composer & reply */
.n2s-composer{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 8px;border-radius:14px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer;max-width:220px}
.n2s-composer:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.n2s-composer span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.n2s-reply-send{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));cursor:pointer}
.n2s-reply-send:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}

/* modal */
.n2s-modal-backdrop{position:fixed;inset:0;z-index:1000;background:rgba(15,17,21,.36);backdrop-filter:blur(2px);display:flex;align-items:center;justify-content:center;padding:20px;animation:n2s-fade .12s ease-out}
.n2s-modal{width:min(680px,100%);max-height:88vh;overflow:auto;box-sizing:border-box;padding:20px 22px;border-radius:16px;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--n2s-line-2);box-shadow:0 24px 64px rgba(0,0,0,.22);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.55;animation:n2s-pop .14s ease-out}
.n2s-modal-title{font-size:16px;font-weight:600}
@keyframes n2s-fade{from{opacity:0}}
@keyframes n2s-pop{from{opacity:0;transform:translateY(6px) scale(.985)}}

/* section + list pattern */
.n2s-sechead{display:flex;align-items:flex-end;gap:10px;margin-bottom:16px}
.n2s-sechead-title{font-size:16px;font-weight:600;line-height:24px}
.n2s-sechead-desc{margin-top:2px;font-size:12.5px;color:var(--n2s-muted);max-width:720px;line-height:1.55}
.n2s-list2{border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius);background:var(--dsw-alias-bg-layer-1);overflow:hidden}
.n2s-list2-row{display:flex;align-items:center;gap:14px;padding:14px 16px;border-bottom:.5px solid var(--n2s-line)}
.n2s-list2-row:last-child{border-bottom:0}
.n2s-list2-row:hover{background:color-mix(in srgb,var(--n2s-hover) 50%,transparent)}
.n2s-list2-title{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.n2s-list2-sub{margin-top:3px;font-size:12px;color:var(--n2s-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.n2s-list2-side{display:grid;justify-items:end;gap:2px;flex:none;min-width:112px}
.n2s-tile{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;background:var(--n2s-fill);color:var(--n2s-muted);flex:none;font-size:12px;font-weight:700;letter-spacing:-.02em}
@media (width<=760px){.n2s-list2-side{display:none}}

/* schema */
.n2s-sidepanel{position:sticky;top:96px;display:flex;flex-direction:column;padding:8px;border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius);background:var(--dsw-alias-bg-layer-1)}
.n2s-legend{display:flex;flex-wrap:wrap;gap:4px 10px;padding:8px 6px 2px;border-top:.5px solid var(--n2s-line);margin-top:6px;font-size:11px;color:var(--n2s-faint)}
.n2s-legend>span{display:inline-flex;align-items:center;gap:5px}
.n2s-roledot{width:7px;height:7px;border-radius:2px;flex:none;background:#94a3b8}
.n2s-roledot.fact{background:#3b82f6}.n2s-roledot.dimension{background:#22c55e}.n2s-roledot.log{background:#f59e0b}.n2s-roledot.config{background:#8b5cf6}.n2s-roledot.view{background:#14b8a6}
.n2s-detail{min-width:0}
.n2s-detail-head{display:flex;align-items:flex-start;gap:8px;margin-bottom:14px}
.n2s-detail-title{font-size:16px !important;font-weight:600}
.n2s-detail-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px;margin-top:20px}
.n2s-colkey{display:inline-flex;align-items:center;height:16px;padding:0 4px;border-radius:4px;font-size:9.5px;font-weight:700;letter-spacing:.02em;color:var(--n2s-faint);border:.5px solid var(--n2s-line-2)}
.n2s-colkey.pk{color:color-mix(in srgb,var(--n2s-warn) 75%,var(--dsw-alias-label-primary));border-color:color-mix(in srgb,#f59e0b 50%,transparent);background:color-mix(in srgb,#f59e0b 10%,transparent)}
.n2s-coltable td{vertical-align:top;padding-top:9px;padding-bottom:9px}
.n2s-linkbtn{padding:0;border:0;background:transparent;color:var(--n2s-accent);font:inherit;cursor:pointer}
.n2s-linkbtn:hover{text-decoration:underline}

.n2s-subtabs{display:flex;gap:4px;margin-bottom:14px;flex-wrap:wrap}
.n2s-subtabs button{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:999px;border:.5px solid transparent;background:transparent;color:var(--n2s-muted);font:inherit;font-size:13px;cursor:pointer}
.n2s-subtabs button:hover{color:var(--dsw-alias-label-primary);background:var(--n2s-hover)}
.n2s-subtabs button[aria-selected=true]{background:var(--n2s-fill);color:var(--dsw-alias-label-primary);font-weight:500}
.n2s-subtabs .count{font-size:11px;color:var(--n2s-faint);font-variant-numeric:tabular-nums}
.n2s-kbsub{margin-top:4px;font-size:13px;color:var(--n2s-muted);line-height:1.6}
.n2s-kbactions{opacity:0;transition:opacity .12s}
.n2s-kbrow:hover .n2s-kbactions,.n2s-kbrow:focus-within .n2s-kbactions{opacity:1}
@media (hover:none){.n2s-kbactions{opacity:1}}

/* drill & why */
.n2s-drill{border-top:.5px solid var(--n2s-line-2);padding-top:12px}
.n2s-waterfall{display:grid;gap:4px}
.n2s-wf-row{display:grid;grid-template-columns:minmax(80px,180px) minmax(0,1fr) 80px 44px;align-items:center;gap:10px;font-size:12.5px}
.n2s-wf-bar{height:14px;border-radius:4px;background:var(--n2s-fill);overflow:hidden}
.n2s-wf-fill{display:block;height:100%;border-radius:4px;background:var(--n2s-line-2)}
.n2s-wf-fill.up{background:#22c55e}
.n2s-wf-fill.down{background:#ef4444}
.n2s-wf-num{text-align:right;font-variant-numeric:tabular-nums}
.n2s-wf-share{text-align:right;font-size:11.5px}
/* dashboards tabs */
.n2s-dashtabs{display:flex;align-items:center;gap:4px;flex-wrap:wrap;margin-bottom:14px}
.n2s-dashtabs [role=tab]{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border-radius:999px;border:.5px solid var(--n2s-line-2);background:transparent;color:var(--n2s-muted);font:inherit;font-size:13px;cursor:pointer}
.n2s-dashtabs [role=tab]:hover{color:var(--dsw-alias-label-primary)}
.n2s-dashtabs [role=tab][aria-selected=true]{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);border-color:transparent;font-weight:500}
.n2s-dashtabs .count{font-size:11px;opacity:.7}
/* eval chart */
.n2s-evalchart{display:flex;align-items:flex-end;gap:6px;height:110px;padding:10px 12px;border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius)}
.n2s-evalbar{position:relative;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;width:28px;height:100%;padding:0;border:0;background:transparent;cursor:pointer}
.n2s-evalbar .fill{display:block;width:100%;border-radius:4px 4px 0 0;background:color-mix(in srgb,var(--n2s-accent) 70%,transparent)}
.n2s-evalbar[aria-pressed=true] .fill{background:var(--n2s-accent)}
.n2s-evalbar .lbl{font-size:10px;color:var(--n2s-faint);margin-top:2px}

.n2s-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:180px;border:1.5px dashed var(--n2s-line-2);border-radius:var(--n2s-radius);cursor:pointer;text-align:center;padding:20px;transition:background .12s,border-color .12s}
.n2s-drop:hover,.n2s-drop.over{background:var(--n2s-hover);border-color:var(--n2s-accent)}

/* misc */
.n2s-md{font-size:13.5px;line-height:1.65;word-break:break-word}
.n2s-md a{color:var(--n2s-accent)}
.n2s-md-code{padding:1px 4px;border-radius:4px;background:var(--n2s-fill);font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
.n2s-mdedit .n2s-btn.small.ghost{height:24px;padding:0 6px}
.n2s-details{margin-top:16px;border-top:.5px solid var(--n2s-line-2);padding-top:12px}
.n2s-details>summary{cursor:pointer;font-size:13px;font-weight:500;list-style-position:inside}
.n2s-ask{display:grid;gap:10px}
.n2s-ask .n2s-textarea{min-height:88px}
.n2s-ds-head{display:flex;align-items:flex-start;gap:12px}
.n2s-ds-title{font-weight:600}
.n2s-dsicon{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;background:var(--n2s-fill);flex:none;font-size:11px;font-weight:600;color:var(--n2s-muted)}
.n2s-spin{display:inline-block;width:12px;height:12px;border:1.5px solid currentColor;border-right-color:transparent;border-radius:50%;animation:n2s-spin .8s linear infinite}
.n2s-skel{border-radius:8px;background:linear-gradient(90deg,var(--n2s-fill) 25%,color-mix(in srgb,var(--n2s-fill) 40%,transparent) 50%,var(--n2s-fill) 75%);background-size:200% 100%;animation:n2s-shimmer 1.2s infinite}
/* ---- v0.9 shell: admin area ---- */
.n2s-content.wide{max-width:1240px}
.n2s-tab.admin{display:inline-flex;align-items:center;gap:6px}
.n2s-admin{display:grid;grid-template-columns:200px minmax(0,1fr);gap:28px;align-items:start}
.n2s-adminnav{position:sticky;top:12px;display:grid;gap:2px}
.n2s-adminnav-item{display:flex;align-items:center;gap:10px;height:36px;padding:0 10px;border:0;border-radius:var(--n2s-radius-sm);background:transparent;color:var(--n2s-muted);font:inherit;font-size:13.5px;text-align:left;cursor:pointer}
.n2s-adminnav-item:hover{background:var(--n2s-hover);color:var(--dsw-alias-label-primary)}
.n2s-adminnav-item[aria-current=page]{background:var(--n2s-fill);color:var(--dsw-alias-label-primary);font-weight:500}
.n2s-adminnav-item .ico{display:inline-flex;width:18px;justify-content:center}
.n2s-adminnav-item:focus-visible,.n2s-setgroups button:focus-visible,.n2s-draghandle:focus-visible{outline:2px solid var(--n2s-accent);outline-offset:1px}
.n2s-navbadge{min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--n2s-fill);color:var(--n2s-muted);font-size:11px;line-height:18px;text-align:center;font-variant-numeric:tabular-nums}
.n2s-navbadge.err{background:var(--n2s-err);color:#fff}
.n2s-adminbody{min-width:0}
@media (width<=860px){.n2s-admin{grid-template-columns:1fr;gap:14px}.n2s-adminnav{position:static;display:flex;overflow-x:auto;scrollbar-width:none;gap:4px;padding-bottom:4px;border-bottom:.5px solid var(--n2s-line-2)}.n2s-adminnav-item{flex:none}.n2s-adminnav-item .n2s-grow{flex:none}}

/* ---- settings ---- */
.n2s-settings{max-width:820px;padding-bottom:72px}
.n2s-setgroups{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:16px}
.n2s-setgroups button{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;border-radius:999px;border:.5px solid var(--n2s-line-2);background:transparent;color:var(--n2s-muted);font:inherit;font-size:13px;cursor:pointer}
.n2s-setgroups button:hover{color:var(--dsw-alias-label-primary)}
.n2s-setgroups button[aria-selected=true]{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base);border-color:transparent;font-weight:500}
.n2s-setpanel{border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius);padding:18px 20px;background:var(--dsw-alias-bg-layer-1)}
.n2s-setrow{display:grid;grid-template-columns:200px minmax(0,1fr);gap:4px 20px;padding:16px 0;border-top:.5px solid var(--n2s-line)}
.n2s-setrow:first-of-type{border-top:0}
.n2s-setrow-label{display:flex;align-items:flex-start;align-self:start;gap:6px;font-size:13.5px;font-weight:500;padding-top:6px;line-height:1.5}
.n2s-setrow-ctl{min-width:0}
.n2s-setrow-hint{grid-column:2;color:var(--n2s-muted);font-size:12.5px;line-height:1.55}
.n2s-setrow.changed .n2s-setrow-label{color:var(--dsw-alias-label-primary)}
@media (width<=760px){.n2s-setrow{grid-template-columns:1fr}.n2s-setrow-hint{grid-column:1}.n2s-setrow-label{padding-top:0}}
.n2s-dotchanged{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--n2s-accent);flex:none}
.n2s-radios{display:grid;gap:8px}
.n2s-radio{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius-sm);cursor:pointer}
.n2s-radio:hover{background:var(--n2s-hover)}
.n2s-radio.on{border-color:var(--n2s-accent);background:color-mix(in srgb,var(--n2s-accent) 6%,transparent)}
.n2s-radio input{margin-top:3px}
.n2s-radio .title{display:block;font-size:13.5px;font-weight:500}
.n2s-radio .desc{display:block;color:var(--n2s-muted);font-size:12.5px;margin-top:2px;line-height:1.5}
.n2s-switch{display:inline-flex;align-items:center;gap:10px;cursor:pointer;font-size:13.5px}
.n2s-switch input{appearance:none;width:34px;height:20px;border-radius:999px;background:var(--n2s-line-2);position:relative;cursor:pointer;margin:0;transition:background .15s}
.n2s-switch input::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
.n2s-switch input:checked{background:var(--n2s-accent)}
.n2s-switch input:checked::after{transform:translateX(14px)}
.n2s-switch input:focus-visible{outline:2px solid var(--n2s-accent);outline-offset:2px}
.n2s-setnote{padding:10px 12px;border-radius:var(--n2s-radius-sm);background:var(--n2s-fill);color:var(--n2s-muted);font-size:12.5px;line-height:1.6}
.n2s-setsub{margin:22px 0 4px;font-size:14px;font-weight:500}
.n2s-infogrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin:8px 0 6px}
.n2s-infocard{display:flex;align-items:center;gap:10px;padding:12px 14px;border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius-sm);min-width:0;margin:8px 0}
.n2s-infogrid .n2s-infocard{margin:0}
.n2s-infocard.col{flex-direction:column;align-items:flex-start;gap:2px}
.n2s-bignum{font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
.n2s-savebar{position:sticky;bottom:12px;z-index:5;display:flex;align-items:center;gap:10px;margin-top:16px;padding:10px 12px 10px 16px;border-radius:var(--n2s-radius);background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--n2s-line-2);box-shadow:0 8px 28px rgba(0,0,0,.14);font-size:13.5px;animation:n2s-up .18s ease-out}
@keyframes n2s-up{from{transform:translateY(8px);opacity:0}}
.n2s-link{border:0;background:none;padding:0;color:var(--n2s-accent);font:inherit;cursor:pointer;text-decoration:none}
.n2s-link:hover{text-decoration:underline}
.n2s-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}

/* ---- toasts & dialogs ---- */
.n2s-toasts{position:fixed;right:20px;bottom:20px;z-index:2147483000;display:grid;gap:8px;pointer-events:none}
.n2s-toast{display:flex;align-items:center;gap:8px;max-width:420px;padding:10px 14px;border-radius:10px;background:var(--dsw-alias-label-primary,#111);color:var(--dsw-alias-bg-base,#fff);font-size:13px;line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,.2);pointer-events:auto;animation:n2s-up .18s ease-out}
.n2s-toast.err{background:var(--n2s-err,#dc2626);color:#fff}
.n2s-toast.ok svg{color:#4ade80}
.n2s-btn.danger-solid{background:var(--n2s-err,#dc2626);border-color:transparent;color:#fff}
.n2s-btn.danger-solid:hover{filter:brightness(1.05)}

/* ---- onboarding & ask ---- */
.n2s-onboard{margin-bottom:22px;padding:18px 20px;border-radius:var(--n2s-radius);border:.5px solid var(--n2s-line-2);background:linear-gradient(180deg,color-mix(in srgb,var(--n2s-accent) 5%,transparent),transparent 70%)}
.n2s-onboard-title{font-size:15px;font-weight:600}
.n2s-steps{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.n2s-step{display:flex;align-items:center;gap:12px;padding:10px 4px;border-radius:var(--n2s-radius-sm)}
.n2s-step .num{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;border:1px solid var(--n2s-line-2);font-size:12px;color:var(--n2s-muted);flex:none}
.n2s-step.current .num{border-color:var(--n2s-accent);color:var(--n2s-accent);font-weight:600}
.n2s-step.done .num{background:var(--n2s-ok);border-color:transparent;color:#fff}
.n2s-step .title{font-size:13.5px;font-weight:500}
.n2s-step.done .title{color:var(--n2s-muted);text-decoration:line-through;text-decoration-color:var(--n2s-line-2)}
.n2s-step .desc{font-size:12.5px;color:var(--n2s-muted)}
.n2s-step:not(.current) .desc{display:none}
.n2s-onboard-extra{display:flex;align-items:center;gap:12px;margin-top:10px;padding-top:12px;border-top:.5px dashed var(--n2s-line-2)}
.n2s-sectlabel{display:flex;align-items:center;gap:8px;margin:22px 0 8px;font-size:12px;font-weight:500;color:var(--n2s-faint);letter-spacing:.02em}
.n2s-sectlabel + .n2s-examples{margin-top:0}
.n2s-recent{border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius);overflow:hidden}
.n2s-recent-row{display:flex;align-items:center;gap:10px;padding:8px 8px 8px 14px;border-top:.5px solid var(--n2s-line);font-size:13.5px;min-width:0}
.n2s-recent-row:first-child{border-top:0}
.n2s-recent-row:hover{background:var(--n2s-hover)}
.n2s-recent-row .n2s-btn{opacity:.75}
.n2s-recent-row:hover .n2s-btn{opacity:1}
.n2s-dot.warn{background:var(--n2s-warn)}
.n2s-show-narrow{display:none}
@media (width<=640px){.n2s-hide-narrow{display:none!important}.n2s-show-narrow{display:block}}

.n2s-progress{width:min(260px,70%);height:4px;margin-top:12px;border-radius:999px;background:var(--n2s-fill);overflow:hidden}
.n2s-progress span{display:block;height:100%;background:var(--n2s-accent);transition:width .2s}
.n2s-shuffle{display:inline-flex;align-items:center;gap:4px}
.n2s-shuffle:disabled{opacity:.6;cursor:default}
.n2s-spinning{display:inline-flex;animation:n2s-spin .8s linear infinite}
.n2s-recent-del,.n2s-rowdel{opacity:0;color:var(--n2s-faint)}
.n2s-recent-row:hover .n2s-recent-del,.n2s-recent-del:focus-visible,.n2s-hist-row:hover .n2s-rowdel,.n2s-rowdel:focus-visible{opacity:1}
.n2s-recent-del:hover,.n2s-rowdel:hover{color:var(--n2s-err)}
@media (hover:none){.n2s-recent-del,.n2s-rowdel{opacity:1}}
.n2s-morebtn{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;height:36px;margin-top:6px;border:.5px dashed var(--n2s-line-2);border-radius:var(--n2s-radius-sm);background:transparent;color:var(--n2s-muted);font:inherit;font-size:13px;cursor:pointer}
.n2s-morebtn:hover{background:var(--n2s-hover);color:var(--dsw-alias-label-primary)}
.n2s-btn.danger-text{color:var(--n2s-err)}
/* ---- member identity picker ---- */
.n2s-pickchips{display:flex;flex-wrap:wrap;gap:6px}
.n2s-pickchip{display:inline-flex;align-items:center;gap:6px;max-width:100%;height:30px;padding:0 10px;border:.5px solid var(--n2s-line-2);border-radius:999px;background:var(--n2s-surface);color:inherit;font:inherit;font-size:12.5px;cursor:pointer}
.n2s-pickchip:hover:not(:disabled){background:var(--n2s-hover)}
.n2s-pickchip[aria-pressed=true]{border-color:var(--n2s-accent);background:var(--n2s-accent-soft,rgba(51,112,255,.08));color:var(--n2s-accent)}
.n2s-pickchip:disabled{opacity:.55;cursor:default}
.n2s-pickchip-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}
.n2s-idpicker{gap:6px}
.n2s-sub-group { margin-bottom: 12px; }
.n2s-sub-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; }
.n2s-sub-chat { font-weight: 600; }
.n2s-sub-kind { font-size: 11px; }
.n2s-sub-err { color: var(--n2s-err); white-space: normal; max-width: 260px; }
/* ---- reconciliation (rc) ---- */
.n2s-rc-panes{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:10px 0}
@media (max-width:820px){.n2s-rc-panes{grid-template-columns:1fr}}
.n2s-rc-pane{display:flex;flex-direction:column;gap:8px;padding:10px;border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius);min-width:0}
.n2s-rc-pane-title{font-weight:500;margin-bottom:2px}
.n2s-rc-maprow{display:flex;align-items:center;gap:6px;margin-top:6px}
.n2s-rc-maprow .n2s-input{flex:1;min-width:0}
.n2s-rc-maprow .n2s-input.n2s-rc-tol{flex:0 0 100px}
.n2s-rc-dry{margin-top:14px;padding-top:12px;border-top:.5px solid var(--n2s-line)}
.n2s-rc-stats{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.n2s-rc-stat{padding:8px 12px;border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius);min-width:96px}
.n2s-rc-stat-v{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
.n2s-rc-stat-l{font-size:12px;color:var(--n2s-muted)}
.n2s-rc-stat.bad .n2s-rc-stat-v,.n2s-rc-bad{color:var(--n2s-err)}
.n2s-rc-run{cursor:pointer}
.n2s-rc-run:hover td{background:color-mix(in srgb,currentColor 4%,transparent)}
.n2s-mcp .n2s-card{margin-bottom:12px}
.n2s-mcp-endpoint{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:12px 0 6px}
.n2s-mcp-endpoint code{padding:4px 8px;border-radius:var(--n2s-radius-sm);background:var(--n2s-hover);font-size:12.5px;word-break:break-all}
.n2s-mcp-form{display:grid;gap:12px}
.n2s-mcp-snippets{margin-top:10px}
.n2s-mcp-code{position:relative}
.n2s-mcp-code pre{margin:0;padding:10px 12px;max-height:260px;overflow:auto;white-space:pre;font-size:12px}
.n2s-mcp-codeact{position:absolute;top:6px;right:6px}
.n2s-mcp-fresh{border-color:var(--n2s-accent)}
/* ---- presentation mode (feature present) ---- */
.n2s-pre{position:fixed;inset:0;z-index:2147483000;display:flex;flex-direction:column;gap:18px;padding:22px 28px 28px;overflow:auto;box-sizing:border-box;background:#0b1020;color:#e8ecf4;font-size:16px;line-height:1.5;outline:none;
  --dsw-alias-label-primary:#e8ecf4;--dsw-alias-label-secondary:#9aa4b8;--dsw-alias-label-tertiary:#6f7a90;--dsw-alias-border-l1:rgba(255,255,255,.10);--dsw-alias-border-l2:rgba(255,255,255,.16);--dsw-alias-bg-layer-1:#141b2e;--dsw-alias-bg-base:#0b1020;--n2s-muted:#9aa4b8;--n2s-faint:#6f7a90;--n2s-line:rgba(255,255,255,.10);--n2s-line-2:rgba(255,255,255,.16);--n2s-hover:rgba(255,255,255,.06);--n2s-fill:rgba(255,255,255,.05);--n2s-accent:#5b8cff;--n2s-ok:#34c759;--n2s-warn:#ffb020;--n2s-err:#ff5c5c}
.n2s-pre-head{display:flex;align-items:center;gap:24px;flex-wrap:wrap}
.n2s-pre-titles{flex:1;min-width:240px}
.n2s-pre-titles h1{margin:0;font-size:clamp(26px,2.6vw,40px);font-weight:700;letter-spacing:-.01em;line-height:1.2}
.n2s-pre-sub{color:#9aa4b8;font-size:14px;margin-top:4px}
.n2s-pre-clock{text-align:right;font-variant-numeric:tabular-nums}
.n2s-pre-clock .time{font-size:clamp(26px,2.4vw,38px);font-weight:600;line-height:1.1}
.n2s-pre-clock .date{color:#9aa4b8;font-size:13px}
.n2s-pre-ctl{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.n2s-pre-ctl label{display:inline-flex;align-items:center;gap:6px;color:#9aa4b8;font-size:13px}
.n2s-pre-ctl select{height:32px;padding:0 8px;border-radius:8px;border:1px solid rgba(255,255,255,.16);background:#141b2e;color:#e8ecf4;font:inherit;font-size:13px}
.n2s-pre-btn{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:34px;padding:0 8px;border-radius:8px;border:1px solid rgba(255,255,255,.16);background:#141b2e;color:#e8ecf4;font:inherit;font-size:16px;cursor:pointer}
.n2s-pre-btn:hover{background:#1d2640}
.n2s-pre-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:18px;align-content:start}
.n2s-pre-card{grid-column:span 3;min-width:0;padding:16px 18px;border-radius:14px;background:#141b2e;border:1px solid rgba(255,255,255,.08);box-shadow:0 8px 30px rgba(0,0,0,.25)}
.n2s-pre-card.w-third{grid-column:span 2}
.n2s-pre-card.w-full{grid-column:span 6}
.n2s-pre-card-title{display:flex;align-items:center;font-size:clamp(16px,1.3vw,22px);font-weight:600;margin-bottom:8px}
.n2s-pre-card .n2s-result-foot{display:none}
.n2s-pre-card .n2s-chart{min-height:300px}
.n2s-pre-card .n2s-kpi .v{font-size:clamp(34px,3.6vw,60px)}
.n2s-pre-card .n2s-table{font-size:14px}
.n2s-pre-empty{padding:80px 0;text-align:center;color:#9aa4b8;font-size:20px}
@media (max-width:1100px){.n2s-pre-card,.n2s-pre-card.w-third{grid-column:span 6}}
@media (min-width:1101px) and (max-width:1500px){.n2s-pre-card.w-third{grid-column:span 3}}
.n2s-pre-dlg{margin-top:10px}

/* ---- proactive: forecast, goals, digest ---- */
.n2s-pro-fc{margin-top:10px;padding:10px 12px;border:.5px dashed var(--n2s-line-2);border-radius:var(--n2s-radius-sm)}
.n2s-pro-fc-title{display:inline-flex;align-items:center;gap:6px;font-weight:500;font-size:13px}
.n2s-pro-chips{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.n2s-pro-chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border-radius:999px;border:.5px solid var(--n2s-line-2);font-size:12px;white-space:nowrap}
.n2s-pro-bar{position:relative;display:inline-block;width:64px;height:5px;border-radius:999px;background:var(--n2s-fill);overflow:hidden;flex:none}
.n2s-pro-bar .proj,.n2s-pro-bar .cur{position:absolute;left:0;top:0;bottom:0;border-radius:999px}
.n2s-pro-bar .proj{background:color-mix(in srgb,var(--n2s-accent) 28%,transparent)}
.n2s-pro-bar .cur{background:var(--n2s-accent)}
.n2s-pro-bar.ok .cur{background:var(--n2s-ok)}.n2s-pro-bar.ok .proj{background:color-mix(in srgb,var(--n2s-ok) 28%,transparent)}
.n2s-pro-bar.warn .cur{background:var(--n2s-warn)}.n2s-pro-bar.warn .proj{background:color-mix(in srgb,var(--n2s-warn) 28%,transparent)}
.n2s-pro-bar.err .cur{background:var(--n2s-err)}
.n2s-pro-bar .tick{position:absolute;top:0;bottom:0;width:1px;background:var(--dsw-alias-label-secondary)}
.n2s-list2-row .n2s-pro-bar{width:140px}
.n2s-pro-pct{font-variant-numeric:tabular-nums;color:var(--n2s-muted)}
.n2s-pro-pct.ok{color:var(--n2s-ok)}.n2s-pro-pct.warn{color:color-mix(in srgb,var(--n2s-warn) 85%,black)}.n2s-pro-pct.err{color:var(--n2s-err)}
.n2s-pro-preview{margin-top:10px;padding:12px;border-radius:var(--n2s-radius-sm);background:var(--n2s-fill)}
.n2s-pro-preview-charts{display:grid;gap:10px;margin-top:10px}
/* ---- data freshness / health (21a-freshness.js) ---- */
.n2s-fq-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px;padding:6px 10px;border-radius:var(--n2s-radius-sm);font-size:12.5px;line-height:1.5;color:color-mix(in srgb,var(--n2s-warn) 80%,black);background:color-mix(in srgb,var(--n2s-warn) 12%,transparent)}
.n2s-fq-panel{border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius-sm);padding:6px 10px;margin-bottom:12px}
.n2s-fq-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:2px 16px;margin-top:6px}
.n2s-fq-item{display:flex;align-items:center;gap:6px;min-width:0;font-size:12.5px;padding:2px 0}
.n2s-fq-dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--n2s-faint)}
.n2s-fq-dot.ok{background:var(--n2s-ok)}
.n2s-fq-dot.warn{background:var(--n2s-warn)}
.n2s-fq-dot.err{background:var(--n2s-err)}
.n2s-fq-score{display:inline-flex;align-items:center;justify-content:center;min-width:34px;height:22px;padding:0 6px;border-radius:6px;font-weight:600;font-size:12px;background:var(--n2s-fill);color:var(--n2s-muted)}
.n2s-fq-score.ok{color:var(--n2s-ok);background:color-mix(in srgb,var(--n2s-ok) 12%,transparent)}
.n2s-fq-score.warn{color:color-mix(in srgb,var(--n2s-warn) 85%,black);background:color-mix(in srgb,var(--n2s-warn) 14%,transparent)}
.n2s-fq-score.err{color:var(--n2s-err);background:color-mix(in srgb,var(--n2s-err) 10%,transparent)}
.n2s-fq-summary{display:flex;align-items:center;gap:12px;font-size:13px}
.n2s-fq-summary .n2s-fq-score{min-width:48px;height:34px;font-size:17px}
.n2s-adminnav-group{margin:14px 12px 4px;font-size:11.5px;letter-spacing:.02em;color:var(--n2s-faint)}
.n2s-adminnav-sep{height:.5px;margin:10px 12px;background:var(--n2s-line)}
.n2s-mcp-tabs{flex-wrap:wrap}
.n2s-mcp-limits{display:grid;gap:12px;padding-top:4px;border-top:1px dashed var(--n2s-border)}
.n2s-mcp-toolgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:4px 12px;margin-top:4px;font-size:12.5px}
.n2s-mcp-editor{display:grid;gap:12px;border-color:var(--n2s-accent)}
.n2s-mcp-actions{text-align:right;white-space:nowrap}
.n2s-mcp-actions .n2s-btn{margin-left:4px}
.n2s-mcp-tokens .n2s-badge{margin:0 4px 2px 0}
.n2s-mcp-selftest{margin-top:6px}
.n2s-mcp-steps{margin:6px 0 0;padding-left:18px;font-size:12.5px}
.n2s-mcp-log .n2s-select{max-width:200px}
.n2s-mcp-logtable td{vertical-align:middle}
.n2s-fq-settings{padding-top:6px}
.n2s-fq-setgroup{margin:14px 0 2px;font-size:12.5px;font-weight:600;color:var(--n2s-muted);letter-spacing:.02em}
.n2s-fq-setgroup:first-child{margin-top:4px}
/* ---- dashboard v2 ---- */
.n2s-srcbadge{display:inline-flex;align-items:center;gap:3px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:none}
.n2s-seg.small button{height:26px;padding:0 10px;font-size:12px}
.n2s-dash{grid-template-columns:repeat(6,minmax(0,1fr));align-items:start}
.n2s-widget.w-third{grid-column:span 2}
.n2s-widget.w-half{grid-column:span 3}
.n2s-widget.w-full{grid-column:1 / -1}
@media (width<=1100px){.n2s-widget.w-third{grid-column:span 3}}
@media (width<=980px){.n2s-dash{grid-template-columns:1fr}.n2s-widget.w-third,.n2s-widget.w-half,.n2s-widget.w-full{grid-column:1 / -1}}
.n2s-draghandle{display:inline-flex;align-items:center;justify-content:center;width:18px;height:22px;margin-left:-6px;border-radius:4px;color:var(--n2s-faint);cursor:grab;flex:none;opacity:.5}
.n2s-widget:hover .n2s-draghandle{opacity:1}
.n2s-draghandle:active{cursor:grabbing}
.n2s-widget.dragging{opacity:.45}
.n2s-dash.is-dragging .n2s-widget:not(.dragging){transition:box-shadow .12s}
.n2s-widget.drop-before{box-shadow:inset 3px 0 0 var(--n2s-accent)}
.n2s-widget.drop-after{box-shadow:inset -3px 0 0 var(--n2s-accent)}
.n2s-widget.w-full.drop-before{box-shadow:inset 0 3px 0 var(--n2s-accent)}
.n2s-widget.w-full.drop-after{box-shadow:inset 0 -3px 0 var(--n2s-accent)}
@media (hover:none){.n2s-draghandle{display:none}}
.n2s-dashbar{flex-wrap:wrap;row-gap:8px}
.n2s-dashbar-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
@media (width<=640px){.n2s-dashbar-actions{width:100%;justify-content:flex-end}.n2s-dashtabs{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.n2s-dashtabs [role=tab]{flex:none}}
/* ---- channels, bots, identities ---- */
.n2s-flabel{color:var(--n2s-muted);font-size:12px;display:inline-flex;align-items:center;gap:2px}
.n2s-req{color:var(--n2s-err)}
.n2s-fielderr{color:var(--n2s-err);font-size:12px;line-height:1.45}
.n2s-input.invalid,.n2s-input[aria-invalid=true],.n2s-select[aria-invalid=true]{border-color:var(--n2s-err);box-shadow:0 0 0 3px color-mix(in srgb,var(--n2s-err) 12%,transparent)}
.n2s-mono-soft{font-variant-ligatures:none}
.n2s-pmark{font-weight:700;letter-spacing:-.02em;flex:none;line-height:1}
.n2s-caps{display:inline-flex;flex-wrap:wrap;gap:4px}
.n2s-cap{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px;border-radius:999px;border:.5px solid var(--n2s-line-2);font-size:11px;color:var(--n2s-muted);white-space:nowrap}
.n2s-cap.muted{color:var(--n2s-faint);border-style:dashed}
.n2s-cap.bot{color:var(--n2s-accent);border-color:color-mix(in srgb,var(--n2s-accent) 40%,transparent);background:color-mix(in srgb,var(--n2s-accent) 6%,transparent)}
.n2s-statusdot.conn::before{background:var(--n2s-warn);animation:n2s-pulse 1.2s ease-in-out infinite}
.n2s-statusdot.warn::before{background:var(--n2s-warn)}
@keyframes n2s-pulse{50%{opacity:.35}}
.n2s-chpick{display:flex;align-items:center;gap:8px;min-width:0}
.n2s-chpick .n2s-select{flex:1}
.n2s-chpick-none{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:7px;background:var(--n2s-fill);color:var(--n2s-faint);flex:none}
.n2s-pgroups{display:grid;gap:18px}
.n2s-pgroup-head{display:flex;align-items:center;gap:8px;margin:0 2px 8px;font-size:13px;font-weight:600}
.n2s-pgroup-head .n2s-faint{font-weight:400;font-size:12px}
.n2s-wizard{padding:20px 24px 18px}
.n2s-wiz-head{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.n2s-wiz-steps{display:flex;gap:6px;list-style:none;margin:0 0 16px;padding:0;counter-reset:wiz}
.n2s-wiz-steps li{counter-increment:wiz;display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--n2s-faint)}
.n2s-wiz-steps li::before{content:counter(wiz);display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;border:1px solid var(--n2s-line-2);font-size:11px}
.n2s-wiz-steps li+li::after{content:none}
.n2s-wiz-steps li+li{padding-left:6px;border-left:.5px solid var(--n2s-line-2)}
.n2s-wiz-steps li.current{color:var(--dsw-alias-label-primary);font-weight:500}
.n2s-wiz-steps li.current::before{border-color:var(--n2s-accent);color:var(--n2s-accent)}
.n2s-wiz-steps li.done::before{content:'✓';background:var(--n2s-ok);border-color:transparent;color:#fff}
.n2s-ptiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-top:8px}
.n2s-ptile{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:12px;border-radius:var(--n2s-radius);border:.5px solid var(--n2s-line-2);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:border-color .12s,background .12s}
.n2s-ptile:hover{background:var(--n2s-hover)}
.n2s-ptile[aria-checked=true]{border-color:var(--n2s-accent);background:color-mix(in srgb,var(--n2s-accent) 6%,transparent);box-shadow:0 0 0 1px var(--n2s-accent)}
.n2s-ptile:focus-visible,.n2s-kindcard:focus-visible{outline:2px solid var(--n2s-accent);outline-offset:2px}
.n2s-ptile-name{font-size:13.5px;font-weight:600}
.n2s-kindcards{display:grid;gap:8px;margin:8px 0 0;padding:0;list-style:none}
.n2s-kindcard-li{display:grid}
.n2s-kindcard{display:grid;gap:4px;padding:12px 14px;border-radius:var(--n2s-radius);border:.5px solid var(--n2s-line-2);background:var(--dsw-alias-bg-base);color:inherit;font:inherit;text-align:left;cursor:pointer;transition:border-color .12s,background .12s}
.n2s-kindcard:hover{border-color:var(--n2s-accent);background:color-mix(in srgb,var(--n2s-accent) 4%,transparent)}
.n2s-kindcard-title{display:flex;align-items:center;gap:6px;font-size:14px;font-weight:600}
.n2s-kindcard-title svg{color:var(--n2s-faint)}
.n2s-kindcard-desc{font-size:12.5px;color:var(--n2s-muted);line-height:1.55}
.n2s-setup{border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius-sm);padding:10px 12px;background:var(--n2s-fill)}
.n2s-setup>summary{cursor:pointer;font-size:13px;font-weight:500}
.n2s-setup ol{margin:8px 0 2px;padding-left:20px;font-size:12.5px;line-height:1.75;color:var(--n2s-muted)}
.n2s-botbox{margin:16px 0 0;padding:12px 14px 14px;border:.5px solid var(--n2s-line-2);border-radius:var(--n2s-radius)}
.n2s-botbox legend{padding:0 6px;font-size:13px;font-weight:600}
.n2s-botbox.focus{border-color:var(--n2s-accent)}
.n2s-wiz-foot{margin-top:16px;padding-top:14px;border-top:.5px solid var(--n2s-line);justify-content:flex-end}
.n2s-idrows{display:grid;gap:8px}
.n2s-idrow-main{display:flex;align-items:center;gap:8px}
.n2s-idrow-main .n2s-input{flex:1}
.n2s-idrow-help,.n2s-idrow .n2s-fielderr{margin:4px 0 0 38px}
.n2s-idchips{display:inline-flex;flex-wrap:wrap;gap:4px;min-width:0}
.n2s-idchip{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px 0 3px;border-radius:999px;background:var(--n2s-fill);font-size:11.5px;max-width:240px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.n2s-botrow{border-bottom:.5px solid var(--n2s-line)}
.n2s-botrow:last-child{border-bottom:0}
.n2s-botrow .n2s-list2-row{border-bottom:0}
.n2s-collapse>button .n2s-badge{margin-left:2px}
@media (prefers-reduced-motion:reduce){.n2s-statusdot.conn::before{animation:none}}
@keyframes n2s-spin{to{transform:rotate(360deg)}}
@keyframes n2s-shimmer{to{background-position:-200% 0}}
`

    // ------------------------------------------------------------ icons

    const svg = (size, children, extra) => h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, ...extra }, ...children)
    const Icon = {
      db: (size = 16) => h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('ellipse', { cx: 12, cy: 5.5, rx: 7.5, ry: 2.8 }),
        h('path', { d: 'M4.5 5.5v6.2c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8V5.5' }),
        h('path', { d: 'M4.5 11.7v6.5c0 1.55 3.36 2.8 7.5 2.8 1 0 1.96-.07 2.83-.2' }),
        h('path', { d: 'M17 15.5v5M19.5 17.5v3M14.5 18.5v2', strokeWidth: 1.8 })),
      chev: (size = 12) => svg(size, [h('path', { key: 1, d: 'M4 6l4 4 4-4' })]),
      check: (size = 14) => svg(size, [h('path', { key: 1, d: 'M3.5 8.5l3 3 6-7' })], { strokeWidth: 1.8 }),
      more: (size = 16) => svg(size, [h('circle', { key: 1, cx: 3.5, cy: 8, r: .9, fill: 'currentColor' }), h('circle', { key: 2, cx: 8, cy: 8, r: .9, fill: 'currentColor' }), h('circle', { key: 3, cx: 12.5, cy: 8, r: .9, fill: 'currentColor' })]),
      code: (size = 15) => svg(size, [h('path', { key: 1, d: 'M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5' })]),
      copy: (size = 15) => svg(size, [h('rect', { key: 1, x: 5.5, y: 5.5, width: 8, height: 8, rx: 1.6 }), h('path', { key: 2, d: 'M10.5 5.5V3.6c0-.6-.5-1.1-1.1-1.1H3.6c-.6 0-1.1.5-1.1 1.1v5.8c0 .6.5 1.1 1.1 1.1h1.9' })]),
      download: (size = 15) => svg(size, [h('path', { key: 1, d: 'M8 2.5v8M4.8 7.5 8 10.7l3.2-3.2M3 13.5h10' })]),
      pin: (size = 15) => svg(size, [h('path', { key: 1, d: 'M10.2 2.5 13.5 5.8l-2.3.8-2.4 2.4.3 2.8-1.3 1.3-2.2-2.2-3 3M4.6 8.7 7.3 6l.8-2.3 2.1-1.2' })]),
      send: (size = 15) => svg(size, [h('path', { key: 1, d: 'M14 2 7 9M14 2l-4.5 12-2.5-5-5-2.5L14 2z' })]),
      thumbUp: (size = 15) => svg(size, [h('path', { key: 1, d: 'M5 7v6.5H3V7h2zm0 0 2.6-4.5c.8 0 1.4.7 1.3 1.5L8.6 6h3.6c.8 0 1.4.8 1.2 1.6l-1 4.6c-.1.7-.7 1.3-1.4 1.3H5' })]),
      thumbDown: (size = 15) => svg(size, [h('path', { key: 1, d: 'M5 9V2.5H3V9h2zm0 0 2.6 4.5c.8 0 1.4-.7 1.3-1.5L8.6 10h3.6c.8 0 1.4-.8 1.2-1.6l-1-4.6c-.1-.7-.7-1.3-1.4-1.3H5' })]),
      chart: (size = 15) => svg(size, [h('path', { key: 1, d: 'M2.5 13.5h11M4.5 11V7.5M8 11V4.5M11.5 11V8.5' })]),
      table: (size = 15) => svg(size, [h('rect', { key: 1, x: 2.5, y: 3, width: 11, height: 10, rx: 1.5 }), h('path', { key: 2, d: 'M2.5 6.5h11M6.5 6.5V13' })]),
      refresh: (size = 15) => svg(size, [h('path', { key: 1, d: 'M13 8a5 5 0 1 1-1.5-3.5M13 2.5v2.8h-2.8' })]),
      close: (size = 14) => svg(size, [h('path', { key: 1, d: 'M4 4l8 8M12 4l-8 8' })]),
      search: (size = 14) => svg(size, [h('circle', { key: 1, cx: 7, cy: 7, r: 4.5 }), h('path', { key: 2, d: 'M10.5 10.5 13.5 13.5' })]),
      spark: (size = 15) => svg(size, [h('path', { key: 1, d: 'M8 2.5 9.3 6.7 13.5 8 9.3 9.3 8 13.5 6.7 9.3 2.5 8l4.2-1.3L8 2.5z' })]),
      arrow: (size = 15) => svg(size, [h('path', { key: 1, d: 'M3 8h10M9 4l4 4-4 4' })]),
      edit: (size = 15) => svg(size, [h('path', { key: 1, d: 'M10.5 3 13 5.5 6 12.5H3.5V10L10.5 3z' })]),
      external: (size = 14) => svg(size, [h('path', { key: 1, d: 'M9.5 2.5h4v4M13.5 2.5 7.5 8.5M12 9.5v3.2c0 .5-.4.8-.8.8H3.3c-.5 0-.8-.3-.8-.8V4.8c0-.4.3-.8.8-.8h3.2' })]),
      trash: (size = 15) => svg(size, [h('path', { key: 1, d: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.3c0 .4.4.7.8.7h4.2c.4 0 .8-.3.8-.7l.6-8.3' })]),
      up: (size = 14) => svg(size, [h('path', { key: 1, d: 'M8 13V3M4 7l4-4 4 4' })]),
      down: (size = 14) => svg(size, [h('path', { key: 1, d: 'M8 3v10M4 9l4 4 4-4' })]),
      expand: (size = 14) => svg(size, [h('path', { key: 1, d: 'M2.5 6V2.5H6M13.5 10v3.5H10M2.5 2.5l4 4M13.5 13.5l-4-4' })]),
    }

    /** Small popover menu anchored to a trigger; items: [{ label, icon?, onClick, danger?, checked?, divider? }]. */
    function Dropdown({ trigger, items, align = 'end', label }) {
      const [open, setOpen] = useState(false)
      const btn = useRef(null)
      const menu = useRef(null)
      const [pos, setPos] = useState(null)
      useEffect(() => {
        if (!open) return
        const r = btn.current.getBoundingClientRect()
        const width = 200
        const left = align === 'end' ? Math.max(8, r.right - width) : Math.min(window.innerWidth - width - 8, r.left)
        const below = window.innerHeight - r.bottom > 260
        setPos(below ? { left, top: r.bottom + 4, minWidth: width } : { left, bottom: window.innerHeight - r.top + 4, minWidth: width })
        const onDown = (e) => { if (!menu.current?.contains(e.target) && !btn.current?.contains(e.target)) setOpen(false) }
        const onKey = (e) => {
          if (e.key === 'Escape') { setOpen(false); btn.current?.focus() }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            const list = [...(menu.current?.querySelectorAll('button:not([disabled])') ?? [])]
            const i = list.indexOf(document.activeElement)
            list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus()
            e.preventDefault()
          }
        }
        const onScroll = () => setOpen(false)
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        window.addEventListener('scroll', onScroll, true)
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); window.removeEventListener('scroll', onScroll, true) }
      }, [open])
      useEffect(() => { if (open && pos) menu.current?.querySelector('button:not([disabled])')?.focus() }, [open, pos])
      return h(React.Fragment, null,
        h('button', { ref: btn, type: 'button', className: trigger.className ?? 'n2s-iconbtn', 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-label': label, title: label, onClick: () => setOpen(v => !v) }, trigger.content),
        open && pos && ReactDOM.createPortal(h('div', { ref: menu, className: 'n2s-menu', role: 'menu', style: pos },
          items.filter(Boolean).map((it, i) => it.divider
            ? h('hr', { key: `d${i}` })
            : h('button', { key: i, type: 'button', role: it.checked === undefined ? 'menuitem' : 'menuitemradio', 'aria-checked': it.checked, className: it.danger ? 'danger' : undefined, disabled: it.disabled, onClick: () => { setOpen(false); it.onClick() } },
              it.checked !== undefined ? h('span', { className: 'check' }, it.checked ? Icon.check(13) : null) : it.icon ? h('span', { className: 'n2s-ico' }, it.icon) : null,
              h('span', { className: 'n2s-grow' }, it.label),
              it.hint ? h('span', { className: 'n2s-faint n2s-small' }, it.hint) : null))), document.body))
    }

    /** Transient confirmation shown next to an action (copied / saved …). */
    function useFlash() {
      const [msg, setMsg] = useState(null)
      const timer = useRef(null)
      useEffect(() => () => clearTimeout(timer.current), [])
      return [msg, (text) => { setMsg(text); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(null), 1600) }]
    }

    // -------------------------------------------------------- utilities

    function fmt(t, key, vars) {
      let s = t(key)
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
      return s
    }

    /** Current UI language ('zh' | 'en'), updated by the page/tool views on render. */
    let uiLang = 'zh'
    // LocaleSnapshot is { active, locales, revision } (dsh-client-locale); older hosts passed a string.
    /**
     * Extension points for feature files (client-src/2x-*.js). Each feature calls
     * `extend.<point>.push(...)` at module evaluation:
     *   adminSections: { id, label: (t) => string, icon: () => node, Component({ t, ds, datasources, onNavigate }) }
     *   dashboardMenu: (ctx: { t, boardId, widgets, filters }) => [Dropdown items]
     *   dashboardBar:  Component({ t, boardId, widgets, filters }) rendered next to the dashboard actions
     *   resultMenu:    (ctx: { t, result }) => [Dropdown items]
     *   resultPanels:  Component({ t, result }) rendered under a result (e.g. forecast, freshness note)
     *   schemaPanels:  Component({ t, ds, schema, selected }) rendered above the table list
     *   askPanels:     Component({ t, ds }) rendered on the Ask page under the composer
     *   toolViews:     { key: '<tool name>', make: (ctx) => Component } conversation tool result views
     */
    const extend = { adminSections: [], dashboardMenu: [], dashboardBar: [], resultMenu: [], resultPanels: [], schemaPanels: [], askPanels: [], toolViews: [] }
    const extItems = (list, arg) => list.flatMap(f => { try { return f(arg) ?? [] } catch (e) { console.warn('nl2sql ext', e); return [] } })

    /** Join a list for display in the UI language: 「a、b」 / "a, b". */
    const joinList = (items, sep) => (items ?? []).filter(x => x !== undefined && x !== null && x !== '').join(sep ?? (uiLang === 'zh' ? '、' : ', '))
    /** Label + colon in the UI language: 「标签：」 / "Label: ". */
    const colon = (label) => (uiLang === 'zh' ? `${label}：` : `${label}: `)
    /** List separator in the UI language. */
    const listSep = () => (uiLang === 'zh' ? '、' : ', ')
    /** Clauses joined in the UI language: 「a；b」 / "a; b". */
    const joinClauses = (items) => joinList(items, uiLang === 'zh' ? '；' : '; ')
    /** Parenthetical in the UI language: 「（x）」 / " (x)". */
    const paren = (s) => (s === undefined || s === null || s === '' ? '' : uiLang === 'zh' ? `（${s}）` : ` (${s})`)
    /** Quoted name in the UI language: 「x」 / "x". */
    const quoted = (s) => (uiLang === 'zh' ? `「${s}」` : `"${s}"`)
    /** BCP 47 tag for Intl formatting in the UI language. */
    const uiLocale = () => (uiLang === 'zh' ? 'zh-CN' : 'en-US')
    const setUiLang = (snapshot) => {
      const id = typeof snapshot === 'string' ? snapshot : (snapshot?.active ?? snapshot?.locale ?? 'zh')
      uiLang = /^zh/i.test(String(id)) ? 'zh' : 'en'
    }

    function formatNumber(v) {
      const n = Number(v)
      if (!Number.isFinite(n)) return String(v)
      if (uiLang === 'zh' && Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(2)}亿`
      if (Math.abs(n) >= 1e4) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
      return n.toLocaleString(undefined, { maximumFractionDigits: 4 })
    }

    function formatCompact(v) {
      if (v === null || v === undefined || v === '') return '—'
      const n = Number(v)
      if (!Number.isFinite(n)) return String(v)
      const abs = Math.abs(n)
      // [divisor, suffix, threshold, digits(abs)] from the largest unit down.
      const scales = uiLang === 'zh'
        ? [[1e8, '亿', 1e8, a => (a >= 1e10 ? 0 : 2)], [1e4, '万', 1e5, a => (a >= 1e7 ? 0 : 1)]]
        : [[1e9, 'B', 1e9, a => (a >= 1e11 ? 0 : 2)], [1e6, 'M', 1e6, a => (a >= 1e8 ? 0 : 1)], [1e3, 'K', 1e5, () => 0]]
      for (let i = 0; i < scales.length; i++) {
        const [div, suffix, threshold, digits] = scales[i]
        if (abs < threshold) continue
        const s = (n / div).toFixed(digits(abs))
        // Rounding can reach the next unit (999 999 → "1000K"): use the larger unit instead.
        if (i > 0 && Math.abs(Number(s)) >= scales[i - 1][0] / div) {
          const [div2, suffix2, , digits2] = scales[i - 1]
          return `${(n / div2).toFixed(digits2(scales[i - 1][0]))}${suffix2}`
        }
        return `${s}${suffix}`
      }
      return n.toLocaleString(uiLocale(), { maximumFractionDigits: 2 })
    }

    function toCsv(result) {
      const esc = (v) => {
        if (v === null || v === undefined) return ''
        const s = String(v)
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
      }
      return `\ufeff${[result.columns.map(c => esc(c.name)).join(','), ...result.rows.map(r => r.map(esc).join(','))].join('\r\n')}`
    }

    function download(name, blob) {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    }

    /** Display-only SQL layout: one clause per line when the author wrote it on one line. */
    function prettySql(sql) {
      const src = String(sql ?? '')
      if (src.includes('\n') || src.length < 90) return src
      let depth = 0
      let out = ''
      let quote = null
      let inSelect = false
      for (let i = 0; i < src.length; i++) {
        const c = src[i]
        if (quote) { out += c; if (c === quote) quote = null; continue }
        if (c === '\'' || c === '"' || c === '`') { quote = c; out += c; continue }
        if (c === '(') depth++
        if (c === ')') depth = Math.max(0, depth - 1)
        if (depth === 0) {
          const rest = src.slice(i)
          const m = rest.match(/^(SELECT|FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT|UNION(?: ALL)?|(?:LEFT |RIGHT |INNER |FULL |CROSS )?(?:OUTER )?JOIN|WITH)\b/i)
          if (m && (out.length === 0 || /\s$/.test(out))) {
            inSelect = /^SELECT$/i.test(m[0])
            out = out.length ? out.replace(/\s+$/, '') + '\n' + m[0].toUpperCase() : m[0].toUpperCase()
            i += m[0].length - 1
            continue
          }
          if (c === ',' && inSelect) { out += ',\n  '; while (src[i + 1] === ' ') i++; continue }
        }
        out += c
      }
      return out
    }

    function downloadBase64({ base64, fileName, mediaType }) {
      const bin = atob(base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      download(fileName, new Blob([bytes], { type: mediaType }))
    }

    async function exportExcel(payload) {
      try { downloadBase64(await call('exportExcel', payload)) } catch (e) { notifyError(e) }
    }

    function escapeHtml(v) {
      return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
    }

    function safeName(s) {
      return (s || 'result').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60)
    }

    /**
     * Async data with request ordering: results of an older request (or of
     * previous deps) never overwrite newer ones, and `loading` is true from the
     * first render after deps change.
     *
     * `value` belongs to the current deps: while new deps load it is undefined,
     * so e.g. a previous data source's data is never shown or acted on.
     * `reload()` with unchanged deps keeps `value` until the new one arrives.
     * `scope` (optional) names the deps that identify *whose* data this is; when
     * only other deps change (a page offset, a filter) the previous value stays
     * on screen while the next one loads, as long as the scope is unchanged.
     */
    function useAsync(fn, deps, scope) {
      const depsKey = JSON.stringify(deps)
      const scopeKey = scope === undefined ? depsKey : JSON.stringify(scope)
      const [state, setState] = useState({ loading: true, value: undefined, error: undefined, key: null, scope: null })
      const seq = useRef(0)
      const reload = useCallback(() => {
        const id = ++seq.current
        setState(s => ({ ...s, loading: true, error: undefined }))
        Promise.resolve().then(fn).then(
          value => { if (seq.current === id) setState({ loading: false, value, error: undefined, key: depsKey, scope: scopeKey }) },
          error => { if (seq.current === id) setState({ loading: false, value: undefined, error, key: depsKey, scope: scopeKey }) },
        )
        return () => { if (seq.current === id) seq.current++ }
      }, deps)
      useEffect(reload, [reload])
      const stale = state.key !== depsKey
      const foreign = state.scope !== scopeKey
      return { loading: state.loading || stale, value: foreign ? undefined : state.value, error: stale ? undefined : state.error, stale, reload }
    }

    /**
     * Guard against double submits: `run(fn)` ignores calls while one is in
     * flight (checked synchronously through a ref, so two clicks in the same
     * tick still run once) and `busy` re-renders the disabled state.
     */
    function useBusy() {
      const ref = useRef(false)
      const [busy, setBusy] = useState(false)
      const alive = useRef(true)
      useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
      const run = useCallback(async (fn) => {
        if (ref.current) return undefined
        ref.current = true
        setBusy(true)
        try { return await fn() } finally { ref.current = false; if (alive.current) setBusy(false) }
      }, [])
      return [busy, run]
    }

    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

    /** Keep Tab / Shift+Tab focus inside the element while `active`. */
    function useFocusTrap(ref, active = true) {
      useEffect(() => {
        const el = ref.current
        if (!active || !el) return
        const onKey = (e) => {
          if (e.key !== 'Tab') return
          const items = [...el.querySelectorAll(FOCUSABLE)].filter(x => !x.closest('[hidden]') && x.getAttribute('aria-hidden') !== 'true')
          if (!items.length) { e.preventDefault(); return }
          const first = items[0]
          const last = items[items.length - 1]
          const cur = document.activeElement
          if (e.shiftKey && (cur === first || !el.contains(cur))) { e.preventDefault(); last.focus() } else if (!e.shiftKey && (cur === last || !el.contains(cur))) { e.preventDefault(); first.focus() }
        }
        el.addEventListener('keydown', onKey)
        return () => el.removeEventListener('keydown', onKey)
      }, [ref, active, ref.current])
    }

    // ------------------------------------------------------------ feedback
    // In-page toasts and dialogs that replace window.alert / confirm / prompt.
    // `notify`, `confirmDialog` and `promptDialog` can be called from anywhere
    // (event handlers, async code); the host <FeedbackLayer/> renders them.

    const feedbackStore = createStore({ toasts: [], dialog: null })
    let toastSeq = 0

    /** Show a transient message. kind: 'info' | 'ok' | 'err'. */
    function notify(text, kind = 'info', ms) {
      const id = ++toastSeq
      const toast = { id, text: String(text ?? ''), kind }
      feedbackStore.set({ ...feedbackStore.get(), toasts: [...feedbackStore.get().toasts, toast].slice(-4) })
      setTimeout(() => feedbackStore.set({ ...feedbackStore.get(), toasts: feedbackStore.get().toasts.filter(x => x.id !== id) }), ms ?? (kind === 'err' ? 6000 : 3000))
    }
    const notifyError = (e) => notify(e?.message ?? String(e), 'err')

    /** Resolve to true when confirmed. */
    function confirmDialog({ title, message, confirmLabel, danger = false }) {
      return new Promise(resolve => feedbackStore.set({ ...feedbackStore.get(), dialog: { kind: 'confirm', title, message, confirmLabel, danger, resolve } }))
    }

    /** Resolve to the entered text, or null when cancelled. */
    function promptDialog({ title, message, value = '', placeholder, confirmLabel, validate }) {
      return new Promise(resolve => feedbackStore.set({ ...feedbackStore.get(), dialog: { kind: 'prompt', title, message, value, placeholder, confirmLabel, validate, resolve } }))
    }

    function FeedbackLayer({ t }) {
      const get = () => feedbackStore.get()
      const st = useSyncExternalStore(feedbackStore.subscribe, get, get)
      const d = st.dialog
      const [value, setValue] = useState('')
      const [err, setErr] = useState(null)
      const box = useRef(null)
      useFocusTrap(box, Boolean(d))
      useEffect(() => {
        if (!d) return
        setValue(d.value ?? '')
        setErr(null)
        const prev = document.activeElement
        setTimeout(() => (box.current?.querySelector('input') ?? box.current?.querySelector('button.primary'))?.focus(), 0)
        return () => prev?.focus?.()
      }, [d])
      const close = (result) => { feedbackStore.set({ ...feedbackStore.get(), dialog: null }); d?.resolve(result) }
      const ok = () => {
        if (d.kind === 'prompt') {
          const v = value.trim()
          if (!v) { setErr(t('fb2.required')); return }
          const msg = d.validate?.(v)
          if (msg) { setErr(msg); return }
          close(v)
        } else close(true)
      }
      return h(React.Fragment, null,
        h('div', { className: 'n2s-toasts', role: 'status', 'aria-live': 'polite' }, st.toasts.map(x => h('div', { key: x.id, className: `n2s-toast ${x.kind}` }, x.kind === 'ok' ? Icon.check(14) : x.kind === 'err' ? Icon.close(13) : null, h('span', null, x.text)))),
        d && ReactDOM.createPortal(h('div', { className: 'n2s-modal-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) close(d.kind === 'prompt' ? null : false) } },
          h('div', { ref: box, className: 'n2s-modal', role: 'alertdialog', 'aria-modal': true, 'aria-labelledby': 'n2s-dlg-title', style: { width: 'min(440px, 100%)' }, onKeyDown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(d.kind === 'prompt' ? null : false) } if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') ok() } },
            h('div', { id: 'n2s-dlg-title', className: 'n2s-modal-title', style: { marginBottom: 8 } }, d.title),
            d.message && h('div', { className: 'n2s-muted', style: { fontSize: 13.5, marginBottom: 12, whiteSpace: 'pre-wrap' } }, d.message),
            d.kind === 'prompt' && h('input', { className: 'n2s-input', value, placeholder: d.placeholder, 'aria-label': d.title, onChange: e => { setValue(e.target.value); setErr(null) } }),
            err && h('div', { className: 'n2s-small', style: { color: 'var(--n2s-err)', marginTop: 6 } }, err),
            h('div', { className: 'n2s-row', style: { marginTop: 16, justifyContent: 'flex-end' } },
              h('button', { type: 'button', className: 'n2s-btn ghost', onClick: () => close(d.kind === 'prompt' ? null : false) }, t('ds.cancel')),
              h('button', { type: 'button', className: `n2s-btn ${d.danger ? 'danger-solid' : 'primary'}`, onClick: ok }, d.confirmLabel ?? t('fb2.ok'))))), document.body))
    }


    /** Mount the FeedbackLayer once into its own root under document.body; returns the disposer. */
    function mountFeedbackLayer(ctx) {
      const el = document.createElement('div')
      el.className = 'n2s-feedback-root'
      el.dataset.plugin = PKG
      document.body.appendChild(el)
      const root = ReactDOMClient.createRoot(el)
      function GlobalFeedback() {
        const t = useMemo(() => ctx.locale.bind(NS), [])
        setUiLang(useSyncExternalStore(ctx.locale.subscribe.bind(ctx.locale), () => ctx.locale.getSnapshot(), () => ctx.locale.getSnapshot()))
        return h(FeedbackLayer, { t })
      }
      root.render(h(GlobalFeedback))
      return () => { const d = feedbackStore.get().dialog; feedbackStore.set({ ...feedbackStore.get(), dialog: null }); d?.resolve(d.kind === 'prompt' ? null : false); setTimeout(() => { root.unmount(); el.remove() }, 0) }
    }
    // ----------------------------------------------------------- charts

    // ECharts is loaded in a sandboxed wrapper (lib/client.echarts.js) whose `window` is an empty
    // object, so it cannot read the screen's devicePixelRatio and would draw at 1x (blurry on
    // Retina / HiDPI). Every chart passes the real ratio explicitly and re-inits when it changes
    // (moving between screens, browser zoom).
    const chartDpr = () => Math.max(1, Math.min(3, (typeof window !== 'undefined' && window.devicePixelRatio) || 1))
    function initChart(echarts, el, opts = {}) {
      return echarts.init(el, null, { renderer: 'canvas', devicePixelRatio: chartDpr(), ...opts })
    }
    /** Call `onChange` when the device pixel ratio changes; returns a cleanup. */
    function watchDpr(onChange) {
      if (typeof window === 'undefined' || !window.matchMedia) return () => {}
      let mq
      const listen = () => {
        mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
        mq.addEventListener?.('change', handler, { once: true })
      }
      const handler = () => { onChange(); listen() }
      listen()
      return () => mq?.removeEventListener?.('change', handler)
    }
    let echartsPromise
    function loadEcharts() {
      echartsPromise ??= require.async('./client.echarts.js')
      return echartsPromise
    }

    function cssVar(el, name, fallback) {
      const v = getComputedStyle(el).getPropertyValue(name).trim()
      return v || fallback
    }

    function buildOption(result, chart, el) {
      const label = cssVar(el, '--dsw-alias-label-secondary', '#888')
      const text = cssVar(el, '--dsw-alias-label-primary', '#222')
      const border = cssVar(el, '--dsw-alias-border-l1', 'rgba(128,128,128,.25)')
      const surface = cssVar(el, '--dsw-alias-bg-layer-1', '#fff')
      const palette = ['#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#ec4899', '#64748b', '#84cc16', '#f97316']
      const colIndex = (name) => result.columns.findIndex(c => c.name === name)
      const xi = colIndex(chart.x)
      const ys = (chart.y ?? []).map(colIndex).filter(i => i >= 0)
      const si = chart.series ? colIndex(chart.series) : -1
      const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v))
      const base = {
        color: palette,
        backgroundColor: 'transparent',
        textStyle: { color: text, fontFamily: 'inherit' },
        animationDuration: 300,
        grid: { left: 4, right: 8, top: 36, bottom: 4, containLabel: true },
        tooltip: { trigger: 'axis', confine: true, backgroundColor: surface, borderColor: border, borderWidth: 1, padding: [8, 10], textStyle: { color: text, fontSize: 12 }, extraCssText: 'border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.12)', axisPointer: { type: 'line', lineStyle: { color: border } }, valueFormatter: (v) => (v === null || v === undefined ? '—' : formatNumber(v)) },
        legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, itemGap: 16, textStyle: { color: label, fontSize: 12 }, type: 'scroll' },
      }
      const axisCommon = { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: label, fontSize: 11 }, splitLine: { lineStyle: { color: border, type: [3, 3] } } }
      if (chart.type === 'pie' || chart.type === 'funnel') {
        const data = result.rows.map(r => ({ name: String(r[xi] ?? 'NULL'), value: num(r[ys[0]]) }))
        return {
          ...base,
          tooltip: { ...base.tooltip, trigger: 'item' },
          legend: { ...base.legend, show: data.length <= 12, orient: 'vertical', left: 'auto', right: 0, top: 'middle' },
          series: [chart.type === 'pie'
            ? { type: 'pie', radius: ['48%', '72%'], center: ['40%', '50%'], data, label: { color: label, fontSize: 11, formatter: '{b}  {d}%' }, labelLine: { length: 8, length2: 8 }, itemStyle: { borderColor: surface, borderWidth: 2, borderRadius: 4 } }
            : { type: 'funnel', top: 36, bottom: 8, data, label: { color: text } }],
        }
      }
      if (chart.type === 'scatter') {
        return {
          ...base,
          tooltip: { ...base.tooltip, trigger: 'item' },
          xAxis: { type: 'value', name: chart.x, nameTextStyle: { color: label }, ...axisCommon },
          yAxis: { type: 'value', name: result.columns[ys[0]]?.name, nameTextStyle: { color: label }, ...axisCommon },
          series: [{ type: 'scatter', symbolSize: 7, data: result.rows.map(r => [num(r[xi]), num(r[ys[0]])]) }],
        }
      }
      const horizontal = chart.type === 'barh'
      const seriesType = chart.type === 'line' || chart.type === 'area' ? 'line' : 'bar'
      let categories
      let series
      if (si >= 0 && ys.length >= 1) {
        categories = [...new Set(result.rows.map(r => String(r[xi] ?? 'NULL')))]
        const groups = new Map()
        for (const r of result.rows) {
          const key = String(r[si] ?? 'NULL')
          if (!groups.has(key)) groups.set(key, new Map())
          groups.get(key).set(String(r[xi] ?? 'NULL'), num(r[ys[0]]))
        }
        series = [...groups.entries()].slice(0, 20).map(([name, m]) => ({ name, type: seriesType, data: categories.map(c => m.get(c) ?? null) }))
      } else {
        categories = result.rows.map(r => String(r[xi] ?? 'NULL'))
        series = ys.map(i => ({ name: result.columns[i].name, type: seriesType, data: result.rows.map(r => num(r[i])) }))
      }
      for (const s of series) {
        if (seriesType === 'line') { s.smooth = 0.3; s.symbol = 'circle'; s.symbolSize = 5; s.showSymbol = false; s.lineStyle = { width: 2 }; s.connectNulls = true; s.emphasis = { focus: 'series' } }
        if (chart.type === 'area' || (chart.type === 'line' && series.length === 1)) s.areaStyle = { opacity: chart.type === 'area' ? 0.18 : 0.08 }
        if (chart.type === 'stacked') s.stack = 'total'
        if (seriesType === 'bar') { s.barMaxWidth = 24; s.itemStyle = { borderRadius: horizontal ? [0, 4, 4, 0] : chart.type === 'stacked' ? 0 : [4, 4, 0, 0] } }
      }
      const catAxis = { type: 'category', data: categories, ...axisCommon, axisLine: { show: true, lineStyle: { color: border } }, axisLabel: { color: label, fontSize: 11, hideOverlap: true }, splitLine: { show: false }, boundaryGap: seriesType === 'bar' }
      const valAxis = { type: 'value', ...axisCommon, axisLabel: { color: label, fontSize: 11, formatter: (v) => formatNumber(v) } }
      // Second axis when series magnitudes differ by more than 10x.
      let dual = false
      if (!horizontal && chart.type !== 'stacked' && series.length >= 2 && series.length <= 4) {
        const peak = series.map(x => Math.max(0, ...x.data.filter(v => Number.isFinite(v)).map(Math.abs)))
        const top = Math.max(...peak)
        const small = peak.map(p => p > 0 && top / p > 10)
        if (top > 0 && small.some(Boolean) && !small.every(Boolean)) { series.forEach((x, i) => { if (small[i]) x.yAxisIndex = 1 }); dual = true }
      }
      return {
        ...base,
        legend: { ...base.legend, show: series.length > 1 },
        grid: { ...base.grid, top: series.length > 1 ? 36 : 16 },
        xAxis: horizontal ? valAxis : catAxis,
        yAxis: horizontal ? { ...catAxis, inverse: true } : dual ? [valAxis, { ...valAxis, splitLine: { show: false } }] : valAxis,
        dataZoom: categories.length > 60 && !horizontal ? [{ type: 'inside' }] : undefined,
        series,
      }
    }

    function EChart({ result, chart, t, onInstance, onPoint }) {
      const pointRef = useRef(onPoint)
      pointRef.current = onPoint
      const ref = useRef(null)
      const instance = useRef(null)
      const [error, setError] = useState(null)
      const [ready, setReady] = useState(false)
      useEffect(() => {
        let disposed = false
        let observer
        let stopDpr
        loadEcharts().then((echarts) => {
          if (disposed || !ref.current) return
          const create = () => {
            const prev = instance.current
            const option = prev?.getOption?.()
            prev?.dispose()
            instance.current = initChart(echarts, ref.current)
            instance.current.on('click', (p) => { if (pointRef.current && p.name !== undefined && p.name !== '') pointRef.current(p.name) })
            if (option) instance.current.setOption(option, true)
            onInstance?.(instance.current)
          }
          create()
          stopDpr = watchDpr(() => { if (!disposed && ref.current) create() })
          observer = new ResizeObserver(() => instance.current?.resize())
          observer.observe(ref.current)
          setReady(true)
        }, (e) => setError(e.message))
        return () => {
          disposed = true
          stopDpr?.()
          observer?.disconnect()
          instance.current?.dispose()
          instance.current = null
        }
      }, [])
      useEffect(() => {
        if (!ready || !instance.current || !ref.current) return
        try {
          instance.current.setOption(buildOption(result, chart, ref.current), true)
          instance.current.resize()
          setError(null)
        } catch (e) {
          setError(e.message)
        }
      }, [ready, result, chart])
      // Re-color on theme change.
      useEffect(() => {
        if (!ready) return
        const mo = new MutationObserver(() => {
          if (instance.current && ref.current) instance.current.setOption(buildOption(result, chart, ref.current), true)
        })
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })
        return () => mo.disconnect()
      }, [ready, result, chart])
      return h('div', { style: { position: 'relative' } },
        error && h('div', { className: 'n2s-notice err' }, error),
        h('div', { ref, className: 'n2s-chart', role: 'img', 'aria-label': result.title || t('chart.label') }),
        !ready && !error && h('div', { className: 'n2s-skel', style: { position: 'absolute', inset: 0 }, 'aria-label': t('chart.loading') }))
    }

    function DataTable({ result, max = 200 }) {
      const rows = result.rows.slice(0, max)
      return h('div', { className: 'n2s-table-wrap' },
        h('table', { className: 'n2s-table' },
          h('thead', null, h('tr', null, result.columns.map((c, i) => h('th', { key: i, title: c.name, className: c.kind === 'number' ? 'num' : undefined }, c.name)))),
          h('tbody', null, rows.map((r, ri) => h('tr', { key: ri }, r.map((v, ci) => {
            const kind = result.columns[ci]?.kind
            return v === null
              ? h('td', { key: ci, className: 'null' }, 'NULL')
              : h('td', { key: ci, className: kind === 'number' ? 'num' : undefined, title: String(v) }, kind === 'number' ? formatNumber(v) : String(v))
          }))))))
    }

    function Kpis({ result, chart }) {
      const row = result.rows[0] ?? []
      const ys = (chart.y?.length ? chart.y : result.columns.filter(c => c.kind === 'number').map(c => c.name))
      return h('div', { className: 'n2s-kpis' }, ys.map(name => {
        const i = result.columns.findIndex(c => c.name === name)
        return h('div', { key: name, className: 'n2s-kpi' }, h('div', { className: 'v', title: String(row[i] ?? '') }, formatCompact(row[i])), h('div', { className: 'k n2s-ellipsis', title: name }, name))
      }))
    }

    const CHART_CHOICES = ['line', 'area', 'bar', 'barh', 'stacked', 'pie', 'funnel', 'scatter', 'kpi', 'table']

    function chartFor(type, result, suggested) {
      if (type === 'table') return { type }
      const cols = result.columns
      const nums = cols.filter(c => c.kind === 'number').map(c => c.name)
      const time = cols.find(c => c.kind === 'time')?.name
      const cat = cols.find(c => c.kind === 'text')?.name
      if (type === 'kpi') return nums.length ? { type, y: nums.slice(0, 6) } : null
      if (type === 'scatter') return nums.length >= 2 ? { type, x: nums[0], y: [nums[1]] } : null
      const x = suggested?.x ?? time ?? cat ?? cols[0]?.name
      const y = suggested?.y?.length ? suggested.y : nums.slice(0, 4)
      if (!x || !y.length) return null
      if (type === 'pie' || type === 'funnel') return { type, x: cat ?? x, y: [y[0]] }
      return { type, x, y, ...(suggested?.series ? { series: suggested.series } : {}) }
    }

    /** One rendered result: chart switcher, chart/table, SQL and actions. */
    function ResultView({ result: initialResult, t, compact, onPinned, hideSql, question, onFeedback, embedded }) {
      const [result, setResult] = useState(initialResult)
      useEffect(() => { setResult(initialResult) }, [initialResult])
      const [type, setType] = useState(result.chart?.type ?? 'table')
      const [showSql, setShowSql] = useState(false)
      const [showTable, setShowTable] = useState(false)
      const [pinned, setPinned] = useState(false)
      const [copied, setCopied] = useState(false)
      const [savedExample, setSavedExample] = useState(false)
      const [editing, setEditing] = useState(null)
      const [editError, setEditError] = useState(null)
      const [running, setRunning] = useState(false)
      const [chartInstance, setChartInstance] = useState(null)
      const [rated, setRated] = useState(null)
      const [sending, setSending] = useState(false)
      const [rating, setRating] = useState(null)
      const [drill, setDrill] = useState(null)
      const ratingBusy = useRef(false)
      useEffect(() => { setType(result.chart?.type ?? 'table') }, [result.resultId])
      const rate = async (value, comment) => {
        if (ratingBusy.current) return
        ratingBusy.current = true
        try {
          await call('submitFeedback', { resultId: result.resultId, rating: value, comment, question, sql: result.baseSql ?? result.sql, datasourceId: result.datasourceId, title: result.title, sessionId: onFeedback?.sessionId })
          setRated(value)
          setRating(null)
          if (value === 'down') onFeedback?.down?.(comment)
        } catch (e) {
          notifyError(e)
        } finally {
          ratingBusy.current = false
        }
      }
      const chart = useMemo(() => (type === result.chart?.type ? result.chart : chartFor(type, result, result.suggestedChart ?? result.chart)) ?? { type: 'table' }, [type, result])
      const available = useMemo(() => CHART_CHOICES.filter(c => c === 'table' || chartFor(c, result, result.chart)), [result])
      const [pinning, runPin] = useBusy()
      const pin = () => runPin(async () => {
        if (pinned) return
        try {
          await call('pinWidget', { title: result.title || result.sql.slice(0, 60), sql: result.sql, datasourceId: result.datasourceId, chart })
          setPinned(true)
          onPinned?.()
        } catch (e) {
          notifyError(e)
        }
      })
      const [savingExample, runSaveExample] = useBusy()
      const saveExample = () => runSaveExample(async () => {
        const q = await promptDialog({ title: t('kb.examplePrompt'), value: question || result.title || '' })
        if (!q) return
        try {
          await call('saveKnowledgeItem', { datasourceId: result.datasourceId, kind: 'example', item: { question: q, sql: result.sql } })
          setSavedExample(true)
        } catch (e) {
          notifyError(e)
        }
      })
      const rerun = async (confirmScan) => {
        setRunning(true); setEditError(null)
        try {
          const next = await call('runQuery', { sql: editing, datasourceId: result.datasourceId, title: result.title, confirmScan })
          setResult(next); setEditing(null)
        } catch (e) {
          if (e.code === 'nl2sql/scan-guard' && await confirmDialog({ title: t('sql.confirmScan'), message: e.message })) return rerun(true)
          setEditError(e.message)
        } finally {
          setRunning(false)
        }
      }
      const [flash, setFlash] = useFlash()
      const copySql = () => { navigator.clipboard?.writeText(result.sql); setFlash(t('result.copied')) }
      const exportPng = () => {
        const url = chartInstance?.getDataURL({ type: 'png', pixelRatio: Math.max(2, chartDpr()), backgroundColor: cssVar(document.body, '--dsw-alias-bg-base', '#fff') })
        if (url) fetch(url).then(r => r.blob()).then(b => download(`${safeName(result.title)}.png`, b))
      }
      const isChart = chart.type !== 'table' && chart.type !== 'kpi'
      const body = result.rows.length === 0
        ? h('div', { className: 'n2s-empty', style: { padding: 24 } }, t('result.empty'))
        : chart.type === 'table'
          ? h(DataTable, { result })
          : chart.type === 'kpi'
            ? h(Kpis, { result, chart })
            : h(EChart, { result, chart, t, onInstance: setChartInstance, onPoint: chart.x ? (xValue) => setDrill({ mode: 'menu', xValue }) : undefined })
      const flags = [
        result.columns.some(c => c.masked) && h('span', { key: 'm', className: 'n2s-badge warn' }, t('result.masked')),
        result.hiddenColumns > 0 && h('span', { key: 'h', className: 'n2s-badge warn', title: t('policy.hiddenInResult') }, fmt(t, 'policy.hiddenCount', { count: result.hiddenColumns })),
        result.filters?.length > 0 && h('span', { key: 'f', className: 'n2s-badge blue', title: result.filters.map(f => f.description).join('\n') }, fmt(t, 'filter.appliedCount', { count: result.filters.length })),
      ].filter(Boolean)
      const hidden = onPinned?.hidden
      const moreItems = [
        { label: t('result.copySql'), icon: Icon.copy(14), onClick: copySql },
        { label: t('sql.edit'), icon: Icon.edit(14), onClick: () => { setShowSql(true); setEditing(result.sql) } },
        { divider: true },
        { label: t('result.csv'), icon: Icon.download(14), onClick: () => download(`${safeName(result.title)}.csv`, new Blob([toCsv(result)], { type: 'text/csv;charset=utf-8' })) },
        { label: t('result.excel'), icon: Icon.download(14), onClick: () => exportExcel({ resultIds: [result.resultId], title: result.title }) },
        { divider: true },
        isChart && result.chart?.x && { label: t('drill.breakdownAll'), icon: Icon.chart(14), onClick: () => setDrill({ mode: 'breakdown' }) },
        isChart && result.chart?.x && result.rows.length >= 2 && { label: t('drill.why'), icon: Icon.spark(14), onClick: () => setDrill({ mode: 'why' }) },
        isChart && chartInstance && { label: t('result.png'), icon: Icon.download(14), onClick: exportPng },
        !hidden && { divider: true },
        !hidden && { label: savedExample ? t('kb.exampleSaved') : t('kb.saveExample'), icon: Icon.spark(14), disabled: savedExample || savingExample, onClick: saveExample },
        ...extItems(extend.resultMenu, { t, result }),
      ]
      const chartPicker = result.rows.length > 0 && h(Dropdown, {
        label: t('result.chartType'),
        trigger: { className: 'n2s-btn small ghost', content: h(React.Fragment, null, chart.type === 'table' ? Icon.table(14) : Icon.chart(14), t(`chart.${chart.type}`), Icon.chev(10)) },
        items: available.map(c => ({ label: t(`chart.${c}`), checked: chart.type === c, onClick: () => setType(c) })),
      })
      return h('div', { className: 'n2s-result' },
        !embedded && h('div', { className: 'n2s-result-head' },
          result.title && h('span', { className: 'title', title: result.title }, result.title),
          h('span', { className: 'n2s-result-meta' },
            h('span', null, fmt(t, 'result.rows', { count: result.rowCount }), result.truncated ? t('result.truncated') : ''),
            h('span', { className: 'sep' }, '·'), h('span', null, fmt(t, 'result.elapsed', { ms: result.elapsedMs })),
            result.datasourceName && h(React.Fragment, null, h('span', { className: 'sep' }, '·'), h('span', { className: 'n2s-ellipsis', style: { maxWidth: 160 } }, result.datasourceName))),
          flags,
          h('span', { className: 'n2s-grow' }),
          chartPicker),
        body,
        ...extend.resultPanels.map((C, k) => h(C, { key: `rp${k}`, t, result })),
        h('div', { className: 'n2s-result-foot' },
          !hideSql && h('button', { type: 'button', className: 'n2s-btn small ghost', 'aria-expanded': showSql, onClick: () => setShowSql(v => !v) }, Icon.code(14), t('result.sql')),
          isChart && result.rows.length > 0 && !compact && h('button', { type: 'button', className: 'n2s-btn small ghost', 'aria-expanded': showTable, onClick: () => setShowTable(v => !v) }, Icon.table(14), t('result.data')),
          embedded && chartPicker,
          flash && h('span', { className: 'n2s-small n2s-muted', role: 'status' }, flash),
          h('span', { className: 'n2s-grow' }),
          embedded && h('span', { className: 'n2s-faint n2s-small' }, fmt(t, 'result.rows', { count: result.rowCount }), ' · ', fmt(t, 'result.elapsed', { ms: result.elapsedMs })),
          !hidden && h('button', { type: 'button', className: 'n2s-iconbtn', 'aria-pressed': rated === 'up', title: t('fb.up'), 'aria-label': t('fb.up'), onClick: () => rate('up') }, Icon.thumbUp()),
          !hidden && h('button', { type: 'button', className: 'n2s-iconbtn', 'aria-pressed': rated === 'down' || rating === 'down', title: t('fb.down'), 'aria-label': t('fb.down'), onClick: () => setRating(rating === 'down' ? null : 'down') }, Icon.thumbDown()),
          !hidden && h('button', { type: 'button', className: 'n2s-iconbtn', disabled: pinned || pinning, 'aria-busy': pinning || undefined, 'aria-pressed': pinned, title: pinned ? t('result.pinned') : t('result.pin'), 'aria-label': t('result.pin'), onClick: pin }, Icon.pin()),
          h('button', { type: 'button', className: 'n2s-iconbtn', title: t('im.share'), 'aria-label': t('im.share'), onClick: () => setSending(true) }, Icon.send()),
          h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: moreItems })),
        rating === 'down' && h(FeedbackForm, { t, onCancel: () => setRating(null), onSubmit: (comment) => rate('down', comment) }),
        rated && h('div', { className: 'n2s-notice', role: 'status' }, rated === 'up' ? t('fb.thanksUp') : t('fb.thanksDown')),
        sending && h(SendDialog, { t, initial: { title: result.title || t('tool.query'), text: question ? `> ${question}` : '', resultIds: [result.resultId] }, onClose: () => setSending(false) }),
        showSql && editing === null && h('div', { style: { position: 'relative' } },
          h('pre', { className: 'n2s-code', style: { paddingRight: 72 } }, prettySql(result.sql)),
          h('div', { className: 'n2s-row', style: { position: 'absolute', top: 6, right: 6, gap: 2 } },
            h('button', { type: 'button', className: 'n2s-iconbtn', title: t('result.copy'), 'aria-label': t('result.copy'), onClick: copySql }, Icon.copy(14)),
            h('button', { type: 'button', className: 'n2s-iconbtn', title: t('sql.edit'), 'aria-label': t('sql.edit'), onClick: () => setEditing(result.sql) }, Icon.edit(14)))),
        editing !== null && h('div', { className: 'n2s-sqlbox', style: { marginTop: 0 } },
          h('textarea', { value: editing, spellCheck: false, autoFocus: true, onChange: e => setEditing(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) rerun(false) } }),
          editError && h('div', { className: 'n2s-notice err', style: { margin: '0 10px 8px', borderRadius: 6 } }, editError),
          h('div', { className: 'n2s-sqlbar' },
            h('span', { className: 'n2s-faint n2s-small' }, h('kbd', { className: 'n2s-kbd' }, '⌘'), ' ', h('kbd', { className: 'n2s-kbd' }, '↵'), ' ', t('ask.run')),
            h('span', { className: 'n2s-grow' }),
            h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => { setEditing(null); setEditError(null) } }, t('ds.cancel')),
            h('button', { type: 'button', className: 'n2s-btn small primary', disabled: running || !editing.trim(), onClick: () => rerun(false) }, running ? h('span', { className: 'n2s-spin' }) : null, t('ask.run')))),
        drill && h(DrillPanel, { t, result, drill, onClose: () => setDrill(null), onChange: setDrill }),
        showTable && h(DataTable, { result }))
    }

    // ------------------------------------------------------------- page

    const DS_TYPES = [
      { id: 'mysql', label: 'MySQL', port: 3306 },
      { id: 'postgres', label: 'PostgreSQL', port: 5432 },
      { id: 'elasticsearch', label: 'Elasticsearch', port: 9200 },
    ]
    const TYPE_LABEL = { ...Object.fromEntries(DS_TYPES.map(x => [x.id, x.label])), sqlite: 'SQLite' }

    function DatasourceForm({ t, initial, onDone, onCancel }) {
      const [form, setForm] = useState(() => {
        const base = { type: 'mysql', name: '', host: '127.0.0.1', port: 3306, database: '', user: '', password: '', apiKey: '', charset: 'utf8mb4', schemas: '', ssl: false, description: '', ...(initial ?? {}) }
        return {
          ...base, password: '', apiKey: '',
          ssh: { enabled: false, host: '', port: 22, user: '', auth: 'password', password: '', privateKey: '', passphrase: '', ...(initial?.ssh ?? {}) },
          privacyOn: Boolean(initial?.privacy && Object.keys(initial.privacy).length),
          privacy: { sampleMode: 'enum', resultToModel: 'summary', modelRows: 20, maskSensitive: true, ...(initial?.privacy ?? {}) },
        }
      })
      const [test, setTest] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
      const setSsh = (k) => (e) => setForm(f => ({ ...f, ssh: { ...f.ssh, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value } }))
      const setPrivacy = (k, v) => setForm(f => ({ ...f, privacy: { ...f.privacy, [k]: v } }))
      const changeType = (type) => setForm(f => ({ ...f, type, port: DS_TYPES.find(x => x.id === type).port, database: type === 'elasticsearch' && !f.database ? '*' : f.database }))
      const isEs = form.type === 'elasticsearch'
      const payload = () => {
        const { privacyOn, privacy, ssh, ...rest } = form
        return {
          ...rest,
          port: Number(form.port) || DS_TYPES.find(x => x.id === form.type).port,
          ssh: ssh.enabled ? { ...ssh, port: Number(ssh.port) || 22 } : { enabled: false },
          privacy: privacyOn ? { ...privacy, modelRows: Number(privacy.modelRows) || 0 } : null,
          ...(initial?.id ? { id: initial.id } : {}),
        }
      }
      const runTest = async () => {
        setBusy(true); setTest(null)
        try { setTest(await call('testConnection', payload())) } catch (e) { setTest({ ok: false, error: e.message }) }
        setBusy(false)
      }
      const save = async () => {
        setBusy(true); setError(null)
        try {
          const saved = await call('saveDatasource', payload())
          await refreshDatasources()
          onDone?.(saved)
        } catch (e) { setError(e.message) }
        setBusy(false)
      }
      const input = (value, onChange, props = {}) => props.textarea
        ? h('textarea', { className: `n2s-textarea ${props.mono ? 'n2s-mono' : ''}`, value: value ?? '', onChange, placeholder: props.placeholder, spellCheck: false })
        : h('input', { className: 'n2s-input', value: value ?? '', onChange, type: props.type ?? 'text', placeholder: props.placeholder, autoComplete: 'off', spellCheck: false })
      const field = (key, label, props = {}) => h('label', { className: `n2s-field ${props.full ? 'full' : ''}` }, h('span', null, label), input(form[key], set(key), props))
      const sshField = (key, label, props = {}) => h('label', { className: `n2s-field ${props.full ? 'full' : ''}` }, h('span', null, label), input(form.ssh[key], setSsh(key), props))
      const radio = (key, values, prefix) => h('div', { style: { display: 'grid', gap: 4 } }, values.map(v => h('label', { key: v, className: 'n2s-check' },
        h('input', { type: 'radio', name: `ds-${key}`, checked: form.privacy[key] === v, onChange: () => setPrivacy(key, v) }), t(`settings.${prefix}.${v}`))))
      return h('div', { className: 'n2s-card' },
        h('div', { className: 'n2s-field', style: { marginBottom: 14 } }, h('span', null, t('ds.type')),
          h('div', { className: 'n2s-seg', role: 'radiogroup' }, DS_TYPES.map(x => h('button', { key: x.id, type: 'button', role: 'radio', 'aria-checked': form.type === x.id, 'aria-pressed': form.type === x.id, disabled: Boolean(initial?.id) && initial.type !== x.id, onClick: () => changeType(x.id) }, x.label)))),
        h('div', { className: 'n2s-form' },
          field('name', t('ds.name'), { placeholder: t('ph.dsName') }),
          field('database', isEs ? t('ds.indexPattern') : t('ds.database'), { placeholder: isEs ? 'logs-*,orders' : '' }),
          field('host', t('ds.host')),
          field('port', t('ds.port'), { type: 'number' }),
          field('user', isEs ? t('ds.userOptional') : t('ds.user')),
          field('password', t('ds.password'), { type: 'password', placeholder: initial?.hasPassword ? t('ds.passwordKeep') : '' }),
          isEs && field('apiKey', t('ds.apiKey'), { type: 'password', placeholder: initial?.hasApiKey ? t('ds.passwordKeep') : t('ds.apiKeyHint'), full: true }),
          form.type === 'mysql' && field('charset', t('ds.charset')),
          form.type === 'postgres' && field('schemas', t('ds.schemas'), { placeholder: 'public,sales' }),
          h('label', { className: 'n2s-check', style: { alignSelf: 'end', height: 34 } }, h('input', { type: 'checkbox', checked: Boolean(form.ssl), onChange: set('ssl') }), isEs ? t('ds.https') : t('ds.ssl')),
          field('description', t('ds.description'), { textarea: true, full: true })),
        h('details', { className: 'n2s-details', open: form.ssh.enabled },
          h('summary', null, t('ds.sshTitle'), form.ssh.enabled ? h('span', { className: 'n2s-badge brand', style: { marginLeft: 8 } }, 'SSH') : null),
          h('label', { className: 'n2s-check', style: { margin: '8px 0' } }, h('input', { type: 'checkbox', checked: Boolean(form.ssh.enabled), onChange: setSsh('enabled') }), t('ds.sshEnable')),
          form.ssh.enabled && h('div', { className: 'n2s-form' },
            sshField('host', t('ds.sshHost')),
            sshField('port', t('ds.port'), { type: 'number' }),
            sshField('user', t('ds.user')),
            h('div', { className: 'n2s-field' }, h('span', null, t('ds.sshAuth')),
              h('div', { className: 'n2s-seg' }, ['password', 'key'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.ssh.auth === v, onClick: () => setForm(f => ({ ...f, ssh: { ...f.ssh, auth: v } })) }, t(`ds.sshAuth.${v}`))))),
            form.ssh.auth === 'password'
              ? sshField('password', t('ds.password'), { type: 'password', placeholder: initial?.ssh?.hasSecret ? t('ds.passwordKeep') : '', full: true })
              : h(React.Fragment, null,
                sshField('privateKey', t('ds.sshKey'), { textarea: true, mono: true, full: true, placeholder: initial?.ssh?.hasSecret ? t('ds.passwordKeep') : '-----BEGIN OPENSSH PRIVATE KEY-----' }),
                sshField('passphrase', t('ds.sshPassphrase'), { type: 'password' })),
            h('div', { className: 'n2s-muted n2s-small full' }, t('ds.sshHint')))),
        h('details', { className: 'n2s-details', open: form.privacyOn },
          h('summary', null, t('ds.privacyTitle'), form.privacyOn ? h('span', { className: 'n2s-badge warn', style: { marginLeft: 8 } }, t('ds.privacyCustom')) : null),
          h('label', { className: 'n2s-check', style: { margin: '8px 0' } }, h('input', { type: 'checkbox', checked: form.privacyOn, onChange: set('privacyOn') }), t('ds.privacyEnable')),
          form.privacyOn && h('div', { className: 'n2s-form' },
            h('div', { className: 'n2s-field' }, h('span', null, t('settings.sampleMode')), radio('sampleMode', ['off', 'enum', 'all'], 'sample')),
            h('div', { className: 'n2s-field' }, h('span', null, t('settings.resultToModel')), radio('resultToModel', ['none', 'summary', 'rows'], 'result')),
            form.privacy.resultToModel === 'rows' && h('label', { className: 'n2s-field' }, h('span', null, t('settings.modelRows')),
              h('input', { className: 'n2s-input', type: 'number', min: 0, max: 500, value: form.privacy.modelRows, onChange: e => setPrivacy('modelRows', e.target.value) })),
            h('label', { className: 'n2s-check full' }, h('input', { type: 'checkbox', checked: Boolean(form.privacy.maskSensitive), onChange: e => setPrivacy('maskSensitive', e.target.checked) }), t('settings.maskSensitive')))),
        test && h('div', { className: `n2s-notice ${test.ok ? (test.readOnlyGrant === false ? 'warn' : 'ok') : 'err'}`, style: { marginTop: 12 } },
          test.ok ? [fmt(t, 'ds.testOk', { version: test.version, tables: test.tableCount ?? '?', latency: test.latencyMs }), test.viaSsh ? t('ds.viaSsh') : '', ...(test.warnings ?? [])].filter(Boolean).join(' · ') : fmt(t, 'ds.testFail', { error: test.error })),
        error && h('div', { className: 'n2s-notice err', style: { marginTop: 12 } }, error),
        h('div', { className: 'n2s-row', style: { marginTop: 14, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn', disabled: busy, onClick: runTest }, busy ? h('span', { className: 'n2s-spin' }) : null, t('ds.test')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: save }, t('ds.save'))))
    }

    /** Page section header: title, one-line description, actions. */
    function SectionHead({ title, desc, children }) {
      return h('div', { className: 'n2s-sechead' },
        h('div', { className: 'n2s-grow' }, h('div', { className: 'n2s-sechead-title' }, title), desc && h('div', { className: 'n2s-sechead-desc' }, desc)),
        children)
    }

    /** Monogram tile for a data source type. */
    function TypeTile({ type }) {
      const map = { mysql: ['My', '#00758f'], postgres: ['Pg', '#336791'], elasticsearch: ['Es', '#f0a20b'], sqlite: ['CSV', '#16a34a'], lark_webhook: ['飞', '#3370ff'], lark_app: ['飞', '#3370ff'] }
      const [txt, color] = map[type] ?? ['DB', '#64748b']
      return h('span', { className: 'n2s-tile', style: { color, background: `color-mix(in srgb, ${color} 12%, transparent)` }, 'aria-hidden': true }, txt)
    }


    // ------------------------------------------------------------ upload

    const UPLOAD_CHUNK = 4 * 1024 * 1024
    const UPLOAD_MAX = 200 * 1024 * 1024

    function bytesToBase64(bytes) {
      let bin = ''
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
      return btoa(bin)
    }

    /**
     * Upload a file once, in 4 MB chunks, to the host's staging area. The host
     * parses it after the last chunk and returns { uploadId, sheets }.
     */
    async function stageFile(file, onProgress) {
      if (file.size > UPLOAD_MAX) throw new Error(`> 200 MB (${(file.size / 1048576).toFixed(0)} MB)`)
      const total = Math.max(1, Math.ceil(file.size / UPLOAD_CHUNK))
      let uploadId
      let res
      for (let index = 0; index < total; index++) {
        const chunk = new Uint8Array(await file.slice(index * UPLOAD_CHUNK, (index + 1) * UPLOAD_CHUNK).arrayBuffer())
        res = await call('stageUploadChunk', { uploadId, fileName: file.name, index, total, base64: bytesToBase64(chunk) })
        uploadId = res.uploadId
        onProgress?.((index + 1) / total)
      }
      return res
    }

    function UploadDialog({ t, datasources, initialTarget, onClose, onDone }) {
      const fileDs = datasources.filter(d => d.type === 'sqlite')
      const [file, setFile] = useState(null)
      const [uploadId, setUploadId] = useState(null)
      const [progress, setProgress] = useState(0)
      const [sheets, setSheets] = useState(null)
      const [target, setTarget] = useState(initialTarget ?? fileDs[0]?.id ?? '')
      const [newName, setNewName] = useState('')
      const [mode, setMode] = useState('create')
      const [state, setState] = useState(null)
      const [drag, setDrag] = useState(false)
      const inputRef = useRef(null)
      const box = useRef(null)
      useFocusTrap(box)
      const busyRef = useRef(false)
      busyRef.current = Boolean(state?.busy)
      useEffect(() => {
        const prev = document.activeElement
        setTimeout(() => box.current?.querySelector('[role=button], button')?.focus(), 0)
        // Escape works wherever focus is (not only inside the dialog), but not under a confirm dialog or mid-upload.
        const onKey = (e) => { if (e.key === 'Escape' && !feedbackStore.get().dialog && !busyRef.current) onClose() }
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() }
      }, [])
      const pick = async (f) => {
        if (!f) return
        setFile(f); setSheets(null); setState({ busy: true }); setProgress(0)
        try {
          const staged = await stageFile(f, setProgress)
          setUploadId(staged.uploadId)
          setSheets(staged.sheets.map(sh => ({ ...sh, include: true })))
          setNewName(n => n || f.name.replace(/\.[^.]+$/, ''))
          setState(null)
        } catch (e) { setState({ error: e.message }) }
      }
      const run = async () => {
        if (busyRef.current) return
        busyRef.current = true
        setState({ busy: true })
        try {
          const res = await call('importUpload', { datasourceId: target || undefined, newName: target ? undefined : newName, fileName: file.name, uploadId, mode, sheets: sheets.filter(x => x.include).map(x => ({ sheet: x.sheet, table: x.table, mode, columns: x.columns })) })
          await refreshDatasources()
          setState({ done: res })
          onDone?.(res)
        } catch (e) { setState({ error: e.message }) }
      }
      const typeOpts = ['TEXT', 'INTEGER', 'REAL', 'DATE', 'DATETIME']
      return ReactDOM.createPortal(h('div', { className: 'n2s-modal-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose() } },
        h('div', { ref: box, className: 'n2s-modal', role: 'dialog', 'aria-modal': true, 'aria-label': t('up.title'), style: { width: 'min(860px, 100%)' } },
          h('div', { className: 'n2s-row', style: { marginBottom: 12 } }, h('span', { className: 'n2s-modal-title' }, t('up.title')), h('span', { className: 'n2s-grow' }), h('button', { type: 'button', className: 'n2s-iconbtn', 'aria-label': t('ds.cancel'), onClick: onClose }, Icon.close())),
          !sheets && h('div', {
            className: `n2s-drop ${drag ? 'over' : ''}`, role: 'button', tabIndex: 0,
            onClick: () => inputRef.current?.click(), onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() },
            onDragOver: (e) => { e.preventDefault(); setDrag(true) }, onDragLeave: () => setDrag(false),
            onDrop: (e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]) },
          },
            h('div', { style: { fontSize: 15, fontWeight: 500 } }, state?.busy ? (progress > 0 && progress < 1 ? fmt(t, 'up.uploading', { p: Math.round(progress * 100) }) : t('up.parsing')) : t('up.drop')),
            state?.busy && h('div', { className: 'n2s-progress', role: 'progressbar', 'aria-valuenow': Math.round(progress * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, h('span', { style: { width: `${Math.max(4, progress * 100)}%` } })),
            h('div', { className: 'n2s-muted n2s-small', style: { marginTop: 4 } }, t('up.formats')),
            h('input', { ref: inputRef, type: 'file', accept: '.csv,.tsv,.txt,.xlsx', style: { display: 'none' }, onChange: e => pick(e.target.files?.[0]) })),
          sheets && h(React.Fragment, null,
            h('div', { className: 'n2s-form', style: { marginBottom: 12 } },
              h('label', { className: 'n2s-field' }, h('span', null, t('up.target')),
                h('select', { className: 'n2s-select', value: target, onChange: e => setTarget(e.target.value) }, h('option', { value: '' }, t('up.newSource')), fileDs.map(d => h('option', { key: d.id, value: d.id }, d.name)))),
              !target ? h('label', { className: 'n2s-field' }, h('span', null, t('up.newName')), h('input', { className: 'n2s-input', value: newName, onChange: e => setNewName(e.target.value) }))
                : h('div', { className: 'n2s-field' }, h('span', null, t('up.mode')), h('div', { className: 'n2s-seg' }, ['create', 'replace', 'append'].map(m => h('button', { key: m, type: 'button', 'aria-pressed': mode === m, onClick: () => setMode(m) }, t(`up.mode.${m}`)))))),
            sheets.map((sh, si) => h('div', { key: sh.sheet, className: 'n2s-card', style: { marginBottom: 10, padding: 12 } },
              h('div', { className: 'n2s-row', style: { marginBottom: 8 } },
                sheets.length > 1 && h('input', { type: 'checkbox', checked: sh.include, 'aria-label': sh.sheet, onChange: e => setSheets(x => x.map((y, i) => i === si ? { ...y, include: e.target.checked } : y)) }),
                h('span', { className: 'n2s-small n2s-muted' }, t('up.table')),
                h('input', { className: 'n2s-input', style: { width: 220, height: 30 }, value: sh.table, onChange: e => setSheets(x => x.map((y, i) => i === si ? { ...y, table: e.target.value } : y)) }),
                h('span', { className: 'n2s-faint n2s-small' }, fmt(t, 'up.rows', { rows: sh.rowCount.toLocaleString(), cols: sh.columns.length }), sh.encoding && sh.encoding !== 'utf-8' ? ` · ${sh.encoding}` : '', sh.truncated ? ` · ${t('up.truncated')}` : '')),
              h('div', { className: 'n2s-table-wrap', style: { maxHeight: 260 } }, h('table', { className: 'n2s-table' },
                h('thead', null,
                  h('tr', null, sh.columns.map((c, ci) => h('th', { key: ci }, c.name))),
                  h('tr', null, sh.columns.map((c, ci) => h('th', { key: ci, style: { top: 30, padding: '2px 8px' } }, h('select', { className: 'n2s-select', style: { height: 24, fontSize: 11, padding: '0 4px' }, value: c.type, 'aria-label': `${c.name} type`, onChange: e => setSheets(x => x.map((y, i) => i === si ? { ...y, columns: y.columns.map((cc, j) => j === ci ? { ...cc, type: e.target.value } : cc) } : y)) }, typeOpts.map(o => h('option', { key: o, value: o }, t(`up.type.${o}`)))))))),
                h('tbody', null, sh.preview.slice(0, 8).map((r, ri) => h('tr', { key: ri }, sh.columns.map((c, ci) => h('td', { key: ci, className: c.type === 'INTEGER' || c.type === 'REAL' ? 'num' : undefined }, r[ci] === null || r[ci] === undefined ? '' : String(r[ci]))))))))))),
          state?.error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, state.error),
          state?.done && h('div', { className: 'n2s-notice ok', style: { marginTop: 10 } }, fmt(t, 'up.done', { name: state.done.datasourceName }), ' ', joinClauses(state.done.results.map(r => r.ok ? fmt(t, 'up.resultOk', { table: r.table, rows: r.rows }) : `${colon(r.sheet)}${r.error}`))),
          h('div', { className: 'n2s-row', style: { marginTop: 14, justifyContent: 'flex-end' } },
            h('span', { className: 'n2s-faint n2s-small n2s-grow' }, t('up.privacy')),
            h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onClose }, state?.done ? t('ds.close') : t('ds.cancel')),
            sheets && !state?.done && h('button', { type: 'button', className: 'n2s-btn primary', disabled: state?.busy || !sheets.some(x => x.include) || (!target && !newName.trim()), onClick: run }, state?.busy ? h('span', { className: 'n2s-spin' }) : null, t('up.import'))))), document.body)
    }
    function FileTables({ t, ds }) {
      const list = useAsync(() => call('listFileTables', { datasourceId: ds.id }), [ds.id, ds.schemaAnalyzedAt], [ds.id])
      const tables = list.value ?? []
      if (!tables.length) return null
      return h('div', { className: 'n2s-chips', style: { marginTop: 6 } }, tables.map(tb => h('span', { key: tb.name, className: 'n2s-badge', title: `${tb.source ?? ''} · ${new Date(tb.updatedAt ?? tb.createdAt).toLocaleString()}` },
        `${tb.name} · ${formatCompact(tb.rows)}`,
        h('button', { type: 'button', className: 'n2s-iconbtn', style: { width: 16, height: 16 }, 'aria-label': `${t('ds.delete')} ${tb.name}`, onClick: async () => { if (await confirmDialog({ title: fmt(t, 'up.dropConfirm', { name: tb.name }), danger: true })) { try { await call('dropFileTable', { datasourceId: ds.id, table: tb.name }) } catch (e) { notifyError(e) } list.reload(); refreshDatasources() } } }, Icon.close(10)))))
    }

    function SourcesTab({ t, datasources }) {
      const [editing, setEditing] = useState(null)
      const [policyFor, setPolicyFor] = useState(null)
      const [tests, setTests] = useState({})
      const [upload, setUpload] = useState(null)
      if (policyFor) return h(PolicyEditor, { t, ds: policyFor, onDone: () => setPolicyFor(null), onCancel: () => setPolicyFor(null) })
      if (editing) return h(DatasourceForm, { t, initial: editing === 'new' ? null : editing, onDone: () => setEditing(null), onCancel: () => setEditing(null) })
      const test = async (ds) => {
        setTests(s => ({ ...s, [ds.id]: { busy: true, ok: true } }))
        const r = await call('testConnection', { id: ds.id }).catch(e => ({ ok: false, error: e.message }))
        setTests(s => ({ ...s, [ds.id]: r }))
        refreshDatasources()
      }
      return h('div', null,
        h(SectionHead, { title: t('tab.sources'), desc: t('ds.sectionDesc') },
          h('button', { type: 'button', className: 'n2s-btn', onClick: () => setUpload({}) }, Icon.up(13), t('up.button')),
          h('button', { type: 'button', className: 'n2s-btn primary', onClick: () => setEditing('new') }, '+ ', t('ds.add'))),
        upload && h(UploadDialog, { t, datasources, initialTarget: upload.target, onClose: () => setUpload(null) }),
        datasources.length === 0 && h('div', { className: 'n2s-empty' }, h('h3', null, t('ds.none')), h('div', null, t('ds.noneHint')), h('button', { type: 'button', className: 'n2s-btn primary', onClick: () => setEditing('new') }, t('ds.add'))),
        datasources.length > 0 && h('div', { className: 'n2s-list2' }, datasources.map(ds => {
          const tr = tests[ds.id]
          const policyOn = Boolean(ds.policy && (ds.policy.mode !== 'all' || ds.policy.hiddenColumns.length > 0 || ds.policy.maskedColumns.length > 0))
          const version = ds.serverVersion ? String(ds.serverVersion).replace(/^(PostgreSQL|Elasticsearch) /, '').split(' ')[0] : ''
          return h('div', { key: ds.id, className: 'n2s-list2-row' },
            h(TypeTile, { type: ds.type }),
            h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
              h('div', { className: 'n2s-row', style: { gap: 6 } },
                h('span', { className: 'n2s-list2-title' }, ds.name),
                ds.current && h('span', { className: 'n2s-badge' }, t('ds.current')),
                ds.needsSecret && h('button', { type: 'button', className: 'n2s-badge warn', style: { border: 0, cursor: 'pointer' }, title: t('ds.needsSecretHint'), onClick: () => setEditing(ds) }, t('ds.needsSecret')),
                policyOn && h('span', { className: 'n2s-badge warn', title: t(`policy.mode.${ds.policy.mode}`) }, t('policy.badge')),
                ds.privacy && Object.keys(ds.privacy).length > 0 && h('span', { className: 'n2s-badge' }, t('ds.privacyCustom')),
                ds.ssh?.enabled && h('span', { className: 'n2s-badge' }, 'SSH')),
              h('div', { className: 'n2s-list2-sub n2s-mono' }, ds.type === 'sqlite' ? t('up.localDesc') : `${ds.user ? `${ds.user}@` : ''}${ds.host}:${ds.port}/${ds.database}${ds.schemas ? ` (${ds.schemas})` : ''}`),
              ds.type === 'sqlite' && h(FileTables, { t, ds }),
              ds.description && h('div', { className: 'n2s-list2-sub' }, ds.description),
              tr && h('div', { className: `n2s-notice ${tr.busy ? '' : tr.ok ? 'ok' : 'err'}`, style: { marginTop: 8 }, role: 'status' },
                tr.busy ? t('ds.testing') : tr.ok ? fmt(t, 'ds.testOk', { version: tr.version, tables: tr.tableCount, latency: tr.latencyMs }) : fmt(t, 'ds.testFail', { error: tr.error }))),
            h('div', { className: 'n2s-list2-side' },
              h('span', { className: `n2s-statusdot ${ds.lastTestOk === false ? 'err' : ds.readOnlyGrant === false ? 'warn' : 'ok'}` }, ds.lastTestOk === false ? t('ds.statusFail') : ds.readOnlyGrant === false ? t('ds.statusWrite') : t('ds.statusOk')),
              h('span', { className: 'n2s-faint n2s-small' }, [typeLabel(t, ds.type), version].filter(Boolean).join(' '))),
            h('div', { className: 'n2s-row', style: { gap: 2, flexWrap: 'nowrap' } },
              h('button', { type: 'button', className: 'n2s-btn small', disabled: tr?.busy, onClick: () => test(ds) }, tr?.busy ? h('span', { className: 'n2s-spin' }) : null, t('ds.test')),
              h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
                !ds.current && { label: t('ds.setCurrent'), icon: Icon.check(14), onClick: async () => { try { await call('setCurrent', { id: ds.id }) } catch (e) { notifyError(e) } refreshDatasources() } },
                ds.type === 'sqlite' && { label: t('up.addFile'), icon: Icon.up(14), onClick: () => setUpload({ target: ds.id }) },
                ds.type !== 'sqlite' && { label: t('ds.edit'), icon: Icon.edit(14), onClick: () => setEditing(ds) },
                { label: t('policy.button'), icon: svg(14, [h('rect', { key: 1, x: 3.5, y: 7, width: 9, height: 6.5, rx: 1.4 }), h('path', { key: 2, d: 'M5.5 7V5a2.5 2.5 0 0 1 5 0v2' })]), onClick: () => setPolicyFor(ds) },
                { divider: true },
                { label: t('ds.delete'), icon: Icon.trash(14), danger: true, onClick: async () => { if (!await confirmDialog({ title: fmt(t, 'ds.deleteConfirm', { name: ds.name }), danger: true })) return; await call('deleteDatasource', { id: ds.id }).catch(e => notifyError(e)); refreshDatasources() } },
              ] })))
        })))
    }

    function DatasourcePicker({ t, datasources, value, onChange }) {
      return h('select', { className: 'n2s-select', style: { width: 'auto', minWidth: 200 }, value: value ?? '', onChange: (e) => onChange(e.target.value), 'aria-label': t('ds.select') },
        datasources.map(ds => h('option', { key: ds.id, value: ds.id }, `${ds.name} · ${typeLabel(t, ds.type)} · ${ds.database}`)))
    }

    function roleBadge(t, role) {
      const cls = role === 'fact' ? 'brand' : role === 'dimension' ? 'ok' : ''
      return h('span', { className: `n2s-badge ${cls}` }, t(`role.${role}`))
    }
    function SchemaTab({ t, ds, onAskTable }) {
      const [schema, setSchema] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [filter, setFilter] = useState('')
      const [selected, setSelected] = useState(null)
      const [preview, setPreview] = useState(null)
      const [mode, setMode] = useState('list')
      const currentDs = useRef(ds?.id)
      currentDs.current = ds?.id
      const analyze = useCallback(async (refresh) => {
        if (!ds) return
        const forId = ds.id
        setBusy(true); setError(null)
        try { const sc = await call('analyzeSchema', { id: forId, refresh }); if (currentDs.current === forId) setSchema(sc) } catch (e) { if (currentDs.current === forId) setError(e.message) }
        if (currentDs.current === forId) setBusy(false)
        refreshDatasources()
      }, [ds?.id])
      useEffect(() => { setSchema(null); setSelected(null); setPreview(null); if (ds?.schemaAnalyzedAt) analyze(false) }, [ds?.id])
      if (!ds) return null
      const tables = (schema?.tables ?? []).filter(tb => !filter || tb.name.toLowerCase().includes(filter.toLowerCase()) || tb.comment.toLowerCase().includes(filter.toLowerCase()) || tb.columns.some(c => c.name.toLowerCase().includes(filter.toLowerCase())))
      const table = schema?.tables.find(tb => tb.name === selected)
      const rels = table ? schema.relations.filter(r => r.from.table === table.name || r.to.table === table.name) : []
      const runPreview = async (sql, title) => {
        const forId = ds.id
        setPreview({ busy: true })
        try { const r = await call('runQuery', { sql, datasourceId: forId, title }); if (currentDs.current === forId) setPreview({ result: r }) } catch (e) { if (currentDs.current === forId) setPreview({ error: e.message }) }
      }
      const quoteTable = (name) => ds.type === 'mysql' ? `\`${name.replace(/`/g, '``')}\`` : ds.type === 'postgres' ? name.split('.').map(p => `"${p.replace(/"/g, '""')}"`).join('.') : `"${name.replace(/"/g, '""')}"`
      const runOverview = async (tb, pin) => {
        const forId = ds.id
        setPreview({ busy: true })
        try {
          const res = await call('tableOverview', { datasourceId: forId, table: tb.name, pin })
          if (currentDs.current === forId) setPreview({ overview: res.results, pinned: pin })
        } catch (e) { if (currentDs.current === forId) setPreview({ error: e.message }) }
      }
      // Default to the largest fact table so the detail pane is never blank.
      const defaultTable = schema ? ([...schema.tables].sort((x, y) => (y.role === 'fact') - (x.role === 'fact') || (y.rows ?? 0) - (x.rows ?? 0))[0]?.name ?? null) : null
      const current = selected ?? defaultTable
      const tbl = schema?.tables.find(tb => tb.name === current)
      const rels2 = tbl ? schema.relations.filter(r => r.from.table === tbl.name || r.to.table === tbl.name) : []
      const keyIcon = (c) => c.key === 'PRI' ? h('span', { className: 'n2s-colkey pk', title: 'PRIMARY KEY' }, 'PK') : c.key === 'UNI' ? h('span', { className: 'n2s-colkey', title: 'UNIQUE' }, 'UQ') : c.key === 'MUL' ? h('span', { className: 'n2s-colkey', title: 'INDEX' }, 'IX') : null
      return h('div', null,
        schema && extend.schemaPanels.map((C, k) => h(C, { key: `sp${k}`, t, ds, schema, selected })),
        h('div', { className: 'n2s-toolbar' },
          schema && h('span', { className: 'n2s-muted n2s-small' }, fmt(t, 'schema.tables', { count: schema.tables.length }), ' · ', fmt(t, 'schema.relations', { count: schema.relations.length }), ' · ', fmt(t, 'schema.analyzedAt', { time: new Date(schema.analyzedAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })),
          h('span', { className: 'n2s-grow' }),
          schema && h('div', { className: 'n2s-seg', role: 'group', 'aria-label': t('schema.mode') },
            h('button', { type: 'button', 'aria-pressed': mode === 'list', onClick: () => setMode('list') }, t('schema.modeList')),
            h('button', { type: 'button', 'aria-pressed': mode === 'er', onClick: () => setMode('er') }, t('schema.modeEr'))),
          h('button', { type: 'button', className: 'n2s-btn small', disabled: busy, onClick: () => analyze(true) }, busy ? h('span', { className: 'n2s-spin' }) : Icon.refresh(13), busy ? t('schema.analyzing') : schema ? t('schema.refresh') : t('schema.analyze'))),
        h(SchemaChanges, { t, ds }),
        schema && mode === 'er' && h(ErGraph, { t, schema, onPick: (name) => { setSelected(name); setMode('list'); setPreview(null) } }),
        error && h('div', { className: 'n2s-notice err', style: { marginBottom: 12 } }, error),
        !schema && busy && h('div', { className: 'n2s-split' }, h('div', { className: 'n2s-skel', style: { height: 360 } }), h('div', { className: 'n2s-skel', style: { height: 360 } })),
        !schema && !busy && h('div', { className: 'n2s-empty' }, h('h3', null, t('schema.notAnalyzed')), h('div', null, t('schema.notAnalyzedHint')), h('button', { type: 'button', className: 'n2s-btn primary', onClick: () => analyze(true) }, t('schema.analyze'))),
        schema && mode === 'list' && h('div', { className: 'n2s-split' },
          h('div', { className: 'n2s-sidepanel' },
            h('div', { className: 'n2s-search', style: { maxWidth: 'none', marginBottom: 6 } }, h('span', { className: 'n2s-ico' }, Icon.search()), h('input', { className: 'n2s-input', 'aria-label': t('schema.search'), placeholder: t('schema.search'), value: filter, onChange: e => setFilter(e.target.value) })),
            h('div', { className: 'n2s-list', role: 'listbox', 'aria-label': t('schema.tablesLabel') }, tables.map(tb => h('button', {
              key: tb.name, type: 'button', className: 'n2s-item', role: 'option', 'aria-selected': current === tb.name,
              onClick: () => { setSelected(tb.name); setPreview(null) }, title: tb.comment || tb.name,
              style: tb.blocked ? { opacity: 0.5 } : undefined,
            }, h('span', { className: `n2s-roledot ${tb.role}`, title: t(`role.${tb.role}`) }), h('span', { className: 'name' }, tb.name), tb.blocked ? h('span', { className: 'n2s-badge err' }, t('policy.blocked')) : h('span', { className: 'n2s-faint n2s-small' }, tb.rows === null ? '' : formatCompact(tb.rows))))),
            h('div', { className: 'n2s-legend' }, ['fact', 'dimension', 'log', 'config'].map(r => h('span', { key: r }, h('span', { className: `n2s-roledot ${r}` }), t(`role.${r}`))))),
          tbl && h('div', { className: 'n2s-detail' },
            h('div', { className: 'n2s-detail-head' },
              h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
                h('div', { className: 'n2s-row', style: { gap: 8 } }, h('span', { className: 'n2s-detail-title n2s-mono' }, tbl.name), roleBadge(t, tbl.role)),
                h('div', { className: 'n2s-list2-sub', style: { whiteSpace: 'normal' } }, [tbl.comment, tbl.rows !== null ? fmt(t, 'schema.rows', { rows: formatNumber(tbl.rows) }) : '', fmt(t, 'schema.colCount', { count: tbl.columns.length })].filter(Boolean).join(' · '))),
              h('button', { type: 'button', className: 'n2s-btn small', onClick: () => runPreview(`SELECT * FROM ${quoteTable(tbl.name)} LIMIT 50`, `${tbl.name} · ${t('schema.preview')}`) }, Icon.table(13), t('schema.preview')),
              h('button', { type: 'button', className: 'n2s-btn small', onClick: () => runOverview(tbl, false) }, Icon.chart(13), t('schema.overview')),
              h('button', { type: 'button', className: 'n2s-btn small primary', onClick: () => onAskTable(tbl) }, Icon.spark(13), t('schema.askAbout')),
              h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
                { label: t('schema.overviewPin'), icon: Icon.pin(14), onClick: async () => { if (await confirmDialog({ title: t('schema.overviewPinConfirm') })) runOverview(tbl, true) } },
                { label: t('schema.copyName'), icon: Icon.copy(14), onClick: () => navigator.clipboard?.writeText(tbl.name) },
              ] })),
            preview && h('div', { style: { marginBottom: 16 } },
              preview.busy && h('div', { className: 'n2s-skel', style: { height: 220 } }),
              preview.error && h('div', { className: 'n2s-notice err' }, preview.error),
              preview.result && h('div', { className: 'n2s-card' }, h(ResultView, { result: preview.result, t })),
              preview.overview && h(OverviewGrid, { t, results: preview.overview, pinned: preview.pinned })),
            h('div', { className: 'n2s-table-wrap', style: { maxHeight: 'none' } }, h('table', { className: 'n2s-table n2s-coltable' },
              h('thead', null, h('tr', null, [t('schema.th.name'), t('schema.th.type'), t('schema.th.meaning'), t('schema.th.values')].map((x, i) => h('th', { key: i }, x)))),
              h('tbody', null, tbl.columns.map(c => h('tr', { key: c.name, style: c.hidden ? { opacity: 0.55 } : undefined },
                h('td', null, h('div', { className: 'n2s-row', style: { gap: 6, flexWrap: 'nowrap' } },
                  h('span', { className: 'n2s-mono', style: { color: 'var(--dsw-alias-label-primary)', textDecoration: c.hidden ? 'line-through' : undefined } }, c.name), keyIcon(c),
                  c.hidden && h('span', { className: 'n2s-badge err' }, t('policy.hidden')), c.policyMasked && h('span', { className: 'n2s-badge warn' }, t('policy.masked')))),
                h('td', { className: 'n2s-mono n2s-muted' }, c.columnType),
                h('td', { style: { whiteSpace: 'normal', maxWidth: 360 } },
                  h('div', { className: 'n2s-row', style: { gap: 4 } }, c.roles.filter(r => r !== 'text').map(r => h('span', { key: r, className: `n2s-badge ${r === 'sensitive' ? 'warn' : r === 'measure' || r === 'time' ? 'blue' : ''}` }, t(`col.${r}`))), c.comment && h('span', { className: 'n2s-muted' }, c.comment))),
                h('td', { className: 'n2s-muted', title: (c.values ?? []).map(v => `${v.value}(${v.count})`).join(', ') }, (c.values ?? []).slice(0, 4).map(v => `${v.value}`).join(' · '))))))),
            (tbl.indexes.length > 0 || rels2.length > 0) && h('div', { className: 'n2s-detail-meta' },
              tbl.indexes.length > 0 && h('div', null, h('div', { className: 'n2s-h2' }, t('schema.indexes')),
                h('div', { style: { display: 'grid', gap: 4 } }, tbl.indexes.map(i => h('div', { key: i.name, className: 'n2s-mono n2s-small' }, h('span', { className: 'n2s-muted' }, i.unique ? 'UNIQUE ' : ''), i.name, h('span', { className: 'n2s-faint' }, ` (${i.columns.join(', ')})`))))),
              rels2.length > 0 && h('div', null, h('div', { className: 'n2s-h2' }, t('schema.relationsOf')),
                h('div', { style: { display: 'grid', gap: 4 } }, rels2.map((r, i) => {
                  const other = r.to.table === tbl.name ? r.from.table : r.to.table
                  return h('div', { key: i, className: 'n2s-row n2s-small', style: { gap: 6 } },
                    h('span', { className: 'n2s-mono n2s-muted' }, `${r.from.table === tbl.name ? '' : `${r.from.table}.`}${r.from.column}`), h('span', { className: 'n2s-faint' }, '→'),
                    h('button', { type: 'button', className: 'n2s-linkbtn n2s-mono', onClick: () => { setSelected(other); setPreview(null) } }, `${r.to.table}.${r.to.column}`),
                    h('span', { className: `n2s-badge ${r.kind === 'declared' ? 'ok' : ''}` }, r.kind === 'declared' ? 'FK' : fmt(t, 'schema.inferred', { p: Math.round(r.confidence * 100) })))
                })))))))
    }
    /**
     * First-run checklist: connect → analyze → ask, plus an optional push step.
     * Hidden once every required step is done or the user dismisses it.
     */
    function Onboarding({ t, ds, onNavigate, onAsk, examples }) {
      const st = useAsync(() => call('onboardingStatus').catch(() => null), [ds?.id, ds?.schemaAnalyzedAt], [])
      const [busy, setBusy] = useState(false)
      const v = st.value
      if (!v || v.dismissed) return null
      const steps = [
        { key: 'connect', done: v.hasDatasource, action: () => onNavigate({ tab: 'admin', section: 'sources' }) },
        { key: 'analyze', done: v.analyzed, action: async () => { if (!ds) return; setBusy(true); try { await call('analyzeSchema', { id: ds.id, refresh: true }); await refreshDatasources(); st.reload(); notify(t('ob.analyzed'), 'ok') } catch (e) { notifyError(e) } setBusy(false) } },
        { key: 'ask', done: v.askedQuestion, action: () => examples[0] && onAsk(examples[0]) },
      ]
      const required = steps.every(x => x.done)
      if (required && v.hasChannel) return null
      const current = steps.find(x => !x.done)
      const dismiss = async () => { try { await call('dismissOnboarding', { dismissed: true }); st.reload() } catch (e) { notifyError(e) } }
      return h('section', { className: 'n2s-onboard', 'aria-label': t('ob.title') },
        h('div', { className: 'n2s-row', style: { marginBottom: 12 } },
          h('div', { className: 'n2s-grow' }, h('div', { className: 'n2s-onboard-title' }, required ? t('ob.doneTitle') : t('ob.title')), h('div', { className: 'n2s-muted n2s-small' }, required ? t('ob.doneSub') : t('ob.sub'))),
          h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: dismiss }, t('ob.dismiss'))),
        !required && h('ol', { className: 'n2s-steps' }, steps.map((x, i) => h('li', { key: x.key, className: `n2s-step${x.done ? ' done' : ''}${current === x ? ' current' : ''}` },
          h('span', { className: 'num', 'aria-hidden': true }, x.done ? Icon.check(13) : i + 1),
          h('div', { className: 'n2s-grow' },
            h('div', { className: 'title' }, t(`ob.${x.key}`), x.done && h('span', { className: 'n2s-sr' }, ` (${t('ob.stepDone')})`)),
            h('div', { className: 'desc' }, t(`ob.${x.key}.desc`))),
          current === x && h('button', { type: 'button', className: 'n2s-btn small primary', disabled: busy || (x.key !== 'connect' && !ds), onClick: x.action }, busy && x.key === 'analyze' ? h('span', { className: 'n2s-spin' }) : null, t(`ob.${x.key}.cta`))))),
        !v.hasChannel && h('div', { className: 'n2s-onboard-extra' },
          h(PlatformMark, { t, platform: 'lark' }),
          h('div', { className: 'n2s-grow' }, h('div', { style: { fontWeight: 500, fontSize: 13.5 } }, t('ob.push')), h('div', { className: 'n2s-muted n2s-small' }, t('ob.push.desc'))),
          h('button', { type: 'button', className: 'n2s-btn small', onClick: () => onNavigate({ tab: 'admin', section: 'push' }) }, t('ob.push.cta'))))
    }

    function AskTab({ t, ds, datasources, onAsk, presetReady, onNavigate }) {
      const [question, setQuestion] = useState('')
      const [sql, setSql] = useState('')
      const [running, setRunning] = useState(false)
      const [result, setResult] = useState(null)
      const [plan, setPlan] = useState(null)
      const [error, setError] = useState(null)
      const [exOffset, setExOffset] = useState(0)
      const [recentLimit, setRecentLimit] = useState(8)
      const [hiddenRecent, setHiddenRecent] = useState(() => new Set())
      // Data source switched: reset paging and per-source results during render, so the
      // first request for the new source already uses offset 0 (no extra fetch).
      const [stateFor, setStateFor] = useState(ds?.id)
      if (stateFor !== ds?.id) {
        setStateFor(ds?.id)
        setExOffset(0); setRecentLimit(8); setHiddenRecent(new Set())
        setResult(null); setPlan(null); setError(null)
      }
      const pageOffset = stateFor === ds?.id ? exOffset : 0
      const pageRecent = stateFor === ds?.id ? recentLimit : 8
      // Scoped by data source + language: within one source the previous page stays on
      // screen while the next loads (no flicker on 换一批); another source's never does.
      const sugg = useAsync(() => (ds ? call('askSuggestions', { datasourceId: ds.id, locale: uiLang, offset: pageOffset, pageSize: 6, recentLimit: pageRecent }).catch(() => null) : null), [ds?.id, ds?.schemaAnalyzedAt, uiLang, pageOffset, pageRecent], [ds?.id, uiLang])
      useEffect(() => { if (sugg.value && !sugg.stale) setHiddenRecent(new Set()) }, [sugg.value])
      const data = sugg.value
      const examples = data?.examples?.length ? data.examples : [t('ask.ex.tables'), t('ask.ex.biggest')]
      const canShuffle = (data?.total ?? 0) > (data?.pageSize ?? 6)
      const recent = (data?.recent ?? []).filter(r => !hiddenRecent.has(r.question))
      const removeRecent = async (r) => {
        if (!await confirmDialog({ title: t('ask.deleteRecent'), message: fmt(t, 'ask.deleteRecentMsg', { q: r.question }), confirmLabel: t('ds.delete'), danger: true })) return
        setHiddenRecent(x => new Set(x).add(r.question))
        try { const res = await call('deleteHistory', { title: r.question, datasourceId: ds.id }); notify(fmt(t, 'ask.deletedN', { n: res.deleted }), 'ok') } catch (e) { notifyError(e); setHiddenRecent(x => { const n = new Set(x); n.delete(r.question); return n }) }
      }
      const currentDs = useRef(ds?.id)
      currentDs.current = ds?.id
      const run = async (confirmScan = false) => {
        const forId = ds.id
        setRunning(true); setError(null)
        try {
          const r = await call('runQuery', { sql, datasourceId: forId, title: '', confirmScan })
          if (currentDs.current === forId) setResult(r)
        } catch (e) {
          if (e.code === 'nl2sql/scan-guard' && currentDs.current === forId && await confirmDialog({ title: t('sql.confirmScan'), message: e.message })) { setRunning(false); return run(true) }
          if (currentDs.current === forId) setError(e.message)
        }
        setRunning(false)
      }
      const explain = async () => {
        const forId = ds.id
        setRunning(true); setError(null)
        try { const p = await call('explain', { sql, datasourceId: forId }); if (currentDs.current === forId) setPlan(p) } catch (e) { if (currentDs.current === forId) setError(e.message) }
        setRunning(false)
      }
      const submit = () => { if (question.trim()) { onAsk(question.trim()); setQuestion('') } }
      const [uploading, setUploading] = useState(false)
      const [sqlOpen, setSqlOpen] = useState(false)
      const tableCount = ds?.tableCount ?? data?.tableCount
      return h('div', null,
        h(Onboarding, { t, ds, onNavigate, onAsk, examples }),
        ...extend.askPanels.map((C, k) => h(C, { key: `ap${k}`, t, ds, onAsk, onNavigate })),
        h('div', { className: 'n2s-hero' },
          h('h2', null, t('ask.heroTitle')),
          h('p', null, ds ? (ds.schemaAnalyzedAt ? (tableCount ? fmt(t, 'ask.heroSub', { name: ds.name, tables: tableCount }) : fmt(t, 'ask.heroSubShort', { name: ds.name })) : fmt(t, 'ask.heroSubNoSchema', { name: ds.name })) : t('ask.hint'))),
        h('div', { className: 'n2s-askbox' },
          h('textarea', {
            'aria-label': t('ask.placeholder'), placeholder: t('ask.placeholder'), value: question, rows: 3, disabled: !ds,
            onChange: e => setQuestion(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } },
          }),
          h('div', { className: 'n2s-askbar' },
            h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => setUploading(true), title: t('up.askLink') }, Icon.up(13), h('span', { className: 'n2s-hide-narrow' }, t('up.short'))),
            h('span', { className: 'n2s-faint n2s-small n2s-grow n2s-hide-narrow', style: { textAlign: 'right' } }, h('kbd', { className: 'n2s-kbd' }, '↵'), ' ', t('ask.enterHint'), '  ', h('kbd', { className: 'n2s-kbd' }, '⇧ ↵'), ' ', t('ask.newline')),
            h('span', { className: 'n2s-grow n2s-show-narrow' }),
            h('button', { type: 'button', className: 'n2s-btn primary', disabled: !question.trim() || !presetReady || !ds, onClick: submit }, t('ask.start'), Icon.arrow(14)))),
        uploading && h(UploadDialog, { t, datasources, onClose: () => setUploading(false), onDone: async (res) => { await call('setCurrent', { id: res.datasourceId }).catch(() => {}); await refreshDatasources(); notify(t('up.askHint'), 'ok', 5000) } }),
        h('div', { className: 'n2s-sectlabel' }, t('ask.try'), h('span', { className: 'n2s-grow' }),
          canShuffle && h('button', { type: 'button', className: 'n2s-link n2s-small n2s-shuffle', disabled: sugg.loading, 'aria-label': t('ask.shuffle'), onClick: () => setExOffset(data?.nextOffset ?? 0) },
            h('span', { className: sugg.loading ? 'n2s-spinning' : undefined, 'aria-hidden': true }, Icon.refresh(12)), t('ask.shuffle'))),
        !data && sugg.loading ? h('div', { className: 'n2s-examples' }, [0, 1, 2, 3].map(i => h('div', { key: i, className: 'n2s-skel', style: { height: 44 } }))) :
          h('div', { className: 'n2s-examples' }, examples.map(q => h('button', { key: q, type: 'button', className: 'n2s-example', disabled: !ds, onClick: () => onAsk(q) }, h('span', { className: 'n2s-ico' }, Icon.spark(14)), h('span', null, q)))),
        recent.length > 0 && h(React.Fragment, null,
          h('div', { className: 'n2s-sectlabel' }, t('ask.recent'), h('span', { className: 'n2s-grow' }), h('button', { type: 'button', className: 'n2s-link n2s-small', onClick: () => onNavigate({ tab: 'history' }) }, t('ask.allHistory'))),
          h('div', { className: 'n2s-recent' }, recent.map((r, i) => h('div', { key: `${r.sessionId ?? ''}-${i}`, className: 'n2s-recent-row' },
            h('span', { className: `n2s-dot ${r.status === 'error' ? 'err' : r.status === 'blocked' ? 'warn' : ''}`, 'aria-hidden': true }),
            h('span', { className: 'n2s-grow n2s-ellipsis', title: r.question }, r.question),
            h('span', { className: 'n2s-faint n2s-small n2s-hide-narrow' }, relTime(t, r.at)),
            r.sessionId && h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => fbCtx.openSession?.(r.sessionId) }, t('ask.openSession')),
            h('button', { type: 'button', className: 'n2s-btn small ghost', disabled: !ds, onClick: () => onAsk(r.question) }, t('ask.askAgain')),
            h('button', { type: 'button', className: 'n2s-iconbtn n2s-recent-del', title: t('ask.deleteRecent'), 'aria-label': `${t('ask.deleteRecent')}: ${r.question}`, onClick: () => removeRecent(r) }, Icon.trash(13))))),
          data?.hasMoreRecent && h('button', { type: 'button', className: 'n2s-morebtn', disabled: sugg.loading, onClick: () => setRecentLimit(n => Math.min(50, n + 10)) }, sugg.loading ? h('span', { className: 'n2s-spin' }) : null, t('ask.moreRecent'))),
        h('div', { className: 'n2s-collapse' },
          h('button', { type: 'button', 'aria-expanded': sqlOpen, onClick: () => setSqlOpen(v => !v) }, Icon.code(14), t('ask.sql'), Icon.chev(11)),
          sqlOpen && h('div', null,
            h('div', { className: 'n2s-sqlbox' },
              h('textarea', { 'aria-label': t('ask.sql'), value: sql, onChange: e => setSql(e.target.value), placeholder: 'SELECT …', spellCheck: false, onKeyDown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && sql.trim()) run() } }),
              h('div', { className: 'n2s-sqlbar' },
                h('span', { className: 'n2s-faint n2s-small n2s-grow' }, h('kbd', { className: 'n2s-kbd' }, '⌘'), ' ', h('kbd', { className: 'n2s-kbd' }, '↵'), ' ', t('ask.run'), ' · ', t('ask.readonly')),
                h('button', { type: 'button', className: 'n2s-btn small', disabled: !sql.trim() || running || !ds, onClick: explain }, t('sql.explain')),
                h('button', { type: 'button', className: 'n2s-btn small primary', disabled: !sql.trim() || running || !ds, onClick: () => run(false) }, running ? h('span', { className: 'n2s-spin' }) : null, t('ask.run')))),
            error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error),
            plan && h('div', { className: 'n2s-card', style: { marginTop: 12 } },
              h('div', { className: 'n2s-row', style: { marginBottom: 10 } }, h('span', { className: 'n2s-h2', style: { margin: 0 } }, t('sql.plan')), h('span', { className: 'n2s-grow' }), h('button', { type: 'button', className: 'n2s-iconbtn', 'aria-label': t('ds.close'), onClick: () => setPlan(null) }, Icon.close())),
              h(PlanTable, { plan: plan.plan, t })),
            result && h('div', { className: 'n2s-card', style: { marginTop: 12 } }, h(ResultView, { result, t, hideSql: true })))))
    }

    /** "3 分钟前" style relative time in the UI language; future or older than a week → the date. */
    function relTime(t, at) {
      if (!at) return ''
      const d = (Date.now() - at) / 1000
      if (d < -60) return new Date(at).toLocaleDateString(uiLocale())
      if (d < 60) return t('time.justNow')
      if (d < 3600) return fmt(t, 'time.minAgo', { n: Math.floor(d / 60) })
      if (d < 86400) return fmt(t, 'time.hourAgo', { n: Math.floor(d / 3600) })
      if (d < 86400 * 7) return fmt(t, 'time.dayAgo', { n: Math.floor(d / 86400) })
      return new Date(at).toLocaleDateString(uiLocale())
    }

    function PlanTable({ plan }) {
      if (!plan?.length) return null
      const cols = Object.keys(plan[0])
      return h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table' },
        h('thead', null, h('tr', null, cols.map(c => h('th', { key: c }, c)))),
        h('tbody', null, plan.map((r, i) => h('tr', { key: i }, cols.map(c => {
          const v = r[c]
          const warn = c === 'type' && String(v).toUpperCase() === 'ALL'
          return h('td', { key: c, className: v === null ? 'null' : undefined, style: warn ? { color: 'var(--dsw-alias-state-warn-primary)', fontWeight: 600 } : undefined }, v === null ? 'NULL' : String(v))
        }))))))
    }
    /** ER graph rendered with ECharts' force layout. */
    function ErGraph({ t, schema, onPick }) {
      const ref = useRef(null)
      const [error, setError] = useState(null)
      const [onlyLinked, setOnlyLinked] = useState(true)
      const [showInferred, setShowInferred] = useState(true)
      useEffect(() => {
        let chart
        let disposed = false
        let observer
        loadEcharts().then((echarts) => {
          if (disposed || !ref.current) return
          chart = initChart(echarts, ref.current)
          observer = new ResizeObserver(() => chart?.resize())
          observer.observe(ref.current)
          const el = ref.current
          const relations = schema.relations.filter(r => showInferred || r.kind === 'declared').filter(r => r.from.table !== r.to.table)
          const linked = new Set(relations.flatMap(r => [r.from.table, r.to.table]))
          const tables = schema.tables.filter(tb => !onlyLinked || linked.has(tb.name))
          const roleColor = { fact: cssVar(el, '--dsw-alias-brand-primary', '#4d6bfe'), dimension: '#22b07d', log: '#f5a623', config: '#8b5cf6', view: '#14b8c4', other: '#7c8a9a' }
          const degree = new Map()
          for (const r of relations) for (const n of [r.from.table, r.to.table]) degree.set(n, (degree.get(n) ?? 0) + 1)
          const roles = ['fact', 'dimension', 'log', 'config', 'view', 'other']
          chart.setOption({
            backgroundColor: 'transparent',
            tooltip: {
              confine: true,
              // ECharts renders tooltip strings as HTML: escape database-provided names and comments.
              formatter: (p) => p.dataType === 'edge'
                ? escapeHtml(p.data.label)
                : `<b>${escapeHtml(p.data.name)}</b><br/>${escapeHtml(t(`role.${p.data.role}`))} · ${escapeHtml(p.data.rows ?? '?')} rows<br/>${escapeHtml(p.data.comment ?? '')}`,
            },
            legend: [{ data: roles.map(r => t(`role.${r}`)), textStyle: { color: cssVar(el, '--dsw-alias-label-secondary', '#888') }, top: 0 }],
            series: [{
              type: 'graph',
              layout: 'force',
              roam: true,
              draggable: true,
              categories: roles.map(r => ({ name: t(`role.${r}`), itemStyle: { color: roleColor[r] } })),
              force: { repulsion: 260, edgeLength: [80, 180], gravity: 0.08 },
              label: { show: true, position: 'right', color: cssVar(el, '--dsw-alias-label-primary', '#222'), fontSize: 11 },
              edgeSymbol: ['none', 'arrow'],
              edgeSymbolSize: 7,
              lineStyle: { color: cssVar(el, '--dsw-alias-label-secondary', '#888'), opacity: 0.6, curveness: 0.12 },
              emphasis: { focus: 'adjacency', lineStyle: { width: 2 } },
              data: tables.map(tb => ({
                id: tb.name, name: tb.name, role: tb.role, rows: tb.rows, comment: tb.comment,
                category: roles.indexOf(tb.role),
                symbolSize: 10 + Math.min(26, Math.log10((tb.rows ?? 0) + 10) * 4 + (degree.get(tb.name) ?? 0) * 2),
              })),
              links: relations.filter(r => tables.some(x => x.name === r.from.table) && tables.some(x => x.name === r.to.table)).map(r => ({
                source: r.from.table, target: r.to.table,
                label: `${r.from.table}.${r.from.column} → ${r.to.table}.${r.to.column} (${r.kind === 'declared' ? 'FK' : `~${Math.round(r.confidence * 100)}%`})`,
                lineStyle: r.kind === 'declared' ? { type: 'solid' } : { type: 'dashed' },
              })),
            }],
          }, true)
          chart.on('dblclick', (p) => { if (p.dataType === 'node') onPick(p.data.name) })
        }, (e) => setError(e.message))
        return () => { disposed = true; observer?.disconnect(); chart?.dispose() }
      }, [schema, onlyLinked, showInferred])
      return h('div', { className: 'n2s-card' },
        h('div', { className: 'n2s-row', style: { marginBottom: 8 } },
          h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: onlyLinked, onChange: e => setOnlyLinked(e.target.checked) }), t('er.onlyLinked')),
          h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: showInferred, onChange: e => setShowInferred(e.target.checked) }), t('er.inferred')),
          h('span', { className: 'n2s-grow' }),
          h('span', { className: 'n2s-muted n2s-small' }, t('er.hint'))),
        error && h('div', { className: 'n2s-notice err' }, error),
        h('div', { ref, style: { width: '100%', height: '62vh', minHeight: 420 } }))
    }
    function KnowledgeEditor({ kind, item, t, fields, schema, noteKeys, onCancel, onSave }) {
      const [form, setForm] = useState(() => ({ ...item, ...(Array.isArray(item?.synonyms) ? { synonyms: item.synonyms.join('，') } : {}) }))
      const [busy, runBusy] = useBusy()
      return h('div', { className: 'n2s-card', style: { marginBottom: 12 } },
        h('div', { className: 'n2s-form' }, fields.map(([key, label, type]) => h('label', { key, className: `n2s-field ${type === 'textarea' || type?.startsWith('code') ? 'full' : ''}` },
          h('span', null, t(label)),
          type === 'textarea' || type?.startsWith('code')
            ? h('textarea', { className: `n2s-textarea ${type?.startsWith('code') ? 'n2s-mono' : ''}`, style: type === 'codeLarge' ? { minHeight: 140 } : undefined, value: form[key] ?? '', spellCheck: type?.startsWith('code') ? false : undefined, onChange: e => setForm(f => ({ ...f, [key]: e.target.value })) })
            : h('input', { className: 'n2s-input', value: form[key] ?? '', list: type === 'table' ? 'n2s-tables' : type === 'noteKey' ? 'n2s-notekeys' : undefined, readOnly: kind === 'note' && key === 'key' && Boolean(item?.key) && Boolean(item?.text), onChange: e => setForm(f => ({ ...f, [key]: e.target.value })) })))),
        h('datalist', { id: 'n2s-tables' }, (schema?.tables ?? []).map(tb => h('option', { key: tb.name, value: tb.name }))),
        h('datalist', { id: 'n2s-notekeys' }, noteKeys.slice(0, 2000).map(k2 => h('option', { key: k2, value: k2 }))),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: () => runBusy(() => onSave(form)) }, busy ? h('span', { className: 'n2s-spin' }) : null, t('ds.save'))))
    }

    function KnowledgeTab({ t, ds }) {
      const kb = useAsync(() => (ds ? call('getKnowledge', { datasourceId: ds.id }) : null), [ds?.id])
      const schema = useAsync(() => (ds?.schemaAnalyzedAt ? call('analyzeSchema', { id: ds.id }) : null), [ds?.id, ds?.schemaAnalyzedAt], [ds?.id])
      const [section, setSection] = useState('glossary')
      const [editing, setEditing] = useState(null)
      const [error, setError] = useState(null)
      const [drafts, setDrafts] = useState(null)
      const noteKeys = useMemo(() => (schema.value?.tables ?? []).flatMap(tb => [tb.name, ...tb.columns.map(c => `${tb.name}.${c.name}`)]), [schema.value])
      const allDatasources = useStore(s2 => s2.datasources)
      const sgCount = useAsync(() => (ds ? call('suggestionCount', { datasourceId: ds.id }) : null), [ds?.id, kb.value], [ds?.id])
      if (!ds) return null
      const k = kb.value ?? { glossary: [], metrics: [], notes: {}, examples: [] }
      const save = async (kind, item) => {
        setError(null)
        try { await call('saveKnowledgeItem', { datasourceId: ds.id, kind, item }); setEditing(null); kb.reload() } catch (e) { setError(e.message) }
      }
      const remove = async (kind, id) => {
        if (!await confirmDialog({ title: t('kb.deleteConfirm'), danger: true })) return
        try { await call('deleteKnowledgeItem', { datasourceId: ds.id, kind, id }) } catch (e) { setError(e.message) }
        kb.reload()
      }
      const FIELDS = {
        glossary: [['term', 'kb.term'], ['synonyms', 'kb.synonyms'], ['definition', 'kb.definition', 'textarea'], ['sql', 'kb.sqlHint', 'code']],
        metric: [['name', 'kb.metricName'], ['unit', 'kb.unit'], ['expression', 'kb.expression', 'code'], ['table', 'kb.table', 'table'], ['timeColumn', 'kb.timeColumn'], ['filter', 'kb.filter', 'code'], ['dimensions', 'kb.dimensions'], ['synonyms', 'kb.synonyms'], ['description', 'kb.description', 'textarea']],
        example: [['question', 'kb.question'], ['sql', 'kb.sql', 'codeLarge'], ['note', 'kb.note', 'textarea']],
        note: [['key', 'kb.noteKey', 'noteKey'], ['text', 'kb.noteText', 'textarea']],
      }
      function renderEditor({ kind, item }) {
        return h(KnowledgeEditor, { key: JSON.stringify(item?.id ?? item?.key ?? 'new'), kind, item, t, fields: FIELDS[kind], schema: schema.value, noteKeys, onCancel: () => setEditing(null), onSave: (form) => save(kind, form) })
      }
      const sections = [['glossary', 'kb.glossary', k.glossary.length], ['metric', 'kb.metrics', k.metrics.length], ['note', 'kb.notes', Object.keys(k.notes).length], ['example', 'kb.examples', k.examples.length], ['suggest', 'sg.section', sgCount.value?.count ?? 0], ['eval', 'ev.section', null], ['feedback', 'fb.section', null]]
      const empty = (text) => h('div', { className: 'n2s-empty' }, h('div', null, text), h('button', { type: 'button', className: 'n2s-btn primary', onClick: () => setEditing({ kind: section, item: section === 'note' ? { key: '', text: '' } : {} }) }, t('kb.add')))
      const item = (key, title, sub, kind, data, extra) => h('div', { key, className: 'n2s-list2-row n2s-kbrow', style: { alignItems: 'flex-start' } },
        h('div', { className: 'n2s-grow', style: { minWidth: 0 } }, h('div', { className: 'n2s-list2-title', style: { whiteSpace: 'normal' } }, title), h('div', { className: 'n2s-kbsub' }, sub)),
        extra,
        h('div', { className: 'n2s-row n2s-kbactions', style: { gap: 2, flexWrap: 'nowrap' } },
          h('button', { type: 'button', className: 'n2s-iconbtn', title: t('ds.edit'), 'aria-label': t('ds.edit'), onClick: () => setEditing({ kind, item: data }) }, Icon.edit(14)),
          h('button', { type: 'button', className: 'n2s-iconbtn danger', title: t('ds.delete'), 'aria-label': t('ds.delete'), onClick: () => remove(kind, kind === 'note' ? data.key : data.id) }, Icon.trash(14))))
      const listWrap = (rows) => Array.isArray(rows) ? h('div', { className: 'n2s-list2' }, rows) : rows
      let list
      if (section === 'glossary') list = k.glossary.length ? k.glossary.map(g => item(g.id, h(React.Fragment, null, g.term, g.synonyms?.length ? h('span', { className: 'n2s-muted n2s-small' }, `  ${g.synonyms.join(' / ')}`) : null),
        h('div', null, h('div', null, g.definition), g.sql && h('code', { className: 'n2s-md-code', style: { display: 'inline-block', marginTop: 6 } }, g.sql)), 'glossary', g)) : empty(t('kb.glossaryEmpty'))
      if (section === 'metric') list = k.metrics.length ? k.metrics.map(m => item(m.id, h(React.Fragment, null, m.name, m.unit ? h('span', { className: 'n2s-badge', style: { marginLeft: 6 } }, m.unit) : null),
        h('div', null, h('div', { className: 'n2s-mono n2s-small' }, `${m.expression}${m.table ? ` FROM ${m.table}` : ''}${m.filter ? ` WHERE ${m.filter}` : ''}`), m.timeColumn && h('div', { className: 'n2s-muted n2s-small' }, `${t('kb.timeColumn')}: ${m.timeColumn}${m.dimensions?.length ? ` · ${t('kb.dimensions')}: ${joinList(m.dimensions)}` : ''}${m.synonyms?.length ? ` · ${t('kb.synonymsLabel')}: ${joinList(m.synonyms)}` : ''}`), m.description && h('div', { className: 'n2s-muted n2s-small' }, m.description)), 'metric', m)) : empty(t('kb.metricsEmpty'))
      if (section === 'note') {
        const entries = Object.entries(k.notes).sort(([a], [b]) => a.localeCompare(b))
        list = h(React.Fragment, null,
          h('div', { className: 'n2s-row', style: { marginBottom: 8 } }, h('span', { className: 'n2s-muted n2s-small n2s-grow' }, t('kb.notesHint')),
            h('button', { type: 'button', className: 'n2s-btn small', onClick: async () => setDrafts(await call('draftNotes', { datasourceId: ds.id }).catch(e => { setError(e.message); return [] })) }, t('kb.draft'))),
          drafts && h('div', { className: 'n2s-card', style: { marginBottom: 10 } },
            h('div', { className: 'n2s-row', style: { marginBottom: 6 } }, h('span', { style: { fontWeight: 500 } }, fmt(t, 'kb.drafts', { count: drafts.length })), h('span', { className: 'n2s-grow' }), h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => setDrafts(null) }, '×')),
            drafts.length === 0 ? h('div', { className: 'n2s-muted n2s-small' }, t('kb.noDrafts')) :
              drafts.map(d => h('div', { key: d.key, className: 'n2s-row', style: { padding: '4px 0' } }, h('span', { className: 'n2s-mono n2s-small', style: { minWidth: 220 } }, d.key), h('span', { className: 'n2s-muted n2s-small n2s-grow' }, d.text),
                h('button', { type: 'button', className: 'n2s-btn small', onClick: () => { setDrafts(x => x.filter(y => y.key !== d.key)); setEditing({ kind: 'note', item: d }) } }, t('ds.edit'))))),
          entries.length ? listWrap(entries.map(([key, text]) => item(key, h('span', { className: 'n2s-mono' }, key), h('div', null, text), 'note', { key, text }))) : empty(t('kb.notesEmpty')))
      }
      if (section === 'example') list = k.examples.length ? [...k.examples].reverse().map(e => item(e.id, e.question, h('pre', { className: 'n2s-code', style: { marginTop: 8, maxHeight: 160 } }, prettySql(e.sql)), 'example', e)) : empty(t('kb.examplesEmpty'))
      return h('div', null,
        h(SectionHead, { title: t('tab.knowledge'), desc: t('kb.hint') },
          h(KnowledgeIO, { t, ds, datasources: allDatasources, onImported: () => kb.reload() }),
          section !== 'feedback' && section !== 'eval' && section !== 'suggest' && h('button', { type: 'button', className: 'n2s-btn primary', onClick: () => setEditing({ kind: section, item: section === 'note' ? { key: '', text: '' } : {} }) }, '+ ', t('kb.add'))),
        h('div', { className: 'n2s-subtabs', role: 'tablist' }, sections.map(([key, label, count]) => h('button', { key, type: 'button', role: 'tab', 'aria-selected': section === key, onClick: () => { setSection(key); setEditing(null) } }, t(label), count === null ? null : h('span', { className: 'count' }, count)))),
        error && h('div', { className: 'n2s-notice err', style: { marginBottom: 10 } }, error),
        editing && h('div', { style: { marginBottom: 12 } }, renderEditor(editing)),
        section === 'suggest' ? h(SuggestionsSection, { t, ds, fields: FIELDS, schema: schema.value, noteKeys, onChanged: () => kb.reload() }) : section === 'feedback' ? h(FeedbackSection, { t, ds }) : section === 'eval' ? h(EvalSection, { t, ds }) : listWrap(list))
    }
    function HistoryTab({ t, datasources, onOpenSession }) {
      const [filters, setFilters] = useState({ status: '', source: '', datasourceId: '', search: '' })
      const list = useAsync(() => call('listHistory', { ...filters, limit: 300 }), [filters.status, filters.source, filters.datasourceId, filters.search], [])
      const [open, setOpen] = useState(null)
      const [rerun, setRerun] = useState(null)
      const [removed, setRemoved] = useState(() => new Set())
      useEffect(() => { setRemoved(new Set()) }, [list.value])
      const set = (k) => (e) => setFilters(f => ({ ...f, [k]: e.target.value }))
      const rows = (list.value ?? []).filter(r => !removed.has(r.id))
      const removeRow = async (r) => {
        if (!await confirmDialog({ title: t('hist.deleteOne'), message: r.title || oneLine(r.sql).slice(0, 120), confirmLabel: t('ds.delete'), danger: true })) return
        setRemoved(x => new Set(x).add(r.id))
        if (open === r.id) setOpen(null)
        try { await call('deleteHistory', { id: r.id }); notify(t('hist.deleted'), 'ok') } catch (e) { notifyError(e); setRemoved(x => { const n = new Set(x); n.delete(r.id); return n }) }
      }
      const statusBadge = (s) => h('span', { className: `n2s-badge ${s === 'error' ? 'err' : s === 'blocked' ? 'warn' : 'ok'}` }, t(`hist.status.${s ?? 'ok'}`))
      const exportCsv = () => {
        const cols = ['time', 'datasource', 'source', 'status', 'title', 'rows', 'elapsedMs', 'sessionId', 'sql', 'error']
        const esc = (v) => { const x = v === undefined || v === null ? '' : String(v); return /[",\n\r]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x }
        const text = '\ufeff' + [cols.join(','), ...rows.map(r => [new Date(r.at).toISOString(), r.datasourceName ?? r.datasourceId, r.source, r.status ?? 'ok', r.title, r.rows, r.elapsedMs, r.sessionId, r.sql, r.error].map(esc).join(','))].join('\r\n')
        download(`nl2sql-audit-${new Date().toISOString().slice(0, 10)}.csv`, new Blob([text], { type: 'text/csv;charset=utf-8' }))
      }
      const stats = useMemo(() => {
        const ok = rows.filter(r => (r.status ?? 'ok') === 'ok')
        return { total: rows.length, errors: rows.filter(r => r.status === 'error').length, blocked: rows.filter(r => r.status === 'blocked').length, avg: ok.length ? Math.round(ok.reduce((a, r) => a + (r.elapsedMs ?? 0), 0) / ok.length) : 0 }
      }, [rows])
      const [search, setSearch] = useState('')
      useEffect(() => { const id = setTimeout(() => setFilters(f => (f.search === search ? f : { ...f, search })), 250); return () => clearTimeout(id) }, [search])
      const rel = (at) => relTime(t, at)
      const statusDot = (st) => h('span', { className: `n2s-statusdot ${st === 'error' ? 'err' : st === 'blocked' ? 'warn' : 'ok'}` }, t(`hist.status.${st ?? 'ok'}`))
      const oneLine = (sql) => sql.replace(/\s+/g, ' ').trim()
      return h('div', null,
        h('div', { className: 'n2s-stats' },
          [['hist.total', stats.total], ['hist.errors', stats.errors], ['hist.blocked', stats.blocked], ['hist.avg', `${stats.avg} ms`]].map(([k2, v]) => h('div', { key: k2, className: 'n2s-stat' }, h('div', { className: 'v' }, v), h('div', { className: 'k' }, t(k2))))),
        h('div', { className: 'n2s-toolbar' },
          h('div', { className: 'n2s-search' }, h('span', { className: 'n2s-ico' }, Icon.search()), h('input', { className: 'n2s-input', 'aria-label': t('hist.search'), placeholder: t('hist.search'), value: search, onChange: e => setSearch(e.target.value) })),
          h('select', { className: 'n2s-select inline', 'aria-label': t('hist.allSources'), value: filters.datasourceId, onChange: set('datasourceId') }, h('option', { value: '' }, t('hist.allSources')), datasources.map(d => h('option', { key: d.id, value: d.id }, d.name))),
          h('div', { className: 'n2s-seg', role: 'group', 'aria-label': t('hist.allStatus') }, ['', 'ok', 'error', 'blocked'].map(v => h('button', { key: v || 'all', type: 'button', 'aria-pressed': filters.status === v, onClick: () => setFilters(f => ({ ...f, status: v })) }, v ? t(`hist.status.${v}`) : t('hist.all')))),
          h('select', { className: 'n2s-select inline', 'aria-label': t('hist.allSource'), value: filters.source, onChange: set('source') }, ['', 'agent', 'ui', 'dashboard', 'alert', 'eval'].map(v => h('option', { key: v, value: v }, v ? t(`hist.source.${v}`) : t('hist.allSource')))),
          h('span', { className: 'n2s-grow' }),
          h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
            { label: t('hist.export'), icon: Icon.download(14), disabled: rows.length === 0, onClick: exportCsv },
            { divider: true },
            { label: t('hist.clear'), icon: Icon.trash(14), danger: true, onClick: async () => { if (await confirmDialog({ title: t('hist.clearConfirm'), danger: true })) { try { await call('clearHistory') } catch (e) { notifyError(e) } list.reload() } } },
          ] })),
        list.error && h('div', { className: 'n2s-notice err' }, list.error.message),
        list.loading && !list.value && h('div', { className: 'n2s-skel', style: { height: 240 } }),
        !list.loading && rows.length === 0 && h('div', { className: 'n2s-empty' }, h('h3', null, t('hist.empty')), h('div', null, t('hist.emptyHint'))),
        rows.length > 0 && h('div', { className: 'n2s-hist', role: 'list' }, rows.map(r => {
          const isOpen = open === r.id
          return h('div', { key: r.id ?? `${r.at}`, className: 'n2s-hist-row', role: 'listitem' },
            h('div', { className: 'n2s-hist-head' },
            h('button', { type: 'button', className: 'n2s-hist-main', 'aria-expanded': isOpen, onClick: () => setOpen(isOpen ? null : r.id) },
              statusDot(r.status),
              h('span', { className: 'n2s-hist-what' },
                h('span', { className: `n2s-hist-title ${r.title ? '' : 'none'}` }, r.title || r.error?.slice(0, 80) || t('hist.untitled')),
                h('span', { className: 'n2s-hist-sql', title: oneLine(r.sql).slice(0, 400) }, oneLine(r.sql).slice(0, 300))),
              h('span', { className: 'n2s-hist-when' }, h('span', { title: new Date(r.at).toLocaleString(uiLocale()) }, rel(r.at)), h('span', { className: 'src' }, `${sourceLabel(t, r.source)} · ${r.datasourceName ?? ''}`)),
              h('span', { className: 'n2s-hist-num' }, r.rows !== undefined ? fmt(t, 'result.rows', { count: r.rows }) : '—', h('br'), r.elapsedMs !== undefined ? `${r.elapsedMs} ms` : ''),
              h('span', { className: 'n2s-hist-chev' }, Icon.chev(12))),
            h('button', { type: 'button', className: 'n2s-iconbtn n2s-rowdel', title: t('hist.deleteOne'), 'aria-label': `${t('hist.deleteOne')}: ${r.title || t('hist.untitled')}`, onClick: () => removeRow(r) }, Icon.trash(14))),
            isOpen && h('div', { className: 'n2s-hist-detail' },
              r.error && h('div', { className: `n2s-notice ${r.status === 'blocked' ? 'warn' : 'err'}` }, r.error),
              h('div', { style: { position: 'relative' } },
                h('pre', { className: 'n2s-code', style: { maxHeight: 220, paddingRight: 44 } }, prettySql(r.sql)),
                h('button', { type: 'button', className: 'n2s-iconbtn', style: { position: 'absolute', top: 6, right: 6 }, title: t('result.copy'), 'aria-label': t('result.copy'), onClick: () => navigator.clipboard?.writeText(r.sql) }, Icon.copy(14))),
              h('div', { className: 'n2s-row' },
                h('span', { className: 'n2s-faint n2s-small n2s-grow' }, new Date(r.at).toLocaleString(uiLocale())),
                r.sessionId && h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => onOpenSession(r.sessionId) }, Icon.external(13), t('hist.openSession')),
                h('button', {
                  type: 'button', className: 'n2s-btn small',
                  onClick: async () => {
                    setRerun({ id: r.id, busy: true })
                    try { setRerun({ id: r.id, result: await call('runQuery', { sql: r.sql, datasourceId: r.datasourceId, title: r.title, confirmScan: r.status !== 'blocked' }) }) } catch (e) { setRerun({ id: r.id, error: e.message }) }
                  },
                }, Icon.refresh(13), t('result.rerun')),
                h('button', { type: 'button', className: 'n2s-btn small ghost danger-text', onClick: () => removeRow(r) }, Icon.trash(13), t('ds.delete'))),
              rerun?.id === r.id && (rerun.busy ? h('div', { className: 'n2s-skel', style: { height: 200 } }) : rerun.error ? h('div', { className: 'n2s-notice err' }, rerun.error) : h('div', { className: 'n2s-card' }, h(ResultView, { result: rerun.result, t, hideSql: true })))))
        })))
    }

    const HIST_SOURCES = ['agent', 'ui', 'dashboard', 'alert', 'eval', 'larkbot', 'telegrambot', 'wecombot', 'dingtalkbot']
    /** Label of a history `source`; unknown sources (a new bot platform…) fall back to a generic label. */
    function sourceLabel(t, source) {
      if (!source) return t('hist.source.unknown')
      if (HIST_SOURCES.includes(source)) return t(`hist.source.${source}`)
      const bot = /^(.+)bot$/.exec(source)
      return bot ? fmt(t, 'hist.source.genericBot', { platform: bot[1] }) : source
    }
    function OverviewGrid({ t, results, pinned }) {
      const [sending, setSending] = useState(false)
      const ok = results.filter(r => !r.error && r.resultId)
      return h('div', null,
        pinned && h('div', { className: 'n2s-notice ok', style: { marginBottom: 10 } }, t('schema.overviewPinned')),
        ok.length > 1 && h('div', { className: 'n2s-row', style: { marginBottom: 8 } }, h('span', { className: 'n2s-grow' }), h('button', { type: 'button', className: 'n2s-btn small', onClick: () => setSending(true) }, t('im.shareAll'))),
        sending && h(SendDialog, { t, initial: { title: `${ok[0].title.split(' · ')[0]} · ${t('ov.suffix')}`, resultIds: ok.map(r => r.resultId) }, onClose: () => setSending(false) }),
        h('div', { className: 'n2s-dash' }, results.map((r, i) => h('div', { key: i, className: 'n2s-card', style: r.error || r.chart?.type === 'kpi' || /趋势|trend/i.test(r.title) ? { gridColumn: '1 / -1' } : undefined },
          r.error
            ? h(React.Fragment, null, h('div', { style: { fontWeight: 500, marginBottom: 6 } }, r.title), h('div', { className: 'n2s-notice err' }, r.error), h('pre', { className: 'n2s-code', style: { marginTop: 6 } }, r.sql))
            : h(ResultView, { result: r, t, compact: true })))))
    }

    const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

    function ReportChannelField({ t, value, onChange }) {
      return h('div', { className: 'n2s-field full' }, h('label', { htmlFor: 'n2s-rep-channel', className: 'n2s-flabel' }, t('rep.push')),
        h(ChannelPicker, { t, id: 'n2s-rep-channel', value, onChange, noneLabel: t('rep.pushNone') }))
    }

    function ReportForm({ t, datasources, initial, defaultDatasourceId, onDone, onCancel }) {
      const [form, setForm] = useState(() => ({ title: '', datasourceId: defaultDatasourceId, scope: 'question', question: '', instructions: '', period: 'daily', time: '09:00', weekdays: [1], target: 'new_once', ...(initial ?? {}), ...(initial?.time ? { time: initial.time.slice(0, 5) } : {}) }))
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
      const save = async () => {
        setBusy(true); setError(null)
        try { await call('saveReport', form); onDone() } catch (e) { setError(e.message) }
        setBusy(false)
      }
      return h('div', { className: 'n2s-card', style: { marginBottom: 12 } },
        h('div', { className: 'n2s-form' },
          h('label', { className: 'n2s-field' }, h('span', null, t('rep.title')), h('input', { className: 'n2s-input', value: form.title, onChange: set('title'), placeholder: t('rep.titlePh') })),
          h('label', { className: 'n2s-field' }, h('span', null, t('ds.select')),
            h('select', { className: 'n2s-select', value: form.datasourceId, onChange: set('datasourceId') }, datasources.map(d => h('option', { key: d.id, value: d.id }, `${d.name} · ${typeLabel(t, d.type)}`)))),
          h('div', { className: 'n2s-field full' }, h('span', null, t('rep.scope')),
            h('div', { className: 'n2s-seg' }, ['question', 'dashboard'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.scope === v, onClick: () => setForm(f => ({ ...f, scope: v })) }, t(`rep.scope.${v}`))))),
          form.scope === 'question' && h('label', { className: 'n2s-field full' }, h('span', null, t('rep.question')), h('textarea', { className: 'n2s-textarea', value: form.question, onChange: set('question'), placeholder: t('rep.questionPh') })),
          h('label', { className: 'n2s-field full' }, h('span', null, t('rep.instructions')), h('textarea', { className: 'n2s-textarea', style: { minHeight: 52 }, value: form.instructions, onChange: set('instructions'), placeholder: t('rep.instructionsPh') })),
          h('div', { className: 'n2s-field' }, h('span', null, t('rep.period')),
            h('div', { className: 'n2s-seg' }, ['daily', 'weekly'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.period === v, onClick: () => setForm(f => ({ ...f, period: v })) }, t(`rep.period.${v}`))))),
          h('label', { className: 'n2s-field' }, h('span', null, t('rep.time')), h('input', { className: 'n2s-input', type: 'time', value: form.time, onChange: set('time') })),
          form.period === 'weekly' && h('div', { className: 'n2s-field full' }, h('span', null, t('rep.weekdays')),
            h('div', { className: 'n2s-row' }, WEEKDAYS.map(d => h('label', { key: d, className: 'n2s-check' },
              h('input', { type: 'checkbox', checked: form.weekdays.includes(d), onChange: e => setForm(f => ({ ...f, weekdays: e.target.checked ? [...f.weekdays, d].sort() : f.weekdays.filter(x => x !== d) })) }), t(`rep.wd.${d}`))))),
          h(ReportChannelField, { t, value: form.channelId ?? '', onChange: (v) => setForm(f => ({ ...f, channelId: v || undefined })) }),
          h('div', { className: 'n2s-field full' }, h('span', null, t('rep.target')),
            h('div', { className: 'n2s-seg' }, ['new_once', 'new'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.target === v, disabled: Boolean(initial?.id) && initial.target !== v, onClick: () => setForm(f => ({ ...f, target: v })) }, t(`rep.target.${v}`)))))),
        error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy || !form.title.trim() || (form.scope === 'question' && !form.question.trim()), onClick: save }, t('ds.save'))))
    }

    function ReportsTab({ t, ds, datasources, onOpenSession, onOpenSchedules }) {
      const list = useAsync(() => call('listReports'), [])
      const [editing, setEditing] = useState(null)
      const [notice, setNotice] = useState(null)
      const act = async (fn, okText) => {
        setNotice(null)
        try { await fn(); if (okText) setNotice({ ok: true, text: okText }) } catch (e) { setNotice({ ok: false, text: e.message }) }
        list.reload()
      }
      const reports = list.value ?? []
      const statusDot = (st) => h('span', { className: `n2s-statusdot ${st === 'active' ? 'ok' : st === 'missing' ? 'err' : 'warn'}` }, t(`rep.status.${st}`))
      return h('div', null,
        h(SectionHead, { title: t('tab.reports'), desc: t('rep.hint') },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onOpenSchedules }, t('rep.openSchedules'), Icon.external(13)),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: !ds, onClick: () => setEditing({}) }, '+ ', t('rep.add'))),
        notice && h('div', { className: `n2s-notice ${notice.ok ? 'ok' : 'err'}`, style: { marginBottom: 10 }, role: 'status' }, notice.text),
        list.error && h('div', { className: 'n2s-notice err' }, list.error.message),
        editing && h(ReportForm, { key: editing.id ?? 'new', t, datasources, initial: editing.id ? editing : null, defaultDatasourceId: ds?.id, onCancel: () => setEditing(null), onDone: () => { setEditing(null); list.reload() } }),
        !list.loading && reports.length === 0 && !editing && h('div', { className: 'n2s-empty' }, h('h3', null, t('rep.empty')), h('div', null, t('rep.emptyHint')), h('button', { type: 'button', className: 'n2s-btn primary', disabled: !ds, onClick: () => setEditing({}) }, t('rep.add'))),
        reports.length > 0 && h('div', { className: 'n2s-list2', style: { marginTop: editing ? 12 : 0 } }, reports.map(r => h('div', { key: r.id, className: 'n2s-list2-row' },
          h('span', { className: 'n2s-tile', 'aria-hidden': true }, svg(16, [h('circle', { key: 1, cx: 8, cy: 8, r: 5.5 }), h('path', { key: 2, d: 'M8 5v3.2l2 1.3' })])),
          h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
            h('div', { className: 'n2s-row', style: { gap: 6 } }, h('span', { className: 'n2s-list2-title' }, r.title), r.channelName && h('span', { className: 'n2s-badge' }, Icon.send(11), r.channelName)),
            h('div', { className: 'n2s-list2-sub' }, `${t(`rep.period.${r.period}`)} ${r.period === 'weekly' ? r.weekdays.map(d => t(`rep.wd.${d}`)).join(listSep()) + ' ' : ''}${r.time.slice(0, 5)} · ${r.datasourceName} · ${r.scope === 'question' ? r.question : t('rep.scope.dashboard')}`)),
          h('div', { className: 'n2s-list2-side' },
            statusDot(r.status),
            h('span', { className: 'n2s-faint n2s-small' }, r.scheduledAt && r.status === 'active' ? `${t('rep.next')} ${new Date(r.scheduledAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}` : '')),
          h('div', { className: 'n2s-row', style: { gap: 2, flexWrap: 'nowrap' } },
            h('button', { type: 'button', className: 'n2s-btn small', disabled: r.status === 'missing', onClick: () => act(() => call('runReportNow', { id: r.id }), t('rep.started')) }, t('rep.runNow')),
            h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
              r.lastDelivery && { label: t('rep.openLast'), icon: Icon.external(14), onClick: () => onOpenSession(r.lastDelivery.targetSessionId) },
              r.status !== 'missing' && { label: r.status === 'active' ? t('rep.pause') : t('rep.resume'), icon: Icon.refresh(14), onClick: () => act(() => call('setReportActive', { id: r.id, active: r.status !== 'active' })) },
              { label: t('ds.edit'), icon: Icon.edit(14), onClick: () => setEditing(r) },
              { divider: true },
              { label: t('ds.delete'), icon: Icon.trash(14), danger: true, onClick: async () => { if (await confirmDialog({ title: fmt(t, 'rep.deleteConfirm', { title: r.title }), danger: true })) act(() => call('deleteReport', { id: r.id })) } },
            ] }))))))
    }
    function FeedbackForm({ t, onCancel, onSubmit }) {
      const [comment, setComment] = useState('')
      const [busy, runBusy] = useBusy()
      const reasons = ['fb.reason.wrongTable', 'fb.reason.wrongMetric', 'fb.reason.wrongFilter', 'fb.reason.wrongTime', 'fb.reason.chart']
      return h('div', { className: 'n2s-card', style: { padding: 10 } },
        h('div', { className: 'n2s-small', style: { marginBottom: 6 } }, t('fb.whatWrong')),
        h('div', { className: 'n2s-chips', style: { marginBottom: 6 } }, reasons.map(r => h('button', { key: r, type: 'button', className: 'n2s-chip', onClick: () => setComment(c => (c ? joinClauses([c, t(r)]) : t(r))) }, t(r)))),
        h('textarea', { className: 'n2s-textarea', style: { minHeight: 56 }, value: comment, onChange: e => setComment(e.target.value), placeholder: t('fb.commentPh') }),
        h('div', { className: 'n2s-row', style: { marginTop: 8, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn small primary', disabled: busy, onClick: () => runBusy(() => onSubmit(comment.trim())) }, busy ? h('span', { className: 'n2s-spin' }) : null, t('fb.submit'))))
    }

    function FeedbackSection({ t, ds }) {
      const [status, setStatus] = useState('open')
      const list = useAsync(() => call('listFeedback', { datasourceId: ds?.id, ...(status ? { status } : {}) }), [ds?.id, status], [ds?.id])
      const stats = useAsync(() => call('feedbackStats', { datasourceId: ds?.id }), [ds?.id, list.value], [ds?.id])
      const [fixing, setFixing] = useState(null)
      const [error, setError] = useState(null)
      const [busy, runBusy] = useBusy()
      const resolve = (payload) => runBusy(async () => {
        setError(null)
        try { await call('resolveFeedback', payload); setFixing(null); list.reload() } catch (e) { setError(e.message) }
      })
      const remove = async (f) => {
        if (!await confirmDialog({ title: t('fb.deleteConfirm'), message: f.question || f.title || '', confirmLabel: t('ds.delete'), danger: true })) return
        try { await call('deleteFeedback', { id: f.id }) } catch (e) { notifyError(e) }
        list.reload()
      }
      const st = stats.value
      return h('div', null,
        st && h('div', { className: 'n2s-kpis', style: { marginBottom: 12 } },
          [['fb.stat.up', st.up], ['fb.stat.down', st.down], ['fb.stat.open', st.open], ['fb.stat.rate', st.rate === null ? '—' : `${Math.round(st.rate * 100)}%`]].map(([k, v]) => h('div', { key: k, className: 'n2s-kpi' }, h('div', { className: 'v', style: { fontSize: 20 } }, v), h('div', { className: 'k' }, t(k))))),
        h('div', { className: 'n2s-row', style: { marginBottom: 10 } },
          h('div', { className: 'n2s-seg' }, [['open', 'fb.filter.open'], ['resolved', 'fb.filter.resolved'], ['', 'fb.filter.all']].map(([v, k]) => h('button', { key: k, type: 'button', 'aria-pressed': status === v, onClick: () => setStatus(v) }, t(k)))),
          h('span', { className: 'n2s-muted n2s-small n2s-grow' }, t('fb.hint'))),
        error && h('div', { className: 'n2s-notice err', style: { marginBottom: 8 } }, error),
        !list.loading && (list.value ?? []).length === 0 && h('div', { className: 'n2s-empty' }, h('div', { className: 'n2s-muted' }, t('fb.empty'))),
        h('div', { className: 'n2s-cards' }, (list.value ?? []).map(f => h('div', { key: f.id, className: 'n2s-card' },
          h('div', { className: 'n2s-row', style: { alignItems: 'flex-start' } },
            h('span', { style: { fontSize: 16 } }, f.rating === 'up' ? '👍' : '👎'),
            h('div', { className: 'n2s-grow' },
              h('div', { className: 'n2s-row' },
                h('span', { style: { fontWeight: 500 } }, f.question || f.title || t('fb.noQuestion')),
                h('span', { className: `n2s-badge ${f.status === 'open' ? 'warn' : 'ok'}` }, t(`fb.status.${f.status}`)),
                f.savedAsExample && h('span', { className: 'n2s-badge brand' }, t('kb.exampleSaved')),
                h('span', { className: 'n2s-muted n2s-small' }, new Date(f.at).toLocaleString())),
              f.comment && h('div', { className: 'n2s-small', style: { marginTop: 4 } }, f.comment),
              h('pre', { className: 'n2s-code', style: { marginTop: 6 } }, f.correctedSql || f.sql),
              f.resolution && h('div', { className: 'n2s-muted n2s-small', style: { marginTop: 4 } }, `${colon(t('fb.resolution'))}${f.resolution}`)),
            h('div', { style: { display: 'grid', gap: 4 } },
              f.sessionId && h('button', { type: 'button', className: 'n2s-btn small', onClick: () => fbCtx.openSession?.(f.sessionId) }, t('hist.openSession')),
              f.status === 'open' && h('button', { type: 'button', className: 'n2s-btn small primary', onClick: () => setFixing({ id: f.id, sql: f.sql, question: f.question || f.title, resolution: '' }) }, t('fb.fix')),
              f.status === 'open' && h('button', { type: 'button', className: 'n2s-btn small', onClick: () => resolve({ id: f.id, status: 'ignored' }) }, t('fb.ignore')),
              f.rating === 'up' && !f.savedAsExample && h('button', { type: 'button', className: 'n2s-btn small', onClick: () => resolve({ id: f.id, status: 'resolved', saveExample: true }) }, t('kb.saveExample')),
              h('button', { type: 'button', className: 'n2s-btn small ghost danger', onClick: () => remove(f) }, t('ds.delete')))),
          fixing?.id === f.id && h('div', { className: 'n2s-ask', style: { marginTop: 10 } },
            h('label', { className: 'n2s-field' }, h('span', null, t('kb.question')), h('input', { className: 'n2s-input', value: fixing.question, onChange: e => setFixing(x => ({ ...x, question: e.target.value })) })),
            h('label', { className: 'n2s-field' }, h('span', null, t('fb.correctedSql')), h('textarea', { className: 'n2s-textarea n2s-mono', style: { minHeight: 120 }, spellCheck: false, value: fixing.sql, onChange: e => setFixing(x => ({ ...x, sql: e.target.value })) })),
            h('label', { className: 'n2s-field' }, h('span', null, t('fb.resolution')), h('input', { className: 'n2s-input', value: fixing.resolution, placeholder: t('fb.resolutionPh'), onChange: e => setFixing(x => ({ ...x, resolution: e.target.value })) })),
            h('div', { className: 'n2s-row', style: { justifyContent: 'flex-end' } },
              h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => setFixing(null) }, t('ds.cancel')),
              h('button', { type: 'button', className: 'n2s-btn small', onClick: () => resolve({ id: f.id, status: 'resolved', resolution: fixing.resolution, correctedSql: fixing.sql !== f.sql ? fixing.sql : undefined }) }, t('fb.markResolved')),
              h('button', { type: 'button', className: 'n2s-btn small primary', onClick: () => resolve({ id: f.id, status: 'resolved', resolution: fixing.resolution, saveExample: true, correctedSql: fixing.sql, question: fixing.question }) }, t('fb.saveFix'))))))))
    }

    // Page-level callbacks the feedback list uses (set by the page).
    const fbCtx = {}
    function PolicyEditor({ t, ds, onDone, onCancel }) {
      const schema = useAsync(() => (ds.schemaAnalyzedAt ? call('analyzeSchema', { id: ds.id }) : null), [ds.id])
      const [form, setForm] = useState(() => ({ mode: ds.policy?.mode ?? 'all', tables: (ds.policy?.tables ?? []).join('\n'), hiddenColumns: (ds.policy?.hiddenColumns ?? []).join('\n'), maskedColumns: (ds.policy?.maskedColumns ?? []).join('\n') }))
      const [error, setError] = useState(null)
      const [busy, setBusy] = useState(false)
      const patterns = form.tables.split(/[\n,，]/).map(x => x.trim()).filter(Boolean)
      const globRe = (p) => { try { return new RegExp(`^${p.toLowerCase().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`) } catch { return /(?!)/ } }
      const matches = (name) => patterns.some(p => { const re = globRe(p); return re.test(name.toLowerCase()) || (!p.includes('.') && re.test(name.toLowerCase().split('.').pop())) })
      const tables = schema.value?.tables ?? []
      const allowed = tables.filter(tb => form.mode === 'all' || (form.mode === 'allow' ? matches(tb.name) : !matches(tb.name)))
      const toggleTable = (name) => setForm(f => {
        const list = f.tables.split(/\n/).map(x => x.trim()).filter(Boolean)
        return { ...f, tables: (list.includes(name) ? list.filter(x => x !== name) : [...list, name]).join('\n') }
      })
      const save = async () => {
        setBusy(true); setError(null)
        try { await call('savePolicy', { id: ds.id, policy: form }); await refreshDatasources(); onDone() } catch (e) { setError(e.message) }
        setBusy(false)
      }
      const area = (key, label, ph) => h('label', { className: 'n2s-field' }, h('span', null, t(label)),
        h('textarea', { className: 'n2s-textarea n2s-mono', style: { minHeight: 90 }, spellCheck: false, value: form[key], placeholder: ph, onChange: e => setForm(f => ({ ...f, [key]: e.target.value })) }))
      return h('div', { className: 'n2s-card' },
        h('div', { className: 'n2s-row', style: { marginBottom: 10 } }, h('span', { style: { fontWeight: 500 } }, `${t('policy.title')} · ${ds.name}`)),
        h('div', { className: 'n2s-notice', style: { marginBottom: 12 } }, t('policy.hint')),
        h('div', { className: 'n2s-field', style: { marginBottom: 12 } }, h('span', null, t('policy.mode')),
          h('div', { className: 'n2s-seg' }, ['all', 'allow', 'deny'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.mode === v, onClick: () => setForm(f => ({ ...f, mode: v })) }, t(`policy.mode.${v}`))))),
        h('div', { className: 'n2s-split', style: { minHeight: 0, gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' } },
          h('div', { style: { display: 'grid', gap: 10 } },
            form.mode !== 'all' && area('tables', form.mode === 'allow' ? 'policy.allowTables' : 'policy.denyTables', 'orders\\nods_*\\nsales.*'),
            area('hiddenColumns', 'policy.hiddenColumns', '*.salary\\nusers.id_card'),
            area('maskedColumns', 'policy.maskedColumns', 'users.phone\\n*.email')),
          h('div', null,
            h('div', { className: 'n2s-muted n2s-small', style: { marginBottom: 6 } }, tables.length ? fmt(t, 'policy.preview', { allowed: allowed.length, total: tables.length }) : t('schema.notAnalyzed')),
            h('div', { className: 'n2s-list', role: 'group', 'aria-label': t('policy.tablesLabel'), style: { maxHeight: 320 } }, tables.map(tb => {
              const ok = allowed.includes(tb)
              const editable = form.mode !== 'all'
              return h('div', {
                key: tb.name, className: 'n2s-item', style: { cursor: editable ? 'pointer' : 'default', opacity: ok ? 1 : 0.5 },
                role: 'checkbox', 'aria-checked': ok, 'aria-disabled': editable ? undefined : true, tabIndex: editable ? 0 : -1, 'aria-label': tb.name,
                onClick: () => editable && toggleTable(tb.name),
                onKeyDown: (e) => { if (editable && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); toggleTable(tb.name) } },
              },
                h('span', { 'aria-hidden': true }, ok ? '✓' : '✕'), h('span', { className: 'name n2s-mono' }, tb.name), roleBadge(t, tb.role))
            })),
            form.mode !== 'all' && tables.length > 0 && h('div', { className: 'n2s-muted n2s-small', style: { marginTop: 6 } }, t('policy.clickHint')))),
        error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: save }, t('ds.save'))))
    }

    const RANGES = ['today', 'yesterday', 'last7d', 'last30d', 'last90d', 'thisMonth', 'lastMonth', 'thisYear', 'custom']
    function FilterBar({ t, filters, onChange }) {
      const cand = useAsync(() => call('filterCandidates'), [])
      const time = filters.find(f => f.kind === 'time')
      const ins = filters.filter(f => f.kind === 'in')
      const [adding, setAdding] = useState('')
      const setTime = (patch) => {
        const next = patch === null ? null : { kind: 'time', column: time?.column ?? cand.value?.time[0]?.column ?? 'created_at', range: 'last30d', ...time, ...patch }
        onChange([...(next ? [next] : []), ...ins])
      }
      // keep: an emptied free-text field keeps its tag (with no values) instead of disappearing.
      const setIn = (column, values, keep) => {
        const others = ins.filter(f => f.column !== column)
        const at = ins.findIndex(f => f.column === column)
        const mine = values.length || keep ? [{ kind: 'in', column, values }] : []
        const next = at < 0 ? [...others, ...mine] : [...others.slice(0, at), ...mine, ...others.slice(at)]
        onChange([...(time ? [time] : []), ...next])
      }
      const c = cand.value ?? { time: [], dims: [] }
      const activeN = filters.filter(f => f.kind !== 'in' || f.values.length > 0).length
      return h('div', { className: 'n2s-filterbar', role: 'group', 'aria-label': t('filter.title') },
        h('span', { className: 'n2s-faint', style: { display: 'inline-flex' } }, svg(14, [h('path', { key: 1, d: 'M2.5 3.5h11l-4.2 5v4l-2.6 1.2V8.5L2.5 3.5z' })])),
        h('select', { className: 'n2s-select', value: time ? time.range : '', onChange: e => setTime(e.target.value ? { range: e.target.value } : null), 'aria-label': t('filter.range') },
          h('option', { value: '' }, t('filter.noTime')), RANGES.map(r => h('option', { key: r, value: r }, t(`filter.range.${r}`)))),
        time && c.time.length > 1 && h('select', { className: 'n2s-select', value: time.column, onChange: e => setTime({ column: e.target.value }), 'aria-label': t('filter.timeColumn') },
          c.time.map(x => h('option', { key: x.column, value: x.column }, x.label === x.column ? x.column : x.label))),
        time?.range === 'custom' && h(React.Fragment, null,
          h('input', { className: 'n2s-input', type: 'date', 'aria-label': t('filter.from'), value: time.from ?? '', onChange: e => setTime({ from: e.target.value }) }),
          h('span', { className: 'n2s-faint' }, '–'),
          h('input', { className: 'n2s-input', type: 'date', 'aria-label': t('filter.to'), value: time.to ?? '', onChange: e => setTime({ to: e.target.value }) })),
        ins.map(f => {
          const dim = c.dims.find(d => d.column === f.column)
          return h('span', { key: f.column, className: 'n2s-ftag' },
            h('span', { className: 'n2s-muted' }, dim?.label ?? f.column),
            dim?.values?.length
              ? h('select', { className: 'n2s-select', 'aria-label': dim.label, value: f.values[0] ?? '', onChange: e => setIn(f.column, e.target.value ? [e.target.value] : []) }, dim.values.map(v => h('option', { key: v, value: v }, v)))
              : h(FilterValuesInput, { key: f.column, t, label: dim?.label ?? f.column, values: f.values, onCommit: (values) => setIn(f.column, values, true) }),
            h('button', { type: 'button', className: 'n2s-iconbtn', style: { width: 22, height: 22 }, 'aria-label': t('filter.remove'), onClick: () => setIn(f.column, []) }, Icon.close(11)))
        }),
        c.dims.filter(d => !ins.some(f => f.column === d.column)).length > 0 && h(Dropdown, {
          label: t('filter.add'), align: 'start',
          trigger: { className: 'n2s-btn small ghost', content: h(React.Fragment, null, '+ ', t('filter.addShort')) },
          items: c.dims.filter(d => !ins.some(f => f.column === d.column)).map(d => ({ label: d.label === d.column ? d.column : `${d.label}`, hint: d.label === d.column ? '' : d.column, onClick: () => setIn(d.column, d.values?.slice(0, 1) ?? []) })),
        }),
        h('span', { className: 'n2s-grow' }),
        activeN > 0 && h('span', { className: 'n2s-faint n2s-small', title: t('filter.hint') }, fmt(t, 'filter.activeN', { count: activeN })),
        filters.length > 0 && h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => onChange([]) }, t('filter.clear')))
    }

    /**
     * Free-text values of an "in" filter: typed into a local draft (commas allowed,
     * clearing does not remove the tag) and committed on Enter, blur or after a pause.
     */
    function FilterValuesInput({ t, label, values, onCommit }) {
      const joined = values.join(', ')
      const [draft, setDraft] = useState(joined)
      const committed = useRef(joined)
      // Adopt outside changes (clear all, another board) when not mid-edit.
      useEffect(() => { if (joined !== committed.current) { committed.current = joined; setDraft(joined) } }, [joined])
      const parse = (s) => s.split(/[,，]/).map(x => x.trim()).filter(Boolean)
      const commit = (s) => {
        const next = parse(s)
        if (next.join('\u0000') === parse(committed.current).join('\u0000')) return
        committed.current = next.join(', ')
        onCommit(next)
      }
      useEffect(() => {
        if (draft === committed.current) return
        const id = setTimeout(() => commit(draft), 800)
        return () => clearTimeout(id)
      }, [draft])
      return h('input', {
        className: 'n2s-input', style: { width: 120, height: 26, border: 0 }, 'aria-label': label, placeholder: t('filter.valuesPh'), value: draft,
        onChange: e => setDraft(e.target.value),
        onBlur: () => commit(draft),
        onKeyDown: (e) => { if (e.key === 'Enter' && !e.nativeEvent?.isComposing) { e.preventDefault(); commit(draft) } },
      })
    }
    // ------------------------------------------------------------ IM push

    function makeReplyAction(ctx) {
      return function Nl2SqlReplySend({ messageId, sessionId }) {
        const t = useMemo(() => ctx.locale.bind(NS), [])
        const info = useSyncExternalStore(sessionInfoCache.subscribe, () => sessionInfoCache.get()[sessionId], () => sessionInfoCache.get()[sessionId])
        const [open, setOpen] = useState(false)
        useEffect(() => { if (sessionId && !info) loadSessionInfo(sessionId) }, [sessionId])
        if (!info || info.preset !== PRESET) return null
        return h(React.Fragment, null,
          h('button', { type: 'button', className: 'n2s-reply-send', title: t('im.sendReply'), 'aria-label': t('im.sendReply'), onClick: () => setOpen(true) },
            h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: 'M14 2 7 9M14 2l-4.5 12-2.5-5-5-2.5L14 2z' }))),
          open && h(SendDialog, { t, initial: { title: '', message: { sessionId, messageId } }, onClose: () => setOpen(false) }))
      }
    }

    // ------------------------------------------- channels: catalog & shapes
    // The host may be older (flat Lark-only channels, no channelCatalog /
    // botStatus RPCs) or newer (docs/channels.md). Everything below normalizes
    // both so the pages only deal with { platform, type, config, secretsSet,
    // capabilities, bot }.

    const KNOWN_PLATFORMS = ['lark', 'telegram', 'wecom', 'dingtalk']
    const PLATFORM_COLORS = { lark: '#3370ff', telegram: '#2aabee', wecom: '#0ba5a0', dingtalk: '#1a7cff' }
    const ID_PLACEHOLDER = {
      lark: { person: 'ou_xxx', chat: 'oc_xxx' }, telegram: { person: '123456789', chat: '-1001234567890' },
      wecom: { person: 'zhangsan', chat: 'wrxxxx' }, dingtalk: { person: 'manager1234', chat: 'cidxxxx==' },
    }
    const LEGACY_CAPS = {
      lark_webhook: { push: true, markdown: 'full', charts: 'native', tables: 'native', buttons: false, bot: false, listTargets: false, mentionAll: true },
      lark_app: { push: true, markdown: 'full', charts: 'native', chartImages: true, tables: 'native', buttons: true, bot: true, listTargets: true, mentionAll: true },
    }
    /** Localized value of a { zh, en } object (or a plain string). */
    const L = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? (v[uiLang] ?? v.zh ?? v.en ?? '') : (v ?? ''))
    const isUnknownMethod = (e) => e?.code === 'nl2sql/unknown-method' || /unknown method/i.test(e?.message ?? '')
    const platformOfType = (type) => (/^lark_/.test(type ?? '') ? 'lark' : (String(type ?? '').split('_')[0] || 'lark'))
    const isSecretField = (f) => Boolean(f.secret || f.type === 'secret')
    /** Translation or '' when the key is missing (hosts return the key or a !!marker). */
    const tOpt = (t, k) => { const v = t(k); return !v || v === k || v.startsWith('!!') ? '' : v }

    /** Built-in catalog used when the host has no `channelCatalog` RPC: today's Lark form. */
    function legacyCatalog(t) {
      const tx = (k) => ({ zh: t(k), en: t(k) })
      return [{
        platform: 'lark', name: tx('ch.p.lark'), builtin: true,
        kinds: [
          {
            id: 'lark_webhook', label: tx('im.type.lark_webhook'), description: tx('ch.k.lark_webhook'),
            fields: [
              { key: 'webhookUrl', label: tx('im.webhookUrl'), type: 'secret', secret: true, required: true, full: true, placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/…', pattern: '^https://open\\.(feishu\\.cn|larksuite\\.com)/open-apis/bot/v2/hook/[\\w-]+$' },
              { key: 'signSecret', label: tx('im.signSecret'), type: 'secret', secret: true, help: tx('ch.f.signSecret') },
            ],
            capabilities: LEGACY_CAPS.lark_webhook,
            setupSteps: { zh: [t('im.help.lark_webhook')], en: [t('im.help.lark_webhook')] },
          },
          {
            id: 'lark_app', label: tx('im.type.lark_app'), description: tx('ch.k.lark_app'),
            fields: [
              { key: 'domain', label: tx('im.domain'), type: 'select', options: ['feishu', 'lark'].map(v => ({ value: v, label: tx(`im.domain.${v}`) })) },
              { key: 'appId', label: tx('im.appId'), type: 'text', required: true, placeholder: 'cli_xxx' },
              { key: 'appSecret', label: tx('im.appSecret'), type: 'secret', secret: true, required: true },
              { key: 'receiveIdType', label: tx('im.receiveIdType'), type: 'select', options: ['chat_id', 'email', 'open_id', 'user_id', 'union_id'].map(v => ({ value: v, label: tx(`im.rid.${v}`) })) },
              { key: 'receiveId', label: tx('im.receiveId'), type: 'text', required: true, placeholder: 'oc_xxx', target: true, help: tx('ch.f.receiveId') },
            ],
            capabilities: LEGACY_CAPS.lark_app,
            setupSteps: { zh: ['im.help.lark_app', 'bot.step3', 'bot.step4', 'bot.step5', 'bot.step7', 'bot.step6'].map(t), en: ['im.help.lark_app', 'bot.step3', 'bot.step4', 'bot.step5', 'bot.step7', 'bot.step6'].map(t) },
          },
        ],
      }]
    }

    function normalizeChannel(c) {
      if (!c || typeof c !== 'object') return c
      const legacy = !c.config
      const config = c.config ?? Object.fromEntries(['domain', 'appId', 'receiveIdType', 'receiveId'].filter(k => c[k] !== undefined && c[k] !== null).map(k => [k, c[k]]))
      const secretsSet = c.secretsSet ?? (c.type === 'lark_webhook' ? { webhookUrl: Boolean(c.hasSecret), signSecret: Boolean(c.hasSign) } : c.type === 'lark_app' ? { appSecret: Boolean(c.hasSecret) } : {})
      return { ...c, platform: c.platform ?? platformOfType(c.type), config, secretsSet, capabilities: c.capabilities ?? LEGACY_CAPS[c.type] ?? { push: true, charts: 'none' }, legacy }
    }

    const channelStore = createStore({ list: null })
    async function refreshChannels() {
      try {
        const list = await call('listChannels')
        channelStore.set({ list: (Array.isArray(list) ? list : []).map(normalizeChannel) })
      } catch { channelStore.set({ list: [] }) }
    }
    function useChannels() {
      const get = () => channelStore.get().list
      const list = useSyncExternalStore(channelStore.subscribe, get, get)
      useEffect(() => { if (list === null) refreshChannels() }, [])
      return list ?? []
    }

    // remote: null = not loaded yet, true = host catalog, false = built-in Lark catalog.
    const catalogStore = createStore({ list: [], remote: null })
    async function loadCatalog() {
      try {
        const list = await call('channelCatalog')
        catalogStore.set(Array.isArray(list) && list.length ? { list, remote: true } : { list: [], remote: false })
      } catch { catalogStore.set({ list: [], remote: false }) }
    }
    function sortPlatforms(list) {
      const rank = (p) => { const i = KNOWN_PLATFORMS.indexOf(p); return i < 0 ? 99 : i }
      return [...list].sort((a, b) => rank(a.platform) - rank(b.platform))
    }
    function useCatalog(t) {
      const get = () => catalogStore.get()
      const st = useSyncExternalStore(catalogStore.subscribe, get, get)
      useEffect(() => { if (st.remote === null) loadCatalog() }, [])
      const catalog = useMemo(() => (st.remote ? sortPlatforms(st.list) : legacyCatalog(t)), [st, t, uiLang])
      return { catalog, remote: st.remote === true, ready: st.remote !== null }
    }
    function findKind(catalog, type) {
      for (const p of catalog) { const kind = (p.kinds ?? []).find(k => k.id === type); if (kind) return { platform: p, kind } }
      return null
    }
    function platformName(t, platform, catalog) {
      if (KNOWN_PLATFORMS.includes(platform)) return t(`ch.p.${platform}`)
      return L((catalog ?? []).find(p => p.platform === platform)?.name) || String(platform ?? '')
    }
    function kindLabel(t, type, catalog) {
      const k = findKind(catalog ?? [], type)?.kind
      if (k) return L(k.label)
      return type === 'lark_webhook' || type === 'lark_app' ? t(`im.type.${type}`) : String(type ?? '')
    }
    function channelOptionLabel(t, c, catalog) {
      return `${c.name} · ${platformName(t, c.platform, catalog)} · ${kindLabel(t, c.type, catalog)}`
    }
    /** Chart modes a channel can send: native card charts, PNG images, tables. */
    function chartModesFor(caps, type) {
      const cm = caps?.charts ?? 'native'
      const modes = cm === 'native' ? ['native'] : cm === 'image' ? ['image'] : []
      if (cm === 'native' && (caps?.chartImages || type === 'lark_app')) modes.push('image')
      modes.push('table')
      return modes
    }
    /** The form field that holds the delivery target (chat id …), used by the target picker. */
    function targetFieldOf(kind) {
      const fields = kind?.fields ?? []
      return fields.find(f => f.target) ?? fields.find(f => !isSecretField(f) && f.type !== 'select' && /chat|target|receive|conversation/i.test(f.key))
    }
    /** One-line, secret-free description of where a channel delivers. */
    function targetSummary(t, c, kind) {
      const cfg = c.config ?? {}
      if (cfg.receiveId) return `${cfg.receiveIdType ? `${cfg.receiveIdType}:` : ''}${cfg.receiveId}`
      const tf = targetFieldOf(kind)
      if (tf && cfg[tf.key]) return String(cfg[tf.key])
      for (const k of ['chatId', 'chat_id', 'conversationId', 'openConversationId', 'target', 'webhookHost', 'host']) if (cfg[k]) return String(cfg[k])
      if (Object.keys(c.secretsSet ?? {}).some(k => /webhook/i.test(k) && c.secretsSet[k])) return t('im.webhookHidden')
      const plain = (kind?.fields ?? []).find(f => !isSecretField(f) && f.type !== 'select' && cfg[f.key])
      return plain ? String(cfg[plain.key]) : ''
    }

    // ------------------------------------------------------------- bots
    // New hosts: botStatus / saveBot (one bot per bot-capable channel).
    // Old hosts: one Lark bot (larkBotStatus / saveLarkBot) bound to a channel.

    const botStore = createStore({ list: null, legacy: false, legacyConf: null, error: null })
    function legacyBotEntry(v) {
      return { channelId: v.channelId ?? null, platform: 'lark', enabled: Boolean(v.enabled), allowP2p: v.allowP2p !== false, sessionScope: v.sessionScope ?? 'chat', status: v.status ?? { state: 'idle' }, info: v.bot ?? null, conversations: v.conversations ?? [] }
    }
    async function refreshBots() {
      try {
        const list = await call('botStatus')
        if (!Array.isArray(list)) throw Object.assign(new Error('unknown method botStatus'), { code: 'nl2sql/unknown-method' })
        botStore.set({ list, legacy: false, error: null })
      } catch (e) {
        if (!isUnknownMethod(e)) { botStore.set({ list: botStore.get().list ?? [], error: e.message }); return }
        try {
          const v = await call('larkBotStatus')
          botStore.set({ list: v?.channelId ? [legacyBotEntry(v)] : [], legacy: true, legacyConf: v ?? null, error: null })
        } catch { botStore.set({ list: [], legacy: true, legacyConf: null }) }
      }
    }
    function useBots() {
      const get = () => botStore.get()
      const st = useSyncExternalStore(botStore.subscribe, get, get)
      useEffect(() => { if (st.list === null) refreshBots() }, [])
      return st
    }
    /** Bot settings + status of one channel, merged from listChannels and botStatus. */
    function botOf(c, bots) {
      const base = { enabled: false, allowP2p: true, sessionScope: 'chat', status: { state: 'idle' }, conversations: [] }
      const e = (bots?.list ?? []).find(b => b.channelId === c.id)
      if (bots?.legacy) {
        const conf = bots.legacyConf ?? {}
        return e ? { ...base, ...e } : { ...base, allowP2p: conf.allowP2p !== false, sessionScope: conf.sessionScope ?? 'chat' }
      }
      const merged = { ...base, ...(c.bot ?? {}), ...(e ?? {}) }
      return { ...merged, status: e?.status ?? c.bot?.status ?? { state: merged.enabled ? 'connecting' : 'idle' } }
    }
    /** 'off' | 'connecting' | 'connected' | 'error' | 'stopped' */
    function botStateOf(b) {
      if (!b?.enabled) return 'off'
      const s = b.status?.state ?? 'connecting'
      return s === 'idle' ? 'connecting' : s
    }
    const BOT_DOT = { connected: 'ok', error: 'err', connecting: 'conn', stopped: 'warn', off: '' }
    function BotDot({ t, bot, prefix }) {
      const s = botStateOf(bot)
      return h('span', { className: `n2s-statusdot ${BOT_DOT[s] ?? ''}`, title: bot?.status?.error ?? undefined }, prefix ? `${prefix} · ` : '', t(`ch.bot.state.${s}`))
    }
    async function saveBotFor(channelId, patch) {
      const st = botStore.get()
      if (st.legacy) {
        const conf = st.legacyConf ?? {}
        const owner = conf.channelId ?? null
        // The single legacy bot belongs to another channel: only an explicit enable moves it.
        if (conf.enabled && owner && owner !== channelId && patch.enabled !== true) return
        if (patch.enabled === false && owner !== channelId) return
        await call('saveLarkBot', { channelId, ...patch })
      } else {
        await call('saveBot', { channelId, ...patch })
      }
      await refreshBots()
    }

    /** Platform tile: brand-tinted letter mark (original, not a logo). */
    function PlatformMark({ t, platform, size = 36 }) {
      const color = PLATFORM_COLORS[platform] ?? '#64748b'
      const txt = KNOWN_PLATFORMS.includes(platform) ? t(`ch.p.${platform}.mark`) : String(platform ?? '?').slice(0, 2).toUpperCase()
      return h('span', {
        className: 'n2s-tile n2s-pmark', 'aria-hidden': true,
        style: { width: size, height: size, borderRadius: Math.round(size * 0.28), fontSize: Math.max(9, Math.round(size * (txt.length > 1 ? 0.3 : 0.4))), color, background: `color-mix(in srgb, ${color} 13%, transparent)` },
      }, txt)
    }

    /** Capability chips: charts / buttons / bot. */
    function CapabilityChips({ t, caps, type }) {
      if (!caps) return null
      const cm = caps.charts ?? 'native'
      const chart = cm === 'none' ? 'none' : chartModesFor(caps, type).includes('native') ? 'native' : 'image'
      return h('div', { className: 'n2s-caps' },
        h('span', { className: `n2s-cap${chart === 'none' ? ' muted' : ''}` }, Icon.chart(11), t(`ch.cap.${chart}`)),
        caps.buttons && h('span', { className: 'n2s-cap' }, t('ch.cap.buttons')),
        caps.bot && h('span', { className: 'n2s-cap bot' }, t('ch.cap.bot')))
    }

    /** Native channel <select> with the platform mark of the selected channel. */
    function ChannelPicker({ t, value, onChange, noneLabel, id, label }) {
      const channels = useChannels()
      const { catalog } = useCatalog(t)
      const cur = channels.find(c => c.id === value)
      return h('div', { className: 'n2s-chpick' },
        cur ? h(PlatformMark, { t, platform: cur.platform, size: 24 }) : h('span', { className: 'n2s-chpick-none', 'aria-hidden': true }, Icon.send(12)),
        h('select', { id, className: 'n2s-select', 'aria-label': id ? undefined : label, value: value ?? '', onChange: e => onChange(e.target.value) },
          noneLabel !== undefined && h('option', { value: '' }, noneLabel),
          channels.map(c => h('option', { key: c.id, value: c.id }, channelOptionLabel(t, c, catalog)))))
    }
    /** Minimal Markdown → React preview of what the Lark card shows (escaped; <font color> kept). */
    function MdPreview({ text }) {
      const blocks = []
      const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
      const inline = (s, key) => {
        const out = []
        const re = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|~~[^~]+~~|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|<font color=['"]?([\w-]+)['"]?>([\s\S]*?)<\/font>|<at [^>]*><\/at>)/g
        let last = 0
        let m
        let i = 0
        while ((m = re.exec(s))) {
          if (m.index > last) out.push(s.slice(last, m.index))
          const t = m[0]
          const k = `${key}-${i++}`
          if (t.startsWith('**') || t.startsWith('__')) out.push(h('strong', { key: k }, t.slice(2, -2)))
          else if (t.startsWith('~~')) out.push(h('del', { key: k }, t.slice(2, -2)))
          else if (t.startsWith('`')) out.push(h('code', { key: k, className: 'n2s-md-code' }, t.slice(1, -1)))
          else if (t.startsWith('[')) { const mm = t.match(/^\[([^\]]+)\]\(([^)]+)\)$/); out.push(h('a', { key: k, href: mm[2], target: '_blank', rel: 'noreferrer' }, mm[1])) }
          else if (t.startsWith('<font')) { const c = { green: '#34c724', red: '#f54a45', grey: '#8f959e', gray: '#8f959e', blue: '#3370ff', orange: '#ff8800' }[m[2]] ?? undefined; out.push(h('span', { key: k, style: c ? { color: c } : undefined }, m[3])) }
          else if (t.startsWith('<at')) out.push(h('span', { key: k, className: 'n2s-badge brand' }, /all/.test(t) ? (uiLang === 'zh' ? '@所有人' : '@all') : (uiLang === 'zh' ? '@用户' : '@user')))
          else out.push(h('em', { key: k }, t.slice(1, -1)))
          last = m.index + t.length
        }
        if (last < s.length) out.push(s.slice(last))
        return out
      }
      for (let i = 0; i < lines.length;) {
        const line = lines[i]
        if (/^```/.test(line)) {
          const body = []
          i++
          while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++])
          i++
          blocks.push(h('pre', { key: blocks.length, className: 'n2s-code' }, body.join('\n')))
          continue
        }
        if (/^\|.*\|\s*$/.test(line) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
          const split = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
          const head = split(line)
          const rows = []
          i += 2
          while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) rows.push(split(lines[i++]))
          blocks.push(h('div', { key: blocks.length, className: 'n2s-table-wrap', style: { maxHeight: 220 } }, h('table', { className: 'n2s-table' },
            h('thead', null, h('tr', null, head.map((c, j) => h('th', { key: j }, inline(c, `h${j}`))))),
            h('tbody', null, rows.map((r, ri) => h('tr', { key: ri }, head.map((_, j) => h('td', { key: j }, inline(r[j] ?? '', `c${ri}-${j}`)))))))))
          continue
        }
        const hm = line.match(/^(#{1,6})\s+(.*)$/)
        if (hm) { blocks.push(h('div', { key: blocks.length, style: { fontWeight: 600, fontSize: [20, 18, 16, 15, 14, 14][hm[1].length - 1], margin: '6px 0 2px' } }, inline(hm[2], `t${i}`))); i++; continue }
        if (/^(-{3,}|<hr\s*\/?>)\s*$/.test(line)) { blocks.push(h('hr', { key: blocks.length, style: { border: 0, borderTop: '.5px solid var(--dsw-alias-border-l2)', margin: '8px 0' } })); i++; continue }
        if (/^>\s?/.test(line)) {
          const q = []
          while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''))
          blocks.push(h('div', { key: blocks.length, style: { borderLeft: '3px solid var(--dsw-alias-border-l2)', paddingLeft: 8, color: 'var(--dsw-alias-label-secondary)' } }, q.map((l, j) => h('div', { key: j }, inline(l, `q${i}-${j}`)))))
          continue
        }
        if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
          const items = []
          const ordered = /^\s*\d+\./.test(line)
          while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, ''))
          blocks.push(h(ordered ? 'ol' : 'ul', { key: blocks.length, style: { margin: '2px 0', paddingLeft: 20 } }, items.map((it, j) => h('li', { key: j }, inline(it, `l${i}-${j}`)))))
          continue
        }
        if (line.trim() === '') { i++; continue }
        const para = []
        while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|```|>|\s*([-*+]|\d+\.)\s|\|)/.test(lines[i])) para.push(lines[i++])
        if (!para.length) { para.push(lines[i++]) }
        blocks.push(h('p', { key: blocks.length, style: { margin: '4px 0' } }, para.flatMap((l, j) => [j ? h('br', { key: `b${j}` }) : null, ...inline(l, `p${i}-${j}`)])))
      }
      return h('div', { className: 'n2s-md' }, blocks)
    }

    const MD_SNIPPETS_ZH = [
      ['im.md.bold', '**', '**', '加粗'],
      ['im.md.heading', '\n## ', '', '标题'],
      ['im.md.list', '\n- ', '', '要点'],
      ['im.md.quote', '\n> ', '', '引用'],
      ['im.md.green', "<font color='green'>", '</font>', '+12%'],
      ['im.md.red', "<font color='red'>", '</font>', '-5%'],
      ['im.md.table', '\n| 指标 | 数值 |\n|---|---:|\n| ', ' | 0 |\n', '名称'],
      ['im.md.link', '[', '](https://)', '链接'],
      ['im.md.atAll', '<at id=all></at> ', '', ''],
    ]
    const MD_SNIPPETS_EN = [
      ['im.md.bold', '**', '**', 'bold'],
      ['im.md.heading', '\n## ', '', 'Heading'],
      ['im.md.list', '\n- ', '', 'point'],
      ['im.md.quote', '\n> ', '', 'quote'],
      ['im.md.green', "<font color='green'>", '</font>', '+12%'],
      ['im.md.red', "<font color='red'>", '</font>', '-5%'],
      ['im.md.table', '\n| Metric | Value |\n|---|---:|\n| ', ' | 0 |\n', 'name'],
      ['im.md.link', '[', '](https://)', 'link'],
      ['im.md.atAll', '<at id=all></at> ', '', ''],
    ]
    const mdSnippets = () => (uiLang === 'zh' ? MD_SNIPPETS_ZH : MD_SNIPPETS_EN)

    function MdEditor({ t, value, onChange, minHeight = 140 }) {
      const ref = useRef(null)
      const [mode, setMode] = useState('edit')
      const insert = ([, before, after, placeholder]) => {
        const el = ref.current
        const start = el?.selectionStart ?? value.length
        const end = el?.selectionEnd ?? value.length
        const sel = value.slice(start, end) || placeholder
        const next = value.slice(0, start) + before + sel + after + value.slice(end)
        onChange(next)
        requestAnimationFrame(() => { if (el) { el.focus(); el.selectionStart = start + before.length; el.selectionEnd = start + before.length + sel.length } })
      }
      return h('div', { className: 'n2s-mdedit' },
        h('div', { className: 'n2s-row', style: { gap: 4, marginBottom: 4 } },
          h('div', { className: 'n2s-seg' }, ['edit', 'preview'].map(m => h('button', { key: m, type: 'button', 'aria-pressed': mode === m, onClick: () => setMode(m) }, t(`im.md.${m}`)))),
          mode === 'edit' && mdSnippets().map(sn => h('button', { key: sn[0], type: 'button', className: 'n2s-btn small ghost', title: t(sn[0]), onMouseDown: (e) => e.preventDefault(), onClick: () => insert(sn) }, t(sn[0])))),
        mode === 'edit'
          ? h('textarea', { ref, className: 'n2s-textarea', style: { minHeight, fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: 12.5 }, value, spellCheck: false, placeholder: t('im.textPh'), onChange: e => onChange(e.target.value) })
          : h('div', { className: 'n2s-card', style: { minHeight, maxHeight: 360, overflow: 'auto', padding: '10px 12px' } }, value.trim() ? h(MdPreview, { text: value }) : h('span', { className: 'n2s-muted' }, t('im.md.empty'))))
    }
    /** Modal dialog sending a title, text and results to an IM channel. */
    function SendDialog({ t, initial, onClose }) {
      const channels = useChannels()
      const [form, setForm] = useState(() => ({ channelId: '', title: initial.title ?? '', text: initial.text ?? '', includeSql: false, chartMode: '', attachFull: true }))
      const [resultIds, setResultIds] = useState(initial.resultIds ?? [])
      const [loading, setLoading] = useState(Boolean(initial.message))
      useEffect(() => {
        if (!initial.message) return
        call('previewAssistantMessage', initial.message).then((p) => {
          setForm(f => ({ ...f, text: p.text, title: f.title || (p.text.split('\n').map(l => l.replace(/^#+\s*|\*\*/g, '').trim()).find(Boolean) ?? '').slice(0, 60) }))
          setResultIds(p.resultIds)
          setLoading(false)
        }, (e) => { setState({ error: e.message }); setLoading(false) })
      }, [])
      const [state, setState] = useState(null)
      const ref = useRef(null)
      useFocusTrap(ref)
      const closeTimer = useRef(null)
      useEffect(() => () => clearTimeout(closeTimer.current), [])
      const busyRef = useRef(false)
      busyRef.current = Boolean(state?.busy)
      useEffect(() => {
        const def = channels.find(c => c.isDefault) ?? channels[0]
        if (def && !form.channelId) setForm(f => ({ ...f, channelId: def.id }))
      }, [channels.length])
      useEffect(() => {
        const prev = document.activeElement
        ref.current?.querySelector('select, textarea, input, button')?.focus()
        // Escape belongs to a confirm/prompt dialog on top, if any.
        const onKey = (e) => { if (e.key === 'Escape' && !feedbackStore.get().dialog) onClose() }
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() }
      }, [])
      const send = async () => {
        if (busyRef.current) return
        busyRef.current = true
        setState({ busy: true })
        try {
          const res = initial.dashboard
            ? await call('sendDashboard', { channelId: form.channelId, title: form.title, attachFull: form.attachFull, ...(form.chartMode ? { chartMode: form.chartMode } : {}) })
            : await call('sendToChannel', { channelId: form.channelId, title: form.title, text: form.text, resultIds, includeSql: form.includeSql, attachFull: form.attachFull, ...(form.chartMode ? { chartMode: form.chartMode } : {}), sessionId: initial.message?.sessionId })
          setState({ ok: `${fmt(t, 'im.sent', { channel: res.channel, images: res.images })}${res.files ? ` · ${t('im.sentFile')}` : ''}`, warn: res.warning })
          refreshChannels()
          closeTimer.current = setTimeout(onClose, 1200)
        } catch (e) {
          setState({ error: e.message })
        }
      }
      const channel = channels.find(c => c.id === form.channelId)
      return ReactDOM.createPortal(h('div', { className: 'n2s-modal-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose() } },
        h('div', { ref, className: 'n2s-modal', role: 'dialog', 'aria-modal': true, 'aria-label': t('im.sendTitle') },
          h('div', { className: 'n2s-row', style: { marginBottom: 12 } }, h('span', { style: { fontWeight: 500, fontSize: 15 } }, t('im.sendTitle')), h('span', { className: 'n2s-grow' }), h('button', { type: 'button', className: 'n2s-btn small ghost', 'aria-label': t('ds.cancel'), onClick: onClose }, '×')),
          channels.length === 0
            ? h('div', { className: 'n2s-empty' }, h('div', { className: 'n2s-muted' }, t('im.noChannel')))
            : h('div', { style: { display: 'grid', gap: 10 } },
              h('div', { className: 'n2s-field' }, h('label', { htmlFor: 'n2s-send-channel', className: 'n2s-flabel' }, t('im.channel')),
                h(ChannelPicker, { t, id: 'n2s-send-channel', value: form.channelId, onChange: (v) => setForm(f => ({ ...f, channelId: v, chartMode: '' })) })),
              h('label', { className: 'n2s-field' }, h('span', null, t('im.msgTitle')), h('input', { className: 'n2s-input', value: form.title, onChange: e => setForm(f => ({ ...f, title: e.target.value })) })),
              !initial.dashboard && h('div', { className: 'n2s-field' }, h('span', null, t('im.text')),
                loading ? h('span', { className: 'n2s-spin n2s-muted' }) : h(MdEditor, { t, value: form.text, onChange: (v) => setForm(f => ({ ...f, text: v })) })),
              h('div', { className: 'n2s-muted n2s-small' }, initial.dashboard ? t('im.dashboardHint') : fmt(t, 'im.attach', { count: resultIds.length })),
              (resultIds.length > 0 || initial.dashboard) && h('div', { className: 'n2s-row' },
                h('span', { className: 'n2s-small' }, t('im.chartMode')),
                channel?.capabilities?.charts === 'none' && h('span', { className: 'n2s-faint n2s-small' }, t('ch.tablesOnly')),
                h('div', { className: 'n2s-seg', role: 'group', 'aria-label': t('im.chartMode') }, ['', ...chartModesFor(channel?.capabilities, channel?.type)].map(v => h('button', { key: v || 'def', type: 'button', 'aria-pressed': form.chartMode === v, onClick: () => setForm(f => ({ ...f, chartMode: v })) }, t(v ? `im.cm.${v}` : 'im.cm.default'))))),
              !initial.dashboard && resultIds.length > 0 && h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: form.includeSql, onChange: e => setForm(f => ({ ...f, includeSql: e.target.checked })) }), t('im.includeSql')),
              (resultIds.length > 0 || initial.dashboard) && h('div', { className: 'n2s-field' },
                channel?.capabilities?.files
                  ? h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: form.attachFull, onChange: e => setForm(f => ({ ...f, attachFull: e.target.checked })) }), fmt(t, 'im.attachFull', { n: channel.capabilities.tableRows ?? 10 }))
                  : h('span', { className: 'n2s-faint n2s-small' }, fmt(t, 'im.rowsLimit', { n: channel?.capabilities?.tableRows ?? 10 })))),
          state?.error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, state.error),
          state?.ok && h('div', { className: 'n2s-notice ok', style: { marginTop: 10 } }, state.ok),
          state?.warn && h('div', { className: 'n2s-notice warn', style: { marginTop: 8 } }, state.warn),
          h('div', { className: 'n2s-row', style: { marginTop: 14, justifyContent: 'flex-end' } },
            h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onClose }, t('ds.cancel')),
            h('button', { type: 'button', className: 'n2s-btn primary', disabled: !form.channelId || !form.title.trim() || state?.busy || loading, onClick: send }, state?.busy ? h('span', { className: 'n2s-spin' }) : null, t('im.send'))))), document.body)
    }
    // ------------------------------------------------------------ channels page
    // 「渠道」: channel list grouped by platform, a two-step "add channel" dialog
    // (platform → kind, then a form rendered from the kind's `fields`), bot
    // settings per bot-capable channel and the delivery log.

    /** Request from elsewhere (bot overview) to open a channel's editor. */
    const channelNav = createStore({ edit: null })
    function openChannelEditor(id, bot) {
      channelNav.set({ edit: { id, bot: Boolean(bot) } })
      fbCtx.navigate?.({ tab: 'admin', section: 'push', sub: null })
    }

    const fieldVisible = (f, config) => {
      if (!f.showIf) return true
      const v = String(config?.[f.showIf.key] ?? '')
      return Array.isArray(f.showIf.equals) ? f.showIf.equals.map(String).includes(v) : v === String(f.showIf.equals)
    }

    /** Move focus between the [data-nav] items of a container with the arrow keys. */
    function arrowNav(e, select) {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
      const items = [...e.currentTarget.querySelectorAll('[data-nav]:not([disabled])')]
      if (!items.length) return
      const i = items.indexOf(document.activeElement)
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
      e.preventDefault()
      items[next].focus()
      if (select) items[next].click()
    }

    /** Modal shell: portal, backdrop, Escape, initial focus and focus restore. */
    function Modal({ label, labelledBy, onClose, width, children, className }) {
      const box = useRef(null)
      useFocusTrap(box)
      useEffect(() => {
        const prev = document.activeElement
        setTimeout(() => box.current?.querySelector('[data-autofocus], input:not([type=checkbox]), select, button:not(.n2s-modal-x)')?.focus(), 0)
        const onKey = (e) => { if (e.key === 'Escape' && !feedbackStore.get().dialog) { e.stopPropagation(); onClose() } }
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() }
      }, [])
      return ReactDOM.createPortal(h('div', { className: 'n2s-modal-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose() } },
        h('div', { ref: box, className: `n2s-modal ${className ?? ''}`, role: 'dialog', 'aria-modal': true, 'aria-label': labelledBy ? undefined : label, 'aria-labelledby': labelledBy, style: width ? { width: `min(${width}px, 100%)` } : undefined }, children)), document.body)
    }

    // ---------------------------------------------------------------- step 1

    function KindPicker({ t, catalog, platform, onPlatform, onPick }) {
      const p = catalog.find(x => x.platform === platform) ?? catalog[0]
      return h('div', { className: 'n2s-wiz-pick' },
        h('div', { className: 'n2s-flabel', id: 'n2s-wiz-plabel' }, t('ch.pickPlatform')),
        h('div', { className: 'n2s-ptiles', role: 'radiogroup', 'aria-labelledby': 'n2s-wiz-plabel', onKeyDown: (e) => arrowNav(e, true) },
          catalog.map(x => h('button', {
            key: x.platform, type: 'button', role: 'radio', 'data-nav': true, 'aria-checked': x.platform === p?.platform, tabIndex: x.platform === p?.platform ? 0 : -1,
            'data-autofocus': x.platform === p?.platform ? true : undefined, className: 'n2s-ptile', onClick: () => onPlatform(x.platform),
          }, h(PlatformMark, { t, platform: x.platform, size: 32 }), h('span', { className: 'n2s-ptile-name' }, platformName(t, x.platform, catalog)),
            h('span', { className: 'n2s-faint n2s-small' }, fmt(t, 'ch.kindsN', { n: (x.kinds ?? []).length }))))),
        p && h(React.Fragment, null,
          h('div', { className: 'n2s-flabel', id: 'n2s-wiz-klabel', style: { marginTop: 18 } }, fmt(t, 'ch.pickKind', { platform: platformName(t, p.platform, catalog) })),
          h('ul', { className: 'n2s-kindcards', 'aria-labelledby': 'n2s-wiz-klabel', onKeyDown: (e) => arrowNav(e, false) },
            (p.kinds ?? []).map(k => h('li', { key: k.id, className: 'n2s-kindcard-li' }, h('button', { type: 'button', 'data-nav': true, className: 'n2s-kindcard', onClick: () => onPick(p.platform, k.id) },
              h('span', { className: 'n2s-kindcard-title' }, L(k.label), h('span', { className: 'n2s-grow' }), Icon.arrow(14)),
              k.description && h('span', { className: 'n2s-kindcard-desc' }, L(k.description)),
              h('span', { className: 'n2s-row', style: { gap: 6, marginTop: 4 } },
                h(CapabilityChips, { t, caps: k.capabilities, type: k.id }),
                k.capabilities?.bot && h('span', { className: 'n2s-faint n2s-small' }, t('ch.noPublicUrl')))))))))
    }

    // ---------------------------------------------------------------- step 2

    function FieldInput({ t, f, value, onChange, error, keep, idBase }) {
      const id = `${idBase}-${CSS_ID(f.key)}`
      const err = error ? `${id}-err` : undefined
      const help = L(f.help)
      const common = { id, 'aria-invalid': error ? true : undefined, 'aria-describedby': [err, help ? `${id}-help` : null].filter(Boolean).join(' ') || undefined, 'aria-required': f.required ? true : undefined }
      const secret = isSecretField(f)
      const control = f.type === 'select'
        ? h('select', { ...common, className: 'n2s-select', value: value ?? '', onChange: e => onChange(e.target.value) },
          (value ?? '') === '' && !(f.options ?? []).some(o => o.value === '') && h('option', { value: '' }, '—'),
          (f.options ?? []).map(o => h('option', { key: o.value, value: o.value }, L(o.label) || o.value)))
        : h('input', {
          ...common, className: `n2s-input${secret ? '' : ' n2s-mono-soft'}${error ? ' invalid' : ''}`, type: secret ? 'password' : f.type === 'url' ? 'url' : 'text',
          value: value ?? '', autoComplete: secret ? 'new-password' : 'off', spellCheck: false,
          placeholder: secret && keep ? t('ch.secretKeep') : (L(f.placeholder) || (secret && !f.required ? t('im.optional') : '')),
          onChange: e => onChange(e.target.value),
        })
      return h('div', { className: `n2s-field${f.full || f.type === 'url' || (secret && /url|webhook/i.test(f.key)) ? ' full' : ''}` },
        h('label', { htmlFor: id, className: 'n2s-flabel' }, L(f.label) || f.key, f.required ? h('span', { className: 'n2s-req', 'aria-hidden': true }, ' *') : null,
          secret && keep && h('span', { className: 'n2s-badge ok', style: { marginLeft: 6 } }, t('ch.secretSet'))),
        control,
        error ? h('span', { id: err, className: 'n2s-fielderr', role: 'alert' }, error) : help ? h('span', { id: `${id}-help`, className: 'n2s-faint n2s-small' }, help) : null)
    }

    function TargetPicker({ t, kind, remote, initial, config, secrets, onPick, current }) {
      const [st, setSt] = useState(null)
      const load = async () => {
        setSt({ busy: true })
        try {
          const legacyChats = async () => ((await call('listChannelChats', { id: initial?.id, appId: config.appId, appSecret: secrets.appSecret || undefined, domain: config.domain })) ?? []).map(c => ({ id: c.chatId, name: c.name, type: 'group' }))
          let list
          if (!remote && kind.id === 'lark_app') list = await legacyChats()
          else {
            try {
              list = await call('listChannelTargets', { ...(initial?.id ? { id: initial.id } : {}), type: kind.id, config, secrets })
            } catch (e) {
              if (!isUnknownMethod(e) || kind.id !== 'lark_app') throw e
              list = await legacyChats()
            }
          }
          setSt({ list: Array.isArray(list) ? list : [] })
        } catch (e) { setSt({ error: e.message }) }
      }
      return h('div', { className: 'n2s-field full' },
        h('div', { className: 'n2s-row' },
          h('button', { type: 'button', className: 'n2s-btn small', onClick: load, disabled: st?.busy }, st?.busy ? h('span', { className: 'n2s-spin' }) : Icon.search(13), t('im.pickChat')),
          h('span', { className: 'n2s-faint n2s-small' }, t('ch.pickHint'))),
        st?.error && h('div', { className: 'n2s-fielderr' }, st.error),
        st?.list && (st.list.length === 0
          ? h('div', { className: 'n2s-muted n2s-small' }, t('im.noChats'))
          : h('div', { role: 'group', 'aria-label': fmt(t, 'im.chats', { count: st.list.length }) },
            h('div', { className: 'n2s-faint n2s-small', style: { margin: '4px 0 6px' } }, fmt(t, 'im.chats', { count: st.list.length })),
            h('div', { className: 'n2s-chips' }, st.list.map(c => h('button', { key: c.id, type: 'button', className: 'n2s-chip', 'aria-pressed': current === c.id, title: c.id, onClick: () => onPick(c) }, c.name || c.id))))))
    }

    function ChannelForm({ t, catalog, remote, platform, kind, initial, focusBot, onBack, onClose }) {
      const bots = useBots()
      const caps = kind.capabilities ?? {}
      const modes = chartModesFor(caps, kind.id)
      const editing = Boolean(initial?.id)
      const fields = kind.fields ?? []
      const initBot = useMemo(() => {
        const b = initial ? botOf(initial, bots) : null
        return { enabled: Boolean(b?.enabled), allowP2p: b ? b.allowP2p !== false : true, sessionScope: b?.sessionScope ?? 'chat' }
      }, [])
      const [form, setForm] = useState(() => {
        const config = { ...(initial?.config ?? {}) }
        for (const f of fields) if (!isSecretField(f) && config[f.key] === undefined) config[f.key] = f.default ?? (f.type === 'select' && f.required !== false ? (f.options?.[0]?.value ?? '') : '')
        return { name: initial?.name ?? '', description: initial?.description ?? '', isDefault: Boolean(initial?.isDefault), chartMode: modes.includes(initial?.chartMode) ? initial.chartMode : modes[0], config, secrets: {}, bot: initBot }
      })
      const pristine = useRef(JSON.stringify(form))
      const dirty = JSON.stringify(form) !== pristine.current
      const [errors, setErrors] = useState({})
      const [general, setGeneral] = useState(null)
      const [busy, setBusy] = useState(null)
      const botRef = useRef(null)
      const formRef = useRef(null)
      useEffect(() => { if (focusBot) setTimeout(() => { botRef.current?.scrollIntoView?.({ block: 'center' }); botRef.current?.querySelector('input')?.focus() }, 30) }, [])
      const visible = fields.filter(f => fieldVisible(f, form.config))
      const setConfig = (k, v) => { setForm(f => ({ ...f, config: { ...f.config, [k]: v } })); setErrors(e => ({ ...e, [k]: undefined })) }
      const setSecret = (k, v) => { setForm(f => ({ ...f, secrets: { ...f.secrets, [k]: v } })); setErrors(e => ({ ...e, [k]: undefined })) }
      const setBot = (patch) => setForm(f => ({ ...f, bot: { ...f.bot, ...patch } }))
      const tf = targetFieldOf(kind)
      const canPick = caps.listTargets && tf && fieldVisible(tf, form.config) && (form.config.receiveIdType === undefined || form.config.receiveIdType === 'chat_id' || !fields.some(f => f.key === 'receiveIdType'))

      const validate = () => {
        const errs = {}
        if (!form.name.trim()) errs.name = t('ch.err.required')
        for (const f of visible) {
          const secret = isSecretField(f)
          const v = String((secret ? form.secrets[f.key] : form.config[f.key]) ?? '').trim()
          if (!v) { if (f.required && !(secret && initial?.secretsSet?.[f.key])) errs[f.key] = t('ch.err.required'); continue }
          if (f.pattern) { try { if (!new RegExp(f.pattern).test(v)) errs[f.key] = t('ch.err.pattern') } catch {} }
          if (f.type === 'url' && !/^https?:\/\//i.test(v)) errs[f.key] = t('ch.err.url')
        }
        return errs
      }
      const payload = () => {
        const config = {}
        const secrets = {}
        for (const f of visible) {
          if (isSecretField(f)) { const v = String(form.secrets[f.key] ?? '').trim(); if (v) secrets[f.key] = v }
          else config[f.key] = typeof form.config[f.key] === 'string' ? form.config[f.key].trim() : form.config[f.key]
        }
        const base = { ...(editing ? { id: initial.id } : {}), name: form.name.trim(), type: kind.id, description: form.description.trim(), isDefault: form.isDefault, chartMode: form.chartMode }
        // Old hosts only understand the flat Lark payload.
        if (!remote) return { ...base, ...config, ...secrets }
        return { ...base, config, secrets, ...(caps.bot ? { bot: form.bot } : {}) }
      }
      const showError = (e) => {
        const msg = e?.message ?? String(e)
        const f = (e?.field && fields.find(x => x.key === e.field)) || visible.find(x => msg.includes(x.key) || [x.label?.zh, x.label?.en, typeof x.label === 'string' ? x.label : null].filter(Boolean).some(l => msg.includes(l)))
        if (f) setErrors({ [f.key]: msg }); else setGeneral(msg)
      }
      const focusFirstError = (errs) => setTimeout(() => {
        const k = Object.keys(errs).find(x => errs[x])
        if (k) formRef.current?.querySelector(`#n2s-chf-${CSS_ID(k)}`)?.focus()
      }, 0)
      const save = async (test) => {
        setGeneral(null)
        const errs = validate()
        setErrors(errs)
        if (Object.keys(errs).length) { focusFirstError(errs); return }
        setBusy(test ? 'test' : 'save')
        let id = initial?.id
        try {
          const saved = await call('saveChannel', payload())
          id = saved?.id ?? id
          if (!remote && caps.bot && id && JSON.stringify(form.bot) !== JSON.stringify(initBot) && (form.bot.enabled || initBot.enabled)) {
            await saveBotFor(id, form.bot).catch(notifyError)
          }
        } catch (e) { setBusy(null); showError(e); return }
        await refreshChannels()
        refreshBots()
        if (test && id) {
          try {
            const r = await call('testChannel', { id })
            if (r && r.ok === false) notify(r.detail ? fmt(t, 'ch.savedTestFailedMsg', { msg: r.detail }) : t('ch.savedTestFailed'), 'err')
            else notify(r?.detail ? `${t('ch.testOk')} · ${r.detail}` : t('ch.testOk'), 'ok')
          } catch (e) { notify(fmt(t, 'ch.savedTestFailedMsg', { msg: e.message }), 'err') }
        } else notify(t('ch.saved'), 'ok')
        setBusy(null)
        onClose()
      }
      const testOnly = async () => {
        setBusy('test'); setGeneral(null)
        try {
          const r = await call('testChannel', { id: initial.id })
          if (r && r.ok === false) setGeneral(r.detail ?? t('im.lastFailed'))
          else notify(r?.detail ? `${t('ch.testOk')} · ${r.detail}` : t('ch.testOk'), 'ok')
          refreshChannels()
        } catch (e) { setGeneral(e.message) }
        setBusy(null)
      }
      const steps = L(kind.setupSteps)
      const stepList = Array.isArray(steps) ? steps : []
      const idBase = 'n2s-chf'
      return h('div', { ref: formRef },
        h('div', { className: 'n2s-wiz-head' },
          !editing && h('button', { type: 'button', className: 'n2s-iconbtn', 'aria-label': t('ch.back'), title: t('ch.back'), onClick: onBack }, h('span', { style: { display: 'inline-flex', transform: 'rotate(180deg)' } }, Icon.arrow(14))),
          h(PlatformMark, { t, platform, size: 32 }),
          h('div', { className: 'n2s-grow' },
            h('div', { id: 'n2s-wiz-title', className: 'n2s-modal-title' }, editing ? fmt(t, 'ch.editTitle', { name: initial.name }) : t('ch.addTitle')),
            h('div', { className: 'n2s-muted n2s-small' }, `${platformName(t, platform, catalog)} · ${L(kind.label)}`)),
          h('button', { type: 'button', className: 'n2s-iconbtn n2s-modal-x', 'aria-label': t('ds.cancel'), onClick: onClose }, Icon.close())),
        !editing && h('ol', { className: 'n2s-wiz-steps', 'aria-label': t('ch.addTitle') },
          h('li', { className: 'done' }, t('ch.step.pick')), h('li', { className: 'current', 'aria-current': 'step' }, t('ch.step.config'))),
        stepList.length > 0 && h('details', { className: 'n2s-setup', open: !editing },
          h('summary', null, fmt(t, 'ch.setupSteps', { n: stepList.length })),
          h('ol', null, stepList.map((s, i) => h('li', { key: i }, s)))),
        h('div', { className: 'n2s-form', style: { marginTop: 14 } },
          h(FieldInput, { t, idBase, f: { key: 'name', label: t('im.name'), required: true, placeholder: t('ph.channelName') }, value: form.name, error: errors.name, onChange: (v) => { setForm(f => ({ ...f, name: v })); setErrors(e => ({ ...e, name: undefined })) } }),
          h(FieldInput, { t, idBase, f: { key: 'description', label: t('im.description') }, value: form.description, onChange: (v) => setForm(f => ({ ...f, description: v })) }),
          visible.map(f => h(FieldInput, {
            key: f.key, t, idBase, f, error: errors[f.key],
            keep: isSecretField(f) && Boolean(initial?.secretsSet?.[f.key]),
            value: isSecretField(f) ? (form.secrets[f.key] ?? '') : form.config[f.key],
            onChange: (v) => (isSecretField(f) ? setSecret(f.key, v) : setConfig(f.key, v)),
          })),
          canPick && h(TargetPicker, {
            t, kind, remote, initial, config: Object.fromEntries(visible.filter(f => !isSecretField(f)).map(f => [f.key, form.config[f.key]])), secrets: Object.fromEntries(Object.entries(form.secrets).filter(([k, v]) => v && visible.some(f => f.key === k))), current: form.config[tf.key],
            onPick: (c) => { setForm(f => ({ ...f, name: f.name || c.name || '', config: { ...f.config, [tf.key]: c.id } })); setErrors(e => ({ ...e, [tf.key]: undefined, name: undefined })) },
          }),
          h('div', { className: 'n2s-field full' },
            h('span', { className: 'n2s-flabel', id: 'n2s-chf-cm' }, t('im.chartMode')),
            h('div', { className: 'n2s-seg', role: 'group', 'aria-labelledby': 'n2s-chf-cm', style: { justifySelf: 'start' } }, modes.map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.chartMode === v, onClick: () => setForm(f => ({ ...f, chartMode: v })) }, t(`im.cm.${v}`)))),
            h('span', { className: 'n2s-faint n2s-small' }, caps.charts === 'none' ? t('ch.tablesOnly') : modes.includes('native') ? t('im.cmHint') : t('ch.cmImage'))),
          h('label', { className: 'n2s-check full' }, h('input', { type: 'checkbox', checked: form.isDefault, onChange: e => setForm(f => ({ ...f, isDefault: e.target.checked })) }), t('im.setDefault'))),
        caps.bot && h('fieldset', { ref: botRef, className: `n2s-botbox${focusBot ? ' focus' : ''}` },
          h('legend', null, t('ch.botSection')),
          h('div', { className: 'n2s-muted n2s-small', style: { marginBottom: 10 } }, t('ch.botSectionHint')),
          h('label', { className: 'n2s-switch' }, h('input', { type: 'checkbox', role: 'switch', checked: form.bot.enabled, onChange: e => setBot({ enabled: e.target.checked }) }), h('span', null, t('ch.botEnable'))),
          form.bot.enabled && h('div', { className: 'n2s-form', style: { marginTop: 12 } },
            h('label', { className: 'n2s-field' }, h('span', null, t('bot.scope')),
              h('select', { className: 'n2s-select', value: form.bot.sessionScope, onChange: e => setBot({ sessionScope: e.target.value }) }, ['chat', 'user'].map(x => h('option', { key: x, value: x }, t(`bot.scope.${x}`))))),
            h('label', { className: 'n2s-check', style: { alignSelf: 'end', height: 34 } }, h('input', { type: 'checkbox', checked: form.bot.allowP2p, onChange: e => setBot({ allowP2p: e.target.checked }) }), t('bot.p2p')))),
        general && h('div', { className: 'n2s-notice err', role: 'alert', style: { marginTop: 12 } }, general),
        h('div', { className: 'n2s-row n2s-wiz-foot' },
          h('span', { className: 'n2s-faint n2s-small n2s-grow' }, editing && !dirty ? '' : t('ch.testSavesFirst')),
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onClose }, t('ds.cancel')),
          editing && !dirty
            ? h('button', { type: 'button', className: 'n2s-btn', disabled: Boolean(busy), onClick: testOnly }, busy === 'test' ? h('span', { className: 'n2s-spin' }) : null, t('ch.testConn'))
            : h('button', { type: 'button', className: 'n2s-btn', disabled: Boolean(busy), onClick: () => save(true) }, busy === 'test' ? h('span', { className: 'n2s-spin' }) : null, t('im.saveTest')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: Boolean(busy), onClick: () => save(false) }, busy === 'save' ? h('span', { className: 'n2s-spin' }) : null, t('ds.save'))))
    }
    const CSS_ID = (k) => String(k).replace(/[^\w-]/g, '_')

    /** Add (pick platform → kind → form) or edit (form only) a channel. */
    function ChannelWizard({ t, initial, focusBot, onClose }) {
      const { catalog, remote, ready } = useCatalog(t)
      const editing = Boolean(initial?.id)
      const [platform, setPlatform] = useState(initial?.platform ?? null)
      const [type, setType] = useState(initial?.type ?? null)
      const p = platform ?? catalog[0]?.platform
      const found = type ? findKind(catalog, type) : null
      const step = type ? 'form' : 'pick'
      return h(Modal, { label: editing ? fmt(t, 'ch.editTitle', { name: initial.name }) : t('ch.addTitle'), labelledBy: step === 'form' && found ? 'n2s-wiz-title' : undefined, onClose, width: 720, className: 'n2s-wizard' },
        !ready ? h('div', { className: 'n2s-skel', style: { height: 220 } }) :
          step === 'pick' ? h(React.Fragment, null,
            h('div', { className: 'n2s-wiz-head' },
              h('div', { className: 'n2s-grow' }, h('div', { className: 'n2s-modal-title' }, t('ch.addTitle')), h('div', { className: 'n2s-muted n2s-small' }, t('ch.addSub'))),
              h('button', { type: 'button', className: 'n2s-iconbtn n2s-modal-x', 'aria-label': t('ds.cancel'), onClick: onClose }, Icon.close())),
            h('ol', { className: 'n2s-wiz-steps', 'aria-label': t('ch.addTitle') }, h('li', { className: 'current', 'aria-current': 'step' }, t('ch.step.pick')), h('li', null, t('ch.step.config'))),
            catalog.length === 0 ? h('div', { className: 'n2s-empty' }, t('ch.noCatalog')) :
              h(KindPicker, { t, catalog, platform: p, onPlatform: setPlatform, onPick: (pl, k) => { setPlatform(pl); setType(k) } })) :
          !found ? h('div', null,
            h('div', { className: 'n2s-notice err' }, fmt(t, 'ch.unknownKind', { type })),
            h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } }, h('button', { type: 'button', className: 'n2s-btn', onClick: onClose }, t('ds.cancel')))) :
            h(ChannelForm, { key: type, t, catalog, remote, platform: found.platform.platform, kind: found.kind, initial: editing ? initial : null, focusBot, onBack: () => setType(null), onClose }))
    }

    // ----------------------------------------------------------------- list

    const shortTime = (ts) => new Date(ts).toLocaleString(uiLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

    function ChannelRow({ t, c, catalog, bots, onEdit, act }) {
      const kind = findKind(catalog, c.type)?.kind
      const caps = c.capabilities ?? kind?.capabilities
      const target = targetSummary(t, c, kind)
      const bot = caps?.bot ? botOf(c, bots) : null
      return h('div', { className: 'n2s-list2-row', 'data-channel': c.id },
        h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
          h('div', { className: 'n2s-row', style: { gap: 6 } },
            h('span', { className: 'n2s-list2-title' }, c.name),
            c.isDefault && h('span', { className: 'n2s-badge blue' }, t('im.default')),
            c.needsSecret && h('span', { className: 'n2s-badge warn', title: t('ds.needsSecretHint') }, t('ds.needsSecret')),
            c.secretsSet?.signSecret && h('span', { className: 'n2s-badge' }, t('im.signed'))),
          h('div', { className: 'n2s-list2-sub' }, kindLabel(t, c.type, catalog), target ? ' · ' : '', target && h('span', { className: target === t('im.webhookHidden') ? undefined : 'n2s-mono' }, target)),
          h('div', { className: 'n2s-row', style: { gap: 8, marginTop: 6 } },
            h(CapabilityChips, { t, caps, type: c.type }),
            bot && h(BotDot, { t, bot, prefix: t('ch.cap.bot') })),
          c.lastError && h('div', { className: 'n2s-list2-sub', style: { color: 'var(--n2s-err)', whiteSpace: 'normal' } }, c.lastError)),
        h('div', { className: 'n2s-list2-side' },
          h('span', { className: `n2s-statusdot ${c.lastError ? 'err' : c.lastSentAt ? 'ok' : ''}` }, c.lastError ? t('im.lastFailed') : c.lastSentAt ? t('im.statusOk') : t('im.statusNew')),
          c.lastSentAt && h('span', { className: 'n2s-faint n2s-small' }, `${t('im.lastSent')} ${shortTime(c.lastSentAt)}`)),
        h('div', { className: 'n2s-row', style: { gap: 2, flexWrap: 'nowrap' } },
          h('button', { type: 'button', className: 'n2s-btn small', onClick: () => act(() => call('testChannel', { id: c.id }), t('ch.testOk')) }, t('im.test')),
          h(Dropdown, { label: fmt(t, 'ch.actionsFor', { name: c.name }), trigger: { content: Icon.more() }, items: [
            { label: t('ds.edit'), icon: Icon.edit(14), onClick: () => onEdit(c, false) },
            !c.isDefault && { label: t('im.makeDefault'), icon: Icon.check(14), onClick: () => act(() => makeDefault(c), t('ch.defaultSet')) },
            caps?.bot && { label: t('ch.botSettings'), icon: Icon.spark(14), onClick: () => onEdit(c, true) },
            { divider: true },
            { label: t('ds.delete'), icon: Icon.trash(14), danger: true, onClick: async () => { if (await confirmDialog({ title: fmt(t, 'im.deleteConfirm', { name: c.name }), message: caps?.bot && bot?.enabled ? t('ch.deleteBotWarn') : undefined, confirmLabel: t('ds.delete'), danger: true })) act(() => call('deleteChannel', { id: c.id }), t('ch.deleted')) } },
          ] })))
    }

    /** Mark a channel as default; old hosts need the flat payload, new ones the config shape. */
    function makeDefault(c) {
      if (c.legacy) return call('saveChannel', { id: c.id, name: c.name, type: c.type, description: c.description, chartMode: c.chartMode, ...c.config, isDefault: true })
      return call('saveChannel', { id: c.id, name: c.name, type: c.type, description: c.description, chartMode: c.chartMode, config: c.config, secrets: {}, isDefault: true })
    }

    function DeliveryLog({ t, channels, deliveries }) {
      const [open, setOpen] = useState(false)
      const rows = deliveries ?? []
      if (!rows.length) return null
      const failed = rows.slice(0, 50).filter(d => d.status !== 'ok').length
      const platformOf = (d) => d.platform ?? channels.find(c => c.id === d.channelId)?.platform ?? channels.find(c => c.name === d.channelName)?.platform
      return h('div', { className: 'n2s-collapse' },
        h('button', { type: 'button', 'aria-expanded': open, 'aria-controls': 'n2s-deliveries', onClick: () => setOpen(v => !v) },
          t('im.log'), h('span', { className: 'n2s-faint' }, rows.length), failed > 0 && h('span', { className: 'n2s-badge err' }, fmt(t, 'ch.failedN', { n: failed })), Icon.chev(12)),
        open && h('div', { id: 'n2s-deliveries', className: 'n2s-table-wrap', style: { marginTop: 12 } }, h('table', { className: 'n2s-table' },
          h('thead', null, h('tr', null, ['im.col.time', 'im.col.channel', 'im.col.title', 'im.col.source', 'im.col.status'].map(k => h('th', { key: k }, t(k))))),
          h('tbody', null, rows.slice(0, 50).map(d => h('tr', { key: d.id },
            h('td', { className: 'n2s-muted' }, shortTime(d.at)),
            h('td', null, h('span', { className: 'n2s-row', style: { gap: 6, flexWrap: 'nowrap' } }, platformOf(d) && h(PlatformMark, { t, platform: platformOf(d), size: 18 }), d.channelName)),
            h('td', { title: d.title }, d.title),
            h('td', { className: 'n2s-muted' }, tOpt(t, `im.src.${d.source}`) || d.source),
            h('td', { title: d.error ?? '' }, d.status === 'ok'
              ? h('span', { className: 'n2s-statusdot ok' }, [t('im.sentOk'), d.results ? fmt(t, 'im.resultsN', { count: d.results }) : '', d.files ? t('im.sentFile') : '', d.error ? d.error : ''].filter(Boolean).join(' · '))
              : h('span', { className: 'n2s-statusdot err' }, d.error ?? t('im.lastFailed')))))))))
    }

    function PushTab({ t }) {
      const channels = useChannels()
      const bots = useBots()
      const { catalog } = useCatalog(t)
      const deliveries = useAsync(() => call('listDeliveries'), [channels], [])
      const [editing, setEditing] = useState(null)
      // Pick up host upgrades (catalog, new channel shape) whenever the page opens.
      useEffect(() => { loadCatalog(); refreshChannels(); refreshBots() }, [])
      useEffect(() => {
        const id = setInterval(() => { if (!document.hidden) refreshBots() }, 8000)
        return () => clearInterval(id)
      }, [])
      // Opened from the bot overview: jump straight into that channel's bot settings.
      const nav = useSyncExternalStore(channelNav.subscribe, channelNav.get, channelNav.get)
      useEffect(() => {
        if (!nav.edit) return
        const c = channels.find(x => x.id === nav.edit.id)
        if (c) { setEditing({ channel: c, focusBot: nav.edit.bot }); channelNav.set({ edit: null }) }
      }, [nav, channels])
      const act = async (fn, ok) => {
        try { const r = await fn(); if (r && r.ok === false) notify(r.detail ?? t('im.lastFailed'), 'err'); else if (ok) notify(r?.detail ? `${ok} · ${r.detail}` : ok, 'ok') } catch (e) { notifyError(e) }
        refreshChannels()
        refreshBots()
      }
      const groups = []
      for (const c of channels) {
        let g = groups.find(x => x.platform === c.platform)
        if (!g) groups.push(g = { platform: c.platform, items: [] })
        g.items.push(c)
      }
      const rank = (p) => { const i = catalog.findIndex(x => x.platform === p); return i < 0 ? 99 : i }
      groups.sort((a, b) => rank(a.platform) - rank(b.platform))
      const add = () => setEditing({ channel: null })
      return h('div', null,
        h(SectionHead, { title: t('admin.push'), desc: t('ch.desc') }, h('button', { type: 'button', className: 'n2s-btn primary', onClick: add }, '+ ', t('im.add'))),
        channels.length === 0
          ? h('div', { className: 'n2s-empty' },
            h('div', { className: 'n2s-row', style: { justifyContent: 'center', gap: 8, marginBottom: 12 } }, catalog.map(p => h(PlatformMark, { key: p.platform, t, platform: p.platform, size: 32 }))),
            h('h3', null, t('im.empty')), h('div', null, t('ch.emptyHint')),
            h('button', { type: 'button', className: 'n2s-btn primary', onClick: add }, t('im.add')))
          : h('div', { className: 'n2s-pgroups' }, groups.map(g => h('section', { key: g.platform, className: 'n2s-pgroup', 'aria-label': platformName(t, g.platform, catalog) },
            h('div', { className: 'n2s-pgroup-head' }, h(PlatformMark, { t, platform: g.platform, size: 22 }), h('span', null, platformName(t, g.platform, catalog)), h('span', { className: 'n2s-faint' }, g.items.length)),
            h('div', { className: 'n2s-list2' }, g.items.map(c => h(ChannelRow, { key: c.id, t, c, catalog, bots, act, onEdit: (ch, focusBot) => setEditing({ channel: ch, focusBot }) })))))),
        h(DeliveryLog, { t, channels, deliveries: deliveries.value }),
        editing && h(ChannelWizard, { key: editing.channel?.id ?? 'new', t, initial: editing.channel, focusBot: editing.focusBot, onClose: () => setEditing(null) }))
    }

    const HIDDEN_PIN = { hidden: true }
    const WIDGET_WIDTHS = ['third', 'half', 'full']

    function DashboardWidget({ t, widget, onRemove, onChanged, onMove, tick, first, last, filters, filterCount, otherBoards = [], onTransfer, onLoaded, drag, source, showSource }) {
      const [state, setState] = useState({ busy: true })
      const [local, setLocal] = useState(0)
      useEffect(() => {
        let alive = true
        setState(s => ({ ...s, busy: true, error: undefined }))
        call('runWidget', { id: widget.id, filters, fresh: local > 0 || tick > 0 }).then(
          r => { if (alive) { setState({ result: r, at: Date.now() }); onLoaded?.(widget.id, { at: Date.now(), cached: Boolean(r.cached), cachedAt: r.cachedAt }) } },
          e => { if (alive) { setState({ error: e.message }); onLoaded?.(widget.id, { at: Date.now(), error: true }) } })
        return () => { alive = false }
      }, [widget.id, tick, local, filters])
      const update = async (patch) => { try { await call('updateWidget', { id: widget.id, ...patch }) } catch (e) { notifyError(e) } onChanged() }
      const ago = state.at ? new Date(state.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
      const widgetResult = useMemo(() => (state.result ? { ...state.result, title: '' } : null), [state.result])
      const width = WIDGET_WIDTHS.includes(widget.width) ? widget.width : 'half'
      return h('div', {
        className: `n2s-widget w-${width}${drag.dragging ? ' dragging' : ''}${drag.over ? ` drop-${drag.over}` : ''}`,
        onDragOver: drag.onDragOver, onDragLeave: drag.onDragLeave, onDrop: drag.onDrop,
      },
        h('div', { className: 'n2s-widget-head' },
          h('span', {
            className: 'n2s-draghandle', draggable: true, role: 'button', tabIndex: 0, title: t('dash.dragHint'), 'aria-label': fmt(t, 'dash.dragLabel', { title: widget.title }),
            onDragStart: drag.onDragStart, onDragEnd: drag.onDragEnd,
            onKeyDown: (e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); if (!first) onMove(-1) } if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); if (!last) onMove(1) } },
          }, svg(14, [h('circle', { key: 1, cx: 6, cy: 4, r: .9, fill: 'currentColor' }), h('circle', { key: 2, cx: 10, cy: 4, r: .9, fill: 'currentColor' }), h('circle', { key: 3, cx: 6, cy: 8, r: .9, fill: 'currentColor' }), h('circle', { key: 4, cx: 10, cy: 8, r: .9, fill: 'currentColor' }), h('circle', { key: 5, cx: 6, cy: 12, r: .9, fill: 'currentColor' }), h('circle', { key: 6, cx: 10, cy: 12, r: .9, fill: 'currentColor' })])),
          h('span', { className: 'title', title: widget.title }, widget.title),
          showSource && h('span', { className: `n2s-badge n2s-srcbadge${source ? '' : ' warn'}`, title: source ? `${t('dash.sourceOf')}: ${source.name} · ${typeLabel(t, source.type)}` : t('dash.sourceMissing') }, Icon.db(11), source ? source.name : t('dash.sourceMissingShort')),
          state.busy ? h('span', { className: 'n2s-spin n2s-faint', 'aria-label': t('dash.loading') }) : ago && h('span', { className: 'n2s-faint n2s-small n2s-hide-narrow', title: state.result?.cached ? fmt(t, 'dash.cachedAt', { time: new Date(state.result.cachedAt).toLocaleTimeString() }) : t('dash.updatedAt') }, state.result?.cached ? `${ago} · ${t('dash.cached')}` : ago),
          state.result?.filters?.length > 0 && h('span', { className: 'n2s-badge blue', title: state.result.filters.map(f => f.description).join('\n') }, fmt(t, 'filter.appliedCount', { count: state.result.filters.length })),
          state.result && filterCount > 0 && !(state.result.filters?.length) && h('span', { className: 'n2s-badge', title: t('filter.notApplied') }, t('filter.notAppliedShort')),
          h('div', { className: 'n2s-widget-actions' },
            h('button', { type: 'button', className: 'n2s-iconbtn', title: t('dash.refreshOne'), 'aria-label': t('dash.refreshOne'), onClick: () => setLocal(x => x + 1) }, Icon.refresh(14)),
            h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
              { label: t('dash.rename'), icon: Icon.edit(14), onClick: async () => { const v = await promptDialog({ title: t('dash.rename'), value: widget.title }); if (v) update({ title: v }) } },
              ...WIDGET_WIDTHS.map(w => ({ label: t(`dash.width.${w}`), checked: width === w, onClick: () => width !== w && update({ width: w }) })),
              { divider: true },
              { label: t('dash.moveUp'), icon: Icon.up(14), disabled: first, onClick: () => onMove(-1) },
              { label: t('dash.moveDown'), icon: Icon.down(14), disabled: last, onClick: () => onMove(1) },
              ...otherBoards.flatMap(b => [{ label: fmt(t, 'dash.copyTo', { name: b.name }), icon: Icon.copy(14), onClick: () => onTransfer(b.id, true) }, { label: fmt(t, 'dash.moveTo', { name: b.name }), icon: Icon.arrow(14), onClick: () => onTransfer(b.id, false) }]),
              { divider: true },
              { label: t('dash.remove'), icon: Icon.trash(14), danger: true, onClick: onRemove },
            ] }))),
        state.error && h('div', { className: 'n2s-notice err' }, state.error, ' ', h('button', { type: 'button', className: 'n2s-link', onClick: () => setLocal(x => x + 1) }, t('dash.retry'))),
        !state.result && state.busy && h('div', { className: 'n2s-skel', style: { height: 220 } }),
        state.result && h(ResultView, { result: widgetResult, t, compact: true, embedded: true, onPinned: HIDDEN_PIN }))
    }

    function DashboardTab({ t, ds, datasources = [] }) {
      const [boardId, setBoardId] = useState(null)
      const list = useAsync(() => call('listDashboard'), [boardId])
      const boards = useAsync(() => call('listDashboards'), [boardId])
      const [tick, setTick] = useState(0)
      const [auto, setAuto] = useState(0)
      useEffect(() => {
        if (!auto) return
        const id = setInterval(() => setTick(x => x + 1), auto * 1000)
        return () => clearInterval(id)
      }, [auto])
      // Optimistic order while a drag-and-drop reorder is being saved.
      const [order, setOrder] = useState(null)
      useEffect(() => { setOrder(null) }, [list.value])
      const serverWidgets = list.value ?? []
      const allWidgets = order ? order.map(id => serverWidgets.find(w => w.id === id)).filter(Boolean) : serverWidgets
      // Widgets keep the data source they were pinned from; a board may mix sources.
      // Scope: all sources, or only the one selected at the top right (remembered per browser).
      const [scope, setScopeState] = useState(() => { try { return localStorage.getItem('nl2sql:dashScope') === 'current' ? 'current' : 'all' } catch { return 'all' } })
      const setScope = (v) => { setScopeState(v); try { localStorage.setItem('nl2sql:dashScope', v) } catch {} }
      const sourceIds = [...new Set(allWidgets.map(w => w.datasourceId))]
      const mixed = sourceIds.length > 1
      const dsById = new Map(datasources.map(d => [d.id, d]))
      const widgets = scope === 'current' && ds ? allWidgets.filter(w => w.datasourceId === ds.id) : allWidgets
      const hiddenByScope = allWidgets.length - widgets.length
      const showSource = mixed || (ds && sourceIds.some(id => id !== ds.id))
      const saved = useAsync(() => call('getDashboardFilters'), [boardId])
      const [filters, setFilters] = useState(null)
      const [filtersFor, setFiltersFor] = useState(null)
      // Adopt the saved filters only once they belong to the current board (avoid showing the previous board's filters).
      useEffect(() => { if (!saved.loading && saved.value) { setFilters(saved.value); setFiltersFor(boardId) } }, [saved.value, saved.loading, boardId])
      const filtersReady = filters !== null && filtersFor === boardId
      const [sendingDash, setSendingDash] = useState(false)
      // Saves are serialized so an older save can never land after a newer one.
      const saveChain = useRef(Promise.resolve())
      const changeFilters = (next) => {
        setFilters(next)
        saveChain.current = saveChain.current.then(() => call('saveDashboardFilters', { filters: next })).catch((e) => notifyError(e))
      }
      const otherBoards = (boards.value?.dashboards ?? []).filter(d => d.id !== boards.value?.current)
      // Per-widget load status → header summary ("updated 10:42 · 2 from cache").
      const [loads, setLoads] = useState({})
      useEffect(() => { setLoads({}) }, [boardId])
      const onLoaded = useCallback((id, info) => setLoads(l => ({ ...l, [id]: info })), [])
      const loadList = widgets.map(w => loads[w.id]).filter(Boolean)
      const lastAt = loadList.length ? Math.max(...loadList.map(x => x.at)) : null
      const cachedN = loadList.filter(x => x.cached).length
      const errorN = loadList.filter(x => x.error).length
      const loadingN = widgets.length - loadList.length
      // Drag and drop.
      const [dragId, setDragId] = useState(null)
      const [over, setOver] = useState(null) // { id, pos: 'before'|'after' }
      const commitOrder = async (visibleIds) => {
        // Hidden (other-source) widgets keep their slots; visible ones take the new order.
        const queue = [...visibleIds]
        const visible = new Set(visibleIds)
        const ids = allWidgets.map(w => (visible.has(w.id) ? queue.shift() : w.id))
        setOrder(ids)
        try { await call('reorderWidgets', { dashboardId: boards.value?.current, ids }) } catch (e) { notifyError(e); setOrder(null) }
        list.reload()
      }
      const dragProps = (w) => ({
        dragging: dragId === w.id,
        over: over?.id === w.id && dragId !== w.id ? over.pos : null,
        onDragStart: (e) => { setDragId(w.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', w.id) } catch {} },
        onDragEnd: () => { setDragId(null); setOver(null) },
        onDragOver: (e) => {
          if (!dragId || dragId === w.id) return
          e.preventDefault()
          const r = e.currentTarget.getBoundingClientRect()
          const pos = (r.width > r.height * 1.6 ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2) ? 'before' : 'after'
          if (over?.id !== w.id || over?.pos !== pos) setOver({ id: w.id, pos })
        },
        onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget) && over?.id === w.id) setOver(null) },
        onDrop: (e) => {
          e.preventDefault()
          if (!dragId || dragId === w.id) return
          const ids = widgets.map(x => x.id).filter(id => id !== dragId)
          const at = ids.indexOf(w.id) + (over?.pos === 'after' ? 1 : 0)
          ids.splice(at, 0, dragId)
          setDragId(null); setOver(null)
          commitOrder(ids)
        },
      })
      const move = (w, delta) => {
        const ids = widgets.map(x => x.id)
        const i = ids.indexOf(w.id)
        const j = i + delta
        if (j < 0 || j >= ids.length) return
        ;[ids[i], ids[j]] = [ids[j], ids[i]]
        commitOrder(ids)
        setTimeout(() => document.querySelectorAll('.n2s-draghandle')[j]?.focus(), 50)
      }
      return h('div', null,
        h(DashboardSwitcher, { t, value: { id: boardId }, onChange: (id) => setBoardId(`${id}:${Date.now()}`) }),
        allWidgets.length > 0 && h('div', { className: 'n2s-toolbar n2s-dashbar' },
          h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
            h('div', { className: 'n2s-row', style: { gap: 10 } },
              h('div', { className: 'n2s-h2', style: { margin: 0 } }, fmt(t, 'dash.count', { count: widgets.length })),
              (mixed || hiddenByScope > 0 || (ds && sourceIds.some(id => id !== ds.id))) && h('div', { className: 'n2s-seg small', role: 'group', 'aria-label': t('dash.scope') },
                ['all', 'current'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': scope === v, disabled: v === 'current' && !ds, onClick: () => setScope(v) }, v === 'all' ? t('dash.scopeAll') : fmt(t, 'dash.scopeCurrent', { name: ds?.name ?? '' }))))),
            showSource && h('div', { className: 'n2s-faint n2s-small' }, fmt(t, 'dash.sources', { list: joinList(sourceIds.map(id => dsById.get(id)?.name ?? t('dash.sourceMissingShort'))) })),
            h('div', { className: 'n2s-faint n2s-small', role: 'status', 'aria-live': 'polite' },
              loadingN > 0 ? fmt(t, 'dash.loadingN', { n: loadingN }) : lastAt ? fmt(t, 'dash.lastRefresh', { time: new Date(lastAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }) : '',
              cachedN > 0 && loadingN === 0 ? h('span', null, ' · ', h('button', { type: 'button', className: 'n2s-link', title: t('dash.cachedHint'), onClick: () => setTick(x => x + 1) }, fmt(t, 'dash.cachedN', { n: cachedN }))) : null,
              errorN > 0 ? h('span', { style: { color: 'var(--n2s-err)' } }, ' · ', fmt(t, 'dash.errorN', { n: errorN })) : null)),
          h('div', { className: 'n2s-dashbar-actions' },
            h(Dropdown, { label: t('dash.export'), trigger: { className: 'n2s-btn small ghost', content: h(React.Fragment, null, Icon.download(13), h('span', { className: 'n2s-hide-narrow' }, t('dash.export')), Icon.chev(10)) }, items: [
              { label: t('result.excel'), icon: Icon.download(14), onClick: () => exportExcel({ dashboardId: boards.value?.current }) },
              { label: t('dash.snapshot'), icon: Icon.pin(14), onClick: async () => { try { const s = await call('snapshotDashboard', { dashboardId: boards.value?.current }); notify(fmt(t, 'dash.snapshotDone', { n: s.widgets.length }), 'ok') } catch (e) { notifyError(e) } } },
              ...extItems(extend.dashboardMenu, { t, boardId: boards.value?.current, widgets, filters: filters ?? [] }),
            ] }),
            ...extend.dashboardBar.map((C, i) => h(C, { key: `x${i}`, t, boardId: boards.value?.current, widgets, filters: filters ?? [] })),
            h(Dropdown, { label: t('dash.auto'), trigger: { className: 'n2s-btn small ghost', content: h(React.Fragment, null, Icon.refresh(13), h('span', { className: 'n2s-hide-narrow' }, auto ? fmt(t, 'dash.autoEvery', { min: auto / 60 }) : t('dash.autoShort')), Icon.chev(10)) },
              items: [0, 60, 300, 900].map(v => ({ label: v === 0 ? t('dash.autoOff') : fmt(t, 'dash.autoEvery', { min: v / 60 }), checked: auto === v, onClick: () => setAuto(v) })) }),
            h('button', { type: 'button', className: 'n2s-btn small', onClick: () => setTick(x => x + 1) }, t('dash.refresh')),
            h('button', { type: 'button', className: 'n2s-btn small primary', onClick: () => setSendingDash(true) }, Icon.send(13), h('span', { className: 'n2s-hide-narrow' }, t('im.shareDashboard'))))),
        widgets.length > 0 && filtersReady && h(FilterBar, { key: `f:${boardId ?? 'b'}`, t, filters, onChange: changeFilters }),
        sendingDash && h(SendDialog, { t, initial: { title: t('im.dashboardTitle'), dashboard: true }, onClose: () => setSendingDash(false) }),
        list.error && h('div', { className: 'n2s-notice err' }, list.error.message),
        !list.loading && widgets.length === 0 && hiddenByScope > 0 && h('div', { className: 'n2s-empty' }, h('h3', null, fmt(t, 'dash.scopeEmpty', { name: ds?.name ?? '' })), h('div', null, fmt(t, 'dash.scopeEmptyHint', { n: hiddenByScope })), h('button', { type: 'button', className: 'n2s-btn', onClick: () => setScope('all') }, t('dash.scopeAll'))),
        !list.loading && allWidgets.length === 0 && h('div', { className: 'n2s-empty' }, h('h3', null, t('dash.empty')), h('div', null, t('dash.emptyHint')), h('button', { type: 'button', className: 'n2s-btn', onClick: () => fbCtx.navigate?.({ tab: 'ask' }) }, t('dash.goAsk'))),
        widgets.length > 1 && h('div', { className: 'n2s-faint n2s-small n2s-hide-narrow', style: { margin: '-4px 0 8px' } }, t('dash.dragTip')),
        filtersReady && !list.loading && h('div', { className: `n2s-dash${dragId ? ' is-dragging' : ''}`, key: `d:${boardId ?? 'b'}` }, widgets.map((w, i) => h(DashboardWidget, {
          key: w.id, t, widget: w, tick, first: i === 0, last: i === widgets.length - 1, filters: filters ?? [], filterCount: (filters ?? []).filter(f => f.kind !== 'in' || f.values.length > 0).length,
          onChanged: () => list.reload(), onLoaded, drag: dragProps(w), source: dsById.get(w.datasourceId), showSource,
          onMove: (delta) => move(w, delta),
          onRemove: async () => { if (!await confirmDialog({ title: fmt(t, 'dash.removeConfirm', { title: w.title }), danger: true })) return; try { await call('unpinWidget', { id: w.id }); notify(t('dash.removed'), 'ok') } catch (e) { notifyError(e) } list.reload() },
          otherBoards, onTransfer: async (to, copy) => { try { await call('transferWidget', { id: w.id, toDashboardId: to, copy }); notify(copy ? t('dash.copied') : t('dash.moved'), 'ok') } catch (e) { notifyError(e) } list.reload(); boards.reload() },
        }))))
    }
    // ------------------------------------------------------- drill & why

    function DrillPanel({ t, result, drill, onClose, onChange }) {
      const dims = useAsync(() => call('drillDimensions', { resultId: result.resultId }), [result.resultId])
      const [state, setState] = useState(null)
      const run = async (payload) => {
        setState({ busy: true })
        try { setState({ result: await call('drill', { resultId: result.resultId, ...payload }) }) } catch (e) { setState({ error: e.message }) }
      }
      const runWhy = async (payload) => {
        setState({ busy: true })
        try { setState({ why: await call('explainChange', { resultId: result.resultId, ...payload }) }) } catch (e) { setState({ error: e.message }) }
      }
      useEffect(() => { setState(null); if (drill.mode === 'why') runWhy({}) }, [drill.mode, drill.xValue])
      const d = dims.value?.dimensions ?? []
      const xLabel = drill.mode === 'why' ? (state?.why ? `${state.why.baseline} → ${state.why.current}` : '…') : drill.xValue !== undefined ? `${result.chart?.x} = ${drill.xValue}` : t('drill.wholeResult')
      return h('div', { className: 'n2s-drill' },
        h('div', { className: 'n2s-row', style: { marginBottom: 8 } },
          h('span', { className: 'n2s-h2', style: { margin: 0 } }, drill.mode === 'why' ? t('drill.whyTitle') : t('drill.title')),
          h('span', { className: 'n2s-badge blue' }, xLabel),
          h('span', { className: 'n2s-grow' }),
          h('button', { type: 'button', className: 'n2s-iconbtn', 'aria-label': t('ds.cancel'), onClick: onClose }, Icon.close())),
        drill.mode !== 'why' && h('div', { className: 'n2s-row', style: { gap: 6 } },
          drill.xValue !== undefined && h('button', { type: 'button', className: 'n2s-btn small', onClick: () => run({ mode: 'detail', xValue: drill.xValue }) }, Icon.table(13), t('drill.detail')),
          h('span', { className: 'n2s-faint n2s-small' }, t('drill.splitBy')),
          dims.loading ? h('span', { className: 'n2s-spin n2s-faint' }) : d.length === 0 ? h('span', { className: 'n2s-faint n2s-small' }, t('drill.noDims')) :
            d.slice(0, 10).map(x => h('button', { key: x.column, type: 'button', className: 'n2s-chip', title: x.label, onClick: () => run({ mode: 'breakdown', xValue: drill.xValue, dimension: x.column }) }, x.label === x.column ? x.column : `${x.label}`)),
          result.rows.length >= 2 && h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => onChange({ mode: 'why' }) }, Icon.spark(13), t('drill.why'))),
        state?.busy && h('div', { className: 'n2s-skel', style: { height: 160, marginTop: 10 } }),
        state?.error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, state.error),
        state?.result && h('div', { style: { marginTop: 10 } }, h(ResultView, { result: state.result, t, compact: true })),
        state?.why && h(WhyView, { t, why: state.why }))
    }

    function WhyView({ t, why }) {
      const [sel, setSel] = useState(0)
      const ok = why.dimensions.filter(d => d.attribution)
      const cur = ok[sel]
      const max = cur ? Math.max(...cur.attribution.items.map(i => Math.abs(i.delta)), 1) : 1
      return h('div', { style: { marginTop: 10, display: 'grid', gap: 10 } },
        h('div', { className: 'n2s-notice' }, why.summary),
        !why.additive && h('div', { className: 'n2s-faint n2s-small' }, t('drill.nonAdditive')),
        ok.length > 0 && h('div', { className: 'n2s-seg' }, ok.map((d, i) => h('button', { key: d.dimension, type: 'button', 'aria-pressed': sel === i, onClick: () => setSel(i) }, `${d.dimension} · ${Math.round(d.attribution.concentration * 100)}%`))),
        cur && h('div', { className: 'n2s-waterfall' }, cur.attribution.items.map((it, i) => h('div', { key: i, className: 'n2s-wf-row' },
          h('span', { className: 'n2s-wf-label n2s-ellipsis', title: String(it.value) }, String(it.value ?? 'NULL')),
          h('span', { className: 'n2s-wf-bar' }, h('span', { className: `n2s-wf-fill ${it.delta > 0 ? 'up' : it.delta < 0 ? 'down' : ''}`, style: { width: `${Math.max(2, Math.abs(it.delta) / max * 100)}%` } })),
          h('span', { className: 'n2s-wf-num' }, `${it.delta >= 0 ? '+' : ''}${formatCompact(it.delta)}`),
          h('span', { className: 'n2s-wf-share n2s-faint' }, it.share === null || Math.abs(it.share) > 3 ? '' : `${Math.round(it.share * 100)}%`)))),
        why.dimensions.filter(d => !d.attribution).length > 0 && h('div', { className: 'n2s-faint n2s-small' }, `${colon(t('drill.failedDims'))}${why.dimensions.filter(d => !d.attribution).map(d => d.dimension).join(listSep())}`))
    }

    // ------------------------------------------------------------ alerts

    function AlertForm({ t, initial, datasources, ds, onDone, onCancel }) {
      const channels = useChannels()
      const [form, setForm] = useState(() => ({ name: '', datasourceId: ds?.id, source: 'metric', metric: '', grain: 'day', sql: '', every: 'hour', at: '09:00', cooldownMin: 60, channelId: initial ? '' : (channels.find(c => c.isDefault)?.id ?? ''), mention: false, enabled: true, ...(initial ?? {}), condition: { type: 'change', direction: 'any', pct: 20, ...(initial?.condition ?? {}) } }))
      const k = useAsync(() => (form.datasourceId ? call('getKnowledge', { datasourceId: form.datasourceId }) : null), [form.datasourceId])
      const [error, setError] = useState(null)
      const [test, setTest] = useState(null)
      const [busy, runBusy] = useBusy()
      // Channels may load after the form opens: adopt the default once, unless the user already chose.
      const channelTouched = useRef(Boolean(initial) || Boolean(form.channelId))
      useEffect(() => {
        if (channelTouched.current) return
        const def = channels.find(c => c.isDefault)
        if (def) { channelTouched.current = true; setForm(f => ({ ...f, channelId: def.id })) }
      }, [channels])
      const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
      const setC = (patch) => setForm(f => ({ ...f, condition: { ...f.condition, ...patch } }))
      const metrics = k.value?.metrics ?? []
      const save = () => runBusy(async () => {
        setError(null)
        try { await call('saveAlert', { ...form, cooldownMin: Number(form.cooldownMin) }); onDone() } catch (e) { setError(e.message) }
      })
      const tryIt = async () => {
        if (test?.busy) return
        setTest({ busy: true })
        try { setTest(await call('previewAlert', { ...form, cooldownMin: Number(form.cooldownMin) })) } catch (e) { setTest({ error: e.message }) }
      }
      const c = form.condition
      return h('div', { className: 'n2s-card', style: { marginBottom: 12 } },
        h('div', { className: 'n2s-form' },
          h('label', { className: 'n2s-field' }, h('span', null, t('al.name')), h('input', { className: 'n2s-input', value: form.name, onChange: set('name'), placeholder: t('al.namePh') })),
          h('label', { className: 'n2s-field' }, h('span', null, t('ds.select')), h('select', { className: 'n2s-select', value: form.datasourceId, onChange: set('datasourceId') }, datasources.map(d => h('option', { key: d.id, value: d.id }, d.name)))),
          h('div', { className: 'n2s-field full' }, h('span', null, t('al.source')), h('div', { className: 'n2s-seg' }, ['metric', 'sql'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.source === v, onClick: () => setForm(f => ({ ...f, source: v })) }, t(`al.src.${v}`))))),
          form.source === 'metric' ? h(React.Fragment, null,
            h('label', { className: 'n2s-field' }, h('span', null, t('al.metric')), metrics.length ? h('select', { className: 'n2s-select', value: form.metric, onChange: set('metric') }, h('option', { value: '' }, '—'), metrics.map(m => h('option', { key: m.id, value: m.name }, m.name))) : h('div', { className: 'n2s-faint n2s-small' }, t('al.noMetrics'))),
            h('label', { className: 'n2s-field' }, h('span', null, t('al.grain')), h('select', { className: 'n2s-select', value: form.grain, onChange: set('grain') }, ['hour', 'day', 'week', 'month'].map(g => h('option', { key: g, value: g }, t(`al.grain.${g}`))))))
            : h('label', { className: 'n2s-field full' }, h('span', null, t('al.sql')), h('textarea', { className: 'n2s-textarea n2s-mono', spellCheck: false, value: form.sql, onChange: set('sql'), placeholder: "SELECT DATE(created_at) AS d, COUNT(*) AS n FROM orders GROUP BY d ORDER BY d" })),
          h('div', { className: 'n2s-field full' }, h('span', null, t('al.condition')),
            h('div', { className: 'n2s-row' },
              h('select', { className: 'n2s-select inline', value: c.type, onChange: e => setC({ type: e.target.value }) }, ['change', 'threshold', 'anomaly', 'missing'].map(v => h('option', { key: v, value: v }, t(`al.cond.${v}`)))),
              c.type === 'threshold' && h(React.Fragment, null,
                h('select', { className: 'n2s-select inline', value: c.op ?? '>', onChange: e => setC({ op: e.target.value }) }, ['>', '>=', '<', '<=', '==', '!='].map(o => h('option', { key: o, value: o }, o))),
                h('input', { className: 'n2s-input', type: 'number', style: { width: 140 }, value: c.value ?? 0, onChange: e => setC({ value: Number(e.target.value) }) })),
              c.type === 'change' && h(React.Fragment, null,
                h('select', { className: 'n2s-select inline', value: c.direction ?? 'any', onChange: e => setC({ direction: e.target.value }) }, ['any', 'up', 'down'].map(o => h('option', { key: o, value: o }, t(`al.dir.${o}`)))),
                h('input', { className: 'n2s-input', type: 'number', style: { width: 90 }, value: c.pct ?? 20, onChange: e => setC({ pct: Number(e.target.value) }) }), h('span', { className: 'n2s-muted' }, '%')),
              c.type === 'anomaly' && h(React.Fragment, null, h('span', { className: 'n2s-muted n2s-small' }, 'Z ≥'), h('input', { className: 'n2s-input', type: 'number', step: 0.5, style: { width: 80 }, value: c.z ?? 3, onChange: e => setC({ z: Number(e.target.value) }) }), h('span', { className: 'n2s-faint n2s-small' }, t('al.anomalyHint')))),
            h('span', { className: 'n2s-faint n2s-small' }, t(`al.condHint.${c.type}`))),
          h('label', { className: 'n2s-field' }, h('span', null, t('al.every')), h('select', { className: 'n2s-select', value: form.every, onChange: set('every') }, ['15m', 'hour', 'day'].map(v => h('option', { key: v, value: v }, t(`al.every.${v}`))))),
          form.every === 'day' ? h('label', { className: 'n2s-field' }, h('span', null, t('rep.time')), h('input', { className: 'n2s-input', type: 'time', value: form.at, onChange: set('at') })) : h('label', { className: 'n2s-field' }, h('span', null, t('al.cooldown')), h('input', { className: 'n2s-input', type: 'number', value: form.cooldownMin, onChange: set('cooldownMin') })),
          h('div', { className: 'n2s-field' }, h('label', { htmlFor: 'n2s-al-channel', className: 'n2s-flabel' }, t('rep.push')), h(ChannelPicker, { t, id: 'n2s-al-channel', value: form.channelId ?? '', noneLabel: t('al.noPush'), onChange: (v) => { channelTouched.current = true; setForm(f => ({ ...f, channelId: v })) } })),
          h('label', { className: 'n2s-check', style: { alignSelf: 'end' } }, h('input', { type: 'checkbox', checked: form.mention, onChange: set('mention') }), t('al.mentionAll'))),
        test && h('div', { className: `n2s-notice ${test.error ? 'err' : test.triggered ? 'warn' : 'ok'}`, style: { marginTop: 10 } }, test.busy ? t('ds.testing') : test.error ?? `${colon(test.triggered ? t('al.wouldFire') : t('al.wouldNotFire'))}${test.message}`),
        error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn', disabled: test?.busy, onClick: tryIt }, t('al.test')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: save }, busy ? h('span', { className: 'n2s-spin' }) : null, t('ds.save'))))
    }

    function AlertsTab({ t, ds, datasources }) {
      const list = useAsync(() => call('listAlerts'), [])
      const events = useAsync(() => call('listAlertEvents', {}), [list.value], [])
      const [editing, setEditing] = useState(null)
      const [notice, setNotice] = useState(null)
      const act = async (fn, ok) => { setNotice(null); try { const r = await fn(); if (ok) setNotice({ ok: true, text: typeof ok === 'function' ? ok(r) : ok }) } catch (e) { setNotice({ ok: false, text: e.message }) } list.reload() }
      const alerts = list.value ?? []
      const sched = useAsync(() => call('schedulerStatus'), [list.value], [])
      const condText = (a) => a.condition.type === 'threshold' ? `${a.condition.op} ${a.condition.value}` : a.condition.type === 'change' ? `${t(`al.dir.${a.condition.direction ?? 'any'}`)} ≥ ${a.condition.pct}%` : a.condition.type === 'anomaly' ? `Z ≥ ${a.condition.z ?? 3}` : t('al.cond.missing')
      return h('div', null,
        h(SectionHead, { title: t('tab.alerts'), desc: t('al.hint') }, h('button', { type: 'button', className: 'n2s-btn primary', disabled: !ds, onClick: () => setEditing({}) }, '+ ', t('al.add'))),
        sched.value && h('div', { className: 'n2s-faint n2s-small', style: { marginBottom: 10 } },
          sched.value.lastTickAt ? fmt(t, 'al.lastTick', { time: new Date(sched.value.lastTickAt).toLocaleTimeString(), n: (sched.value.lastRan ?? []).length }) : t('al.noTickYet'),
          sched.value.nextAlerts?.[0] ? ` · ${fmt(t, 'al.nextDue', { name: sched.value.nextAlerts[0].name, time: new Date(Math.max(sched.value.nextAlerts[0].dueAt, Date.now())).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })}` : '',
          ` · ${t('al.schedulerNote')}`),
        notice && h('div', { className: `n2s-notice ${notice.ok ? 'ok' : 'err'}`, style: { marginBottom: 10 }, role: 'status' }, notice.text),
        editing && h(AlertForm, { key: editing.id ?? 'new', t, ds, datasources, initial: editing.id ? editing : null, onCancel: () => setEditing(null), onDone: () => { setEditing(null); list.reload() } }),
        !list.loading && alerts.length === 0 && !editing && h('div', { className: 'n2s-empty' }, h('h3', null, t('al.empty')), h('div', null, t('al.emptyHint')), h('button', { type: 'button', className: 'n2s-btn primary', disabled: !ds, onClick: () => setEditing({}) }, t('al.add'))),
        alerts.length > 0 && h('div', { className: 'n2s-list2' }, alerts.map(a => h('div', { key: a.id, className: 'n2s-list2-row' },
          h('span', { className: 'n2s-tile', style: a.state === 'firing' ? { color: 'var(--n2s-err)', background: 'color-mix(in srgb, var(--n2s-err) 12%, transparent)' } : undefined, 'aria-hidden': true }, svg(16, [h('path', { key: 1, d: 'M8 2.5 14 13H2L8 2.5zM8 6.5v3M8 11.3v.2' })])),
          h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
            h('div', { className: 'n2s-row', style: { gap: 6 } }, h('span', { className: 'n2s-list2-title' }, a.name), !a.enabled && h('span', { className: 'n2s-badge' }, t('rep.status.paused')), a.channelName && h('span', { className: 'n2s-badge' }, Icon.send(11), a.channelName)),
            h('div', { className: 'n2s-list2-sub' }, `${a.source === 'metric' ? `${a.metric} · ${t(`al.grain.${a.grain}`)}` : 'SQL'} · ${t(`al.cond.${a.condition.type}`)} ${condText(a)} · ${t(`al.every.${a.every}`)} · ${a.datasourceName}`),
            a.lastError && h('div', { className: 'n2s-list2-sub', style: { color: 'var(--n2s-err)' } }, a.lastError)),
          h('div', { className: 'n2s-list2-side' },
            h('span', { className: `n2s-statusdot ${a.state === 'firing' ? 'err' : a.lastCheckedAt ? 'ok' : ''}` }, a.state === 'firing' ? t('al.firing') : a.lastCheckedAt ? t('al.ok') : t('al.never')),
            h('span', { className: 'n2s-faint n2s-small' }, a.lastValue !== null && a.lastValue !== undefined ? `${t('al.last')} ${formatCompact(a.lastValue)}` : '')),
          h('div', { className: 'n2s-row', style: { gap: 2, flexWrap: 'nowrap' } },
            h('button', { type: 'button', className: 'n2s-btn small', onClick: () => act(() => call('checkAlert', { id: a.id }), (r) => `${r.triggered ? '⚠️ ' : '✓ '}${r.message}${r.pushed ? ` · ${t('al.pushed')}` : ''}`) }, t('al.checkNow')),
            h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
              { label: a.enabled ? t('rep.pause') : t('rep.resume'), icon: Icon.refresh(14), onClick: () => act(() => call('saveAlert', { id: a.id, enabled: !a.enabled })) },
              { label: t('ds.edit'), icon: Icon.edit(14), onClick: () => setEditing(a) },
              { divider: true },
              { label: t('ds.delete'), icon: Icon.trash(14), danger: true, onClick: async () => { if (await confirmDialog({ title: fmt(t, 'al.deleteConfirm', { name: a.name }), danger: true })) act(() => call('deleteAlert', { id: a.id })) } },
            ] }))))),
        (events.value ?? []).length > 0 && h('div', { className: 'n2s-section' }, h('h2', null, t('al.events')),
          h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table' },
            h('thead', null, h('tr', null, [t('im.col.time'), t('al.name'), t('al.message'), t('im.col.status')].map((x, i) => h('th', { key: i }, x)))),
            h('tbody', null, events.value.slice(0, 50).map(e => h('tr', { key: e.id },
              h('td', { className: 'n2s-muted' }, new Date(e.at).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })),
              h('td', null, e.name), h('td', { style: { whiteSpace: 'normal' } }, e.message),
              h('td', null, e.pushed ? h('span', { className: 'n2s-statusdot ok' }, t('im.sentOk')) : e.pushError ? h('span', { className: 'n2s-statusdot err', title: e.pushError }, t('im.lastFailed')) : h('span', { className: 'n2s-faint' }, '—')))))))))
    }

    // -------------------------------------------------------- evaluation

    function EvalSection({ t, ds }) {
      const set = useAsync(() => call('evalSet', { datasourceId: ds.id }), [ds.id])
      const runs = useAsync(() => call('listEvalRuns', { datasourceId: ds.id }), [ds.id])
      const [mode, setMode] = useState('agent')
      const [open, setOpen] = useState(null)
      const [error, setError] = useState(null)
      const latest = (runs.value ?? [])[0]
      useEffect(() => {
        if (latest?.status !== 'running') return
        const id = setInterval(() => { runs.reload(); set.reload() }, 3000)
        return () => clearInterval(id)
      }, [latest?.status, latest?.id])
      const detail = useAsync(() => (open ? call('getEvalRun', { id: open }) : null), [open, latest?.done], [open])
      const start = async () => { setError(null); try { await call('runEval', { datasourceId: ds.id, mode }); runs.reload() } catch (e) { setError(e.message) } }
      const cases = set.value ?? []
      return h('div', null,
        h('div', { className: 'n2s-notice', style: { marginBottom: 12 } }, t('ev.hint')),
        h('div', { className: 'n2s-toolbar' },
          h('div', { className: 'n2s-seg' }, ['agent', 'sql'].map(m => h('button', { key: m, type: 'button', 'aria-pressed': mode === m, onClick: () => setMode(m) }, t(`ev.mode.${m}`)))),
          h('span', { className: 'n2s-faint n2s-small' }, fmt(t, 'ev.cases', { count: cases.filter(c => c.enabled).length })),
          h('span', { className: 'n2s-grow' }),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: latest?.status === 'running' || !cases.length, onClick: start }, latest?.status === 'running' ? h('span', { className: 'n2s-spin' }) : null, latest?.status === 'running' ? fmt(t, 'ev.running', { done: latest.done, total: latest.total }) : t('ev.run'))),
        error && h('div', { className: 'n2s-notice err', style: { marginBottom: 10 } }, error),
        (runs.value ?? []).length > 0 && h('div', { className: 'n2s-evalchart' }, [...runs.value].reverse().slice(-20).map(r => h('button', { key: r.id, type: 'button', className: 'n2s-evalbar', 'aria-pressed': open === r.id, title: `${new Date(r.startedAt).toLocaleString()} · ${t(`ev.mode.${r.mode}`)} · ${r.passed}/${r.total}`, onClick: () => setOpen(open === r.id ? null : r.id) },
          h('span', { className: 'fill', style: { height: `${r.total ? Math.max(4, r.passed / r.total * 100) : 4}%` } }),
          h('span', { className: 'lbl' }, r.status === 'running' ? '…' : `${Math.round((r.accuracy ?? 0) * 100)}%`)))),
        detail.value && h('div', { className: 'n2s-hist', style: { marginTop: 12 } }, detail.value.cases.map(c => h('div', { key: c.id, className: 'n2s-hist-row', style: { padding: '10px 16px' } },
          h('div', { className: 'n2s-row' },
            h('span', { className: `n2s-statusdot ${c.status === 'pass' ? 'ok' : c.status === 'fail' ? 'warn' : 'err'}` }, t(`ev.status.${c.status}`)),
            h('span', { style: { fontWeight: 500 } }, c.question),
            c.similarity !== null && c.similarity !== undefined && h('span', { className: 'n2s-faint n2s-small' }, fmt(t, 'ev.sim', { p: Math.round(c.similarity * 100) })),
            h('span', { className: 'n2s-grow' }),
            c.sessionId && h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => fbCtx.openSession?.(c.sessionId) }, Icon.external(13), t('hist.openSession'))),
          c.reason && h('div', { className: 'n2s-small n2s-muted', style: { marginTop: 4 } }, c.reason),
          c.status !== 'pass' && c.actualSql && h('details', { style: { marginTop: 6 } }, h('summary', { className: 'n2s-small n2s-muted', style: { cursor: 'pointer' } }, t('ev.compareSql')),
            h('div', { className: 'n2s-form', style: { marginTop: 6 } }, h('pre', { className: 'n2s-code' }, prettySql(c.expectedSql)), h('pre', { className: 'n2s-code' }, prettySql(c.actualSql))))))),
        !open && cases.length > 0 && h('div', { className: 'n2s-list2', style: { marginTop: 12 } }, cases.map(c => h('div', { key: c.id, className: 'n2s-list2-row', style: { padding: '8px 16px' } },
          h('input', { type: 'checkbox', checked: c.enabled, 'aria-label': t('ev.include'), onChange: async (e) => { try { await call('setEvalCase', { datasourceId: ds.id, id: c.id, enabled: e.target.checked }) } catch (err) { notifyError(err) } set.reload() } }),
          h('span', { className: 'n2s-grow n2s-ellipsis' }, c.question),
          c.lastStatus && h('span', { className: `n2s-statusdot ${c.lastStatus === 'pass' ? 'ok' : c.lastStatus === 'fail' ? 'warn' : 'err'}` }, t(`ev.status.${c.lastStatus}`))))))
    }

    // ---------------------------------------------------- schema changes

    function SchemaChanges({ t, ds }) {
      const list = useAsync(() => call('listSchemaChanges', { datasourceId: ds.id }), [ds.id, ds.schemaAnalyzedAt], [ds.id])
      const open = (list.value ?? []).filter(c => c.status === 'open')
      if (!open.length) return null
      const kindLabel = (k) => t(`sc.${k}`)
      return h('div', { className: 'n2s-notice warn', style: { marginBottom: 14 } },
        open.slice(0, 3).map(c => h('div', { key: c.id, style: { marginBottom: 6 } },
          h('div', { className: 'n2s-row' }, h('strong', null, fmt(t, 'sc.title', { count: c.changes.length, time: new Date(c.at).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })), h('span', { className: 'n2s-grow' }),
            h('button', { type: 'button', className: 'n2s-btn small', onClick: async () => { try { await call('ackSchemaChange', { id: c.id }) } catch (e) { notifyError(e) } list.reload() } }, t('sc.ack'))),
          h('div', { className: 'n2s-small', style: { marginTop: 4 } }, joinClauses(c.changes.slice(0, 8).map(x => `${kindLabel(x.kind)} ${x.table}${x.column ? `.${x.column}` : ''}${paren(x.detail)}`))),
          c.impacts.length > 0 && h('div', { className: 'n2s-small', style: { marginTop: 4 } }, h('strong', null, `${colon(t('sc.impacts'))}`), joinList(c.impacts.slice(0, 8).map(i => `${t(`sc.imp.${i.kind}`)}${uiLang === 'zh' ? '' : ' '}${quoted(i.name)}`))))))
    }

    // -------------------------------------------------- knowledge io

    function KnowledgeIO({ t, ds, datasources, onImported }) {
      const fileRef = useRef(null)
      const [state, setState] = useState(null)
      const box = useRef(null)
      useFocusTrap(box, Boolean(state))
      // A dry run belongs to the data source it was computed for.
      useEffect(() => { setState(null) }, [ds?.id])
      useEffect(() => {
        if (!state) return
        const prev = document.activeElement
        setTimeout(() => box.current?.querySelector('button.primary, button')?.focus(), 0)
        const onKey = (e) => { if (e.key === 'Escape' && !feedbackStore.get().dialog && !busyRef.current) setState(null) }
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() }
      }, [Boolean(state)])
      const [busy, runBusy] = useBusy()
      const busyRef = useRef(false)
      busyRef.current = busy
      const doExport = async (all) => {
        try {
          const data = await call('exportKnowledge', all ? {} : { datasourceId: ds.id })
          download(`knowledge-${all ? 'all' : safeName(ds.name)}-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
        } catch (e) { notifyError(e) }
      }
      const onFile = async (e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (!f) return
        try {
          const text = await f.text()
          const doc = JSON.parse(text)
          const single = doc.datasources?.length === 1
          const dsId = ds.id
          const dry = await call('importKnowledge', { data: doc, targetDatasourceId: single ? dsId : undefined, dryRun: true })
          setState({ doc, single, dry, dsId, dsName: ds.name })
        } catch (err) { setState({ error: err.message }) }
      }
      const apply = (mode) => runBusy(async () => {
        try { const r = await call('importKnowledge', { data: state.doc, targetDatasourceId: state.single ? state.dsId : undefined, mode }); setState({ done: r }); onImported() } catch (err) { setState({ error: err.message }) }
      })
      return h(React.Fragment, null,
        h('input', { ref: fileRef, type: 'file', accept: 'application/json,.json', style: { display: 'none' }, onChange: onFile }),
        h(Dropdown, { label: t('kb.io'), trigger: { className: 'n2s-btn', content: h(React.Fragment, null, t('kb.io'), Icon.chev(10)) }, items: [
          { label: t('kb.exportThis'), icon: Icon.download(14), onClick: () => doExport(false) },
          datasources.length > 1 && { label: t('kb.exportAll'), icon: Icon.download(14), onClick: () => doExport(true) },
          { divider: true },
          { label: t('kb.import'), icon: Icon.up(14), onClick: () => fileRef.current?.click() },
        ] }),
        state && ReactDOM.createPortal(h('div', { className: 'n2s-modal-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) setState(null) } },
          h('div', { ref: box, className: 'n2s-modal', role: 'dialog', 'aria-modal': true, 'aria-label': t('kb.import') },
            h('div', { className: 'n2s-modal-title', style: { marginBottom: 10 } }, t('kb.import')),
            state.error && h('div', { className: 'n2s-notice err' }, state.error),
            state.dry && h(React.Fragment, null,
              h('div', { className: 'n2s-muted n2s-small', style: { marginBottom: 8 } }, state.single ? fmt(t, 'kb.importInto', { name: state.dsName }) : t('kb.importByName')),
              h('table', { className: 'n2s-table' }, h('thead', null, h('tr', null, [t('kb.src'), t('kb.target'), t('kb.glossary'), t('kb.metrics'), t('kb.notes'), t('kb.examples'), t('kb.invalid')].map((x, i) => h('th', { key: i }, x)))),
                h('tbody', null, state.dry.report.map((r, i) => h('tr', { key: i }, h('td', null, r.source), h('td', null, r.target ?? h('span', { style: { color: 'var(--n2s-err)' } }, r.skipped)), h('td', null, r.glossary ?? '—'), h('td', null, r.metrics ?? '—'), h('td', null, r.notes ?? '—'), h('td', null, r.examples ?? '—'), h('td', null, r.invalid ?? '—'))))),
              h('div', { className: 'n2s-row', style: { marginTop: 14, justifyContent: 'flex-end' } },
                h('button', { type: 'button', className: 'n2s-btn ghost', onClick: () => setState(null) }, t('ds.cancel')),
                h('button', { type: 'button', className: 'n2s-btn danger', disabled: busy, onClick: async () => { if (await confirmDialog({ title: t('kb.replaceConfirm'), danger: true })) apply('replace') } }, t('kb.replace')),
                h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: () => apply('merge') }, busy ? h('span', { className: 'n2s-spin' }) : null, t('kb.merge')))),
            state.done && h(React.Fragment, null, h('div', { className: 'n2s-notice ok' }, t('kb.imported')), h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } }, h('button', { type: 'button', className: 'n2s-btn primary', onClick: () => setState(null) }, t('ds.close')))))), document.body))
    }

    // -------------------------------------------------- knowledge suggestions
    // Candidate knowledge mined from history and feedback (service/suggestions.js),
    // shown in the 业务知识 → 建议 section for a human to accept or dismiss.

    const SUGGEST_KINDS = ['example', 'metric', 'note', 'glossary']

    function suggestionTitle(s) {
      const it = s.item ?? {}
      if (s.kind === 'example') return it.question
      if (s.kind === 'metric') return it.name
      if (s.kind === 'note') return it.key
      return it.term
    }

    function SuggestionBody({ t, s }) {
      const it = s.item ?? {}
      if (s.kind === 'example') return h('pre', { className: 'n2s-code', style: { marginTop: 6, maxHeight: 140 } }, prettySql(it.sql ?? ''))
      if (s.kind === 'metric') return h('div', null,
        h('div', { className: 'n2s-mono n2s-small' }, `${it.expression}${it.table ? ` FROM ${it.table}` : ''}${it.filter ? ` WHERE ${it.filter}` : ''}`),
        (it.timeColumn || it.dimensions?.length) && h('div', { className: 'n2s-muted n2s-small' }, [it.timeColumn && `${t('kb.timeColumn')}: ${it.timeColumn}`, it.dimensions?.length && `${t('kb.dimensions')}: ${joinList(it.dimensions)}`].filter(Boolean).join(' · ')))
      if (s.kind === 'note') return h('div', { className: 'n2s-small' }, it.text)
      return h('div', null, h('div', { className: 'n2s-small' }, it.definition), it.sql && h('code', { className: 'n2s-md-code', style: { display: 'inline-block', marginTop: 4 } }, it.sql))
    }

    /** Editor-ready copy of a suggested item (arrays the editor shows as text). */
    function suggestionForm(s) {
      const it = { ...(s.item ?? {}) }
      if (Array.isArray(it.dimensions)) it.dimensions = it.dimensions.join('，')
      return it
    }

    function SuggestionsSection({ t, ds, fields, schema, noteKeys, onChanged }) {
      const list = useAsync(() => call('listKnowledgeSuggestions', { datasourceId: ds.id }), [ds.id])
      const [editing, setEditing] = useState(null)
      const [busy, setBusy] = useState(null)
      const items = list.value?.suggestions ?? []
      const done = () => { list.reload(); onChanged?.() }
      const inFlight = useRef(new Set())
      const accept = async (s, item) => {
        if (inFlight.current.has(s.id)) return
        inFlight.current.add(s.id)
        setBusy(s.id)
        try {
          await call('acceptSuggestion', { datasourceId: ds.id, id: s.id, ...(item ? { item } : {}) })
          setEditing(null)
          notify(t('sg.accepted'), 'ok')
          done()
        } catch (e) { notifyError(e) } finally { inFlight.current.delete(s.id); setBusy(null) }
      }
      const dismiss = async (s) => {
        if (!await confirmDialog({ title: t('sg.dismissConfirm'), confirmLabel: t('sg.dismiss') })) return
        setBusy(s.id)
        try { await call('dismissSuggestion', { datasourceId: ds.id, id: s.id }); notify(t('sg.dismissed')); done() } catch (e) { notifyError(e) } finally { setBusy(null) }
      }
      const card = (s) => h('div', { key: s.id, className: 'n2s-card n2s-sgcard', 'data-sg': s.id },
        h('div', { className: 'n2s-row', style: { alignItems: 'flex-start' } },
          h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
            h('div', { className: 'n2s-row', style: { gap: 6 } },
              h('span', { style: { fontWeight: 500, wordBreak: 'break-all' } }, suggestionTitle(s)),
              h('span', { className: `n2s-badge ${s.score >= 0.8 ? 'ok' : s.score >= 0.5 ? 'blue' : ''}` }, fmt(t, 'sg.score', { score: `${Math.round(s.score * 100)}%` }))),
            h('div', { style: { marginTop: 4 } }, h(SuggestionBody, { t, s })),
            h('div', { className: 'n2s-muted n2s-small', style: { marginTop: 6 } }, s.reason),
            s.evidence?.length > 0 && h('details', { style: { marginTop: 6 } },
              h('summary', { className: 'n2s-small', style: { cursor: 'pointer' } }, fmt(t, 'sg.evidence', { count: s.evidence.length })),
              s.evidence.map((ev, i) => h('div', { key: i, style: { marginTop: 6 } },
                h('div', { className: 'n2s-small' }, h('span', { className: 'n2s-badge', style: { marginRight: 6 } }, ['feedback', 'agent', 'ui'].includes(ev.source) ? t(`sg.src.${ev.source}`) : ev.source), ev.question || '—', h('span', { className: 'n2s-faint', style: { marginLeft: 6 } }, ev.at ? new Date(ev.at).toLocaleString() : '')),
                h('pre', { className: 'n2s-code', style: { marginTop: 4, maxHeight: 120 } }, ev.sql))))),
          h('div', { className: 'n2s-row', style: { gap: 4, flexWrap: 'nowrap' } },
            h('button', { type: 'button', className: 'n2s-btn small primary', disabled: busy === s.id, onClick: () => setEditing(s) }, t('sg.accept')),
            h(Dropdown, { label: t('sg.acceptDirect'), trigger: { className: 'n2s-iconbtn', content: Icon.chev(10) }, items: [
              { label: t('sg.acceptEdit'), icon: Icon.edit(14), disabled: busy === s.id, onClick: () => setEditing(s) },
              { label: t('sg.acceptDirect'), icon: Icon.check(14), disabled: busy === s.id, onClick: () => accept(s) },
            ] }),
            h('button', { type: 'button', className: 'n2s-btn small ghost', disabled: busy === s.id, onClick: () => dismiss(s) }, t('sg.dismiss')))),
        editing?.id === s.id && h('div', { style: { marginTop: 10 } },
          h(KnowledgeEditor, { key: s.id, kind: s.kind, item: suggestionForm(s), t, fields: fields[s.kind], schema, noteKeys, onCancel: () => setEditing(null), onSave: (form) => accept(s, form) })))
      return h('div', null,
        h('div', { className: 'n2s-row', style: { marginBottom: 10 } },
          h('span', { className: 'n2s-muted n2s-small n2s-grow' }, t('sg.hint')),
          h('button', { type: 'button', className: 'n2s-btn small', onClick: () => list.reload() }, t('sg.refresh'))),
        list.error && h('div', { className: 'n2s-notice err', style: { marginBottom: 8 } }, list.error.message),
        !list.loading && !list.error && items.length === 0 && h('div', { className: 'n2s-empty' },
          h('div', { style: { fontWeight: 500 } }, t('sg.empty')),
          h('div', { className: 'n2s-muted n2s-small', style: { maxWidth: 560, marginTop: 6 } }, t('sg.emptyHint'))),
        SUGGEST_KINDS.map(kind => {
          const group = items.filter(s => s.kind === kind)
          if (!group.length) return null
          return h('div', { key: kind, style: { marginBottom: 16 } },
            h('div', { className: 'n2s-row', style: { marginBottom: 6 } }, h('span', { style: { fontWeight: 600 } }, t(`sg.kind.${kind}`)), h('span', { className: 'n2s-badge' }, group.length)),
            h('div', { className: 'n2s-cards' }, group.map(card)))
        }))
    }
    // ------------------------------------------------------ members & bots

    /** Identities of a member: the new array, or the legacy Lark fields. */
    function identitiesOf(u) {
      if (Array.isArray(u?.identities)) return u.identities.filter(x => x && x.id).map(x => ({ platform: x.platform ?? 'lark', id: String(x.id), ...(x.email ? { email: x.email } : {}) }))
      const out = []
      const id = u?.kind === 'chat' ? u?.larkChatId : u?.larkOpenId
      if (id || (u?.kind !== 'chat' && u?.email)) out.push({ platform: 'lark', id: id ?? '', ...(u?.kind !== 'chat' && u?.email ? { email: u.email } : {}) })
      return out
    }

    /** Platforms members can be identified on: those with a bot-capable kind. */
    function identityPlatforms(catalog) {
      const list = catalog.filter(p => (p.kinds ?? []).some(k => k.capabilities?.bot)).map(p => p.platform)
      return list.length ? list : ['lark']
    }

    function IdentityEditor({ t, kind, rows, onChange, catalog, errors }) {
      const platforms = identityPlatforms(catalog)
      const set = (i, patch) => onChange(rows.map((r, j) => j === i ? { ...r, ...patch } : r))
      const help = (p) => tOpt(t, `mb.idHelp.${p}.${kind}`)
      return h('div', { className: 'n2s-field full', role: 'group', 'aria-labelledby': 'n2s-ids-label' },
        h('span', { id: 'n2s-ids-label', className: 'n2s-flabel' }, kind === 'chat' ? t('mb.ids.chat') : t('mb.ids.person')),
        h('span', { className: 'n2s-faint n2s-small' }, kind === 'chat' ? t('mb.ids.chatHint') : t('mb.ids.personHint')),
        h('div', { className: 'n2s-idrows' }, rows.map((r, i) => h('div', { key: i, className: 'n2s-idrow', 'data-identity': i },
          h('div', { className: 'n2s-idrow-main' },
            h(PlatformMark, { t, platform: r.platform, size: 30 }),
            h('select', { className: 'n2s-select inline', 'aria-label': fmt(t, 'mb.ids.platformN', { n: i + 1 }), value: r.platform, onChange: e => set(i, { platform: e.target.value }) },
              [...new Set([...platforms, r.platform])].map(p => h('option', { key: p, value: p }, platformName(t, p, catalog)))),
            h('input', { className: `n2s-input n2s-mono${errors?.[i] ? ' invalid' : ''}`, 'aria-label': fmt(t, 'mb.ids.idN', { n: i + 1 }), 'aria-invalid': errors?.[i] ? true : undefined, value: r.id, placeholder: ID_PLACEHOLDER[r.platform]?.[kind] ?? 'id', spellCheck: false, autoComplete: 'off', onChange: e => set(i, { id: e.target.value }) }),
            kind === 'person' && h('input', { className: 'n2s-input', style: { maxWidth: 220 }, type: 'email', 'aria-label': fmt(t, 'mb.ids.emailN', { n: i + 1 }), value: r.email ?? '', placeholder: t('mb.ids.emailPh'), onChange: e => set(i, { email: e.target.value }) }),
            h('button', { type: 'button', className: 'n2s-iconbtn danger', 'aria-label': fmt(t, 'mb.ids.remove', { n: i + 1 }), title: t('ds.delete'), onClick: () => onChange(rows.filter((_, j) => j !== i)) }, Icon.close())),
          errors?.[i] ? h('div', { className: 'n2s-fielderr', role: 'alert' }, errors[i]) : help(r.platform) && h('div', { className: 'n2s-faint n2s-small n2s-idrow-help' }, help(r.platform))))),
        h('button', { type: 'button', className: 'n2s-btn small ghost', style: { justifySelf: 'start' }, onClick: () => onChange([...rows, { platform: rows[rows.length - 1]?.platform ?? platforms[0], id: '', email: '' }]) }, '+ ', t('mb.ids.add')))
    }

    /**
     * One-click identity picks: people and groups that already talked to a bot
     * (recorded by the host, including refused ones), plus the groups a bot is
     * in (channels whose kind can list targets). No id lookup needed.
     */
    function IdentityPicker({ t, kind, catalog, onPick, chosen }) {
      const seen = useAsync(() => call('listSeenIdentities', { kind }).catch(() => []), [kind])
      const channels = useChannels()
      const listable = channels.filter(c => (c.capabilities ?? findKind(catalog, c.type)?.kind?.capabilities)?.listTargets)
      const [groups, setGroups] = useState(null)
      const [loadingGroups, setLoadingGroups] = useState(false)
      const loadGroups = async () => {
        setLoadingGroups(true)
        const out = []
        for (const c of listable) {
          try { for (const g of await call('listChannelTargets', { id: c.id })) out.push({ platform: c.platform, kind: 'chat', id: String(g.id), name: g.name, via: c.name }) } catch (e) { notifyError(e) }
        }
        setGroups(out); setLoadingGroups(false)
      }
      useEffect(() => { if (kind === 'chat' && listable.length && groups === null) loadGroups() }, [kind, listable.length])
      const isChosen = (x) => chosen.some(r => r.platform === x.platform && r.id === x.id)
      const items = [...(seen.value ?? [])]
      if (kind === 'chat') for (const g of groups ?? []) if (!items.some(x => x.platform === g.platform && x.id === g.id)) items.push(g)
      const label = (x) => x.name || x.chatName || x.email || x.id
      return h('div', { className: 'n2s-field full n2s-idpicker' },
        h('div', { className: 'n2s-row' },
          h('span', { className: 'n2s-flabel' }, kind === 'chat' ? t('mb.pick.chats') : t('mb.pick.people')),
          h('span', { className: 'n2s-grow' }),
          kind === 'chat' && listable.length > 0 && h('button', { type: 'button', className: 'n2s-link n2s-small', disabled: loadingGroups, onClick: loadGroups }, loadingGroups ? h('span', { className: 'n2s-spin' }) : Icon.refresh(12), t('mb.pick.refresh'))),
        seen.loading && !seen.value ? h('div', { className: 'n2s-skel', style: { height: 34 } }) :
          items.length === 0
            ? h('div', { className: 'n2s-faint n2s-small' }, kind === 'chat' ? t('mb.pick.noChats') : t('mb.pick.noPeople'))
            : h('div', { className: 'n2s-pickchips', role: 'group', 'aria-label': kind === 'chat' ? t('mb.pick.chats') : t('mb.pick.people') }, items.slice(0, 30).map(x => {
              const taken = x.memberId && !isChosen(x)
              return h('button', {
                key: `${x.platform}:${x.id}`, type: 'button', className: 'n2s-pickchip', 'aria-pressed': isChosen(x), disabled: Boolean(taken),
                title: [`${platformName(t, x.platform, catalog)} · ${x.id}`, x.email, x.via ? fmt(t, 'mb.pick.via', { name: x.via }) : '', taken ? fmt(t, 'mb.pick.taken', { name: x.memberName }) : '', x.refused ? t('mb.pick.refused') : ''].filter(Boolean).join('\n'),
                onClick: () => onPick(x),
              },
              h(PlatformMark, { t, platform: x.platform, size: 16 }),
              h('span', { className: 'n2s-pickchip-name' }, label(x)),
              x.refused && !x.memberId && h('span', { className: 'n2s-badge warn' }, t('mb.pick.pending')),
              taken && h('span', { className: 'n2s-faint' }, t('mb.pick.added')),
              x.lastAt && h('span', { className: 'n2s-faint' }, shortTime(x.lastAt)))
            })),
        h('div', { className: 'n2s-faint n2s-small' }, kind === 'chat' ? t('mb.pick.chatsHint') : t('mb.pick.peopleHint')))
    }

    /** People / groups refused by a bot because they are not members yet: add with one click. */
    function PendingMembers({ t, onAdd }) {
      const seen = useAsync(() => call('listSeenIdentities', {}).catch(() => []), [])
      const { catalog } = useCatalog(t)
      const pending = (seen.value ?? []).filter(x => x.refused && !x.memberId).slice(0, 6)
      if (!pending.length) return null
      return h('div', { className: 'n2s-notice warn n2s-pending', role: 'status', style: { marginBottom: 12 } },
        h('div', { style: { marginBottom: 6 } }, fmt(t, 'mb.pending.title', { n: pending.length })),
        h('div', { className: 'n2s-pickchips' }, pending.map(x => h('button', { key: `${x.platform}:${x.kind}:${x.id}`, type: 'button', className: 'n2s-pickchip', onClick: () => onAdd(x), title: `${platformName(t, x.platform, catalog)} · ${x.id}` },
          h(PlatformMark, { t, platform: x.platform, size: 16 }),
          h('span', { className: 'n2s-pickchip-name' }, x.name || x.chatName || x.id),
          h('span', { className: 'n2s-faint' }, x.kind === 'chat' ? t('mb.kind2.chat') : t('mb.kind2.person')),
          h('span', { className: 'n2s-link' }, t('mb.pending.add'))))))
    }

    function IdentityChips({ t, u, catalog }) {
      const ids = identitiesOf(u)
      if (!ids.length) return h('span', { className: 'n2s-badge warn' }, t('mb.ids.none'))
      return h('span', { className: 'n2s-idchips' }, ids.map((x, i) => h('span', { key: i, className: 'n2s-idchip', title: `${platformName(t, x.platform, catalog)} · ${x.id}${x.email ? ` · ${x.email}` : ''}` },
        h(PlatformMark, { t, platform: x.platform, size: 16 }), h('span', { className: 'n2s-mono' }, x.id || x.email))))
    }

    function UserForm({ t, initial, prefill, datasources, onDone, onCancel }) {
      const { catalog } = useCatalog(t)
      const [form, setForm] = useState(() => {
        const base = { kind: prefill?.kind ?? 'person', name: prefill ? (prefill.name || prefill.chatName || '') : '', role: 'analyst', allDatasources: initial ? initial.datasourceIds === null : false, datasourceIds: [], note: '', ...(initial ?? {}) }
        const ids = prefill ? [{ platform: prefill.platform, id: prefill.id, ...(prefill.kind === 'person' && prefill.email ? { email: prefill.email } : {}) }] : identitiesOf(initial)
        return { ...base, identities: ids.length ? ids : [{ platform: 'lark', id: '', email: '' }] }
      })
      const [error, setError] = useState(null)
      const [idErrors, setIdErrors] = useState({})
      const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
      const ids = form.datasourceIds ?? []
      const rules = form.rowRules ?? []
      const setRule = (i, patch) => setForm(f => ({ ...f, rowRules: (f.rowRules ?? []).map((r, j) => j === i ? { ...r, ...patch } : r) }))
      const save = async () => {
        setError(null)
        const identities = form.identities
          .map(r => ({ platform: r.platform, id: String(r.id ?? '').trim(), ...(form.kind === 'person' && String(r.email ?? '').trim() ? { email: String(r.email).trim() } : {}) }))
        // Rows left empty are dropped; at least one identity is required.
        const kept = identities.filter(r => r.id || r.email)
        if (!kept.length) { setIdErrors({ 0: t('mb.ids.needOne') }); return }
        setIdErrors({})
        // Legacy mirror for hosts that still read the Lark-only fields.
        const lark = kept.find(r => r.platform === 'lark' && r.id)
        const email = kept.find(r => r.email)?.email
        const legacy = form.kind === 'chat' ? { larkChatId: lark?.id ?? '' } : { larkOpenId: lark?.id ?? '', email: email ?? '' }
        const { identities: _i, larkOpenId: _o, larkChatId: _c, email: _e, ...rest } = form
        try {
          await call('saveUser', { ...rest, ...legacy, identities: kept.filter(r => r.id), datasourceIds: form.allDatasources ? null : ids, rowRules: rules.filter(r => r.column && (Array.isArray(r.values) ? r.values.length : String(r.values ?? '').trim())) })
          onDone()
        } catch (e) { setError(e.message) }
      }
      return h('div', { className: 'n2s-card', style: { marginBottom: 12 } },
        h('div', { className: 'n2s-form' },
          h('div', { className: 'n2s-field full' }, h('span', { id: 'n2s-mb-kind' }, t('mb.kind')), h('div', { className: 'n2s-seg', role: 'group', 'aria-labelledby': 'n2s-mb-kind', style: { justifySelf: 'start' } }, ['person', 'chat'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.kind === v, disabled: Boolean(initial?.id), onClick: () => setForm(f => ({ ...f, kind: v })) }, t(`mb.kind2.${v}`))))),
          h('label', { className: 'n2s-field' }, h('span', null, t('im.name')), h('input', { className: 'n2s-input', value: form.name, onChange: set('name') })),
          h('label', { className: 'n2s-field' }, h('span', null, t('mb.role')), h('select', { className: 'n2s-select', value: form.role, onChange: set('role') }, ['admin', 'analyst', 'viewer'].map(r => h('option', { key: r, value: r }, t(`mb.role.${r}`)))), h('span', { className: 'n2s-faint n2s-small' }, t(`mb.roleHint.${form.role}`))),
          !initial?.id && h(IdentityPicker, { t, kind: form.kind, catalog, chosen: form.identities, onPick: (x) => setForm(f => {
            const exists = f.identities.some(r => r.platform === x.platform && r.id === x.id)
            const rows = exists ? f.identities.filter(r => !(r.platform === x.platform && r.id === x.id)) : [...f.identities.filter(r => r.id || r.email), { platform: x.platform, id: x.id, ...(f.kind === 'person' && x.email ? { email: x.email } : {}) }]
            return { ...f, identities: rows.length ? rows : [{ platform: x.platform, id: '', email: '' }], name: f.name || (exists ? f.name : (x.name || x.chatName || '')) }
          }) }),
          h(IdentityEditor, { t, kind: form.kind, rows: form.identities, catalog, errors: idErrors, onChange: (rows) => { setForm(f => ({ ...f, identities: rows })); setIdErrors({}) } }),
          h('div', { className: 'n2s-field full' }, h('span', null, t('mb.scope')),
            h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: form.allDatasources, onChange: set('allDatasources') }), t('mb.allDs')),
            !form.allDatasources && h('div', { className: 'n2s-chips', style: { marginTop: 6 } }, datasources.map(d => h('button', { key: d.id, type: 'button', className: 'n2s-chip', 'aria-pressed': ids.includes(d.id), onClick: () => setForm(f => ({ ...f, datasourceIds: ids.includes(d.id) ? ids.filter(x => x !== d.id) : [...ids, d.id] })) }, d.name)))),
          h('div', { className: 'n2s-field full' }, h('span', null, t('mb.rowRules')),
            h('span', { className: 'n2s-faint n2s-small' }, t('mb.rowRulesHint')),
            rules.map((r, i) => h('div', { key: i, className: 'n2s-row', style: { flexWrap: 'nowrap' } },
              h('select', { className: 'n2s-select inline', 'aria-label': t('ds.select'), value: r.datasourceId ?? '', onChange: e => setRule(i, { datasourceId: e.target.value || null }) }, h('option', { value: '' }, t('mb.anyDs')), datasources.map(d => h('option', { key: d.id, value: d.id }, d.name))),
              h('input', { className: 'n2s-input n2s-mono', style: { width: 180 }, 'aria-label': t('mb.ruleColumn'), placeholder: 'merchant_code', value: r.column ?? '', onChange: e => setRule(i, { column: e.target.value }) }),
              h('span', { className: 'n2s-muted' }, '∈'),
              h('input', { className: 'n2s-input', 'aria-label': t('mb.ruleValues'), placeholder: 'A001, A002', value: Array.isArray(r.values) ? r.values.join(', ') : (r.values ?? ''), onChange: e => setRule(i, { values: e.target.value }) }),
              h('button', { type: 'button', className: 'n2s-iconbtn', 'aria-label': t('ds.delete'), onClick: () => setForm(f => ({ ...f, rowRules: (f.rowRules ?? []).filter((_, j) => j !== i) })) }, Icon.close()))),
            h('button', { type: 'button', className: 'n2s-btn small ghost', style: { justifySelf: 'start' }, onClick: () => setForm(f => ({ ...f, rowRules: [...(f.rowRules ?? []), { datasourceId: null, column: '', values: '' }] })) }, '+ ', t('mb.addRule'))),
          h('label', { className: 'n2s-field full' }, h('span', null, t('im.description')), h('input', { className: 'n2s-input', value: form.note ?? '', onChange: set('note') }))),
        error && h('div', { className: 'n2s-notice err', role: 'alert', style: { marginTop: 10 } }, error),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', onClick: save }, t('ds.save'))))
    }

    /** 「机器人」: every bot-capable channel with status, enable switch and recent conversations. */
    function BotsOverview({ t }) {
      const channels = useChannels()
      const bots = useBots()
      const { catalog } = useCatalog(t)
      const [busy, setBusy] = useState(null)
      const [open, setOpen] = useState(null)
      useEffect(() => { loadCatalog(); refreshChannels(); refreshBots() }, [])
      useEffect(() => {
        const id = setInterval(() => { if (!document.hidden) refreshBots() }, 5000)
        return () => clearInterval(id)
      }, [])
      const capable = channels.filter(c => (c.capabilities ?? findKind(catalog, c.type)?.kind?.capabilities)?.bot)
      const toggle = async (c, enabled) => {
        setBusy(c.id)
        try { await saveBotFor(c.id, { enabled }); notify(enabled ? fmt(t, 'ch.botOn', { name: c.name }) : fmt(t, 'ch.botOff', { name: c.name }), 'ok') } catch (e) { notifyError(e) }
        refreshChannels()
        setBusy(null)
      }
      const restart = async (c) => {
        try {
          if (bots.legacy) await call('restartLarkBot'); else await call('restartBot', { channelId: c.id })
          await refreshBots()
        } catch (e) { notifyError(e) }
      }
      return h('div', { className: 'n2s-section', style: { marginTop: 0, marginBottom: 24 } },
        h('div', { className: 'n2s-row', style: { marginBottom: 10 } },
          h('h2', { className: 'n2s-h2', style: { margin: 0 } }, t('ch.bots')),
          h('span', { className: 'n2s-faint n2s-small n2s-grow' }, t('ch.botsHint'))),
        bots.error && h('div', { className: 'n2s-notice err', style: { marginBottom: 8 } }, bots.error),
        capable.length === 0
          ? h('div', { className: 'n2s-empty', style: { padding: '24px 20px' } },
            h('h3', null, t('ch.bots.empty')), h('div', null, t('ch.bots.emptyHint')),
            h('button', { type: 'button', className: 'n2s-btn', onClick: () => fbCtx.navigate?.({ tab: 'admin', section: 'push' }) }, t('ch.bots.goAdd')))
          : h('div', { className: 'n2s-list2' }, capable.map(c => {
            const b = botOf(c, bots)
            const convs = b.conversations ?? []
            const expanded = open === c.id
            return h('div', { key: c.id, className: 'n2s-botrow', 'data-bot': c.id },
              h('div', { className: 'n2s-list2-row' },
                h(PlatformMark, { t, platform: c.platform }),
                h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
                  h('div', { className: 'n2s-row', style: { gap: 6 } }, h('span', { className: 'n2s-list2-title' }, c.name), b.info?.name && h('span', { className: 'n2s-badge' }, b.info.name), h(BotDot, { t, bot: b })),
                  h('div', { className: 'n2s-list2-sub' }, `${platformName(t, c.platform, catalog)} · ${kindLabel(t, c.type, catalog)} · ${t(`bot.scope.${b.sessionScope ?? 'chat'}`)}${b.allowP2p ? ` · ${t('ch.p2pOn')}` : ''}`),
                  b.enabled && b.status?.error && h('div', { className: 'n2s-list2-sub', style: { color: 'var(--n2s-err)', whiteSpace: 'normal' } }, b.status.error)),
                h('div', { className: 'n2s-row', style: { gap: 4, flexWrap: 'nowrap' } },
                  convs.length > 0 && h('button', { type: 'button', className: 'n2s-btn small ghost', 'aria-expanded': expanded, onClick: () => setOpen(expanded ? null : c.id) }, fmt(t, 'ch.convsN', { n: convs.length }), Icon.chev(10)),
                  b.enabled && botStateOf(b) === 'error' && h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => restart(c) }, Icon.refresh(12), t('ch.restart')),
                  h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => openChannelEditor(c.id, true) }, t('ch.botSettings')),
                  h('label', { className: 'n2s-switch', title: t('bot.enable') }, h('input', { type: 'checkbox', role: 'switch', 'aria-label': fmt(t, 'ch.botToggle', { name: c.name }), checked: Boolean(b.enabled), disabled: busy === c.id, onChange: e => toggle(c, e.target.checked) })))),
              expanded && h('div', { style: { padding: '0 16px 14px' } }, h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table' },
                h('thead', null, h('tr', null, [t('bot.chat'), t('bot.lastQ'), t('mb.user'), t('im.col.time'), ''].map((x, i) => h('th', { key: i }, x)))),
                h('tbody', null, convs.slice(0, 20).map(cv => h('tr', { key: cv.key },
                  h('td', null, cv.chatName ?? (cv.chatType === 'p2p' ? t('bot.p2pShort') : cv.chatId)), h('td', { title: cv.lastQuestion }, cv.lastQuestion), h('td', null, cv.lastActor ?? ''),
                  h('td', { className: 'n2s-muted' }, cv.lastAt ? shortTime(cv.lastAt) : ''),
                  h('td', null, cv.sessionId && h('button', { type: 'button', className: 'n2s-btn small ghost', 'aria-label': t('hist.openSession'), title: t('hist.openSession'), onClick: () => fbCtx.openSession?.(cv.sessionId) }, Icon.external(13))))))))))
          })))
    }

    function MembersTab({ t, datasources }) {
      const users = useAsync(() => call('listUsers'), [])
      const usage = useAsync(() => call('usageByActor', { days: 30 }), [])
      const settings = useAsync(() => call('getSettings'), [])
      const [editing, setEditing] = useState(null)
      const { catalog } = useCatalog(t)
      const list = users.value ?? []
      const usageById = new Map((usage.value ?? []).map(u => [u.actorId, u]))
      return h('div', null,
        h(SectionHead, { title: t('tab.members'), desc: t('mb.hint') }, h('button', { type: 'button', className: 'n2s-btn primary', onClick: () => setEditing({}) }, '+ ', t('mb.add'))),
        h(BotsOverview, { t }),
        !editing && h(PendingMembers, { t, onAdd: (x) => setEditing({ prefill: x }) }),
        editing && h(UserForm, { key: editing.id ?? (editing.prefill ? `p:${editing.prefill.id}` : 'new'), t, datasources, prefill: editing.prefill, initial: editing.id ? editing : null, onCancel: () => setEditing(null), onDone: () => { setEditing(null); users.reload() } }),
        settings.value && h('div', { className: 'n2s-setnote', style: { marginBottom: 10 } },
          t('mb.default'), ' ', h('strong', null, t(`mb.defaultRole.${settings.value.botDefaultRole ?? settings.value.larkDefaultRole ?? 'none'}`)), ' · ',
          h('button', { type: 'button', className: 'n2s-link', onClick: () => fbCtx.navigate?.({ tab: 'admin', section: 'settings' }) }, t('set.changeInSettings'))),
        list.length === 0 && !editing ? h('div', { className: 'n2s-empty' }, h('h3', null, t('mb.empty')), h('div', null, t('mb.emptyHint'))) :
          h('div', { className: 'n2s-list2' }, list.map(u => {
            const us = usageById.get(u.id)
            return h('div', { key: u.id, className: 'n2s-list2-row' },
              h('span', { className: 'n2s-tile', 'aria-hidden': true }, u.kind === 'chat' ? t('mb.chatShort') : (u.name || '?').slice(0, 1)),
              h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
                h('div', { className: 'n2s-row', style: { gap: 6 } }, h('span', { className: 'n2s-list2-title' }, u.name), h('span', { className: 'n2s-badge' }, t(`mb.role.${u.role}`)), u.disabled && h('span', { className: 'n2s-badge err' }, t('mb.disabled'))),
                h('div', { className: 'n2s-row', style: { gap: 6, marginTop: 4 } }, h(IdentityChips, { t, u, catalog }), h('span', { className: 'n2s-muted n2s-small' }, u.datasourceIds === null ? t('mb.allDs') : (u.datasourceNames ?? []).join(listSep()) || t('mb.noDs'))),
                (u.rowRules ?? []).length > 0 && h('div', { className: 'n2s-list2-sub' }, `${colon(t('mb.rowRules'))}${joinClauses(u.rowRules.map(r => `${r.column} ∈ {${r.values.join(', ')}}`))}`)),
              h('div', { className: 'n2s-list2-side' }, h('span', { className: 'n2s-small' }, us ? fmt(t, 'mb.queries', { n: us.queries }) : t('mb.noUsage')), us?.lastAt && h('span', { className: 'n2s-faint n2s-small' }, new Date(us.lastAt).toLocaleDateString())),
              h(Dropdown, { label: fmt(t, 'ch.actionsFor', { name: u.name }), trigger: { content: Icon.more() }, items: [
                { label: t('ds.edit'), icon: Icon.edit(14), onClick: () => setEditing(u) },
                { label: u.disabled ? t('mb.enable') : t('mb.disable'), icon: Icon.refresh(14), onClick: async () => { try { await call('saveUser', { id: u.id, disabled: !u.disabled }) } catch (e) { notifyError(e) } users.reload() } },
                { divider: true },
                { label: t('ds.delete'), icon: Icon.trash(14), danger: true, onClick: async () => { if (await confirmDialog({ title: fmt(t, 'mb.deleteConfirm', { name: u.name }), danger: true })) { try { await call('deleteUser', { id: u.id }) } catch (e) { notifyError(e) } users.reload() } } },
              ] }))
          })),
        (usage.value ?? []).length > 0 && h('div', { className: 'n2s-section' }, h('h2', null, t('mb.usage')),
          h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table' },
            h('thead', null, h('tr', null, [t('mb.user'), t('hist.total'), t('hist.errors'), t('hist.blocked'), t('mb.lastActive')].map((x, i) => h('th', { key: i, className: i && i < 4 ? 'num' : undefined }, x)))),
            h('tbody', null, usage.value.map(u => h('tr', { key: u.actorId }, h('td', null, u.name), h('td', { className: 'num' }, u.queries), h('td', { className: 'num' }, u.errors), h('td', { className: 'num' }, u.blocked), h('td', { className: 'n2s-muted' }, new Date(u.lastAt).toLocaleString()))))))))
    }

    // ---------------------------------------------------- dashboards bar

    function DashboardSwitcher({ t, value, onChange }) {
      const list = useAsync(() => call('listDashboards'), [value?.id], [])
      const v = list.value
      if (!v) return null
      const cur = v.dashboards.find(d => d.id === v.current)
      const act = async (fn) => { try { const r = await fn(); list.reload(); onChange(r?.current ?? v.current) } catch (e) { notifyError(e) } }
      return h('div', { className: 'n2s-dashtabs', role: 'tablist' },
        v.dashboards.map(d => h('button', { key: d.id, type: 'button', role: 'tab', 'aria-selected': d.id === v.current, onClick: () => act(() => call('selectDashboard', { id: d.id })) }, d.name, h('span', { className: 'count' }, d.widgets))),
        h(Dropdown, { label: t('dash.manage'), trigger: { className: 'n2s-btn small ghost', content: h(React.Fragment, null, '+', Icon.chev(10)) }, items: [
          { label: t('dash.new'), icon: Icon.chart(14), onClick: async () => { const name = await promptDialog({ title: t('dash.newName') }); if (name) act(() => call('saveDashboard', { name })) } },
          { label: t('dash.duplicate'), icon: Icon.copy(14), onClick: async () => { const name = await promptDialog({ title: t('dash.newName'), value: fmt(t, 'dash.copyName', { name: cur?.name ?? '' }) }); if (name) act(() => call('saveDashboard', { name, copyFrom: v.current })) } },
          { label: t('dash.renameBoard'), icon: Icon.edit(14), onClick: async () => { const name = await promptDialog({ title: t('dash.renameBoard'), value: cur?.name }); if (name) act(() => call('saveDashboard', { id: v.current, name })) } },
          { divider: true },
          v.dashboards.length > 1 && { label: t('dash.deleteBoard'), icon: Icon.trash(14), danger: true, onClick: async () => { if (await confirmDialog({ title: fmt(t, 'dash.deleteBoardConfirm', { name: cur?.name }), danger: true })) act(() => call('deleteDashboard', { id: v.current })) } },
        ] }))
    }

    function CacheStats({ t }) {
      const st = useAsync(() => call('cacheStats'), [])
      const v = st.value
      return h('div', { className: 'n2s-row' },
        h('span', { className: 'n2s-small n2s-muted' }, v ? fmt(t, 'settings.cacheStatsText', { results: v.results, mb: (v.bytes / 1048576).toFixed(1), cache: v.cacheEntries }) : '…'),
        h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: async () => { try { await call('clearCache') } catch (e) { notifyError(e) } st.reload() } }, t('settings.clearCache')))
    }

    function ChannelSelect({ t, value, onChange }) {
      return h('div', { style: { maxWidth: 380 } }, h(ChannelPicker, { t, value, onChange, noneLabel: t('rep.pushNone'), label: t('set.l.notify') }))
    }

    // Questions started from the page bind their new session to the chosen
    // data source as soon as the session appears in the composer. Only the
    // session our own startSession created may claim an ask: the one whose id
    // startSession returned (when the host returns it), otherwise a session the
    // composer had not seen before the ask was made, within PENDING_ASK_MS.
    const pendingAsks = []
    const seenSessions = new Set()
    const PENDING_ASK_MS = 60000
    function addPendingAsk(datasourceId, question) {
      const pending = { datasourceId, question, at: Date.now(), seen: new Set(seenSessions), sessionId: null }
      pendingAsks.push(pending)
      setTimeout(() => { const i = pendingAsks.indexOf(pending); if (i >= 0) pendingAsks.splice(i, 1) }, PENDING_ASK_MS)
      return pending
    }
    /** Remove and return the pending ask that belongs to this session, if any. */
    function claimPendingAsk(sessionId) {
      const now = Date.now()
      const i = pendingAsks.findIndex(p => now - p.at < PENDING_ASK_MS && (p.sessionId ? p.sessionId === sessionId : !p.seen.has(sessionId)))
      return i >= 0 ? pendingAsks.splice(i, 1)[0] : null
    }

    // ------------------------------------------------ composer selector

    function makeComposerControl(ctx) {
      return function Nl2SqlComposerControl({ sessionId }) {
        const t = useMemo(() => ctx.locale.bind(NS), [])
        setUiLang(useSyncExternalStore(ctx.locale.subscribe.bind(ctx.locale), () => ctx.locale.getSnapshot(), () => ctx.locale.getSnapshot()))
        const info = useSyncExternalStore(sessionInfoCache.subscribe, () => sessionInfoCache.get()[sessionId], () => sessionInfoCache.get()[sessionId])
        const datasources = useStore(s => s.datasources)
        const [open, setOpen] = useState(false)
        const anchor = useRef(null)
        const menu = useRef(null)
        useEffect(() => {
          if (!sessionId) return
          let cancelled = false
          ;(async () => {
            const fresh = pendingAsks.length > 0 && !seenSessions.has(sessionId)
            seenSessions.add(sessionId)
            if (fresh) {
              // A session already bound to a data source, or running another preset, is not ours.
              const info = await call('sessionInfo', { sessionId }).catch(() => null)
              const candidate = info && !info.boundDatasourceId && (info.preset === PRESET || info.preset === null || info.preset === undefined)
              const pending = candidate ? claimPendingAsk(sessionId) : null
              if (pending) await call('bindSession', { sessionId, datasourceId: pending.datasourceId }).catch(() => {})
            }
            if (!cancelled) await loadSessionInfo(sessionId)
          })()
          if (!store.get().loaded) refreshDatasources()
          return () => { cancelled = true }
        }, [sessionId])
        useEffect(() => {
          if (!open) return
          const onDown = (e) => { if (!menu.current?.contains(e.target) && !anchor.current?.contains(e.target)) setOpen(false) }
          const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); anchor.current?.focus() } }
          document.addEventListener('mousedown', onDown)
          document.addEventListener('keydown', onKey)
          menu.current?.querySelector('button')?.focus()
          return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
        }, [open])
        if (!info || info.preset !== PRESET) return null
        const current = datasources.find(d => d.id === info.datasourceId)
        const rect = anchor.current?.getBoundingClientRect()
        return h(React.Fragment, null,
          h('button', { ref: anchor, type: 'button', className: 'n2s-composer', title: t('composer.title'), 'aria-haspopup': 'menu', 'aria-expanded': open, onClick: () => setOpen(v => !v) },
            Icon.db(14), h('span', null, current ? current.name : t('composer.none')), Icon.chev(10)),
          open && rect && ReactDOM.createPortal(h('div', {
            ref: menu, className: 'n2s-menu', role: 'menu',
            style: { left: Math.max(8, rect.left), bottom: Math.max(8, window.innerHeight - rect.top + 6) },
          }, datasources.length === 0 && h('div', { className: 'n2s-muted n2s-small', style: { padding: '6px 10px' } }, t('ds.none')),
          datasources.map(ds => h('button', {
            key: ds.id, type: 'button', role: 'menuitemradio', 'aria-checked': ds.id === info.datasourceId,
            onClick: async () => {
              setOpen(false)
              await call('bindSession', { sessionId, datasourceId: ds.id }).catch(e => notifyError(e))
              await loadSessionInfo(sessionId)
            },
          }, h('span', { className: 'check' }, ds.id === info.datasourceId ? Icon.check() : null), h('span', { className: 'n2s-grow' }, ds.name), h('span', { className: 'n2s-muted n2s-small' }, ds.database)))), document.body))
      }
    }

    // ------------------------------------------------------ tool views

    function parseArgs(raw) {
      try { return JSON.parse(raw || '{}') } catch { return {} }
    }

    function makeOverviewToolView(ctx) {
      return function Nl2SqlOverviewView(props) {
        const t = useMemo(() => ctx.locale.bind(NS), [])
        setUiLang(useSyncExternalStore(ctx.locale.subscribe.bind(ctx.locale), () => ctx.locale.getSnapshot(), () => ctx.locale.getSnapshot()))
        const block = props.block
        const settled = props.phase === 'result'
        const meta = settled ? block.meta : undefined
        const args = parseArgs(settled ? block.call?.argsRaw : block?.argsRaw)
        const [results, setResults] = useState(null)
        useEffect(() => {
          if (!settled || block.isError || !meta?.results) return
          let alive = true
          Promise.all(meta.results.map(r => (r.error || !r.resultId ? r : call('getResult', { resultId: r.resultId }).then(full => full ?? { ...r, rows: [], expired: true }).catch(() => r))))
            .then(list => alive && setResults(list))
          return () => { alive = false }
        }, [settled, meta])
        if (!settled) return h('div', { className: 'n2s-toolcard' }, h('div', { className: 'n2s-row' }, h('span', { className: 'n2s-spin n2s-muted' }), h('span', { className: 'n2s-muted' }, t('tool.overviewRunning')), h('span', null, args.table ?? '')))
        if (block.isError) return h('div', { className: 'n2s-toolcard' }, h('div', { className: 'n2s-notice err' }, block.content?.map(c => (c.type === 'text' ? c.text : '')).join('\n')))
        return h('div', { className: 'n2s-toolcard' },
          h('div', { className: 'n2s-row', style: { marginBottom: 8 } }, h('span', { style: { fontWeight: 500 } }, fmt(t, 'tool.overviewTitle', { table: meta?.table ?? args.table })), meta?.results && h('span', { className: 'n2s-badge' }, fmt(t, 'tool.overviewCount', { count: meta.results.length }))),
          !results ? h('span', { className: 'n2s-spin n2s-muted' }) : h(OverviewGrid, { t, results: results.map(r => (r.expired ? { title: r.title, sql: r.sql, error: t('result.expired') } : r)), pinned: Boolean(args.pin) }))
      }
    }

    /** The latest user message before this tool call, used as the feedback question. */
    function findQuestion(props) {
      try {
        const nodes = props.useChat?.((s) => s.nodes ?? s.items ?? null)
        if (!Array.isArray(nodes)) return ''
        const idx = nodes.findIndex(n => n?.callId === props.callId || n?.block?.callId === props.callId)
        for (let i = (idx < 0 ? nodes.length : idx) - 1; i >= 0; i--) {
          const n = nodes[i]
          if (n?.kind === 'user') return String(n.text ?? n.message?.text ?? '').slice(0, 500)
        }
      } catch {}
      return ''
    }

    function makeToolView(ctx, kind) {
      return function Nl2SqlToolView(props) {
        const t = useMemo(() => ctx.locale.bind(NS), [])
        setUiLang(useSyncExternalStore(ctx.locale.subscribe.bind(ctx.locale), () => ctx.locale.getSnapshot(), () => ctx.locale.getSnapshot()))
        const block = props.block
        const settled = props.phase === 'result'
        const meta = settled ? block.meta : undefined
        const args = settled ? parseArgs(block.call?.argsRaw) : parseArgs(block?.argsRaw)
        const [result, setResult] = useState(null)
        const [state, setState] = useState('idle')
        const load = useCallback(async (rerun) => {
          if (!meta?.resultId) return
          setState('loading')
          try {
            let r = rerun ? null : await call('getResult', { resultId: meta.resultId })
            if (!r && rerun) r = await call('runQuery', { sql: meta.sql, datasourceId: meta.datasourceId, title: meta.title, chart: meta.chart })
            if (r) { setResult(r); setState('ok') } else setState('expired')
          } catch (e) {
            setState('error'); setResult({ error: e.message })
          }
        }, [meta?.resultId])
        useEffect(() => { if (settled && !block.isError) load(false) }, [settled, meta?.resultId])
        const title = args.title || (kind === 'chart' ? t('tool.chart') : t('tool.query'))
        if (!settled) {
          return h('div', { className: 'n2s-toolcard' }, h('div', { className: 'n2s-row' }, h('span', { className: 'n2s-spin n2s-muted' }), h('span', { className: 'n2s-muted' }, t('tool.running')), h('span', null, title)),
            args.sql && h('pre', { className: 'n2s-code', style: { marginTop: 8 } }, args.sql))
        }
        if (block.isError) {
          const text = block.content?.map(c => (c.type === 'text' ? c.text : '')).join('\n') || block.error?.code || ''
          return h('div', { className: 'n2s-toolcard' }, h('div', { className: 'n2s-row' }, h('span', { className: 'n2s-badge err' }, t('tool.failed')), h('span', null, title)),
            args.sql && h('pre', { className: 'n2s-code', style: { marginTop: 8 } }, args.sql),
            h('div', { className: 'n2s-notice err', style: { marginTop: 8 } }, text))
        }
        return h('div', { className: 'n2s-toolcard' },
          state === 'loading' && h('span', { className: 'n2s-spin n2s-muted' }),
          state === 'expired' && h('div', { className: 'n2s-row' }, h('span', { className: 'n2s-muted n2s-grow' }, `${meta?.title || title} · ${t('result.expired')}`),
            h('button', { type: 'button', className: 'n2s-btn small', onClick: () => load(true) }, t('result.rerun'))),
          state === 'error' && h('div', { className: 'n2s-notice err' }, result?.error),
          state === 'ok' && result && h(ResultView, {
            result, t, compact: true, question: findQuestion(props),
            onFeedback: {
              sessionId: props.sessionId,
              down: (comment) => props.inputActions?.setDraft?.(fmt(t, 'fb.followup', { title: result.title || t('tool.query'), comment: comment || t('fb.followupDefault') })),
            },
          }))
      }
    }

    // ---------------------------------------------------------- page shell
    // Five everyday tabs on top; administration lives behind one "管理" tab with
    // a left-hand section nav. The current location is kept in the URL hash-free
    // local state and remembered per browser (localStorage) so a refresh lands
    // where the user was.

    const PRIMARY_TABS = ['ask', 'dashboard', 'schema', 'knowledge', 'history']
    const BASE_ADMIN_SECTIONS = ['sources', 'members', 'automation', 'push', 'settings']
    // Feature sections (extend.adminSections) go before 设置.
    const adminSections = () => [...BASE_ADMIN_SECTIONS.slice(0, -1), ...extend.adminSections.map(x => x.id), 'settings']
    // Nav groups: feature sections are grouped by purpose so the list stays scannable.
    const NAV_GROUP_OF = { sources: 'core', members: 'core', automation: 'core', push: 'core', health: 'insight', reconcile: 'insight', goals: 'insight', digests: 'insight', subscriptions: 'insight', bitable: 'connect', mcp: 'connect', settings: 'end' }
    const navGroupOf = (k) => NAV_GROUP_OF[k] ?? extend.adminSections.find(x => x.id === k)?.group ?? 'insight'
    const NAV_GROUP_ORDER = ['core', 'insight', 'connect', 'end']
    const NAV_KEY = 'nl2sql:nav'

    function loadNav() {
      try { const v = JSON.parse(localStorage.getItem(NAV_KEY) ?? 'null'); if (v && (PRIMARY_TABS.includes(v.tab) || v.tab === 'admin')) return v } catch {}
      return { tab: 'ask', section: 'sources', sub: null }
    }

    const AdminIcons = {
      sources: () => Icon.db(15),
      members: () => svg(15, [h('circle', { key: 1, cx: 6, cy: 5.5, r: 2.5 }), h('path', { key: 2, d: 'M1.5 13.5c.6-2.4 2.3-3.8 4.5-3.8s3.9 1.4 4.5 3.8M11 3.2a2.4 2.4 0 0 1 0 4.6M12.6 9.9c1 .6 1.7 1.8 2 3.6' })]),
      automation: () => svg(15, [h('circle', { key: 1, cx: 8, cy: 8.5, r: 5.5 }), h('path', { key: 2, d: 'M8 5.5v3l2 1.5M6 1.5h4' })]),
      push: () => Icon.send(15),
      settings: () => svg(15, [h('path', { key: 1, d: 'M2.5 4.5h7M12.5 4.5h1M2.5 11.5h1M6.5 11.5h7' }), h('circle', { key: 2, cx: 11, cy: 4.5, r: 1.5 }), h('circle', { key: 3, cx: 5, cy: 11.5, r: 1.5 })]),
    }

    function AdminArea({ t, ctx, section, sub, onNavigate, ds, datasources }) {
      const counts = useAsync(() => Promise.all([call('listAlerts').catch(() => []), call('listReports').catch(() => []), call('listChannels').catch(() => []), call('listUsers').catch(() => [])]), [section], [])
      const [alerts, reports, channels, users] = counts.value ?? []
      const badge = { sources: datasources.length, members: users?.length, automation: (alerts?.length ?? 0) + (reports?.length ?? 0), push: channels?.length }
      const firing = (alerts ?? []).filter(a => a.state === 'firing').length
      const autoSub = sub === 'reports' ? 'reports' : 'alerts'
      return h('div', { className: 'n2s-admin' },
        h('nav', { className: 'n2s-adminnav', 'aria-label': t('tab.admin') },
          NAV_GROUP_ORDER.flatMap(g => {
            const keys = adminSections().filter(k => navGroupOf(k) === g)
            if (!keys.length) return []
            return [g !== 'core' && g !== 'end' && h('div', { key: `g:${g}`, className: 'n2s-adminnav-group', role: 'presentation' }, t(`admin.group.${g}`)), g === 'end' && h('div', { key: 'g:end', className: 'n2s-adminnav-sep', role: 'presentation' }), ...keys.map(k => h('button', { key: k, type: 'button', className: 'n2s-adminnav-item', 'aria-current': section === k ? 'page' : undefined, onClick: () => onNavigate({ section: k, sub: null }) },
            h('span', { className: 'ico', 'aria-hidden': true }, (AdminIcons[k] ?? extend.adminSections.find(x => x.id === k)?.icon ?? (() => Icon.chart(15)))()),
            h('span', { className: 'n2s-grow' }, extend.adminSections.find(x => x.id === k)?.label(t) ?? t(`admin.${k}`)),
            k === 'automation' && firing > 0 ? h('span', { className: 'n2s-navbadge err', title: t('al.firing') }, firing) : badge[k] ? h('span', { className: 'n2s-navbadge' }, badge[k]) : null))].filter(Boolean)
          })),
        h('div', { className: 'n2s-adminbody' },
          section === 'sources' ? h(SourcesTab, { t, datasources }) :
          section === 'members' ? h(MembersTab, { t, datasources }) :
          section === 'automation' ? h(React.Fragment, null,
            h('div', { className: 'n2s-seg', role: 'tablist', style: { marginBottom: 16 } },
              ['alerts', 'reports'].map(k => h('button', { key: k, type: 'button', role: 'tab', 'aria-selected': autoSub === k, 'aria-pressed': autoSub === k, onClick: () => onNavigate({ section, sub: k }) }, t(`tab.${k}`),
                k === 'alerts' && alerts?.length ? h('span', { className: 'n2s-faint', style: { marginLeft: 6 } }, alerts.length) : null,
                k === 'reports' && reports?.length ? h('span', { className: 'n2s-faint', style: { marginLeft: 6 } }, reports.length) : null))),
            autoSub === 'alerts' ? h(AlertsTab, { t, ds, datasources }) : h(ReportsTab, { t, ds, datasources, onOpenSession: (id) => ctx.uiWorkspace.openSession(id), onOpenSchedules: () => ctx.layout.selectPanel('schedules') })) :
          section === 'push' ? h(PushTab, { t }) :
          extend.adminSections.some(x => x.id === section) ? h(extend.adminSections.find(x => x.id === section).Component, { t, ds, datasources, onNavigate }) :
          h(SettingsPage, { t, datasources, onNavigate })))
    }

    function makePage(ctx) {
      return function Nl2SqlPage() {
        const t = useMemo(() => ctx.locale.bind(NS), [])
        const localeSnap = useSyncExternalStore(ctx.locale.subscribe.bind(ctx.locale), () => ctx.locale.getSnapshot(), () => ctx.locale.getSnapshot())
        setUiLang(localeSnap)
        const { datasources, loaded, error } = useStore(s => s)
        const [nav, setNavState] = useState(loadNav)
        const setNav = useCallback((patch) => setNavState(n => { const next = { ...n, ...patch }; try { localStorage.setItem(NAV_KEY, JSON.stringify(next)) } catch {} return next }), [])
        // Leaving 管理 → 设置 with unsaved settings asks first (SettingsPage sets fbCtx.settingsDirty).
        const navRef = useRef(nav)
        navRef.current = nav
        const guardedNav = useCallback(async (patch) => {
          const cur = navRef.current
          const next = { ...cur, ...patch }
          const inSettings = cur.tab === 'admin' && cur.section === 'settings'
          const leaving = inSettings && (next.tab !== 'admin' || next.section !== 'settings')
          if (leaving && fbCtx.settingsDirty) {
            const ok = await confirmDialog({ title: t('set.leaveTitle'), message: t('set.leaveMsg'), confirmLabel: t('set.leaveOk'), danger: true })
            if (!ok) return false
            fbCtx.settingsDirty = false
          }
          setNav(patch)
          return true
        }, [])
        const [selectedId, setSelectedId] = useState(null)
        useEffect(() => { refreshDatasources() }, [])
        const ds = datasources.find(d => d.id === selectedId) ?? datasources.find(d => d.current) ?? datasources[0]
        const needsSource = loaded && datasources.length === 0 && ['schema', 'knowledge'].includes(nav.tab)
        const ask = useCallback((question) => {
          if (!ds) return
          const pending = addPendingAsk(ds.id, question)
          try {
            const r = ctx.uiWorkspace.startSession(undefined, { agentPreset: PRESET, prompt: question, whenDraftExists: 'replace' })
            // Hosts that return the new session id (directly or as a promise) pin the ask to it.
            const adopt = (id) => { if (typeof id === 'string' && id) pending.sessionId = id }
            if (r && typeof r.then === 'function') r.then(adopt, () => {}); else adopt(r)
          } catch (e) {
            const i = pendingAsks.indexOf(pending); if (i >= 0) pendingAsks.splice(i, 1)
            notifyError(e)
          }
        }, [ds?.id])
        fbCtx.openSession = (id) => ctx.uiWorkspace.openSession(id)
        fbCtx.navigate = (patch) => { guardedNav(patch) }
        const tabs = [...PRIMARY_TABS, 'admin']
        const onTabKey = (e) => {
          if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
          const i = tabs.indexOf(nav.tab)
          const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
          guardedNav({ tab: next }).then(ok => { if (ok) setTimeout(() => document.getElementById(`n2s-tab-${next}`)?.focus(), 0) })
        }
        const tabBtn = (k) => h('button', { key: k, type: 'button', role: 'tab', id: `n2s-tab-${k}`, className: `n2s-tab${k === 'admin' ? ' admin' : ''}`, tabIndex: nav.tab === k ? 0 : -1, 'aria-selected': nav.tab === k, onClick: () => { guardedNav({ tab: k }) } },
          k === 'admin' && AdminIcons.settings(), t(`tab.${k}`))
        const status = !ds ? 'off' : ds.lastTestOk === false ? 'err' : ''
        const showPicker = datasources.length > 0 && nav.tab !== 'admin'
        return h('div', { className: 'n2s-page' },
          h('div', { className: 'n2s-scroll' }, h('div', { className: `n2s-content${nav.tab === 'admin' ? ' wide' : ''}` },
            h('div', { className: 'n2s-top' },
              h('div', { className: 'n2s-heading' },
                h('h1', null, t('page.title')),
                h('span', { className: 'n2s-grow' }),
                showPicker && h('label', { className: 'n2s-dspill', title: ds ? (ds.type === 'sqlite' ? t('up.localDesc') : `${ds.user ? `${ds.user}@` : ''}${ds.host}:${ds.port}/${ds.database}`) : '' },
                  h('span', { className: `n2s-dot ${status}` }),
                  h('span', { className: 'name' }, ds?.name ?? '—'),
                  ds && h('span', { className: 'meta' }, typeLabel(t, ds.type)),
                  Icon.chev(10),
                  h('select', { 'aria-label': t('ds.select'), value: ds?.id ?? '', onChange: async (e) => { const id = e.target.value; setSelectedId(id); try { await call('setCurrent', { id }) } catch (err) { notifyError(err) } refreshDatasources() } },
                    datasources.map(d => h('option', { key: d.id, value: d.id }, `${d.name} · ${typeLabel(t, d.type)}${d.type === 'sqlite' ? '' : ` · ${d.database}`}`))))),
              h('div', { className: 'n2s-tabs', role: 'tablist', 'aria-label': t('page.title'), onKeyDown: onTabKey }, PRIMARY_TABS.map(tabBtn), h('span', { className: 'n2s-grow' }), tabBtn('admin'))),
            h('div', { className: 'n2s-body', role: 'tabpanel', 'aria-labelledby': `n2s-tab-${nav.tab}` },
              error && h('div', { className: 'n2s-notice err', style: { marginBottom: 12 } }, error),
              !loaded ? h('div', { style: { display: 'grid', gap: 12 } }, h('div', { className: 'n2s-skel', style: { height: 120 } }), h('div', { className: 'n2s-skel', style: { height: 60 } })) :
                needsSource ? h(EmptySourceHint, { t, onGo: () => guardedNav({ tab: 'admin', section: 'sources' }) }) :
                nav.tab === 'ask' ? h(AskTab, { t, ds, datasources, onAsk: ask, presetReady: true, onNavigate: guardedNav }) :
                nav.tab === 'schema' ? h(SchemaTab, { t, ds, onAskTable: (tb) => ask(fmt(t, 'ask.tablePrompt', { name: tb.name, comment: paren(tb.comment) })) }) :
                nav.tab === 'knowledge' ? h(KnowledgeTab, { key: `kb:${ds?.id ?? ''}`, t, ds }) :
                nav.tab === 'history' ? h(HistoryTab, { t, datasources, onOpenSession: (id) => ctx.uiWorkspace.openSession(id) }) :
                nav.tab === 'dashboard' ? h(DashboardTab, { t, ds, datasources }) :
                h(AdminArea, { t, ctx, section: adminSections().includes(nav.section) ? nav.section : 'sources', sub: nav.sub, onNavigate: guardedNav, ds, datasources })))))
      }
    }

    function EmptySourceHint({ t, onGo }) {
      return h('div', { className: 'n2s-empty' },
        h('h3', null, t('ds.empty')),
        h('div', null, t('ds.emptyHint')),
        h('button', { type: 'button', className: 'n2s-btn primary', onClick: onGo }, t('ds.goAdd')))
    }

    function typeLabel(t, type) {
      return type === 'sqlite' ? t('type.sqlite') : (TYPE_LABEL[type] ?? type)
    }

    // ------------------------------------------------------------ settings
    // Grouped settings: a section nav on the left, one form per group. Edits are
    // kept as a draft until "保存"; a sticky bar shows unsaved changes and offers
    // save / discard; each group can restore its defaults. Leaving the group or
    // the admin area with unsaved changes asks for confirmation.

    const SETTINGS_GROUPS = ['privacy', 'query', 'automation', 'lark', 'storage', 'about']
    const GROUP_KEYS = {
      privacy: ['sampleMode', 'resultToModel', 'modelRows', 'maskSensitive'],
      query: ['maxRows', 'timeoutMs', 'scanGuardRows', 'cacheTtlSec', 'schemaOverviewMax'],
      automation: ['schemaWatch', 'schemaCheckDaily', 'schemaNotifyChannel'],
      lark: ['botDefaultRole', 'larkDefaultRole'],
      storage: ['retention'],
      about: [],
    }

    function sameValue(a, b) { return JSON.stringify(a ?? null) === JSON.stringify(b ?? null) }

    /** One labelled setting row: label + control on the left, explanation underneath. */
    function SettingRow({ label, hint, children, changed, htmlFor }) {
      return h('div', { className: `n2s-setrow${changed ? ' changed' : ''}` },
        h('div', { className: 'n2s-setrow-label' }, htmlFor ? h('label', { htmlFor }, label) : h('span', null, label), changed && h('span', { className: 'n2s-dotchanged', title: '•' })),
        h('div', { className: 'n2s-setrow-ctl' }, children),
        hint && h('div', { className: 'n2s-setrow-hint' }, hint))
    }

    function SettingsPage({ t, datasources, onNavigate }) {
      const loaded = useAsync(() => call('getSettings'), [])
      const [group, setGroup] = useState('privacy')
      const [base, setBase] = useState(null)
      const [form, setForm] = useState(null)
      const [saving, setSaving] = useState(false)
      useEffect(() => { if (loaded.value) { const { defaults, ...v } = loaded.value; setBase(v); setForm(v) } }, [loaded.value])
      const defaults = loaded.value?.defaults ?? {}
      const dirtyKeys = form && base ? Object.keys(form).filter(k => !sameValue(form[k], base[k])) : []
      const dirty = dirtyKeys.length > 0
      // Warn before the browser tab closes with unsaved settings.
      useEffect(() => {
        if (!dirty) return
        const onBefore = (e) => { e.preventDefault(); e.returnValue = '' }
        window.addEventListener('beforeunload', onBefore)
        return () => window.removeEventListener('beforeunload', onBefore)
      }, [dirty])
      // Let the admin nav ask before discarding.
      useEffect(() => { fbCtx.settingsDirty = dirty; return () => { fbCtx.settingsDirty = false } }, [dirty])
      if (!form) return loaded.error ? h('div', { className: 'n2s-notice err' }, loaded.error.message) : h('div', { className: 'n2s-skel', style: { height: 240 } })
      const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
      const changed = (k) => dirtyKeys.includes(k)
      const save = async () => {
        setSaving(true)
        try {
          const patch = Object.fromEntries(dirtyKeys.map(k => [k, form[k]]))
          const { defaults: _d, ...v } = await call('saveSettings', patch)
          setBase(v); setForm(v)
          notify(t('settings.saved'), 'ok')
        } catch (e) { notifyError(e) }
        setSaving(false)
      }
      const discard = () => setForm(base)
      const resetGroup = async () => {
        const keys = GROUP_KEYS[group].filter(k => k in defaults || k === 'retention')
        if (!keys.length) return
        if (!await confirmDialog({ title: t('settings.resetConfirm'), message: fmt(t, 'settings.resetConfirmMsg', { group: t(`set.g.${group}`) }) })) return
        try {
          const { defaults: _d, ...v } = await call('resetSettings', { keys })
          setBase(v); setForm(f => ({ ...f, ...Object.fromEntries(keys.map(k => [k, v[k]])) }))
          notify(t('settings.resetDone'), 'ok')
        } catch (e) { notifyError(e) }
      }
      const goGroup = async (g) => {
        if (g === group) return
        setGroup(g)
      }
      const radio = (key, values, prefix) => h('div', { className: 'n2s-radios', role: 'radiogroup', 'aria-label': t(`settings.${key}`) }, values.map(v => h('label', { key: v, className: `n2s-radio${form[key] === v ? ' on' : ''}` },
        h('input', { type: 'radio', name: key, checked: form[key] === v, onChange: () => set(key, v) }),
        h('span', null, h('span', { className: 'title' }, t(`${prefix}.${v}`)), h('span', { className: 'desc' }, t(`${prefix}.${v}.desc`))))))
      const num = (key, props = {}) => h('input', { id: `set-${key}`, className: 'n2s-input', type: 'number', style: { maxWidth: 200 }, value: form[key] ?? '', onChange: e => set(key, e.target.value === '' ? '' : Number(e.target.value)), ...props })
      // New hosts expose botDefaultRole (larkDefaultRole stays as an alias); old ones only larkDefaultRole.
      const roleKey = 'botDefaultRole' in base ? 'botDefaultRole' : 'larkDefaultRole'
      const overrides = datasources.filter(d => d.privacy && Object.keys(d.privacy).length)
      const body =
        group === 'privacy' ? h(React.Fragment, null,
          h(SettingRow, { label: t('settings.sampleMode'), hint: t('set.h.sampleMode'), changed: changed('sampleMode') }, radio('sampleMode', ['off', 'enum', 'all'], 'settings.sample')),
          h(SettingRow, { label: t('settings.resultToModel'), hint: t('set.h.resultToModel'), changed: changed('resultToModel') }, radio('resultToModel', ['none', 'summary', 'rows'], 'settings.result')),
          form.resultToModel === 'rows' && h(SettingRow, { label: t('settings.modelRows'), hint: t('set.h.modelRows'), changed: changed('modelRows'), htmlFor: 'set-modelRows' }, num('modelRows', { min: 0, max: 500 })),
          h(SettingRow, { label: t('set.l.mask'), hint: t('set.h.maskSensitive'), changed: changed('maskSensitive') }, h('label', { className: 'n2s-switch' }, h('input', { type: 'checkbox', role: 'switch', checked: Boolean(form.maskSensitive), onChange: e => set('maskSensitive', e.target.checked) }), h('span', null, form.maskSensitive ? t('set.on') : t('set.off')))),
          h('div', { className: 'n2s-setnote' }, overrides.length
            ? h(React.Fragment, null, t('set.overrides'), ' ', overrides.map((d, i) => h(React.Fragment, { key: d.id }, i > 0 && listSep(), h('button', { type: 'button', className: 'n2s-link', onClick: () => onNavigate({ section: 'sources' }) }, d.name))))
            : t('set.noOverrides'))) :
        group === 'query' ? h(React.Fragment, null,
          h(SettingRow, { label: t('set.l.maxRows'), hint: t('set.h.maxRows'), changed: changed('maxRows'), htmlFor: 'set-maxRows' }, num('maxRows', { min: 1, max: 100000 })),
          h(SettingRow, { label: t('set.l.timeout'), hint: t('set.h.timeoutMs'), changed: changed('timeoutMs'), htmlFor: 'set-timeoutMs' }, num('timeoutMs', { min: 1000, step: 1000 })),
          h(SettingRow, { label: t('set.l.scanGuard'), hint: t('set.h.scanGuardRows'), changed: changed('scanGuardRows'), htmlFor: 'set-scanGuardRows' }, num('scanGuardRows', { min: 0, step: 100000 })),
          h(SettingRow, { label: t('set.l.cacheTtl'), hint: t('set.h.cacheTtl'), changed: changed('cacheTtlSec'), htmlFor: 'set-cacheTtlSec' }, h('div', { className: 'n2s-row' }, num('cacheTtlSec', { min: 0 }), h(CacheStats, { t }))),
          h(SettingRow, { label: t('set.schemaOverviewMax'), hint: t('set.h.schemaOverviewMax'), changed: changed('schemaOverviewMax'), htmlFor: 'set-schemaOverviewMax' }, num('schemaOverviewMax', { min: 10, max: 1000 }))) :
        group === 'automation' ? h(React.Fragment, null,
          h(SchedulerCard, { t, onOpen: () => onNavigate({ section: 'automation', sub: 'alerts' }) }),
          h(SettingRow, { label: t('set.l.watch'), hint: t('settings.schemaWatchOn'), changed: changed('schemaWatch') }, h('label', { className: 'n2s-switch' }, h('input', { type: 'checkbox', role: 'switch', checked: form.schemaWatch !== false, onChange: e => set('schemaWatch', e.target.checked) }), h('span', null, form.schemaWatch !== false ? t('set.on') : t('set.off')))),
          h(SettingRow, { label: t('set.l.daily'), hint: t('set.h.schemaDaily'), changed: changed('schemaCheckDaily'), htmlFor: 'set-daily' }, h('div', { className: 'n2s-row' },
            h('input', { id: 'set-daily', className: 'n2s-input', type: 'time', style: { maxWidth: 160 }, value: form.schemaCheckDaily ?? '', onChange: e => set('schemaCheckDaily', e.target.value) }),
            form.schemaCheckDaily && h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => set('schemaCheckDaily', '') }, t('set.turnOff')))),
          h(SettingRow, { label: t('set.l.notify'), hint: t('set.h.schemaNotify'), changed: changed('schemaNotifyChannel') }, h(ChannelSelect, { t, value: form.schemaNotifyChannel ?? '', onChange: v => set('schemaNotifyChannel', v) }))) :
        group === 'lark' ? h(React.Fragment, null,
          h(SettingRow, { label: t('set.defaultChannel'), hint: t('set.h.defaultChannel'), htmlFor: 'set-defchannel' }, h(DefaultChannelControl, { t, onOpenPush: () => onNavigate({ section: 'push' }) })),
          h(SettingRow, { label: t('set.l.unknownUser'), hint: t('set.h.botDefaultRole'), changed: changed(roleKey) }, radio(roleKey, ['none', 'viewer', 'analyst'], 'mb.defaultRole')),
          h(BotSummary, { t, onOpenMembers: () => onNavigate({ section: 'members' }), onOpenPush: () => onNavigate({ section: 'push' }) })) :
        group === 'storage' ? h(StorageSection, { t, form, set, changed, defaults }) :
        h(AboutSection, { t })
      const canReset = GROUP_KEYS[group].length > 0
      return h('div', { className: 'n2s-settings' },
        h(SectionHead, { title: t('tab.settings'), desc: t('set.desc') }),
        h('div', { className: 'n2s-setgroups', role: 'tablist', 'aria-label': t('tab.settings') }, SETTINGS_GROUPS.map(g => {
          const n = GROUP_KEYS[g].filter(k => dirtyKeys.includes(k)).length
          return h('button', { key: g, type: 'button', role: 'tab', 'aria-selected': group === g, onClick: () => goGroup(g) }, t(`set.g.${g}`), n > 0 && h('span', { className: 'n2s-dotchanged', 'aria-label': t('set.unsaved') }))
        })),
        h('div', { className: 'n2s-setpanel', role: 'tabpanel' },
          h('div', { className: 'n2s-row', style: { marginBottom: 6 } },
            h('div', { className: 'n2s-grow' }, h('div', { className: 'n2s-h2', style: { margin: 0 } }, t(`set.g.${group}`)), h('div', { className: 'n2s-muted n2s-small', style: { marginTop: 2 } }, t(`set.gd.${group}`))),
            canReset && h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: resetGroup }, Icon.refresh(13), t('settings.reset'))),
          body),
        dirty && h('div', { className: 'n2s-savebar', role: 'region', 'aria-label': t('set.unsaved') },
          h('span', { className: 'n2s-dotchanged' }),
          h('span', { className: 'n2s-grow' }, fmt(t, 'set.unsavedN', { n: dirtyKeys.length })),
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: discard, disabled: saving }, t('set.discard')),
          h('button', { type: 'button', className: 'n2s-btn primary', onClick: save, disabled: saving }, saving ? h('span', { className: 'n2s-spin' }) : null, t('settings.save'))))
    }

    function SchedulerCard({ t, onOpen }) {
      const st = useAsync(() => call('schedulerStatus').catch(() => null), [])
      const v = st.value
      return h('div', { className: 'n2s-infocard' },
        h('span', { className: `n2s-statusdot ${v?.running ? 'ok' : ''}` }, v?.running ? t('set.schedOn') : t('set.schedOff')),
        h('span', { className: 'n2s-muted n2s-small n2s-grow' },
          v?.lastTickAt ? fmt(t, 'al.lastTick', { time: new Date(v.lastTickAt).toLocaleTimeString(), n: (v.lastRan ?? []).length }) : t('al.noTickYet'),
          v?.nextAlerts?.[0] ? ` · ${fmt(t, 'al.nextDue', { name: v.nextAlerts[0].name, time: new Date(Math.max(v.nextAlerts[0].dueAt, Date.now())).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })}` : ''),
        h('button', { type: 'button', className: 'n2s-btn small', onClick: onOpen }, t('set.openAlerts')))
    }

    /** Default channel: applied immediately (it is a channel property, not a setting). */
    function DefaultChannelControl({ t, onOpenPush }) {
      const channels = useChannels()
      const def = channels.find(c => c.isDefault)
      if (!channels.length) return h('div', { className: 'n2s-row' }, h('span', { className: 'n2s-muted n2s-small' }, t('set.noChannels')), h('button', { type: 'button', className: 'n2s-btn small', onClick: onOpenPush }, t('im.add')))
      return h('div', { style: { maxWidth: 380 } }, h(ChannelPicker, {
        t, id: 'set-defchannel', value: def?.id ?? '', noneLabel: def ? undefined : t('set.noDefaultChannel'),
        onChange: async (id) => {
          const c = channels.find(x => x.id === id)
          if (!c) return
          try { await makeDefault(c); notify(t('ch.defaultSet'), 'ok') } catch (e) { notifyError(e) }
          refreshChannels()
        },
      }))
    }

    /** Bots per platform: how many are on and whether any is failing. */
    function BotSummary({ t, onOpenMembers, onOpenPush }) {
      const channels = useChannels()
      const bots = useBots()
      const { catalog } = useCatalog(t)
      const capable = channels.filter(c => (c.capabilities ?? findKind(catalog, c.type)?.kind?.capabilities)?.bot)
      const byPlatform = []
      for (const c of capable) {
        let g = byPlatform.find(x => x.platform === c.platform)
        if (!g) byPlatform.push(g = { platform: c.platform, total: 0, on: 0, err: 0, ok: 0 })
        const b = botOf(c, bots)
        const s = botStateOf(b)
        g.total++
        if (b.enabled) g.on++
        if (s === 'error') g.err++
        if (s === 'connected') g.ok++
      }
      return h(React.Fragment, null,
        h('div', { className: 'n2s-setsub' }, t('ch.bots')),
        byPlatform.length === 0
          ? h('div', { className: 'n2s-setnote' }, t('ch.bots.emptyHint'), ' ', h('button', { type: 'button', className: 'n2s-link', onClick: onOpenPush }, t('ch.bots.goAdd')))
          : h('div', { className: 'n2s-infogrid' }, byPlatform.map(g => h('div', { key: g.platform, className: 'n2s-infocard' },
            h(PlatformMark, { t, platform: g.platform, size: 28 }),
            h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
              h('div', { className: 'n2s-small', style: { fontWeight: 500 } }, platformName(t, g.platform, catalog)),
              h('span', { className: `n2s-statusdot ${g.err ? 'err' : g.ok ? 'ok' : ''}` }, g.err ? fmt(t, 'ch.sum.err', { n: g.err }) : fmt(t, 'ch.sum.on', { on: g.on, total: g.total }))),
            h('button', { type: 'button', className: 'n2s-btn small', onClick: onOpenMembers }, t('set.configure'))))))
    }

    const RETENTION_KINDS = ['history', 'feedback', 'delivery', 'alertEvent', 'admin', 'evalRun', 'schemaChange']

    function StorageSection({ t, form, set, changed, defaults }) {
      const st = useAsync(() => call('storageStats').catch(() => null), [])
      const v = st.value
      const retention = form.retention ?? defaults.retention ?? {}
      const fileRef = useRef(null)
      const [importState, setImportState] = useState(null)
      const importBox = useRef(null)
      useFocusTrap(importBox, Boolean(importState))
      const [importing, runImport] = useBusy()
      useEffect(() => {
        if (!importState) return
        const prev = document.activeElement
        setTimeout(() => importBox.current?.querySelector('button.primary')?.focus(), 0)
        const onKey = (e) => { if (e.key === 'Escape' && !feedbackStore.get().dialog) setImportState(null) }
        document.addEventListener('keydown', onKey)
        return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() }
      }, [Boolean(importState)])
      const exportAll = async () => {
        try {
          const doc = await call('exportConfig')
          download(`nl2sql-config-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }))
          notify(t('set.exported'), 'ok')
        } catch (e) { notifyError(e) }
      }
      const onFile = async (e) => {
        const f = e.target.files?.[0]
        e.target.value = ''
        if (!f) return
        try {
          const doc = JSON.parse(await f.text())
          const dry = await call('importConfig', { data: doc, mode: 'merge', dryRun: true })
          setImportState({ doc, dry })
        } catch (err) { notifyError(err) }
      }
      const doImport = (mode) => runImport(async () => {
        if (mode === 'replace' && !await confirmDialog({ title: t('set.importReplaceConfirm'), message: t('set.importReplaceMsg'), danger: true })) return
        try {
          const r = await call('importConfig', { data: importState.doc, mode })
          setImportState(null)
          await refreshDatasources()
          refreshChannels()
          const needs = (r.report?.datasources?.needsSecret ?? r.needsSecret ?? []).length
          notify(needs ? fmt(t, 'set.importedNeedsSecret', { n: needs }) : t('set.imported'), 'ok', 6000)
        } catch (err) { notifyError(err) }
      })
      const purge = async (kind) => {
        if (!await confirmDialog({ title: fmt(t, 'set.purgeConfirm', { kind: t(`set.rk.${kind}`) }), danger: true })) return
        try { await call('purgeRecords', { kind }); st.reload(); notify(t('set.purged'), 'ok') } catch (e) { notifyError(e) }
      }
      return h(React.Fragment, null,
        h('div', { className: 'n2s-infogrid' },
          h('div', { className: 'n2s-infocard col' }, h('span', { className: 'n2s-faint n2s-small' }, t('set.resultsDb')), h('span', { className: 'n2s-bignum' }, v ? `${(v.resultsDb.bytes / 1048576).toFixed(1)} MB` : '…'), h('span', { className: 'n2s-muted n2s-small' }, v ? fmt(t, 'set.resultsDbSub', { results: v.resultsDb.results, cache: v.resultsDb.cacheEntries }) : '')),
          h('div', { className: 'n2s-infocard col' }, h('span', { className: 'n2s-faint n2s-small' }, t('set.stateFile')), h('span', { className: 'n2s-bignum' }, v ? `${(v.stateBytes / 1024).toFixed(1)} KB` : '…'), h('span', { className: 'n2s-muted n2s-small n2s-ellipsis', title: v?.dataDir }, v?.dataDir ?? ''))),
        h('div', { className: 'n2s-setsub' }, t('set.retention')),
        h('div', { className: 'n2s-muted n2s-small', style: { marginBottom: 8 } }, t('set.h.retention')),
        h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table' },
          h('thead', null, h('tr', null, [t('set.rkCol'), t('set.rkCount'), t('set.rkKeep'), ''].map((x, i) => h('th', { key: i, className: i === 1 ? 'num' : undefined }, x)))),
          h('tbody', null, RETENTION_KINDS.map(k => h('tr', { key: k },
            h('td', null, t(`set.rk.${k}`)),
            h('td', { className: 'num' }, v?.records?.[k] ?? '—'),
            h('td', null, h('input', { className: 'n2s-input', type: 'number', min: 100, max: 200000, step: 100, 'aria-label': `${t(`set.rk.${k}`)} ${t('set.rkKeep')}`, style: { width: 120, height: 30 }, value: retention[k] ?? '', onChange: e => set('retention', { ...retention, [k]: e.target.value === '' ? '' : Number(e.target.value) }) })),
            h('td', { style: { textAlign: 'right' } }, h('button', { type: 'button', className: 'n2s-btn small ghost', disabled: !v?.records?.[k], onClick: () => purge(k) }, t('set.purge')))))))),
        changed('retention') && h('div', { className: 'n2s-faint n2s-small', style: { marginTop: 6 } }, t('set.retentionNote')),
        h('div', { className: 'n2s-setsub' }, t('set.backup')),
        h('div', { className: 'n2s-muted n2s-small', style: { marginBottom: 10 } }, t('set.h.backup')),
        h('div', { className: 'n2s-row' },
          h('button', { type: 'button', className: 'n2s-btn', onClick: exportAll }, Icon.download(13), t('set.export')),
          h('button', { type: 'button', className: 'n2s-btn', onClick: () => fileRef.current?.click() }, Icon.up(13), t('set.import')),
          h('input', { ref: fileRef, type: 'file', accept: 'application/json,.json', style: { display: 'none' }, onChange: onFile })),
        importState && ReactDOM.createPortal(h('div', { className: 'n2s-modal-backdrop', onMouseDown: (e) => { if (e.target === e.currentTarget) setImportState(null) } },
          h('div', { ref: importBox, className: 'n2s-modal', role: 'dialog', 'aria-modal': true, 'aria-label': t('set.import') },
            h('div', { className: 'n2s-modal-title', style: { marginBottom: 10 } }, t('set.import')),
            h('div', { className: 'n2s-muted n2s-small', style: { marginBottom: 10 } }, fmt(t, 'set.importFrom', { time: importState.doc.exportedAt ? new Date(importState.doc.exportedAt).toLocaleString() : '?' })),
            h('table', { className: 'n2s-table' }, h('thead', null, h('tr', null, [t('set.section'), t('set.toAdd'), t('set.toUpdate'), t('set.note')].map((x, i) => h('th', { key: i }, x)))),
              h('tbody', null, Object.entries(importState.dry?.report ?? {}).map(([k, r]) => h('tr', { key: k },
                h('td', null, t(`set.sec.${k}`)), h('td', null, r.add ?? r.added ?? 0), h('td', null, r.update ?? r.updated ?? 0),
                h('td', { className: 'n2s-muted n2s-small', style: { whiteSpace: 'normal' } }, joinClauses([r.needsSecret?.length ? fmt(t, 'set.needsSecret', { names: joinList(r.needsSecret) }) : '', r.paused ? t('set.reportsPaused') : '', r.skipped ? fmt(t, 'set.skipped', { n: r.skipped }) : ''])))))),
            h('div', { className: 'n2s-row', style: { marginTop: 14, justifyContent: 'flex-end' } },
              h('button', { type: 'button', className: 'n2s-btn ghost', onClick: () => setImportState(null) }, t('ds.cancel')),
              h('button', { type: 'button', className: 'n2s-btn danger', disabled: importing, onClick: () => doImport('replace') }, t('kb.replace')),
              h('button', { type: 'button', className: 'n2s-btn primary', disabled: importing, onClick: () => doImport('merge') }, importing ? h('span', { className: 'n2s-spin' }) : null, t('kb.merge'))))), document.body))
    }

    function AboutSection({ t }) {
      const info = useAsync(() => call('aboutInfo').catch(() => null), [])
      const v = info.value
      const row = (k, val, mono) => h('tr', { key: k }, h('td', { className: 'n2s-muted', style: { width: 160 } }, t(`set.about.${k}`)), h('td', { className: mono ? 'n2s-mono' : undefined, style: { whiteSpace: 'normal', wordBreak: 'break-all' } }, val ?? '—'))
      return h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table' }, h('tbody', null,
        row('version', v?.version),
        row('dataDir', v?.dataDir, true),
        row('runtime', v ? `Node ${v.nodeVersion} · SQLite ${v.sqliteVersion}` : null),
        row('tests', v?.testsCommand, true),
        row('docs', 'github.com/hedeqiang/dsh-nl2sql'))))
    }

    // ------------------------------------------------------------ data freshness + quality (health)
    // - resultPanels: a warning bar under results whose referenced tables are stale
    //   (server resolves the tables with policy.js referencedTables via freshnessFor({ sql })).
    // - schemaPanels: tables with lag (green / amber / red) and a refresh button.
    // - adminSections 'health': freshness table with per-table thresholds, quality patrol
    //   results, run now, settings (channels, thresholds, schedule).
    // - toolViews: conversation view of the nl2sql_freshness agent tool.

    /** Shared freshness cache: key → { at, promise, value }; bumping `rev` re-renders subscribers. */
    const fqCache = (() => {
      let rev = 0
      const map = new Map()
      const subs = new Set()
      const TTL = 5 * 60000
      return {
        get(datasourceId, sql) {
          const key = `${datasourceId}\u0000${sql ?? ''}`
          const hit = map.get(key)
          if (hit && Date.now() - hit.at < TTL) return hit.promise
          const promise = call('freshnessFor', { datasourceId, panel: true, ...(sql ? { sql } : {}) })
          map.set(key, { at: Date.now(), promise })
          promise.catch(() => map.delete(key))
          return promise
        },
        async refresh(datasourceId) {
          const v = await call('freshnessFor', { datasourceId, refresh: true, panel: true })
          for (const k of [...map.keys()]) if (k.startsWith(`${datasourceId}\u0000`)) map.delete(k)
          map.set(`${datasourceId}\u0000`, { at: Date.now(), promise: Promise.resolve(v) })
          rev++
          for (const f of subs) f()
          return v
        },
        /** Drop everything (e.g. after the show / enable settings change) and re-render subscribers. */
        reset() { map.clear(); rev++; for (const f of subs) f() },
        subscribe(f) { subs.add(f); return () => subs.delete(f) },
        rev: () => rev,
      }
    })()

    const fqStatusClass = { ok: 'ok', warn: 'warn', stale: 'err', error: 'err', empty: 'off', off: 'off', unknown: 'off' }
    const fqPad = (n) => String(n).padStart(2, '0')

    function fqLag(t, min) {
      if (min === null || min === undefined || !Number.isFinite(min)) return '—'
      const m = Math.max(0, Math.round(min))
      if (m < 60) return fmt(t, 'fq.lagMin', { n: m })
      if (m < 48 * 60) return fmt(t, 'fq.lagHour', { n: Math.round(m / 60) })
      return fmt(t, 'fq.lagDay', { n: Math.round(m / 1440) })
    }

    /** 「昨天 17:55」 / "yesterday 17:55" relative to now. */
    function fqWhen(t, ms) {
      if (!Number.isFinite(ms)) return '—'
      const d = new Date(ms)
      const now = new Date()
      const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
      const diff = Math.round((day(now) - day(d)) / 86400000)
      const hm = `${fqPad(d.getHours())}:${fqPad(d.getMinutes())}`
      if (diff === 0) return fmt(t, 'fq.today', { time: hm })
      if (diff === 1) return fmt(t, 'fq.yesterday', { time: hm })
      return `${d.getFullYear() === now.getFullYear() ? '' : `${d.getFullYear()}-`}${fqPad(d.getMonth() + 1)}-${fqPad(d.getDate())} ${hm}`
    }

    const fqTime = (at) => (at ? new Date(at).toLocaleString(uiLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')

    function useFqRev() {
      return useSyncExternalStore(fqCache.subscribe, fqCache.rev, fqCache.rev)
    }

    // ---- result warning bar

    function FreshnessResultPanel({ t, result }) {
      const rev = useFqRev()
      const dsId = result?.datasourceId
      const sql = result?.sql
      const [view, setView] = useState(null)
      useEffect(() => {
        if (!dsId || !sql || result?.error) return
        let alive = true
        fqCache.get(dsId, sql).then(v => alive && setView(v), () => {})
        return () => { alive = false }
      }, [dsId, sql, rev])
      if (view?.disabled) return null
      const stale = (view?.tables ?? []).filter(x => x.stale)
      if (!stale.length) return null
      return h('div', { className: 'n2s-fq-bar', role: 'status' },
        h('span', { 'aria-hidden': true }, '⚠️'),
        h('span', null, joinClauses(stale.slice(0, 3).map(x => fmt(t, 'fq.barItem', { table: x.table, when: fqWhen(t, x.latestAt), lag: fqLag(t, x.lagMinutes) })))),
        stale.length > 3 && h('span', { className: 'n2s-faint' }, fmt(t, 'fq.barMore', { n: stale.length - 3 })))
    }
    extend.resultPanels.push(FreshnessResultPanel)

    // ---- schema panel

    function FqDot({ status }) {
      return h('span', { className: `n2s-fq-dot ${fqStatusClass[status] ?? 'off'}`, 'aria-hidden': true })
    }

    function FreshnessSchemaPanel({ t, ds }) {
      const rev = useFqRev()
      const [state, setState] = useState({ loading: true })
      const [open, setOpen] = useState(null)
      const [busy, setBusy] = useState(false)
      useEffect(() => {
        if (!ds?.id) return
        let alive = true
        setState(s => ({ ...s, loading: true }))
        fqCache.get(ds.id).then(v => alive && setState({ value: v }), e => alive && setState({ error: e }))
        return () => { alive = false }
      }, [ds?.id, rev])
      const v = state.value
      if (!ds || state.error || !v || v.disabled || !v.tables?.length) return null
      const stale = v.tables.filter(x => x.stale).length
      const warn = v.tables.filter(x => x.status === 'warn').length
      const expanded = open ?? stale > 0
      const refresh = async () => {
        setBusy(true)
        try { await fqCache.refresh(ds.id) } catch (e) { notifyError(e) }
        setBusy(false)
      }
      return h('div', { className: 'n2s-fq-panel' },
        h('div', { className: 'n2s-row' },
          h('button', { type: 'button', className: 'n2s-btn small ghost', 'aria-expanded': expanded, onClick: () => setOpen(!expanded) }, Icon.chev(10), t('fq.title')),
          h('span', { className: `n2s-badge ${stale ? 'err' : warn ? 'warn' : 'ok'}` }, stale ? fmt(t, 'fq.staleCount', { n: stale }) : warn ? fmt(t, 'fq.warnCount', { n: warn }) : t('fq.allFresh')),
          h('span', { className: 'n2s-faint n2s-small' }, fmt(t, 'fq.checkedAt', { time: fqTime(v.checkedAt) })),
          h('span', { className: 'n2s-grow' }),
          h('button', { type: 'button', className: 'n2s-btn small', disabled: busy, onClick: refresh }, busy ? h('span', { className: 'n2s-spin' }) : Icon.refresh(13), t('fq.refresh'))),
        expanded && h('div', { className: 'n2s-fq-list' }, v.tables.map(x => h('div', { key: x.table, className: 'n2s-fq-item', title: x.error ?? `${x.column} · ${x.latestLocal ?? '—'}` },
          h(FqDot, { status: x.status }),
          h('span', { className: 'n2s-ellipsis n2s-mono' }, x.table),
          h('span', { className: 'n2s-grow' }),
          h('span', { className: 'n2s-faint n2s-small' }, x.error ? t('fq.st.error') : x.latestAt === null ? t('fq.st.empty') : fqLag(t, x.lagMinutes))))))
    }
    extend.schemaPanels.push(FreshnessSchemaPanel)

    // ---- conversation tool view

    function makeFreshnessToolView(ctx) {
      return function Nl2SqlFreshnessView(props) {
        const t = useMemo(() => ctx.locale.bind(NS), [])
        setUiLang(useSyncExternalStore(ctx.locale.subscribe.bind(ctx.locale), () => ctx.locale.getSnapshot(), () => ctx.locale.getSnapshot()))
        const block = props.block
        const settled = props.phase === 'result'
        const f = settled ? block.meta?.freshness : undefined
        if (!settled) return h('div', { className: 'n2s-toolcard' }, h('div', { className: 'n2s-row' }, h('span', { className: 'n2s-spin n2s-muted' }), h('span', { className: 'n2s-muted' }, t('fq.running'))))
        if (block.isError || !f) return h('div', { className: 'n2s-toolcard' }, h('div', { className: 'n2s-notice err' }, block.content?.map(c => (c.type === 'text' ? c.text : '')).join('\n') || t('fq.failed')))
        return h('div', { className: 'n2s-toolcard' },
          h('div', { className: 'n2s-row', style: { marginBottom: 6 } }, h('span', { style: { fontWeight: 500 } }, t('fq.title')), f.datasource && h('span', { className: 'n2s-badge' }, f.datasource)),
          (f.warnings ?? []).map((w, i) => h('div', { key: i, className: 'n2s-fq-bar' }, w)),
          h('div', { className: 'n2s-fq-list' }, (f.tables ?? []).map(x => h('div', { key: x.table, className: 'n2s-fq-item' },
            h(FqDot, { status: x.status ?? 'unknown' }),
            h('span', { className: 'n2s-mono n2s-ellipsis' }, x.table),
            h('span', { className: 'n2s-grow' }),
            h('span', { className: 'n2s-faint n2s-small' }, x.note && !x.latestAt ? t('fq.noTime') : x.latestAt ? `${x.latestAt} · ${fqLag(t, x.lagMinutes)}` : t('fq.st.empty'))))))
      }
    }
    if (extend.toolViews) extend.toolViews.push({ key: 'nl2sql_freshness', make: makeFreshnessToolView })

    // ---- admin section

    function FqScore({ score }) {
      const cls = score === null || score === undefined ? 'off' : score >= 90 ? 'ok' : score >= 70 ? 'warn' : 'err'
      return h('span', { className: `n2s-fq-score ${cls}` }, score === null || score === undefined ? '—' : score)
    }

    function HealthSettings({ t, onSaved }) {
      const st = useAsync(() => call('healthSettings'), [])
      const [form, setForm] = useState(null)
      const [busy, runBusy] = useBusy()
      useEffect(() => { if (st.value) setForm(structuredClone(st.value)) }, [st.value])
      if (!form) return h('div', { className: 'n2s-skel', style: { height: 120 } })
      const setF = (k, v) => setForm(f => ({ ...f, freshness: { ...f.freshness, [k]: v } }))
      const setQ = (k, v) => setForm(f => ({ ...f, quality: { ...f.quality, [k]: v } }))
      const save = () => runBusy(async () => {
        try {
          const { overrides: _o, ...freshness } = form.freshness
          const out = await call('saveHealthSettings', { freshness: { ...freshness, intervalMin: Number(freshness.intervalMin), staleHours: Number(freshness.staleHours), channelId: freshness.channelId || null }, quality: { ...form.quality, dropPoints: Number(form.quality.dropPoints), channelId: form.quality.channelId || null } })
          setForm(structuredClone(out))
          fqCache.reset()
          notify(t('fq.saved'), 'ok')
          onSaved?.()
        } catch (e) { notifyError(e) }
      })
      const fOn = Boolean(form.freshness.enabled)
      const qOn = Boolean(form.quality.enabled)
      const sw = (checked, onChange, label, disabled) => h('label', { className: 'n2s-switch' }, h('input', { type: 'checkbox', role: 'switch', checked, disabled, 'aria-label': label, onChange: e => onChange(e.target.checked) }), h('span', null, label))
      const num = (id, value, onChange, attrs) => h('input', { id, className: 'n2s-input', type: 'number', style: { maxWidth: 160 }, value, onChange: e => onChange(e.target.value), ...attrs })
      const picker = (id, value, onChange) => h('div', { style: { maxWidth: 360 } }, h(ChannelPicker, { t, id, value: value ?? '', noneLabel: t('fq.set.noPush'), onChange }))
      return h('div', { className: 'n2s-card n2s-fq-settings' },
        h('div', { className: 'n2s-fq-setgroup' }, t('fq.set.gFresh')),
        h(SettingRow, { label: t('fq.set.fEnabledShort'), hint: t('fq.set.fEnabledHint') }, sw(fOn, v => setF('enabled', v), fOn ? t('fq.set.on') : t('fq.set.off'))),
        fOn && h(SettingRow, { label: t('fq.set.showShort'), hint: t('fq.set.showHint') }, sw(form.freshness.showInUi !== false, v => setF('showInUi', v), form.freshness.showInUi !== false ? t('fq.set.shown') : t('fq.set.hidden'))),
        fOn && h(SettingRow, { label: t('fq.set.interval'), htmlFor: 'n2s-fq-int' }, num('n2s-fq-int', form.freshness.intervalMin, v => setF('intervalMin', v), { min: 5, max: 1440 })),
        fOn && h(SettingRow, { label: t('fq.set.staleHours'), htmlFor: 'n2s-fq-stale', hint: t('fq.set.staleHint') }, num('n2s-fq-stale', form.freshness.staleHours, v => setF('staleHours', v), { min: 0.25, step: 0.25 })),
        fOn && h(SettingRow, { label: t('fq.set.fChannel'), htmlFor: 'n2s-fq-fch', hint: t('fq.set.fChannelHint') }, picker('n2s-fq-fch', form.freshness.channelId, v => setF('channelId', v))),
        h('div', { className: 'n2s-fq-setgroup' }, t('fq.set.gQuality')),
        h(SettingRow, { label: t('fq.set.qEnabled'), hint: t('fq.set.qEnabledHint') }, sw(qOn, v => setQ('enabled', v), qOn ? t('fq.set.on') : t('fq.set.off'))),
        qOn && h(SettingRow, { label: t('fq.set.time'), htmlFor: 'n2s-fq-time' }, h('input', { id: 'n2s-fq-time', className: 'n2s-input', type: 'time', style: { maxWidth: 160 }, value: form.quality.time, onChange: e => setQ('time', e.target.value) })),
        qOn && h(SettingRow, { label: t('fq.set.qChannel'), htmlFor: 'n2s-fq-qch' }, picker('n2s-fq-qch', form.quality.channelId, v => setQ('channelId', v))),
        qOn && form.quality.channelId && h(SettingRow, { label: t('fq.set.drop'), htmlFor: 'n2s-fq-drop' }, num('n2s-fq-drop', form.quality.dropPoints, v => setQ('dropPoints', v), { min: 1, max: 100 })),
        h('div', { className: 'n2s-row', style: { marginTop: 14, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: save }, busy ? h('span', { className: 'n2s-spin' }) : null, t('ds.save'))))
    }

    function HealthFreshnessTable({ t, dsId }) {
      const rev = useFqRev()
      const fr = useAsync(() => (dsId ? call('freshnessFor', { datasourceId: dsId }) : null), [dsId, rev])
      const settings = useAsync(() => call('healthSettings'), [dsId, rev])
      const events = useAsync(() => (dsId ? call('freshnessEvents', { datasourceId: dsId, limit: 10 }) : []), [dsId, rev])
      const [busy, setBusy] = useState(false)
      const refresh = async () => {
        setBusy(true)
        try { await fqCache.refresh(dsId) } catch (e) { notifyError(e) }
        setBusy(false)
      }
      const setOverride = async (table, value) => {
        const cur = structuredClone(settings.value?.freshness?.overrides ?? {})
        cur[dsId] ??= {}
        if (value === '' || value === null) delete cur[dsId][table]
        else cur[dsId][table] = Number(value)
        try { await call('saveHealthSettings', { freshness: { overrides: cur } }); await fqCache.refresh(dsId) } catch (e) { notifyError(e) }
      }
      const v = fr.value
      const overrides = settings.value?.freshness?.overrides?.[dsId] ?? {}
      return h('div', null,
        h('div', { className: 'n2s-row', style: { marginBottom: 8 } },
          h('div', { className: 'n2s-setsub', style: { margin: 0 } }, t('fq.title')),
          v && h('span', { className: 'n2s-faint n2s-small' }, fmt(t, 'fq.checkedAt', { time: fqTime(v.checkedAt) })),
          h('span', { className: 'n2s-grow' }),
          h('button', { type: 'button', className: 'n2s-btn small', disabled: busy || !dsId, onClick: refresh }, busy ? h('span', { className: 'n2s-spin' }) : Icon.refresh(13), t('fq.refresh'))),
        fr.error && h('div', { className: 'n2s-notice err' }, fr.error.message),
        v && !v.analyzed && h('div', { className: 'n2s-notice' }, t('fq.notAnalyzed')),
        v && v.analyzed && !v.tables.length && h('div', { className: 'n2s-notice' }, t('fq.noTables')),
        v && v.tables.length > 0 && h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table' },
          h('thead', null, h('tr', null, [t('fq.col.table'), t('fq.col.column'), t('fq.col.latest'), t('fq.col.lag'), t('fq.col.threshold')].map((x, i) => h('th', { key: i, className: i === 3 ? 'num' : undefined }, x)))),
          h('tbody', null, v.tables.map(x => h('tr', { key: x.table },
            h('td', null, h('span', { className: 'n2s-row', style: { flexWrap: 'nowrap' } }, h(FqDot, { status: x.status }), h('span', { className: 'n2s-mono' }, x.table))),
            h('td', { className: 'n2s-mono n2s-muted' }, x.column),
            h('td', { title: x.error ?? '' }, x.error ? h('span', { className: 'n2s-badge err' }, t('fq.st.error')) : x.latestAt === null ? t('fq.st.empty') : fqWhen(t, x.latestAt)),
            h('td', { className: 'num' }, fqLag(t, x.lagMinutes)),
            h('td', null, h('input', { className: 'n2s-input', type: 'number', min: 0, step: 0.5, style: { width: 90, height: 28 }, 'aria-label': fmt(t, 'fq.thresholdFor', { table: x.table }), placeholder: String(settings.value?.freshness?.staleHours ?? 24), defaultValue: overrides[x.table] ?? '', onBlur: e => { const val = e.target.value; if (String(overrides[x.table] ?? '') !== val) setOverride(x.table, val) } }))))))),
        (events.value ?? []).length > 0 && h('div', { style: { marginTop: 10 } },
          h('div', { className: 'n2s-faint n2s-small', style: { marginBottom: 4 } }, t('fq.events')),
          events.value.map(e => h('div', { key: e.id, className: 'n2s-small n2s-muted' }, `${fqTime(e.at)} · ${e.kind === 'stale' ? '⚠️' : '✅'} ${e.table} ${e.kind === 'stale' ? fmt(t, 'fq.evStale', { lag: fqLag(t, e.lagMinutes) }) : t('fq.evRecovered')}${e.pushed ? ` · ${t('fq.pushed')}` : ''}`))))
    }

    function HealthQuality({ t, dsId }) {
      const res = useAsync(() => (dsId ? call('qualityResults', { datasourceId: dsId }) : null), [dsId])
      const [busy, setBusy] = useState(false)
      const [open, setOpen] = useState({})
      const run = async () => {
        setBusy(true)
        try { const r = await call('qualityScan', { datasourceId: dsId }); notify(fmt(t, 'fq.q.done', { score: r.score ?? '—' }), 'ok'); res.reload() } catch (e) { notifyError(e) }
        setBusy(false)
      }
      const latest = res.value?.latest
      const lang = uiLang === 'zh' ? 'zh' : 'en'
      return h('div', null,
        h('div', { className: 'n2s-row', style: { margin: '22px 0 8px' } },
          h('div', { className: 'n2s-setsub', style: { margin: 0 } }, t('fq.q.title')),
          latest && h('span', { className: 'n2s-faint n2s-small' }, fmt(t, 'fq.q.lastRun', { time: fqTime(latest.at) })),
          h('span', { className: 'n2s-grow' }),
          h('button', { type: 'button', className: 'n2s-btn small primary', disabled: busy || !dsId, onClick: run }, busy ? h('span', { className: 'n2s-spin' }) : Icon.spark(13), busy ? t('fq.q.running') : t('fq.q.run'))),
        res.error && h('div', { className: 'n2s-notice err' }, res.error.message),
        !res.loading && !latest && h('div', { className: 'n2s-notice' }, t('fq.q.empty')),
        latest && h('div', { className: 'n2s-fq-summary' },
          h(FqScore, { score: latest.score }),
          h('div', { className: 'n2s-grow' },
            h('div', null, latest.summary?.[lang] ?? ''),
            res.value.history.length > 1 && h('div', { className: 'n2s-faint n2s-small' }, colon(t('fq.q.history')), res.value.history.slice(0, 10).reverse().map(x => x.score ?? '—').join(' → ')))),
        latest && h('div', { className: 'n2s-table-wrap', style: { marginTop: 8 } }, h('table', { className: 'n2s-table' },
          h('thead', null, h('tr', null, [t('fq.col.table'), t('fq.q.score'), t('fq.q.rows'), t('fq.q.issues')].map((x, i) => h('th', { key: i, className: i === 1 || i === 2 ? 'num' : undefined }, x)))),
          h('tbody', null, latest.tables.map(r => {
            const issues = (r.issues ?? []).filter(i => i.deduct > 0 || r.score === null)
            const shown = open[r.table] ? issues : issues.slice(0, 2)
            return h('tr', { key: r.table },
              h('td', { className: 'n2s-mono' }, r.table),
              h('td', { className: 'num' }, h(FqScore, { score: r.score })),
              h('td', { className: 'num' }, r.rowCount ?? '—'),
              h('td', null,
                issues.length ? shown.map((i, k) => h('div', { key: k, className: 'n2s-small' }, i[lang])) : h('span', { className: 'n2s-faint n2s-small' }, t('fq.q.noIssues')),
                issues.length > 2 && h('button', { type: 'button', className: 'n2s-link n2s-small', onClick: () => setOpen(o => ({ ...o, [r.table]: !o[r.table] })) }, open[r.table] ? t('fq.less') : fmt(t, 'fq.more', { n: issues.length - 2 }))))
          })))))
    }

    function HealthSection({ t, ds, datasources }) {
      const [dsId, setDsId] = useState(ds?.id ?? datasources?.[0]?.id ?? '')
      useEffect(() => { if (!dsId && (ds?.id || datasources?.[0]?.id)) setDsId(ds?.id ?? datasources[0].id) }, [ds?.id, datasources?.length])
      const status = useAsync(() => call('healthStatus'), [])
      return h('div', null,
        h(SectionHead, { title: t('fq.admin.title'), desc: t('fq.admin.desc') },
          (datasources ?? []).length > 1 && h('select', { className: 'n2s-select inline', 'aria-label': t('ds.select'), value: dsId, onChange: e => setDsId(e.target.value) }, datasources.map(d => h('option', { key: d.id, value: d.id }, d.name)))),
        status.value && h('div', { className: 'n2s-faint n2s-small', style: { marginBottom: 10 } },
          status.value.freshness.enabled ? fmt(t, 'fq.admin.nextF', { time: fqTime(status.value.freshness.nextAt) }) : t('fq.admin.fOff'),
          ' · ',
          status.value.quality.enabled ? fmt(t, 'fq.admin.nextQ', { time: status.value.quality.time }) : t('fq.admin.qOff')),
        !dsId ? h('div', { className: 'n2s-empty' }, h('h3', null, t('fq.admin.noDs'))) : h(React.Fragment, null,
          // When freshness is turned off, its table and events are not shown (and not queried).
          status.value && !status.value.freshness.enabled
            ? h('div', { className: 'n2s-notice', style: { marginBottom: 6 } }, t('fq.admin.fOffNote'))
            : h(HealthFreshnessTable, { key: `f-${dsId}`, t, dsId }),
          h(HealthQuality, { key: `q-${dsId}`, t, dsId })),
        h('div', { className: 'n2s-setsub' }, t('fq.set.title')),
        h(HealthSettings, { t, onSaved: () => status.reload() }))
    }
    extend.adminSections.push({ id: 'health', label: (t) => t('fq.admin.nav'), icon: () => svg(15, [h('path', { key: 1, d: 'M1.5 8.5h3l1.5-4 3 7 1.5-3h4' })]), Component: HealthSection })
    // ------------------------------------------------------------ reconciliation (对账)
    // Admin section 'reconcile': saved jobs (two queries, key mapping, compare columns,
    // schedule, channel), dry run with summary + difference tables (ResultView), run history.
    // Also the conversation view of the nl2sql_reconcile agent tool.

    const rcPct = (r) => (r === null || r === undefined ? '—' : `${(r * 100).toFixed(r === 1 || r === 0 ? 0 : 2)}%`)
    const rcTime = (at) => new Date(at).toLocaleString(uiLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

    function rcBlank(ds) {
      return {
        name: '', left: { datasourceId: ds?.id ?? '', sql: '' }, right: { datasourceId: ds?.id ?? '', sql: '' },
        keys: [{ left: '', right: '' }], compare: [], options: { trim: true, ignoreCase: false },
        schedule: { time: '09:00', enabled: false }, channelId: '', notifyOn: 'diff',
      }
    }

    /** Definition as sent to the server: empty rows dropped, numbers parsed. */
    function rcPayload(form) {
      return {
        ...(form.id ? { id: form.id } : {}),
        name: form.name, left: form.left, right: form.right,
        keys: form.keys.filter(k => k.left.trim()).map(k => ({ left: k.left.trim(), right: (k.right || k.left).trim() })),
        compare: form.compare.filter(c => c.left.trim()).map(c => ({ left: c.left.trim(), right: (c.right || c.left).trim(), tolerance: c.tolerance === '' || c.tolerance === undefined ? 0 : Number(c.tolerance), relative: Boolean(c.relative) })),
        options: form.options, schedule: form.schedule, channelId: form.channelId || null, notifyOn: form.notifyOn,
      }
    }

    /** Summary numbers + warnings + the four detail tables (ResultView each). */
    function ReconcileOutcome({ t, out }) {
      const parts = ['summary', 'mismatches', 'onlyLeft', 'onlyRight']
      const results = out.results ?? []
      const firstDiff = results.findIndex((r, i) => i > 0 && r.rowCount > 0)
      const [tab, setTab] = useState(firstDiff > 0 ? firstDiff : 0)
      const s = out.summary
      if (!s) return null
      const lname = out.left?.label ?? out.left?.datasourceName
      const rname = out.right?.label ?? out.right?.datasourceName
      const stat = (label, value, bad) => h('div', { className: `n2s-rc-stat${bad ? ' bad' : ''}` }, h('div', { className: 'n2s-rc-stat-v' }, value), h('div', { className: 'n2s-rc-stat-l' }, label))
      const label = (i) => (i === 0 ? t('rc.tab.summary') : i === 1 ? t('rc.tab.mismatches') : i === 2 ? fmt(t, 'rc.tab.only', { side: lname }) : fmt(t, 'rc.tab.only', { side: rname }))
      const cur = results[tab]
      return h('div', { className: 'n2s-rc-out' },
        h('div', { className: `n2s-notice ${s.hasDiff ? 'warn' : 'ok'}`, role: 'status' }, s.hasDiff ? fmt(t, 'rc.hasDiff', { rate: rcPct(s.matchRate) }) : fmt(t, 'rc.noDiff', { rate: rcPct(s.matchRate) })),
        h('div', { className: 'n2s-rc-stats' },
          stat(t('rc.matchRate'), rcPct(s.matchRate), s.matchRate < 1),
          stat(fmt(t, 'rc.rowsOf', { side: lname }), `${formatNumber(s.leftRows)}${s.truncated?.left ? '+' : ''}`),
          stat(fmt(t, 'rc.rowsOf', { side: rname }), `${formatNumber(s.rightRows)}${s.truncated?.right ? '+' : ''}`),
          stat(t('rc.matched'), formatNumber(s.matched)),
          stat(fmt(t, 'rc.onlyIn', { side: lname }), formatNumber(s.onlyLeft), s.onlyLeft > 0),
          stat(fmt(t, 'rc.onlyIn', { side: rname }), formatNumber(s.onlyRight), s.onlyRight > 0),
          s.columns?.length > 0 && stat(t('rc.mismatched'), formatNumber(s.mismatchedRows), s.mismatchedRows > 0)),
        s.columns?.length > 0 && h('div', { className: 'n2s-table-wrap', style: { marginTop: 8 } }, h('table', { className: 'n2s-table' },
          h('thead', null, h('tr', null, [t('rc.col'), t('rc.mismatchRows'), fmt(t, 'rc.totalOf', { side: lname }), fmt(t, 'rc.totalOf', { side: rname }), t('rc.diff')].map((x, i) => h('th', { key: i }, x)))),
          h('tbody', null, s.columns.map((c, i) => h('tr', { key: i },
            h('td', null, c.label, c.tolerance ? h('span', { className: 'n2s-faint n2s-small' }, ` ±${c.relative ? `${+(c.tolerance * 100).toFixed(4)}%` : c.tolerance}`) : null),
            h('td', { className: c.mismatches ? 'n2s-rc-bad' : undefined }, formatNumber(c.mismatches)),
            h('td', null, c.leftTotal === undefined ? '—' : formatNumber(c.leftTotal)),
            h('td', null, c.rightTotal === undefined ? '—' : formatNumber(c.rightTotal)),
            h('td', { className: c.diff ? 'n2s-rc-bad' : undefined }, c.diff === undefined ? '—' : formatNumber(c.diff))))))),
        (out.warnings ?? []).map((w, i) => h('div', { key: `w${i}`, className: 'n2s-notice warn', style: { marginTop: 8 } }, w)),
        results.length > 0 && h('div', { className: 'n2s-seg', role: 'tablist', style: { marginTop: 12 } }, results.map((r, i) => h('button', { key: parts[i] ?? i, type: 'button', role: 'tab', 'aria-pressed': tab === i, 'aria-selected': tab === i, onClick: () => setTab(i) }, label(i), i > 0 ? ` (${formatNumber(r.rowCount)}${r.truncated ? '+' : ''})` : ''))),
        cur && h('div', { style: { marginTop: 8 } }, cur.rows ? h(ResultView, { key: cur.resultId, t, result: cur, compact: true, onPinned: { hidden: true } }) : h('div', { className: 'n2s-faint' }, t('result.expired'))))
    }

    function RcSidePane({ t, title, side, datasources, onChange }) {
      return h('div', { className: 'n2s-rc-pane' },
        h('div', { className: 'n2s-rc-pane-title' }, title),
        h('label', { className: 'n2s-field' }, h('span', null, t('ds.select')),
          h('select', { className: 'n2s-select', value: side.datasourceId, onChange: e => onChange({ ...side, datasourceId: e.target.value }) },
            h('option', { value: '' }, '—'), datasources.map(d => h('option', { key: d.id, value: d.id }, d.name)))),
        h('label', { className: 'n2s-field' }, h('span', null, 'SQL'),
          h('textarea', { className: 'n2s-textarea n2s-mono', spellCheck: false, rows: 6, value: side.sql, onChange: e => onChange({ ...side, sql: e.target.value }), placeholder: 'SELECT order_no, amount FROM orders WHERE DATE(created_at) = CURDATE() - INTERVAL 1 DAY' })))
    }

    function ReconcileEditor({ t, initial, datasources, ds, onDone, onCancel }) {
      const [form, setForm] = useState(() => {
        const b = rcBlank(ds)
        if (!initial) return b
        return { ...b, ...initial, channelId: initial.channelId ?? '', keys: initial.keys?.length ? initial.keys : b.keys, compare: (initial.compare ?? []).map(c => ({ ...c, tolerance: c.tolerance ?? 0 })), options: { ...b.options, ...(initial.options ?? {}) }, schedule: { ...b.schedule, ...(initial.schedule ?? {}) } }
      })
      const [error, setError] = useState(null)
      const [dry, setDry] = useState(null)
      const [busy, runBusy] = useBusy()
      const patch = (p) => setForm(f => ({ ...f, ...p }))
      const setList = (key, i, p) => setForm(f => ({ ...f, [key]: f[key].map((x, j) => (j === i ? { ...x, ...p } : x)) }))
      const addRow = (key, row) => setForm(f => ({ ...f, [key]: [...f[key], row] }))
      const delRow = (key, i) => setForm(f => ({ ...f, [key]: f[key].filter((_, j) => j !== i) }))
      const save = () => runBusy(async () => {
        setError(null)
        try { await call('saveReconcile', rcPayload(form)); notify(t('rc.saved'), 'ok'); onDone() } catch (e) { setError(e.message) }
      })
      const dryRun = async () => {
        if (dry?.busy) return
        setDry({ busy: true })
        try { setDry({ out: await call('runReconcile', { definition: { ...rcPayload(form), name: form.name || t('rc.dryRun') } }) }) } catch (e) { setDry({ error: e.message }) }
      }
      const colInput = (value, onChange, ph, label) => h('input', { className: 'n2s-input', value, placeholder: ph, 'aria-label': label, onChange: e => onChange(e.target.value) })
      return h('div', { className: 'n2s-card n2s-rc-editor', style: { marginBottom: 12 } },
        h('label', { className: 'n2s-field' }, h('span', null, t('rc.name')), h('input', { className: 'n2s-input', value: form.name, onChange: e => patch({ name: e.target.value }), placeholder: t('rc.namePh') })),
        h('div', { className: 'n2s-rc-panes' },
          h(RcSidePane, { t, title: t('rc.left'), side: form.left, datasources, onChange: (left) => patch({ left }) }),
          h(RcSidePane, { t, title: t('rc.right'), side: form.right, datasources, onChange: (right) => patch({ right }) })),
        h('div', { className: 'n2s-field full' }, h('span', null, t('rc.keys')), h('span', { className: 'n2s-faint n2s-small' }, t('rc.keysHint')),
          form.keys.map((k, i) => h('div', { key: i, className: 'n2s-rc-maprow' },
            colInput(k.left, v => setList('keys', i, { left: v }), t('rc.leftCol'), `${t('rc.keys')} ${i + 1} ${t('rc.left')}`),
            h('span', { className: 'n2s-muted', 'aria-hidden': true }, '⇄'),
            colInput(k.right, v => setList('keys', i, { right: v }), k.left || t('rc.rightCol'), `${t('rc.keys')} ${i + 1} ${t('rc.right')}`),
            h('button', { type: 'button', className: 'n2s-iconbtn', disabled: form.keys.length <= 1, title: t('ds.delete'), 'aria-label': t('ds.delete'), onClick: () => delRow('keys', i) }, Icon.trash(14)))),
          h('div', null, h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => addRow('keys', { left: '', right: '' }) }, '+ ', t('rc.addKey')))),
        h('div', { className: 'n2s-field full' }, h('span', null, t('rc.compare')), h('span', { className: 'n2s-faint n2s-small' }, t('rc.compareHint')),
          form.compare.map((c, i) => h('div', { key: i, className: 'n2s-rc-maprow' },
            colInput(c.left, v => setList('compare', i, { left: v }), t('rc.leftCol'), `${t('rc.compare')} ${i + 1} ${t('rc.left')}`),
            h('span', { className: 'n2s-muted', 'aria-hidden': true }, '⇄'),
            colInput(c.right, v => setList('compare', i, { right: v }), c.left || t('rc.rightCol'), `${t('rc.compare')} ${i + 1} ${t('rc.right')}`),
            h('input', { className: 'n2s-input n2s-rc-tol', type: 'number', min: 0, step: 'any', value: c.tolerance, 'aria-label': t('rc.tolerance'), title: t('rc.tolerance'), placeholder: t('rc.tolerance'), onChange: e => setList('compare', i, { tolerance: e.target.value }) }),
            h('select', { className: 'n2s-select inline', value: c.relative ? 'rel' : 'abs', 'aria-label': t('rc.tolMode'), onChange: e => setList('compare', i, { relative: e.target.value === 'rel' }) },
              h('option', { value: 'abs' }, t('rc.tolAbs')), h('option', { value: 'rel' }, t('rc.tolRel'))),
            h('button', { type: 'button', className: 'n2s-iconbtn', title: t('ds.delete'), 'aria-label': t('ds.delete'), onClick: () => delRow('compare', i) }, Icon.trash(14)))),
          h('div', null, h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => addRow('compare', { left: '', right: '', tolerance: 0, relative: false }) }, '+ ', t('rc.addCompare')))),
        h('div', { className: 'n2s-row', style: { gap: 16, marginTop: 4 } },
          h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: form.options.trim, onChange: e => patch({ options: { ...form.options, trim: e.target.checked } }) }), t('rc.trim')),
          h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: form.options.ignoreCase, onChange: e => patch({ options: { ...form.options, ignoreCase: e.target.checked } }) }), t('rc.ignoreCase'))),
        h('div', { className: 'n2s-form', style: { marginTop: 10 } },
          h('label', { className: 'n2s-check', style: { alignSelf: 'end' } }, h('input', { type: 'checkbox', checked: form.schedule.enabled, onChange: e => patch({ schedule: { ...form.schedule, enabled: e.target.checked } }) }), t('rc.daily')),
          h('label', { className: 'n2s-field' }, h('span', null, t('rep.time')), h('input', { className: 'n2s-input', type: 'time', value: form.schedule.time, disabled: !form.schedule.enabled, onChange: e => patch({ schedule: { ...form.schedule, time: e.target.value } }) })),
          h('div', { className: 'n2s-field' }, h('label', { htmlFor: 'n2s-rc-channel', className: 'n2s-flabel' }, t('rep.push')), h(ChannelPicker, { t, id: 'n2s-rc-channel', value: form.channelId ?? '', noneLabel: t('rc.noPush'), onChange: (v) => patch({ channelId: v }) })),
          h('label', { className: 'n2s-field' }, h('span', null, t('rc.notifyOn')), h('select', { className: 'n2s-select', value: form.notifyOn, disabled: !form.channelId, onChange: e => patch({ notifyOn: e.target.value }) },
            h('option', { value: 'diff' }, t('rc.notify.diff')), h('option', { value: 'always' }, t('rc.notify.always'))))),
        error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn', disabled: dry?.busy, onClick: dryRun }, dry?.busy ? h('span', { className: 'n2s-spin' }) : null, t('rc.dryRun')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: save }, busy ? h('span', { className: 'n2s-spin' }) : null, t('ds.save'))),
        dry?.error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, dry.error),
        dry?.out && h('div', { className: 'n2s-rc-dry' }, h('div', { className: 'n2s-rc-pane-title' }, t('rc.dryResult')), h(ReconcileOutcome, { t, out: dry.out })))
    }

    function RcStatus({ t, run }) {
      if (!run) return h('span', { className: 'n2s-statusdot' }, t('rc.never'))
      if (run.status === 'error') return h('span', { className: 'n2s-statusdot err', title: run.error }, t('rc.status.error'))
      return h('span', { className: `n2s-statusdot ${run.status === 'diff' ? 'warn' : 'ok'}` }, run.status === 'diff' ? t('rc.status.diff') : t('rc.status.ok'))
    }

    function rcDiffText(t, run) {
      if (!run || run.status === 'error') return ''
      const s = run.summary ?? run
      return joinList([
        `${t('rc.matchRate')} ${rcPct(s.matchRate)}`,
        s.onlyLeft ? fmt(t, 'rc.short.onlyLeft', { n: s.onlyLeft }) : null,
        s.onlyRight ? fmt(t, 'rc.short.onlyRight', { n: s.onlyRight }) : null,
        s.mismatchedRows ? fmt(t, 'rc.short.mismatch', { n: s.mismatchedRows }) : null,
        s.complete === false ? t('rc.incomplete') : null,
      ], ' · ')
    }

    function ReconcileSection({ t, ds, datasources }) {
      const list = useAsync(() => call('listReconciles'), [])
      const [editing, setEditing] = useState(null)
      const [historyOf, setHistoryOf] = useState(null)
      const [shown, setShown] = useState(null)
      const runs = useAsync(() => call('reconcileRuns', { id: historyOf ?? undefined, limit: 50 }), [historyOf, list.value])
      const [running, setRunning] = useState(null)
      const jobs = list.value ?? []
      const runNow = async (job) => {
        if (running) return
        setRunning(job.id)
        try {
          const out = await call('runReconcile', { id: job.id })
          if (out.ok === false) notify(out.error, 'err')
          else { notify(`${out.status === 'diff' ? '⚠️ ' : '✓ '}${rcDiffText(t, out)}${out.pushed ? ` · ${t('rc.pushed')}` : ''}`, out.status === 'diff' ? 'info' : 'ok'); setShown(out) }
        } catch (e) { notifyError(e) } finally { setRunning(null); list.reload() }
      }
      const showRun = async (r) => {
        if (!r.resultIds?.length) return setShown({ ...r, results: [] })
        const results = await Promise.all(r.resultIds.map(id => call('getResult', { resultId: id }).catch(() => null)))
        setShown({ ...r, results: results.map((x, i) => x ?? { resultId: r.resultIds[i], title: '', rowCount: 0 }) })
      }
      return h('div', { className: 'n2s-rc' },
        h(SectionHead, { title: t('rc.title'), desc: t('rc.hint') }, h('button', { type: 'button', className: 'n2s-btn primary', disabled: !datasources?.length, onClick: () => { setShown(null); setEditing({}) } }, '+ ', t('rc.add'))),
        editing && h(ReconcileEditor, { key: editing.id ?? 'new', t, ds, datasources: datasources ?? [], initial: editing.id ? editing : null, onCancel: () => setEditing(null), onDone: () => { setEditing(null); list.reload() } }),
        list.error && h('div', { className: 'n2s-notice err' }, list.error.message),
        !list.loading && !list.error && jobs.length === 0 && !editing && h('div', { className: 'n2s-empty' }, h('h3', null, t('rc.empty')), h('div', null, t('rc.emptyHint')), h('button', { type: 'button', className: 'n2s-btn primary', disabled: !datasources?.length, onClick: () => setEditing({}) }, t('rc.add'))),
        jobs.length > 0 && h('div', { className: 'n2s-list2' }, jobs.map(j => h('div', { key: j.id, className: 'n2s-list2-row' },
          h('span', { className: 'n2s-tile', 'aria-hidden': true }, '⇄'),
          h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
            h('div', { className: 'n2s-row', style: { gap: 6 } }, h('span', { className: 'n2s-list2-title' }, j.name),
              j.schedule?.enabled ? h('span', { className: 'n2s-badge' }, fmt(t, 'rc.dailyAt', { time: j.schedule.time })) : h('span', { className: 'n2s-badge' }, t('rc.manual')),
              j.channelName && h('span', { className: 'n2s-badge' }, Icon.send(11), j.channelName)),
            h('div', { className: 'n2s-list2-sub' }, `${j.leftName} ⇄ ${j.rightName} · ${colon(t('rc.keys'))}${joinList(j.keys.map(k => (k.left === k.right ? k.left : `${k.left}/${k.right}`)))}`),
            j.lastRun && h('div', { className: 'n2s-list2-sub' }, `${rcTime(j.lastRun.at)} · `, j.lastRun.status === 'error' ? h('span', { style: { color: 'var(--n2s-err)' } }, j.lastRun.error) : rcDiffText(t, j.lastRun))),
          h('div', { className: 'n2s-list2-side' }, h(RcStatus, { t, run: j.lastRun })),
          h('div', { className: 'n2s-row', style: { gap: 2, flexWrap: 'nowrap' } },
            h('button', { type: 'button', className: 'n2s-btn small', disabled: Boolean(running), onClick: () => runNow(j) }, running === j.id ? h('span', { className: 'n2s-spin' }) : null, t('rc.runNow')),
            h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
              { label: t('ds.edit'), icon: Icon.edit(14), onClick: () => { setShown(null); setEditing(j) } },
              { label: t('rc.history'), icon: Icon.table(14), onClick: () => setHistoryOf(j.id) },
              { label: j.schedule?.enabled ? t('rep.pause') : t('rep.resume'), icon: Icon.refresh(14), onClick: async () => { try { await call('saveReconcile', { id: j.id, schedule: { ...j.schedule, enabled: !j.schedule?.enabled } }) } catch (e) { notifyError(e) } list.reload() } },
              { divider: true },
              { label: t('ds.delete'), icon: Icon.trash(14), danger: true, onClick: async () => { if (await confirmDialog({ title: fmt(t, 'rc.deleteConfirm', { name: j.name }), danger: true })) { try { await call('deleteReconcile', { id: j.id }) } catch (e) { notifyError(e) } list.reload() } } },
            ] }))))),
        shown && h('div', { className: 'n2s-section' },
          h('div', { className: 'n2s-row' }, h('h2', { className: 'n2s-grow' }, fmt(t, 'rc.runOf', { name: shown.title ?? shown.name ?? '' }), shown.at ? h('span', { className: 'n2s-faint n2s-small' }, ` · ${rcTime(shown.at)}`) : null),
            h('button', { type: 'button', className: 'n2s-iconbtn', title: t('rc.close'), 'aria-label': t('rc.close'), onClick: () => setShown(null) }, Icon.close(14))),
          shown.error ? h('div', { className: 'n2s-notice err' }, shown.error) : h(ReconcileOutcome, { key: shown.runId ?? shown.id ?? shown.at, t, out: shown })),
        (runs.value ?? []).length > 0 && h('div', { className: 'n2s-section' },
          h('div', { className: 'n2s-row' }, h('h2', { className: 'n2s-grow' }, historyOf ? fmt(t, 'rc.historyOf', { name: jobs.find(j => j.id === historyOf)?.name ?? '' }) : t('rc.history')),
            historyOf && h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => setHistoryOf(null) }, t('rc.allRuns'))),
          h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table n2s-rc-runs' },
            h('thead', null, h('tr', null, [t('im.col.time'), t('rc.name'), t('im.col.status'), t('rc.detail'), t('rc.push')].map((x, i) => h('th', { key: i }, x)))),
            h('tbody', null, runs.value.map(r => h('tr', { key: r.id, className: 'n2s-rc-run', tabIndex: 0, onClick: () => showRun(r), onKeyDown: (e) => { if (e.key === 'Enter') showRun(r) } },
              h('td', { className: 'n2s-muted' }, rcTime(r.at)),
              h('td', null, r.name, r.source === 'schedule' ? h('span', { className: 'n2s-faint n2s-small' }, ` · ${t('rc.scheduled')}`) : null),
              h('td', null, h(RcStatus, { t, run: r })),
              h('td', { style: { whiteSpace: 'normal' } }, r.status === 'error' ? r.error : rcDiffText(t, r)),
              h('td', null, r.pushed ? h('span', { className: 'n2s-statusdot ok' }, t('im.sentOk')) : r.pushError ? h('span', { className: 'n2s-statusdot err', title: r.pushError }, t('im.lastFailed')) : h('span', { className: 'n2s-faint' }, '—')))))))))
    }

    extend.adminSections.push({ id: 'reconcile', label: (t) => t('rc.title'), icon: () => svg(15, [h('path', { key: 1, d: 'M2.5 5h10M10 2.5 12.5 5 10 7.5M13.5 11h-10M6 8.5 3.5 11 6 13.5' })]), Component: ReconcileSection })

    /** Conversation view of nl2sql_reconcile: summary + difference tables. */
    function makeReconcileToolView(ctx) {
      return function Nl2SqlReconcileView(props) {
        const t = useMemo(() => ctx.locale.bind(NS), [])
        setUiLang(useSyncExternalStore(ctx.locale.subscribe.bind(ctx.locale), () => ctx.locale.getSnapshot(), () => ctx.locale.getSnapshot()))
        const block = props.block
        const settled = props.phase === 'result'
        const meta = settled ? block.meta : undefined
        const args = parseArgs(settled ? block.call?.argsRaw : block?.argsRaw)
        const [results, setResults] = useState(null)
        useEffect(() => {
          if (!settled || block.isError || !meta?.results) return
          let alive = true
          Promise.all(meta.results.map(r => call('getResult', { resultId: r.resultId }).then(full => full ?? { ...r, rows: null }).catch(() => ({ ...r, rows: null }))))
            .then(list => alive && setResults(list))
          return () => { alive = false }
        }, [settled, meta])
        const title = args.title || t('rc.tool')
        if (!settled) return h('div', { className: 'n2s-toolcard' }, h('div', { className: 'n2s-row' }, h('span', { className: 'n2s-spin n2s-muted' }), h('span', { className: 'n2s-muted' }, t('rc.toolRunning')), h('span', null, title)))
        if (block.isError) return h('div', { className: 'n2s-toolcard' }, h('div', { className: 'n2s-row' }, h('span', { className: 'n2s-badge err' }, t('tool.failed')), h('span', null, title)), h('div', { className: 'n2s-notice err', style: { marginTop: 8 } }, block.content?.map(c => (c.type === 'text' ? c.text : '')).join('\n')))
        return h('div', { className: 'n2s-toolcard' },
          h('div', { className: 'n2s-row', style: { marginBottom: 8 } }, h('span', { style: { fontWeight: 500 } }, meta?.title ?? title), meta?.left && h('span', { className: 'n2s-badge' }, `${meta.left.datasourceName} ⇄ ${meta.right.datasourceName}`)),
          !meta?.summary ? null : !results ? h('span', { className: 'n2s-spin n2s-muted' }) : h(ReconcileOutcome, { t, out: { ...meta, results } }))
      }
    }
    if (extend.toolViews) extend.toolViews.push({ key: 'nl2sql_reconcile', make: makeReconcileToolView })
    // ------------------------------------------------------------ chat subscriptions (admin section)

    /** Subscriptions and alerts created from IM chats, grouped by chat, with pause / resume / delete. */
    function ChatSubscriptionsSection({ t }) {
      const list = useAsync(() => call('listChatSubscriptions'), [])
      const [notice, setNotice] = useState(null)
      const groups = list.value ?? []
      const when = (ms) => (ms ? new Date(ms).toLocaleString(uiLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—')
      const act = async (item, action) => {
        setNotice(null)
        if (action === 'delete' && !(await confirmDialog({ title: fmt(t, 'sub.deleteConfirm', { name: item.title }), danger: true }))) return
        try { await call('setChatSubscription', { id: item.id, action }); setNotice({ ok: true, text: t(`sub.done.${action}`) }) } catch (e) { setNotice({ ok: false, text: e.message }) }
        list.reload()
      }
      const statusDot = (s) => h('span', { className: `n2s-statusdot ${s === 'active' ? 'ok' : s === 'suspended' ? 'err' : ''}` }, t(`sub.status.${s}`))
      return h('div', { className: 'n2s-sub' },
        h(SectionHead, { title: t('sub.title'), desc: t('sub.desc') },
          h('button', { type: 'button', className: 'n2s-btn', onClick: () => list.reload() }, Icon.refresh(14), ' ', t('sub.refresh'))),
        notice && h('div', { className: `n2s-notice ${notice.ok ? 'ok' : 'err'}`, role: 'status', style: { marginBottom: 10 } }, notice.text),
        list.error && h('div', { className: 'n2s-notice err' }, list.error.message),
        !list.loading && !list.error && groups.length === 0 && h('div', { className: 'n2s-empty' }, h('h3', null, t('sub.empty')), h('div', null, t('sub.emptyHint'))),
        groups.map(g => h('div', { key: g.key, className: 'n2s-card n2s-sub-group' },
          h('div', { className: 'n2s-sub-head' },
            h('span', { className: 'n2s-sub-chat' }, g.chatName || g.chatId),
            h('span', { className: 'n2s-badge' }, Icon.send(11), ' ', g.channelName ?? g.channelId),
            h('span', { className: 'n2s-faint n2s-small' }, g.platform)),
          h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table' },
            h('thead', null, h('tr', null, [t('sub.col.item'), t('sub.col.creator'), t('sub.col.schedule'), t('sub.col.last'), t('sub.col.status'), ''].map((x, i) => h('th', { key: i }, x)))),
            h('tbody', null, g.items.map(it => h('tr', { key: it.id },
              h('td', null,
                h('span', { className: 'n2s-badge n2s-sub-kind' }, t(`sub.kind.${it.kind}`)), ' ', it.title,
                h('div', { className: 'n2s-faint n2s-small' }, joinList([it.datasourceName, it.conditionText, it.metric]))),
              h('td', null, it.createdBy?.name ?? '—'),
              h('td', null, it.schedule, it.nextAt ? h('div', { className: 'n2s-faint n2s-small' }, `${colon(t('sub.next'))}${when(it.nextAt)}`) : null),
              h('td', null, when(it.lastDeliveredAt)),
              h('td', null, statusDot(it.status), it.lastError && h('div', { className: 'n2s-small n2s-sub-err' }, it.lastError)),
              h('td', null, h('div', { className: 'n2s-row', style: { gap: 4, flexWrap: 'nowrap' } },
                it.status === 'active'
                  ? h('button', { type: 'button', className: 'n2s-btn small', onClick: () => act(it, 'pause') }, t('sub.pause'))
                  : h('button', { type: 'button', className: 'n2s-btn small', onClick: () => act(it, 'resume') }, t('sub.resume')),
                h('button', { type: 'button', className: 'n2s-btn small ghost', 'aria-label': t('sub.delete'), title: t('sub.delete'), onClick: () => act(it, 'delete') }, Icon.trash(13))))))))))))
    }

    extend.adminSections.push({ id: 'subscriptions', label: (t) => t('sub.nav'), icon: () => svg(15, [h('path', { key: 1, d: 'M4 6.5a4 4 0 0 1 8 0c0 3 1.5 4.5 1.5 4.5h-11S4 9.5 4 6.5M6.5 13.5a1.6 1.6 0 0 0 3 0' })]), Component: ChatSubscriptionsSection })
    // ------------------------------------------------------------ proactive (daily digest, goals, forecast)
    // Admin sections 'digests' (每日简报) and 'goals' (目标); goal chips in the dashboard bar;
    // "预测未来 N 天" in the result menu + forecast panel under the result; nl2sql_forecast tool view.

    // ---- forecast

    /** resultId → horizon requested from the result menu (shared by the menu item and the panel). */
    const proForecastStore = createStore({})

    function proForecastOption(f, el, t) {
      const label = cssVar(el, '--dsw-alias-label-secondary', '#888')
      const text = cssVar(el, '--dsw-alias-label-primary', '#222')
      const border = cssVar(el, '--dsw-alias-border-l1', 'rgba(128,128,128,.25)')
      const surface = cssVar(el, '--dsw-alias-bg-layer-1', '#fff')
      const color = '#3b82f6'
      const fcColor = '#f59e0b'
      const hist = f.history ?? []
      const fc = f.forecast ?? []
      const cats = [...hist.map(p => String(p.x)), ...fc.map(p => String(p.x))]
      const n = hist.length
      const pad = (k) => new Array(k).fill(null)
      const histData = hist.map(p => p.y)
      // The dashed forecast starts at the last observation so the two lines join.
      const fcData = [...pad(Math.max(0, n - 1)), n ? hist[n - 1].y : null, ...fc.map(p => p.value)]
      const lower = [...pad(n), ...fc.map(p => p.lower)]
      const width = [...pad(n), ...fc.map(p => p.upper - p.lower)]
      const axisCommon = { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: label, fontSize: 11 }, splitLine: { lineStyle: { color: border, type: [3, 3] } } }
      return {
        color: [color, fcColor],
        backgroundColor: 'transparent',
        textStyle: { color: text, fontFamily: 'inherit' },
        animationDuration: 300,
        grid: { left: 4, right: 8, top: 36, bottom: 4, containLabel: true },
        legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, itemGap: 16, textStyle: { color: label, fontSize: 12 }, data: [f.measure, t('pro.fc.forecast'), t('pro.fc.band')] },
        tooltip: {
          trigger: 'axis', confine: true, backgroundColor: surface, borderColor: border, borderWidth: 1, padding: [8, 10], textStyle: { color: text, fontSize: 12 },
          formatter: (ps) => {
            const i = ps[0]?.dataIndex ?? 0
            const rows = [escapeHtml(cats[i])]
            if (i < n) rows.push(`${escapeHtml(f.measure)}: ${formatNumber(hist[i].y)}`)
            else { const p = fc[i - n]; rows.push(`${escapeHtml(t('pro.fc.forecast'))}: ${formatNumber(p.value)}`, `95%: ${formatNumber(p.lower)} ~ ${formatNumber(p.upper)}`) }
            return rows.join('<br/>')
          },
        },
        xAxis: { type: 'category', data: cats, boundaryGap: false, ...axisCommon, axisLine: { show: true, lineStyle: { color: border } }, axisLabel: { color: label, fontSize: 11, hideOverlap: true }, splitLine: { show: false } },
        yAxis: { type: 'value', scale: true, ...axisCommon, axisLabel: { color: label, fontSize: 11, formatter: (v) => formatNumber(v) } },
        dataZoom: cats.length > 60 ? [{ type: 'inside', startValue: Math.max(0, cats.length - 60) }] : undefined,
        series: [
          { name: f.measure, type: 'line', data: histData, smooth: 0.3, showSymbol: false, symbol: 'circle', lineStyle: { width: 2, color }, itemStyle: { color }, areaStyle: { opacity: 0.06 } },
          { name: t('pro.fc.forecast'), type: 'line', data: fcData, smooth: 0.3, showSymbol: false, symbol: 'circle', lineStyle: { width: 2, type: 'dashed', color: fcColor }, itemStyle: { color: fcColor } },
          { name: 'lower', type: 'line', data: lower, stack: 'band', stackStrategy: 'all', symbol: 'none', lineStyle: { opacity: 0 }, silent: true, tooltip: { show: false } },
          { name: t('pro.fc.band'), type: 'line', data: width, stack: 'band', stackStrategy: 'all', symbol: 'none', lineStyle: { opacity: 0 }, itemStyle: { color: fcColor }, areaStyle: { color: fcColor, opacity: 0.16 }, silent: true },
        ],
      }
    }

    function ForecastChart({ t, forecast }) {
      const ref = useRef(null)
      const inst = useRef(null)
      const [error, setError] = useState(null)
      useEffect(() => {
        let disposed = false
        let observer
        loadEcharts().then((echarts) => {
          if (disposed || !ref.current) return
          inst.current = initChart(echarts, ref.current)
          observer = new ResizeObserver(() => inst.current?.resize())
          observer.observe(ref.current)
          try { inst.current.setOption(proForecastOption(forecast, ref.current, t), true) } catch (e) { setError(e.message) }
        }, (e) => setError(e.message))
        return () => { disposed = true; observer?.disconnect(); inst.current?.dispose(); inst.current = null }
      }, [forecast])
      return h('div', { style: { position: 'relative' } },
        error && h('div', { className: 'n2s-notice err' }, error),
        h('div', { ref, className: 'n2s-chart', role: 'img', 'aria-label': t('pro.fc.title') }))
    }

    /** Forecast summary + chart + table, shared by the result panel and the tool view. */
    function ForecastView({ t, f, onClose, onHorizon }) {
      const [showTable, setShowTable] = useState(false)
      const method = f.method === 'holt-winters' ? t('pro.fc.hw') : t('pro.fc.holt')
      return h('div', { className: 'n2s-pro-fc' },
        h('div', { className: 'n2s-row', style: { gap: 8, marginBottom: 6 } },
          h('span', { className: 'n2s-pro-fc-title' }, Icon.spark(13), fmt(t, 'pro.fc.heading', { n: f.horizon })),
          h('span', { className: 'n2s-badge' }, method),
          f.filled > 0 && h('span', { className: 'n2s-badge warn', title: t('pro.fc.filledHint') }, fmt(t, 'pro.fc.filled', { n: f.filled })),
          h('span', { className: 'n2s-grow' }),
          onHorizon && h(Dropdown, { label: t('pro.fc.horizon'), trigger: { className: 'n2s-btn small ghost', content: h(React.Fragment, null, fmt(t, 'pro.fc.nDays', { n: f.horizon }), Icon.chev(10)) }, items: [7, 14, 30].map(n => ({ label: fmt(t, 'pro.fc.nDays', { n }), checked: f.horizon === n, onClick: () => onHorizon(n) })) }),
          h('button', { type: 'button', className: 'n2s-btn small ghost', 'aria-expanded': showTable, onClick: () => setShowTable(v => !v) }, Icon.table(13), t('result.data')),
          onClose && h('button', { type: 'button', className: 'n2s-iconbtn', title: t('pro.close'), 'aria-label': t('pro.close'), onClick: onClose }, Icon.close())),
        h(ForecastChart, { t, forecast: f }),
        h('div', { className: 'n2s-faint n2s-small', style: { marginTop: 6 } }, t('pro.fc.note')),
        showTable && h('div', { className: 'n2s-table-wrap', style: { marginTop: 8 } }, h('table', { className: 'n2s-table' },
          h('thead', null, h('tr', null, [f.x, t('pro.fc.forecast'), t('pro.fc.lower'), t('pro.fc.upper')].map((c, i) => h('th', { key: i, className: i ? 'num' : undefined }, c)))),
          h('tbody', null, (f.forecast ?? []).map(p => h('tr', { key: p.x }, h('td', null, p.x), h('td', { className: 'num' }, formatNumber(p.value)), h('td', { className: 'num' }, formatNumber(p.lower)), h('td', { className: 'num' }, formatNumber(p.upper))))))))
    }

    /** Can this result be forecast? Time column + exactly one numeric measure, no series split. */
    function proForecastable(result) {
      if (!result?.columns || !result.rows || result.rows.length < 3 || result.chart?.series) return false
      const time = result.columns.some(c => c.kind === 'time')
      const nums = result.columns.filter(c => c.kind === 'number')
      const ys = result.chart?.y?.length ? result.chart.y : nums.map(c => c.name)
      return time && ys.filter(y => nums.some(c => c.name === y)).length === 1
    }

    function ForecastPanel({ t, result }) {
      const get = () => proForecastStore.get()[result?.resultId]
      const horizon = useSyncExternalStore(proForecastStore.subscribe, get, get)
      const fc = useAsync(() => (horizon ? call('forecast', { resultId: result.resultId, horizon }) : null), [result?.resultId, horizon])
      if (!horizon) return null
      const close = () => proForecastStore.set({ [result.resultId]: 0 })
      if (fc.error) return h('div', { className: 'n2s-notice err', role: 'alert', style: { marginTop: 8 } }, fc.error.message, ' ', h('button', { type: 'button', className: 'n2s-link', onClick: close }, t('pro.close')))
      if (!fc.value) return h('div', { className: 'n2s-pro-fc' }, h('span', { className: 'n2s-spin n2s-muted' }), ' ', h('span', { className: 'n2s-muted n2s-small' }, t('pro.fc.running')))
      return h(ForecastView, { t, f: fc.value, onClose: close, onHorizon: (n) => proForecastStore.set({ [result.resultId]: n }) })
    }

    extend.resultMenu.push(({ t, result }) => (proForecastable(result) ? [
      { divider: true },
      { label: fmt(t, 'pro.fc.menu', { n: 7 }), icon: Icon.spark(14), onClick: () => proForecastStore.set({ [result.resultId]: 7 }) },
    ] : []))
    extend.resultPanels.push(ForecastPanel)

    function makeForecastToolView(ctx) {
      return function Nl2SqlForecastView(props) {
        const t = useMemo(() => ctx.locale.bind(NS), [])
        setUiLang(useSyncExternalStore(ctx.locale.subscribe.bind(ctx.locale), () => ctx.locale.getSnapshot(), () => ctx.locale.getSnapshot()))
        const block = props.block
        const settled = props.phase === 'result'
        const f = settled ? block.meta?.forecast : undefined
        if (!settled) return h('div', { className: 'n2s-toolcard' }, h('div', { className: 'n2s-row' }, h('span', { className: 'n2s-spin n2s-muted' }), h('span', { className: 'n2s-muted' }, t('pro.fc.running'))))
        if (block.isError || !f) return h('div', { className: 'n2s-toolcard' }, h('div', { className: 'n2s-notice err' }, block.content?.map(c => (c.type === 'text' ? c.text : '')).join('\n') || t('tool.failed')))
        return h('div', { className: 'n2s-toolcard' }, f.title && h('div', { style: { fontWeight: 500, marginBottom: 6 } }, f.title), h(ForecastView, { t, f }))
      }
    }
    if (extend.toolViews) extend.toolViews.push({ key: 'nl2sql_forecast', make: makeForecastToolView })

    // ---- goals

    const proStatusClass = { 'on-track': 'ok', achieved: 'ok', 'at-risk': 'warn', missed: 'err', error: 'err' }
    const proPct = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${Math.round(v * 100)}%`)

    function GoalBar({ g }) {
      const w = Math.max(0, Math.min(100, (g.pct ?? 0) * 100))
      const pw = Math.max(0, Math.min(100, (g.projectedPct ?? 0) * 100))
      const tick = Math.max(0, Math.min(100, (g.elapsedPct ?? 0) * 100))
      return h('span', { className: `n2s-pro-bar ${proStatusClass[g.status] ?? ''}`, 'aria-hidden': true },
        h('span', { className: 'proj', style: { width: `${pw}%` } }),
        h('span', { className: 'cur', style: { width: `${w}%` } }),
        g.direction !== 'down' && h('span', { className: 'tick', style: { left: `${tick}%` } }))
    }

    /** Goal chips in the dashboard bar: goals tied to this dashboard or to its data sources. */
    function GoalChips({ t, boardId }) {
      const list = useAsync(() => (boardId ? call('goalProgress', { dashboardId: boardId }) : []), [boardId])
      const goals = list.value ?? []
      if (!goals.length) return null
      return h('div', { className: 'n2s-pro-chips', role: 'list', 'aria-label': t('pro.goals.title') }, goals.slice(0, 4).map(g => h('span', {
        key: g.id, role: 'listitem', className: 'n2s-pro-chip',
        title: g.error ?? `${g.name} · ${g.metric}\n${t('pro.goals.actual')} ${formatNumber(g.actual)} / ${formatNumber(g.target)} (${proPct(g.pct)})\n${t('pro.goals.projected')} ${formatNumber(g.projected)} (${proPct(g.projectedPct)})\n${t(`pro.st.${g.status}`)}`,
      },
      h('span', { className: 'n2s-ellipsis', style: { maxWidth: 90 } }, g.name),
      g.error ? h('span', { className: 'n2s-statusdot err' }, t('pro.st.error')) : h(React.Fragment, null, h(GoalBar, { g }), h('span', { className: `n2s-pro-pct ${proStatusClass[g.status] ?? ''}` }, proPct(g.pct))))))
    }
    extend.dashboardBar.push(GoalChips)

    function useMetrics(datasourceId) {
      const k = useAsync(() => (datasourceId ? call('getKnowledge', { datasourceId }) : null), [datasourceId])
      return k.value?.metrics ?? []
    }

    function GoalForm({ t, initial, ds, datasources, onDone, onCancel }) {
      const [form, setForm] = useState(() => ({ name: '', datasourceId: ds?.id ?? datasources[0]?.id ?? '', metric: '', period: 'month', target: '', direction: 'up', dashboardId: '', ...(initial ?? {}) }))
      const metrics = useMetrics(form.datasourceId)
      const boards = useAsync(() => call('listDashboards'), [])
      const [error, setError] = useState(null)
      const [busy, run] = useBusy()
      const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
      const save = () => run(async () => {
        setError(null)
        try { await call('saveGoal', { ...form, target: Number(form.target), dashboardId: form.dashboardId || null }); onDone() } catch (e) { setError(e.message) }
      })
      return h('div', { className: 'n2s-card', style: { marginBottom: 12 } },
        h('div', { className: 'n2s-form' },
          h('label', { className: 'n2s-field' }, h('span', null, t('pro.goals.name')), h('input', { className: 'n2s-input', value: form.name, onChange: set('name'), placeholder: t('pro.goals.namePh') })),
          h('label', { className: 'n2s-field' }, h('span', null, t('ds.select')), h('select', { className: 'n2s-select', value: form.datasourceId, onChange: set('datasourceId') }, datasources.map(d => h('option', { key: d.id, value: d.id }, d.name)))),
          h('label', { className: 'n2s-field' }, h('span', null, t('al.metric')), metrics.length ? h('select', { className: 'n2s-select', value: form.metric, onChange: set('metric') }, h('option', { value: '' }, '—'), metrics.map(m => h('option', { key: m.id, value: m.name }, m.name))) : h('div', { className: 'n2s-faint n2s-small' }, t('al.noMetrics'))),
          h('label', { className: 'n2s-field' }, h('span', null, t('pro.goals.period')), h('select', { className: 'n2s-select', value: form.period, onChange: set('period') }, ['month', 'quarter', 'year'].map(p => h('option', { key: p, value: p }, t(`pro.period.${p}`))))),
          h('label', { className: 'n2s-field' }, h('span', null, t('pro.goals.target')), h('input', { className: 'n2s-input', type: 'number', value: form.target, onChange: set('target') })),
          h('div', { className: 'n2s-field' }, h('span', null, t('pro.goals.direction')), h('div', { className: 'n2s-seg' }, ['up', 'down'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.direction === v, onClick: () => setForm(f => ({ ...f, direction: v })) }, t(`pro.dir.${v}`))))),
          h('label', { className: 'n2s-field' }, h('span', null, t('pro.goals.dashboard')), h('select', { className: 'n2s-select', value: form.dashboardId ?? '', onChange: set('dashboardId') }, h('option', { value: '' }, t('pro.goals.anyBoard')), (boards.value?.dashboards ?? []).map(b => h('option', { key: b.id, value: b.id }, b.name))))),
        error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: save }, busy ? h('span', { className: 'n2s-spin' }) : null, t('ds.save'))))
    }

    function GoalPushSettings({ t }) {
      const cfg = useAsync(() => call('getGoalPush'), [])
      const [busy, run] = useBusy()
      const v = cfg.value
      if (!v) return null
      const save = (patch) => run(async () => { try { await call('saveGoalPush', patch); cfg.reload() } catch (e) { notifyError(e) } })
      return h('div', { className: 'n2s-section' }, h('h2', null, t('pro.goals.weekly')),
        h('div', { className: 'n2s-row', style: { gap: 10, flexWrap: 'wrap' } },
          h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: Boolean(v.enabled), disabled: busy, onChange: e => save({ enabled: e.target.checked }) }), t('pro.goals.weeklyOn')),
          h('select', { className: 'n2s-select inline', 'aria-label': t('pro.weekday'), value: v.weekday, onChange: e => save({ weekday: Number(e.target.value) }) }, [1, 2, 3, 4, 5, 6, 0].map(d => h('option', { key: d, value: d }, t(`pro.wd.${d}`)))),
          h('input', { className: 'n2s-input', type: 'time', 'aria-label': t('rep.time'), style: { width: 110 }, value: v.time, onChange: e => save({ time: e.target.value }) }),
          h('div', { style: { minWidth: 200 } }, h(ChannelPicker, { t, value: v.channelId ?? '', noneLabel: t('al.noPush'), label: t('rep.push'), onChange: (id) => save({ channelId: id || null }) })),
          h('button', { type: 'button', className: 'n2s-btn small', disabled: !v.channelId || busy, onClick: () => run(async () => { try { await call('sendGoalReport'); notify(t('pro.sent'), 'ok') } catch (e) { notifyError(e) } }) }, Icon.send(13), t('pro.sendNow'))),
        h('div', { className: 'n2s-faint n2s-small', style: { marginTop: 6 } }, t('pro.goals.weeklyHint')))
    }

    function GoalsSection({ t, ds, datasources }) {
      const list = useAsync(() => call('goalProgress', {}), [])
      const [editing, setEditing] = useState(null)
      const goals = list.value ?? []
      return h('div', null,
        h(SectionHead, { title: t('pro.goals.title'), desc: t('pro.goals.desc') }, h('button', { type: 'button', className: 'n2s-btn primary', disabled: !datasources?.length, onClick: () => setEditing({}) }, '+ ', t('pro.goals.add'))),
        editing && h(GoalForm, { key: editing.id ?? 'new', t, ds, datasources: datasources ?? [], initial: editing.id ? editing : null, onCancel: () => setEditing(null), onDone: () => { setEditing(null); list.reload() } }),
        list.error && h('div', { className: 'n2s-notice err' }, list.error.message),
        list.loading && !list.value && h('span', { className: 'n2s-spin n2s-muted' }),
        !list.loading && goals.length === 0 && !editing && h('div', { className: 'n2s-empty' }, h('h3', null, t('pro.goals.empty')), h('div', null, t('pro.goals.emptyHint'))),
        goals.length > 0 && h('div', { className: 'n2s-list2' }, goals.map(g => h('div', { key: g.id, className: 'n2s-list2-row' },
          h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
            h('div', { className: 'n2s-row', style: { gap: 6 } }, h('span', { className: 'n2s-list2-title' }, g.name), h('span', { className: `n2s-statusdot ${proStatusClass[g.status] ?? ''}` }, t(`pro.st.${g.status}`))),
            h('div', { className: 'n2s-list2-sub' }, joinList([g.metric, t(`pro.period.${g.period}`), `${t(`pro.dir.${g.direction}`)} ${formatNumber(g.target)}`, g.datasourceName ?? null, g.periodStart && `${g.periodStart} ~ ${g.periodEnd}`], ' · ')),
            g.error ? h('div', { className: 'n2s-list2-sub', style: { color: 'var(--n2s-err)' } }, g.error)
              : h('div', { className: 'n2s-row', style: { gap: 8, marginTop: 6 } }, h(GoalBar, { g }),
                h('span', { className: 'n2s-small' }, `${formatCompact(g.actual)} / ${formatCompact(g.target)} (${proPct(g.pct)})`),
                h('span', { className: 'n2s-faint n2s-small' }, fmt(t, 'pro.goals.proj', { v: formatCompact(g.projected), p: proPct(g.projectedPct) }), g.weekdayAware ? ` · ${t('pro.goals.weekdayAware')}` : ''))),
          h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
            { label: t('ds.edit'), icon: Icon.edit(14), onClick: () => setEditing({ id: g.id, name: g.name, datasourceId: g.datasourceId, metric: g.metric, period: g.period, target: g.target, direction: g.direction, dashboardId: g.dashboardId ?? '' }) },
            { divider: true },
            { label: t('ds.delete'), icon: Icon.trash(14), danger: true, onClick: async () => { if (await confirmDialog({ title: fmt(t, 'pro.deleteConfirm', { name: g.name }), danger: true })) { try { await call('deleteGoal', { id: g.id }) } catch (e) { notifyError(e) } list.reload() } } },
          ] })))),
        h(GoalPushSettings, { t }))
    }
    extend.adminSections.push({ id: 'goals', label: (t) => t('pro.goals.title'), icon: () => svg(15, [h('circle', { key: 1, cx: 8, cy: 8, r: 6 }), h('circle', { key: 2, cx: 8, cy: 8, r: 3 }), h('circle', { key: 3, cx: 8, cy: 8, r: .6 })]), Component: GoalsSection })

    // ---- daily digest

    function DigestForm({ t, initial, ds, datasources, onDone, onCancel }) {
      const [form, setForm] = useState(() => ({ name: '', datasourceId: ds?.id ?? datasources[0]?.id ?? '', source: initial?.dashboardId ? 'dashboard' : 'metrics', metrics: [], dashboardId: '', channelId: '', time: '09:00', language: uiLang, threshold: 30, enabled: true, ...(initial ?? {}) }))
      const metrics = useMetrics(form.datasourceId)
      const boards = useAsync(() => call('listDashboards'), [])
      const [error, setError] = useState(null)
      const [busy, run] = useBusy()
      const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))
      const payload = () => ({ id: form.id, name: form.name, datasourceId: form.datasourceId, metrics: form.source === 'metrics' ? form.metrics : [], dashboardId: form.source === 'dashboard' ? form.dashboardId || null : null, channelId: form.channelId || null, time: form.time, language: form.language, threshold: Number(form.threshold), enabled: form.enabled })
      const save = () => run(async () => {
        setError(null)
        try { await call('saveDigest', payload()); onDone() } catch (e) { setError(e.message) }
      })
      const toggle = (name) => setForm(f => ({ ...f, metrics: f.metrics.includes(name) ? f.metrics.filter(x => x !== name) : [...f.metrics, name] }))
      return h('div', { className: 'n2s-card', style: { marginBottom: 12 } },
        h('div', { className: 'n2s-form' },
          h('label', { className: 'n2s-field' }, h('span', null, t('pro.dg.name')), h('input', { className: 'n2s-input', value: form.name, onChange: set('name'), placeholder: t('pro.dg.namePh') })),
          h('label', { className: 'n2s-field' }, h('span', null, t('ds.select')), h('select', { className: 'n2s-select', value: form.datasourceId, onChange: set('datasourceId') }, datasources.map(d => h('option', { key: d.id, value: d.id }, d.name)))),
          h('div', { className: 'n2s-field full' }, h('span', null, t('pro.dg.source')), h('div', { className: 'n2s-seg' }, ['metrics', 'dashboard'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.source === v, onClick: () => setForm(f => ({ ...f, source: v })) }, t(`pro.dg.src.${v}`))))),
          form.source === 'metrics'
            ? h('div', { className: 'n2s-field full' }, h('span', null, t('pro.dg.metrics')), metrics.length ? h('div', { className: 'n2s-chips' }, metrics.map(m => h('button', { key: m.id, type: 'button', className: 'n2s-chip', 'aria-pressed': form.metrics.includes(m.name), onClick: () => toggle(m.name) }, m.name))) : h('div', { className: 'n2s-faint n2s-small' }, t('al.noMetrics')))
            : h('label', { className: 'n2s-field full' }, h('span', null, t('pro.dg.dashboard')), h('select', { className: 'n2s-select', value: form.dashboardId ?? '', onChange: set('dashboardId') }, h('option', { value: '' }, '—'), (boards.value?.dashboards ?? []).map(b => h('option', { key: b.id, value: b.id }, b.name)))),
          h('label', { className: 'n2s-field' }, h('span', null, t('rep.time')), h('input', { className: 'n2s-input', type: 'time', value: form.time, onChange: set('time') })),
          h('div', { className: 'n2s-field' }, h('label', { htmlFor: 'n2s-pro-dg-ch', className: 'n2s-flabel' }, t('rep.push')), h(ChannelPicker, { t, id: 'n2s-pro-dg-ch', value: form.channelId ?? '', noneLabel: t('al.noPush'), onChange: (v) => setForm(f => ({ ...f, channelId: v })) })),
          h('label', { className: 'n2s-field' }, h('span', null, t('pro.dg.language')), h('select', { className: 'n2s-select', value: form.language, onChange: set('language') }, h('option', { value: 'zh' }, '中文'), h('option', { value: 'en' }, 'English'))),
          h('label', { className: 'n2s-field' }, h('span', null, t('pro.dg.threshold')), h('input', { className: 'n2s-input', type: 'number', min: 1, max: 500, value: form.threshold, onChange: set('threshold') }))),
        h('div', { className: 'n2s-faint n2s-small', style: { marginTop: 8 } }, t('pro.dg.hint')),
        error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: save }, busy ? h('span', { className: 'n2s-spin' }) : null, t('ds.save'))))
    }

    function DigestPreview({ t, run }) {
      if (run.busy) return h('div', { className: 'n2s-notice', style: { marginTop: 10 } }, h('span', { className: 'n2s-spin' }), ' ', t('pro.dg.previewing'))
      if (run.error) return h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, run.error)
      return h('div', { className: 'n2s-pro-preview' },
        h('div', { style: { fontWeight: 500, marginBottom: 6 } }, run.title),
        h(MdPreview, { text: run.text }),
        (run.results ?? []).length > 0 && h('div', { className: 'n2s-pro-preview-charts' }, run.results.map(r => h(ResultView, { key: r.resultId, result: r, t, compact: true, hideSql: true, onPinned: { hidden: true } }))))
    }

    function DigestsSection({ t, ds, datasources }) {
      const list = useAsync(() => call('listDigests'), [])
      const [editing, setEditing] = useState(null)
      const [preview, setPreview] = useState(null)
      const digests = list.value ?? []
      const runPreview = async (d) => {
        setPreview({ id: d.id, busy: true })
        try { setPreview({ ...(await call('runDigest', { id: d.id })), runId: undefined, id: d.id }) } catch (e) { setPreview({ id: d.id, error: e.message }) }
      }
      const act = async (fn, ok) => { try { await fn(); if (ok) notify(ok, 'ok') } catch (e) { notifyError(e) } list.reload() }
      return h('div', null,
        h(SectionHead, { title: t('pro.dg.title'), desc: t('pro.dg.desc') }, h('button', { type: 'button', className: 'n2s-btn primary', disabled: !datasources?.length, onClick: () => setEditing({}) }, '+ ', t('pro.dg.add'))),
        editing && h(DigestForm, { key: editing.id ?? 'new', t, ds, datasources: datasources ?? [], initial: editing.id ? editing : null, onCancel: () => setEditing(null), onDone: () => { setEditing(null); list.reload() } }),
        list.error && h('div', { className: 'n2s-notice err' }, list.error.message),
        !list.loading && digests.length === 0 && !editing && h('div', { className: 'n2s-empty' }, h('h3', null, t('pro.dg.empty')), h('div', null, t('pro.dg.emptyHint'))),
        digests.length > 0 && h('div', { className: 'n2s-list2' }, digests.map(d => h(React.Fragment, { key: d.id },
          h('div', { className: 'n2s-list2-row' },
            h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
              h('div', { className: 'n2s-row', style: { gap: 6 } }, h('span', { className: 'n2s-list2-title' }, d.name), !d.enabled && h('span', { className: 'n2s-badge' }, t('rep.status.paused')), d.channelName && h('span', { className: 'n2s-badge' }, Icon.send(11), d.channelName)),
              h('div', { className: 'n2s-list2-sub' }, joinList([d.dashboardId ? t('pro.dg.src.dashboard') : joinList(d.metrics), fmt(t, 'pro.dg.dailyAt', { time: d.time }), d.datasourceName], ' · ')),
              d.lastError && h('div', { className: 'n2s-list2-sub', style: { color: 'var(--n2s-err)' } }, d.lastError)),
            h('div', { className: 'n2s-list2-side' }, d.lastRunAt ? h('span', { className: `n2s-statusdot ${d.lastStatus === 'ok' ? 'ok' : 'err'}` }, new Date(d.lastRunAt).toLocaleString(uiLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })) : h('span', { className: 'n2s-faint n2s-small' }, t('al.never'))),
            h('div', { className: 'n2s-row', style: { gap: 2, flexWrap: 'nowrap' } },
              h('button', { type: 'button', className: 'n2s-btn small', disabled: preview?.id === d.id && preview.busy, onClick: () => runPreview(d) }, t('pro.dg.preview')),
              h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
                { label: t('pro.sendNow'), icon: Icon.send(14), disabled: !d.channelId, onClick: () => act(() => call('runDigest', { id: d.id, send: true }), t('pro.sent')) },
                { label: d.enabled ? t('rep.pause') : t('rep.resume'), icon: Icon.refresh(14), onClick: () => act(() => call('saveDigest', { id: d.id, enabled: !d.enabled })) },
                { label: t('ds.edit'), icon: Icon.edit(14), onClick: () => setEditing({ ...d, source: d.dashboardId ? 'dashboard' : 'metrics', channelId: d.channelId ?? '', dashboardId: d.dashboardId ?? '' }) },
                { divider: true },
                { label: t('ds.delete'), icon: Icon.trash(14), danger: true, onClick: async () => { if (await confirmDialog({ title: fmt(t, 'pro.deleteConfirm', { name: d.name }), danger: true })) act(() => call('deleteDigest', { id: d.id })) } },
              ] }))),
          preview?.id === d.id && h('div', { style: { padding: '0 12px 12px' } }, h(DigestPreview, { t, run: preview }), !preview.busy && h('button', { type: 'button', className: 'n2s-btn small ghost', style: { marginTop: 6 }, onClick: () => setPreview(null) }, t('pro.close')))))))
    }
    extend.adminSections.push({ id: 'digests', label: (t) => t('pro.dg.title'), icon: () => Icon.spark(15), Component: DigestsSection })
    // ------------------------------------------------- presentation (feature "present")
    // Dashboard menu: export PPT / long image, send the long image, presentation mode.
    // Result menu: export PPT. Admin section: Lark Bitable sync.

    async function preDownload(t, method, payload, doneKey) {
      notify(t('pre.working'), 'info', 2500)
      try { const r = await call(method, payload); downloadBase64(r); if (doneKey) notify(t(doneKey), 'ok') } catch (e) { notifyError(e) }
    }

    /** Pick an image-capable channel and send the dashboard long image. */
    function PreSendImageDialog({ t, boardId, onClose }) {
      const channels = useChannels().filter(c => c.type === 'lark_app' || c.type === 'telegram_bot')
      const [channelId, setChannelId] = useState('')
      const [busy, run] = useBusy()
      const [error, setError] = useState(null)
      useEffect(() => { if (!channelId && channels[0]) setChannelId(channels[0].id) }, [channels.length])
      const send = () => run(async () => {
        setError(null)
        try { const r = await call('sendDashboardImage', { dashboardId: boardId, channelId }); notify(fmt(t, 'pre.imageSent', { channel: r.channel }), 'ok'); onClose() } catch (e) { setError(e.message) }
      })
      return h(Modal, { label: t('pre.sendImage'), onClose, width: 460 },
        h('div', { className: 'n2s-modal-title' }, t('pre.sendImage')),
        h('div', { className: 'n2s-pre-dlg' },
          h('p', { className: 'n2s-muted n2s-small', style: { marginTop: 0 } }, t('pre.sendImageHint')),
          channels.length
            ? h('select', { className: 'n2s-select', 'aria-label': t('pre.channel'), value: channelId, onChange: e => setChannelId(e.target.value) }, channels.map(c => h('option', { key: c.id, value: c.id }, c.name)))
            : h('div', { className: 'n2s-notice warn' }, t('pre.noImageChannel')),
          error && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error)),
        h('div', { className: 'n2s-row', style: { justifyContent: 'flex-end', gap: 8, marginTop: 16 } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onClose }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy || !channelId, onClick: send }, busy ? h('span', { className: 'n2s-spin' }) : Icon.send(13), t('pre.send'))))
    }

    // ------------------------------------------------------ presentation mode

    const PRE_REFRESH = [60, 300, 900]
    const PRE_ROTATE = [0, 30, 60, 120, 300]

    function PreWidget({ t, widget, filters, tick, onLoaded }) {
      const [state, setState] = useState({ busy: true })
      useEffect(() => {
        let alive = true
        setState(s => ({ ...s, busy: true }))
        call('runWidget', { id: widget.id, ...(filters ? { filters } : {}), fresh: tick > 0 }).then(
          r => { if (alive) { setState({ result: { ...r, title: '' } }); onLoaded?.() } },
          e => { if (alive) { setState({ error: e.message }); onLoaded?.() } })
        return () => { alive = false }
      }, [widget.id, tick, filters])
      const width = ['third', 'half', 'full'].includes(widget.width) ? widget.width : 'half'
      return h('section', { className: `n2s-pre-card w-${width}`, 'aria-label': widget.title },
        h('div', { className: 'n2s-pre-card-title' }, widget.title, state.busy && state.result ? h('span', { className: 'n2s-spin', style: { marginLeft: 8 } }) : null),
        state.error ? h('div', { className: 'n2s-notice err' }, state.error)
          : state.result ? h(ResultView, { result: state.result, t, compact: true, embedded: true, hideSql: true, onPinned: HIDDEN_PIN })
            : h('div', { className: 'n2s-skel', style: { height: 240 } }))
    }

    function PresentationMode({ t, boardId, filters, onClose }) {
      const root = useRef(null)
      const boards = useAsync(() => call('listDashboards'), [])
      const list = boards.value?.dashboards ?? []
      const [current, setCurrent] = useState(boardId)
      const board = list.find(b => b.id === current)
      const widgets = useAsync(() => call('listDashboard', { dashboardId: current }), [current])
      const [refresh, setRefresh] = useState(() => { try { return Number(localStorage.getItem('nl2sql:preRefresh')) || 300 } catch { return 300 } })
      const [rotate, setRotate] = useState(0)
      const [tick, setTick] = useState(0)
      const [now, setNow] = useState(Date.now())
      const [lastAt, setLastAt] = useState(null)
      const [fs, setFs] = useState(false)
      // The opening board keeps the dashboard's current (unsaved) filters; other boards use their saved ones.
      const boardFilters = current === boardId ? filters : undefined
      const go = useCallback((delta) => {
        if (list.length < 2) return
        const i = Math.max(0, list.findIndex(b => b.id === current))
        setCurrent(list[(i + delta + list.length) % list.length].id)
        setLastAt(null)
      }, [list, current])
      useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [])
      useEffect(() => { const id = setInterval(() => setTick(x => x + 1), refresh * 1000); return () => clearInterval(id) }, [refresh])
      useEffect(() => { if (!rotate || list.length < 2) return; const id = setInterval(() => go(1), rotate * 1000); return () => clearInterval(id) }, [rotate, go, list.length])
      useEffect(() => {
        const onKey = (e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
          else if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
          else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
        }
        document.addEventListener('keydown', onKey, true)
        return () => document.removeEventListener('keydown', onKey, true)
      }, [go, onClose])
      useEffect(() => {
        const el = root.current
        const prev = document.activeElement
        el?.focus()
        try { if (el?.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().then(() => setFs(true), () => {}) } catch {}
        // Leaving browser fullscreen with Esc closes the overlay too.
        const onFs = () => { if (!document.fullscreenElement) { setFs(was => { if (was) onClose(); return false }) } }
        document.addEventListener('fullscreenchange', onFs)
        const overflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => {
          document.removeEventListener('fullscreenchange', onFs)
          document.body.style.overflow = overflow
          try { if (document.fullscreenElement) document.exitFullscreen?.() } catch {}
          prev?.focus?.()
        }
      }, [])
      const setRefreshSaved = (v) => { setRefresh(v); try { localStorage.setItem('nl2sql:preRefresh', String(v)) } catch {} }
      const items = widgets.value ?? []
      const clock = new Date(now)
      return ReactDOM.createPortal(h('div', { ref: root, className: 'n2s-pre', role: 'dialog', 'aria-modal': true, 'aria-label': t('pre.mode'), tabIndex: -1 },
        h('header', { className: 'n2s-pre-head' },
          h('div', { className: 'n2s-pre-titles' },
            h('h1', null, board?.name ?? ''),
            h('div', { className: 'n2s-pre-sub', role: 'status', 'aria-live': 'polite' },
              lastAt ? fmt(t, 'pre.lastRefresh', { time: new Date(lastAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }) : t('pre.loading'),
              list.length > 1 ? ` · ${list.findIndex(b => b.id === current) + 1}/${list.length}` : '')),
          h('div', { className: 'n2s-pre-clock', 'aria-label': t('pre.clock') },
            h('div', { className: 'time' }, clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })),
            h('div', { className: 'date' }, clock.toLocaleDateString(uiLocale(), { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }))),
          h('div', { className: 'n2s-pre-ctl' },
            h('label', null, h('span', null, t('pre.refresh')), h('select', { value: refresh, onChange: e => setRefreshSaved(Number(e.target.value)) }, PRE_REFRESH.map(v => h('option', { key: v, value: v }, fmt(t, 'dash.autoEvery', { min: v / 60 }))))),
            list.length > 1 && h('label', null, h('span', null, t('pre.rotate')), h('select', { value: rotate, onChange: e => setRotate(Number(e.target.value)) }, PRE_ROTATE.map(v => h('option', { key: v, value: v }, v ? fmt(t, 'pre.everySec', { s: v }) : t('pre.rotateOff'))))),
            list.length > 1 && h('button', { type: 'button', className: 'n2s-pre-btn', 'aria-label': t('pre.prev'), title: t('pre.prev'), onClick: () => go(-1) }, '←'),
            list.length > 1 && h('button', { type: 'button', className: 'n2s-pre-btn', 'aria-label': t('pre.next'), title: t('pre.next'), onClick: () => go(1) }, '→'),
            h('button', { type: 'button', className: 'n2s-pre-btn', 'aria-label': t('dash.refresh'), title: t('dash.refresh'), onClick: () => setTick(x => x + 1) }, Icon.refresh(16)),
            h('button', { type: 'button', className: 'n2s-pre-btn', 'aria-label': t('pre.exit'), title: t('pre.exitHint'), onClick: onClose }, Icon.close(16)))),
        widgets.error && h('div', { className: 'n2s-notice err' }, widgets.error.message),
        !widgets.loading && items.length === 0 && h('div', { className: 'n2s-pre-empty' }, t('dash.empty')),
        h('main', { className: 'n2s-pre-grid', key: current },
          items.map(w => h(PreWidget, { key: w.id, t, widget: w, filters: boardFilters, tick, onLoaded: () => setLastAt(Date.now()) })))), document.body)
    }

    // ------------------------------------------------------------ menus

    const preState = createStore({ present: null, sendImage: null })
    function PreLayer({ t }) {
      const s = useSyncExternalStore(preState.subscribe, preState.get, preState.get)
      return h(React.Fragment, null,
        s.present && h(PresentationMode, { t, boardId: s.present.boardId, filters: s.present.filters, onClose: () => preState.set({ present: null }) }),
        s.sendImage && h(PreSendImageDialog, { t, boardId: s.sendImage.boardId, onClose: () => preState.set({ sendImage: null }) }))
    }
    extend.dashboardBar.push(PreLayer)

    extend.dashboardMenu.push(({ t, boardId, widgets, filters }) => [
      { divider: true },
      { label: t('pre.exportPpt'), icon: Icon.download(14), disabled: !widgets?.length, onClick: () => preDownload(t, 'exportDashboardPptx', { dashboardId: boardId, filters }, 'pre.exported') },
      { label: t('pre.exportImage'), icon: Icon.download(14), disabled: !widgets?.length, onClick: () => preDownload(t, 'exportDashboardImage', { dashboardId: boardId, filters, width: 1200 }, 'pre.exported') },
      { label: t('pre.sendImage'), icon: Icon.send(14), disabled: !widgets?.length, onClick: () => preState.set({ sendImage: { boardId } }) },
      { label: t('pre.mode'), icon: Icon.expand(14), onClick: () => preState.set({ present: { boardId, filters } }) },
    ])

    extend.resultMenu.push(({ t, result }) => (result?.resultId ? [
      { label: t('pre.exportPpt'), icon: Icon.download(14), onClick: () => preDownload(t, 'exportResultsPptx', { resultIds: [result.resultId], title: result.title }, 'pre.exported') },
    ] : []))

    // ------------------------------------------------------- Bitable sync admin

    function PreBitableForm({ t, initial, datasources, onDone, onCancel }) {
      const channels = useChannels().filter(c => c.type === 'lark_app')
      const boards = useAsync(() => call('listDashboards'), [])
      const allWidgets = useAsync(async () => {
        const list = boards.value?.dashboards ?? []
        const per = await Promise.all(list.map(b => call('listDashboard', { dashboardId: b.id }).then(ws => ws.map(w => ({ ...w, board: b.name }))).catch(() => [])))
        return per.flat()
      }, [boards.value])
      const [form, setForm] = useState(() => ({
        name: '', channelId: '', appToken: '', tableId: '', mode: 'replace', schedule: { time: '08:00', enabled: false },
        kind: initial?.source?.sql ? 'sql' : 'widget', widgetId: initial?.source?.widgetId ?? '', datasourceId: initial?.source?.datasourceId ?? datasources[0]?.id ?? '', sql: initial?.source?.sql ?? '',
        ...(initial ?? {}),
      }))
      useEffect(() => { if (!form.channelId && channels[0]) setForm(f => ({ ...f, channelId: channels[0].id })) }, [channels.length])
      const [error, setError] = useState(null)
      const [busy, run] = useBusy()
      const set = (key) => (e) => setForm(f => ({ ...f, [key]: e.target.value }))
      // Paste a Bitable link: …/base/<app_token>?table=<table_id>
      const pasteLink = (e) => {
        const m = String(e.target.value).match(/\/base\/([A-Za-z0-9]+)(?:[^#]*[?&]table=(tbl[A-Za-z0-9]+))?/)
        if (m) { e.preventDefault(); setForm(f => ({ ...f, appToken: m[1], tableId: m[2] ?? f.tableId })) } else set('appToken')(e)
      }
      const save = () => run(async () => {
        setError(null)
        const source = form.kind === 'sql' ? { datasourceId: form.datasourceId, sql: form.sql } : { widgetId: form.widgetId }
        try { await call('saveBitableSync', { id: form.id, name: form.name, channelId: form.channelId, appToken: form.appToken, tableId: form.tableId, mode: form.mode, schedule: form.schedule, source }); onDone() } catch (e) { setError(e) }
      })
      const err = (field) => error?.field === field ? h('span', { className: 'n2s-small', style: { color: 'var(--n2s-err)' } }, error.message) : null
      return h('div', { className: 'n2s-card', style: { marginBottom: 12 } },
        h('div', { className: 'n2s-form' },
          h('label', { className: 'n2s-field' }, h('span', null, t('pre.bt.name')), h('input', { className: 'n2s-input', value: form.name, onChange: set('name'), placeholder: t('pre.bt.namePh') })),
          h('label', { className: 'n2s-field' }, h('span', null, t('pre.bt.channel')),
            channels.length ? h('select', { className: 'n2s-select', value: form.channelId, onChange: set('channelId') }, channels.map(c => h('option', { key: c.id, value: c.id }, c.name))) : h('span', { className: 'n2s-small n2s-muted' }, t('pre.bt.noChannel')), err('channelId')),
          h('label', { className: 'n2s-field' }, h('span', null, 'app_token'), h('input', { className: 'n2s-input n2s-mono', value: form.appToken, onChange: pasteLink, placeholder: t('pre.bt.appTokenPh') }), err('appToken')),
          h('label', { className: 'n2s-field' }, h('span', null, 'table_id'), h('input', { className: 'n2s-input n2s-mono', value: form.tableId, onChange: set('tableId'), placeholder: 'tbl…' }), err('tableId')),
          h('div', { className: 'n2s-field full' }, h('span', null, t('pre.bt.source')), h('div', { className: 'n2s-seg' }, ['widget', 'sql'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.kind === v, onClick: () => setForm(f => ({ ...f, kind: v })) }, t(`pre.bt.src.${v}`))))),
          form.kind === 'widget'
            ? h('label', { className: 'n2s-field full' }, h('span', null, t('pre.bt.widget')), h('select', { className: 'n2s-select', value: form.widgetId, onChange: set('widgetId') }, h('option', { value: '' }, '—'), (allWidgets.value ?? []).map(w => h('option', { key: w.id, value: w.id }, `${w.board} · ${w.title}`))), err('source'))
            : h(React.Fragment, null,
              h('label', { className: 'n2s-field' }, h('span', null, t('ds.select')), h('select', { className: 'n2s-select', value: form.datasourceId, onChange: set('datasourceId') }, datasources.map(d => h('option', { key: d.id, value: d.id }, d.name)))),
              h('label', { className: 'n2s-field full' }, h('span', null, 'SQL'), h('textarea', { className: 'n2s-textarea n2s-mono', spellCheck: false, value: form.sql, onChange: set('sql'), placeholder: 'SELECT …' }), err('sql'))),
          h('div', { className: 'n2s-field' }, h('span', null, t('pre.bt.mode')), h('div', { className: 'n2s-seg' }, ['replace', 'append'].map(v => h('button', { key: v, type: 'button', 'aria-pressed': form.mode === v, onClick: () => setForm(f => ({ ...f, mode: v })) }, t(`pre.bt.mode.${v}`)))),
            h('span', { className: 'n2s-faint n2s-small' }, t(`pre.bt.modeHint.${form.mode}`))),
          h('div', { className: 'n2s-field' }, h('span', null, t('pre.bt.schedule')),
            h('div', { className: 'n2s-row' },
              h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: form.schedule.enabled, onChange: e => setForm(f => ({ ...f, schedule: { ...f.schedule, enabled: e.target.checked } })) }), t('pre.bt.daily')),
              h('input', { className: 'n2s-input', type: 'time', 'aria-label': t('rep.time'), style: { width: 120 }, value: form.schedule.time, disabled: !form.schedule.enabled, onChange: e => setForm(f => ({ ...f, schedule: { ...f.schedule, time: e.target.value } })) })))),
        h('div', { className: 'n2s-faint n2s-small', style: { marginTop: 8 } }, t('pre.bt.permHint')),
        error && !error.field && h('div', { className: 'n2s-notice err', style: { marginTop: 10 } }, error.message),
        h('div', { className: 'n2s-row', style: { marginTop: 12, justifyContent: 'flex-end' } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: save }, busy ? h('span', { className: 'n2s-spin' }) : null, t('ds.save'))))
    }

    function PreBitableSection({ t, datasources = [] }) {
      const list = useAsync(() => call('listBitableSyncs'), [])
      const [editing, setEditing] = useState(null)
      const [running, setRunning] = useState(null)
      const syncs = list.value ?? []
      const runNow = async (s) => {
        if (running) return
        setRunning(s.id)
        try { const r = await call('runBitableSync', { id: s.id }); notify(fmt(t, 'pre.bt.ran', { created: r.created, deleted: r.deleted }), 'ok') } catch (e) { notifyError(e) } finally { setRunning(null); list.reload() }
      }
      return h('div', null,
        h(SectionHead, { title: t('pre.bt.title'), desc: t('pre.bt.desc') }, h('button', { type: 'button', className: 'n2s-btn primary', onClick: () => setEditing({}) }, '+ ', t('pre.bt.add'))),
        editing && h(PreBitableForm, { key: editing.id ?? 'new', t, datasources, initial: editing.id ? editing : null, onCancel: () => setEditing(null), onDone: () => { setEditing(null); list.reload() } }),
        list.error && h('div', { className: 'n2s-notice err' }, list.error.message),
        !list.loading && !syncs.length && !editing && h('div', { className: 'n2s-empty' }, h('h3', null, t('pre.bt.empty')), h('div', null, t('pre.bt.emptyHint'))),
        syncs.length > 0 && h('div', { className: 'n2s-list2' }, syncs.map(s => h('div', { key: s.id, className: 'n2s-list2-row' },
          h('span', { className: 'n2s-tile', 'aria-hidden': true }, Icon.table(16)),
          h('div', { className: 'n2s-grow', style: { minWidth: 0 } },
            h('div', { className: 'n2s-row', style: { gap: 6 } }, h('span', { className: 'n2s-list2-title' }, s.name), h('span', { className: 'n2s-badge' }, t(`pre.bt.mode.${s.mode}`)), s.schedule?.enabled && h('span', { className: 'n2s-badge blue' }, fmt(t, 'pre.bt.dailyAt', { time: s.schedule.time }))),
            h('div', { className: 'n2s-list2-sub' }, joinList([s.source?.widgetId ? `${t('pre.bt.src.widget')}${colon('')}${s.sourceLabel ?? '?'}` : `SQL · ${s.sourceLabel ?? ''}`, s.channelName ?? t('pre.bt.channelMissing'), `${s.appToken} / ${s.tableId}`], ' · ')),
            s.lastError && s.lastStatus === 'error' && h('div', { className: 'n2s-list2-sub', style: { color: 'var(--n2s-err)' } }, s.lastError)),
          h('div', { className: 'n2s-list2-side' },
            h('span', { className: `n2s-statusdot ${s.lastStatus === 'error' ? 'err' : s.lastStatus === 'ok' ? 'ok' : ''}` }, s.lastStatus === 'ok' ? fmt(t, 'pre.bt.lastOk', { n: s.lastRows ?? 0 }) : s.lastStatus === 'error' ? t('pre.bt.lastErr') : t('pre.bt.never')),
            s.lastRunAt ? h('span', { className: 'n2s-faint n2s-small' }, new Date(s.lastRunAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })) : null),
          h('div', { className: 'n2s-row', style: { gap: 2, flexWrap: 'nowrap' } },
            h('button', { type: 'button', className: 'n2s-btn small', disabled: Boolean(running), onClick: () => runNow(s) }, running === s.id ? h('span', { className: 'n2s-spin' }) : null, t('pre.bt.run')),
            h(Dropdown, { label: t('result.more'), trigger: { content: Icon.more() }, items: [
              { label: t('ds.edit'), icon: Icon.edit(14), onClick: () => setEditing(s) },
              { divider: true },
              { label: t('ds.delete'), icon: Icon.trash(14), danger: true, onClick: async () => { if (await confirmDialog({ title: fmt(t, 'pre.bt.deleteConfirm', { name: s.name }), danger: true })) { try { await call('deleteBitableSync', { id: s.id }) } catch (e) { notifyError(e) } list.reload() } } },
            ] }))))))
    }

    extend.adminSections.push({ id: 'bitable', label: (t) => t('pre.bt.nav'), icon: () => Icon.table(15), Component: PreBitableSection })
    // ------------------------------------------------------------ MCP access (admin section)
    // Enable the local MCP server, manage bearer tokens (shown once; expiry, tool allowlist,
    // rate limit, rotation), test the connection, read the per-token call log, and copy setup
    // snippets for ten MCP clients (formats verified against each client's docs, see docs/mcp.md).

    const MCP_PKG = '@hedeqiang/dsh-nl2sql'
    const MCP_CLIENTS = ['claude', 'claudeCode', 'cursor', 'vscode', 'cline', 'windsurf', 'codex', 'gemini', 'zed', 'continue']

    /** Config snippets for a token (placeholder when the token value is no longer known). */
    function mcpSnippets(url, token) {
      const tok = token || '<YOUR_TOKEN>'
      const auth = { Authorization: `Bearer ${tok}` }
      const json = (o) => JSON.stringify(o, null, 2)
      const stdio = { command: 'npx', args: ['-y', '-p', MCP_PKG, 'nl2sql-mcp'], env: { NL2SQL_MCP_URL: url, NL2SQL_MCP_TOKEN: tok } }
      return {
        // https://modelcontextprotocol.io/docs/develop/connect-local-servers
        claude: json({ mcpServers: { nl2sql: stdio } }),
        // https://code.claude.com/docs/en/mcp
        claudeCode: `claude mcp add --transport http nl2sql ${url} \\\n  --header "Authorization: Bearer ${tok}"\n\n# stdio variant (bridge)\nclaude mcp add --transport stdio --env NL2SQL_MCP_URL=${url} --env NL2SQL_MCP_TOKEN=${tok} nl2sql -- npx -y -p ${MCP_PKG} nl2sql-mcp`,
        // https://cursor.com/docs/mcp
        cursor: json({ mcpServers: { nl2sql: { url, headers: auth } } }),
        // https://code.visualstudio.com/docs/agents/reference/mcp-configuration
        vscode: json({ servers: { nl2sql: { type: 'http', url, headers: auth } } }),
        // https://docs.cline.bot/mcp/configuring-mcp-servers
        cline: json({ mcpServers: { nl2sql: { type: 'streamableHttp', url, headers: auth, disabled: false } } }),
        // https://docs.devin.ai/windsurf/plugins/cascade/mcp
        windsurf: json({ mcpServers: { nl2sql: { serverUrl: url, headers: auth } } }),
        // https://developers.openai.com/codex/mcp
        codex: `[mcp_servers.nl2sql]\nurl = "${url}"\nhttp_headers = { "Authorization" = "Bearer ${tok}" }`,
        // https://geminicli.com/docs/tools/mcp-server/
        gemini: json({ mcpServers: { nl2sql: { httpUrl: url, headers: auth } } }),
        // https://zed.dev/docs/ai/mcp
        zed: json({ context_servers: { nl2sql: { url, headers: auth } } }),
        // https://docs.continue.dev/customize/deep-dives/mcp
        continue: `name: nl2sql\nversion: 0.0.1\nschema: v1\nmcpServers:\n  - name: nl2sql\n    type: streamable-http\n    url: ${url}\n    requestOptions:\n      headers:\n        Authorization: Bearer ${tok}`,
      }
    }

    function McpCopy({ t, text, label }) {
      const [done, setDone] = useState(false)
      return h('button', {
        type: 'button', className: 'n2s-btn small', 'aria-label': label ?? t('mcp.copy'),
        onClick: async () => {
          try { await navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) } catch (e) { notifyError(e) }
        },
      }, done ? Icon.check(13) : Icon.copy(13), ' ', done ? t('mcp.copied') : (label ?? t('mcp.copy')))
    }

    function McpSnippets({ t, url, token }) {
      const [tab, setTab] = useState('claude')
      const snip = mcpSnippets(url, token)
      return h('div', { className: 'n2s-mcp-snippets' },
        h('div', { className: 'n2s-seg n2s-mcp-tabs', role: 'tablist', 'aria-label': t('mcp.setup') }, MCP_CLIENTS.map(k => h('button', { key: k, type: 'button', role: 'tab', 'data-client': k, 'aria-selected': tab === k, 'aria-pressed': tab === k, onClick: () => setTab(k) }, t(`mcp.client.${k}`)))),
        h('div', { className: 'n2s-faint n2s-small', style: { margin: '6px 0' } }, t(`mcp.where.${tab}`)),
        h('div', { className: 'n2s-mcp-code' },
          h('pre', { className: 'n2s-code', 'data-snippet': tab }, snip[tab]),
          h('div', { className: 'n2s-mcp-codeact' }, h(McpCopy, { t, text: snip[tab] }))),
        !token && h('div', { className: 'n2s-faint n2s-small' }, t('mcp.placeholderHint')))
    }

    function McpScopeLabel({ t, scope }) {
      if (scope.type === 'member') return h('span', null, h('span', { className: 'n2s-badge' }, t('mcp.scope.member')), ' ', scope.memberName ?? scope.memberId, scope.missing ? h('span', { className: 'n2s-badge warn' }, t('mcp.memberMissing')) : scope.disabled ? h('span', { className: 'n2s-badge warn' }, t('mcp.memberDisabled')) : null)
      if (scope.type === 'role') return h('span', null, h('span', { className: 'n2s-badge' }, t(`mcp.role.${scope.role}`)), ' ', scope.datasourceNames ? joinList(scope.datasourceNames) : t('mcp.allDs'), scope.rowRules?.length ? h('span', { className: 'n2s-faint' }, paren(fmt(t, 'mcp.rowRulesN', { n: scope.rowRules.length }))) : null)
      return h('span', { className: 'n2s-badge ok' }, t('mcp.scope.owner'))
    }

    const mcpDateInput = (ms) => {
      if (!ms) return ''
      const d = new Date(ms)
      const p = (n) => String(n).padStart(2, '0')
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    }

    /** Expiry, tool allowlist and rate limit fields. value: { expires: 'YYYY-MM-DD'|'', allTools, tools: [], rateLimit: '' }. */
    function McpLimitsFields({ t, value, onChange, toolNames }) {
      const set = (k, v) => onChange({ ...value, [k]: v })
      return h('div', { className: 'n2s-mcp-limits' },
        h('label', { className: 'n2s-field' }, h('span', { className: 'n2s-flabel' }, t('mcp.expiry')),
          h('div', { className: 'n2s-row' },
            h('input', { type: 'date', className: 'n2s-input', style: { maxWidth: 180 }, 'aria-label': t('mcp.expiry'), value: value.expires, onChange: e => set('expires', e.target.value) }),
            value.expires && h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => set('expires', '') }, t('mcp.noExpiry'))),
          h('span', { className: 'n2s-faint n2s-small' }, t('mcp.expiryHint'))),
        h('div', { className: 'n2s-field', role: 'group', 'aria-label': t('mcp.toolsAllow') },
          h('span', { className: 'n2s-flabel' }, t('mcp.toolsAllow')),
          h('label', { className: 'n2s-check' }, h('input', { type: 'checkbox', checked: value.allTools, onChange: e => set('allTools', e.target.checked) }), ' ', t('mcp.allTools')),
          !value.allTools && h('div', { className: 'n2s-mcp-toolgrid' }, (toolNames ?? []).map(n => h('label', { key: n, className: 'n2s-check n2s-mono' },
            h('input', { type: 'checkbox', 'data-tool': n, checked: value.tools.includes(n), onChange: e => set('tools', e.target.checked ? [...value.tools, n] : value.tools.filter(x => x !== n)) }), ' ', n)))),
        h('label', { className: 'n2s-field' }, h('span', { className: 'n2s-flabel' }, t('mcp.rateLimit')),
          h('div', { className: 'n2s-row' },
            h('input', { className: 'n2s-input n2s-mono', style: { width: 110 }, inputMode: 'numeric', 'aria-label': t('mcp.rateLimit'), placeholder: t('mcp.unlimited'), value: value.rateLimit, onChange: e => set('rateLimit', e.target.value.replace(/\D/g, '').slice(0, 5)) }),
            h('span', { className: 'n2s-faint n2s-small' }, t('mcp.perMinute')))))
    }

    /** Limits form state → RPC payload fields. */
    function mcpLimitsPayload(v) {
      return {
        expiresAt: v.expires ? new Date(`${v.expires}T23:59:59`).getTime() : null,
        tools: v.allTools ? null : v.tools,
        rateLimit: v.rateLimit ? Number(v.rateLimit) : null,
      }
    }
    const mcpLimitsOf = (tok) => ({ expires: mcpDateInput(tok?.expiresAt), allTools: !Array.isArray(tok?.tools), tools: tok?.tools ?? [], rateLimit: tok?.rateLimit ? String(tok.rateLimit) : '' })

    function McpTokenForm({ t, datasources, toolNames, onCreated, onCancel }) {
      const users = useAsync(() => call('listUsers').catch(() => []), [])
      const [form, setForm] = useState({ name: '', type: 'owner', memberId: '', role: 'analyst', datasourceIds: [], rowColumn: '', rowValues: '' })
      const [limits, setLimits] = useState(mcpLimitsOf(null))
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState(null)
      const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
      const members = (users.value ?? []).filter(u => !u.disabled)
      const submit = async () => {
        setErr(null)
        const scope = form.type === 'member' ? { memberId: form.memberId }
          : form.type === 'role' ? { role: form.role, datasourceIds: form.datasourceIds, ...(form.rowColumn.trim() && form.rowValues.trim() ? { rowRules: [{ column: form.rowColumn.trim(), values: form.rowValues }] } : {}) }
            : { kind: 'owner' }
        if (!form.name.trim()) return setErr(t('mcp.err.name'))
        if (form.type === 'member' && !form.memberId) return setErr(t('mcp.err.member'))
        if (form.type === 'role' && !form.datasourceIds.length) return setErr(t('mcp.err.ds'))
        if (!limits.allTools && !limits.tools.length) return setErr(t('mcp.err.tools'))
        const extra = mcpLimitsPayload(limits)
        setBusy(true)
        try { onCreated(await call('createMcpToken', { name: form.name.trim(), scope, ...Object.fromEntries(Object.entries(extra).filter(([, v]) => v !== null)) })) } catch (e) { setErr(e.message) }
        setBusy(false)
      }
      return h('div', { className: 'n2s-card n2s-mcp-form' },
        h('div', { className: 'n2s-sechead-title', style: { marginBottom: 10 } }, t('mcp.newToken')),
        h('label', { className: 'n2s-field' }, h('span', { className: 'n2s-flabel' }, t('mcp.tokenName')),
          h('input', { className: 'n2s-input', value: form.name, maxLength: 60, placeholder: t('mcp.tokenNamePh'), onChange: e => set('name', e.target.value) })),
        h('div', { className: 'n2s-field', role: 'group', 'aria-label': t('mcp.scope') },
          h('span', { className: 'n2s-flabel' }, t('mcp.scope')),
          h('div', { className: 'n2s-seg', role: 'radiogroup' }, ['owner', 'member', 'role'].map(k => h('button', { key: k, type: 'button', role: 'radio', 'aria-checked': form.type === k, 'aria-pressed': form.type === k, onClick: () => set('type', k) }, t(`mcp.scope.${k}`)))),
          h('span', { className: 'n2s-faint n2s-small' }, t(`mcp.scopeHint.${form.type}`))),
        form.type === 'member' && h('label', { className: 'n2s-field' }, h('span', { className: 'n2s-flabel' }, t('mcp.member')),
          members.length
            ? h('select', { className: 'n2s-select', value: form.memberId, onChange: e => set('memberId', e.target.value) },
              h('option', { value: '' }, t('mcp.pickMember')),
              members.map(u => h('option', { key: u.id, value: u.id }, `${u.name} · ${t(`mcp.role.${u.role}`)}`)))
            : h('span', { className: 'n2s-faint n2s-small' }, t('mcp.noMembers'))),
        form.type === 'role' && h(React.Fragment, null,
          h('label', { className: 'n2s-field' }, h('span', { className: 'n2s-flabel' }, t('mcp.role')),
            h('select', { className: 'n2s-select', value: form.role, onChange: e => set('role', e.target.value) }, ['analyst', 'viewer', 'admin'].map(r => h('option', { key: r, value: r }, t(`mcp.role.${r}`))))),
          h('div', { className: 'n2s-field' }, h('span', { className: 'n2s-flabel' }, t('mcp.datasources')),
            h('div', { className: 'n2s-chips' }, (datasources ?? []).map(d => h('button', { key: d.id, type: 'button', className: 'n2s-chip', 'aria-pressed': form.datasourceIds.includes(d.id), onClick: () => set('datasourceIds', form.datasourceIds.includes(d.id) ? form.datasourceIds.filter(x => x !== d.id) : [...form.datasourceIds, d.id]) }, d.name)))),
          h('div', { className: 'n2s-field' }, h('span', { className: 'n2s-flabel' }, t('mcp.rowRule')),
            h('div', { className: 'n2s-row' },
              h('input', { className: 'n2s-input n2s-mono', style: { maxWidth: 180 }, 'aria-label': t('mcp.rowColumn'), placeholder: t('mcp.rowColumn'), value: form.rowColumn, onChange: e => set('rowColumn', e.target.value) }),
              h('input', { className: 'n2s-input', 'aria-label': t('mcp.rowValues'), placeholder: t('mcp.rowValues'), value: form.rowValues, onChange: e => set('rowValues', e.target.value) })),
            h('span', { className: 'n2s-faint n2s-small' }, t('mcp.rowRuleHint')))),
        h(McpLimitsFields, { t, value: limits, onChange: setLimits, toolNames }),
        err && h('div', { className: 'n2s-notice err', role: 'alert', style: { marginTop: 8 } }, err),
        h('div', { className: 'n2s-row', style: { justifyContent: 'flex-end', marginTop: 12 } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: submit }, busy ? h('span', { className: 'n2s-spin' }) : null, t('mcp.create'))))
    }

    /** Edit name / expiry / allowlist / rate limit of an existing token (the secret is never shown again). */
    function McpTokenEditor({ t, tok, toolNames, onSaved, onCancel }) {
      const [name, setName] = useState(tok.name)
      const [limits, setLimits] = useState(mcpLimitsOf(tok))
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState(null)
      const save = async () => {
        setErr(null)
        if (!name.trim()) return setErr(t('mcp.err.name'))
        if (!limits.allTools && !limits.tools.length) return setErr(t('mcp.err.tools'))
        setBusy(true)
        try { onSaved(await call('updateMcpToken', { id: tok.id, name: name.trim(), ...mcpLimitsPayload(limits) })) } catch (e) { setErr(e.message) }
        setBusy(false)
      }
      return h('div', { className: 'n2s-card n2s-mcp-editor', 'data-editing': tok.id },
        h('div', { className: 'n2s-sechead-title', style: { marginBottom: 10 } }, fmt(t, 'mcp.editTitle', { name: tok.name })),
        h('label', { className: 'n2s-field' }, h('span', { className: 'n2s-flabel' }, t('mcp.tokenName')),
          h('input', { className: 'n2s-input', value: name, maxLength: 60, 'aria-label': t('mcp.tokenName'), onChange: e => setName(e.target.value) })),
        h(McpLimitsFields, { t, value: limits, onChange: setLimits, toolNames }),
        err && h('div', { className: 'n2s-notice err', role: 'alert', style: { marginTop: 8 } }, err),
        h('div', { className: 'n2s-row', style: { justifyContent: 'flex-end', marginTop: 12 } },
          h('button', { type: 'button', className: 'n2s-btn ghost', onClick: onCancel }, t('ds.cancel')),
          h('button', { type: 'button', className: 'n2s-btn primary', disabled: busy, onClick: save }, busy ? h('span', { className: 'n2s-spin' }) : null, t('mcp.save'))))
    }

    /** "Test connection": mcpSelfTest (discover + tools/list + initialize over loopback with a temporary credential). */
    function McpSelfTest({ t, disabled }) {
      const [res, setRes] = useState(null)
      const [busy, setBusy] = useState(false)
      const run = async () => {
        setBusy(true)
        try { setRes(await call('mcpSelfTest')) } catch (e) { setRes({ ok: false, error: e.message, steps: [] }) }
        setBusy(false)
      }
      return h('div', { className: 'n2s-mcp-selftest' },
        h('button', { type: 'button', className: 'n2s-btn small', disabled: disabled || busy, onClick: run }, busy ? h('span', { className: 'n2s-spin' }) : null, t('mcp.test')),
        res && h('div', { className: `n2s-notice ${res.ok ? 'ok' : 'err'}`, role: 'status', 'data-selftest': res.ok ? 'ok' : 'fail', style: { marginTop: 8 } },
          h('div', null, res.ok ? fmt(t, 'mcp.testOk', { n: res.tools?.length ?? 0 }) : (res.error ? fmt(t, 'mcp.testFail', { error: res.error }) : t('mcp.testFailSteps'))),
          (res.steps ?? []).length > 0 && h('ul', { className: 'n2s-mcp-steps' }, res.steps.map(s => h('li', { key: s.step }, s.ok ? '✓ ' : '✗ ', h('span', { className: 'n2s-mono' }, s.step), ` · ${s.detail} · ${s.ms} ms`)))))
    }

    /** Per-token call log with a status / tool filter. */
    function McpCallLog({ t, tokens }) {
      const [tokenId, setTokenId] = useState('')
      const [status, setStatus] = useState('')
      const [q, setQ] = useState('')
      const log = useAsync(() => call('mcpCallLog', { ...(tokenId ? { tokenId } : {}), ...(status ? { status } : {}), limit: 200 }), [tokenId, status])
      const when = (ms) => new Date(ms).toLocaleString(uiLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      const rows = (log.value ?? []).filter(r => !q || `${r.tool ?? r.method} ${r.datasource ?? ''}`.toLowerCase().includes(q.toLowerCase()))
      const badge = (s) => h('span', { className: `n2s-badge ${s === 'ok' ? 'ok' : s === 'cancelled' || s === 'rate-limited' ? 'warn' : 'err'}` }, t(`mcp.log.status.${s}`) ?? s)
      return h('div', { className: 'n2s-card n2s-mcp-log' },
        h('div', { className: 'n2s-row', style: { flexWrap: 'wrap', gap: 8, marginBottom: 8 } },
          h('select', { className: 'n2s-select', 'aria-label': t('mcp.log.token'), value: tokenId, onChange: e => setTokenId(e.target.value) },
            h('option', { value: '' }, t('mcp.log.allTokens')), tokens.map(tk => h('option', { key: tk.id, value: tk.id }, tk.name))),
          h('div', { className: 'n2s-seg', role: 'group', 'aria-label': t('mcp.log.status') }, ['', 'ok', 'error', 'cancelled', 'rate-limited'].map(v => h('button', { key: v || 'all', type: 'button', 'aria-pressed': status === v, onClick: () => setStatus(v) }, v ? t(`mcp.log.status.${v}`) : t('mcp.log.all')))),
          h('input', { className: 'n2s-input', style: { maxWidth: 200 }, 'aria-label': t('mcp.log.filter'), placeholder: t('mcp.log.filter'), value: q, onChange: e => setQ(e.target.value) }),
          h('span', { className: 'n2s-grow' }),
          h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => log.reload() }, t('mcp.log.refresh'))),
        rows.length === 0
          ? h('div', { className: 'n2s-faint n2s-small' }, log.value ? t('mcp.log.empty') : '…')
          : h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table n2s-mcp-logtable' },
            h('thead', null, h('tr', null, [t('mcp.log.time'), t('mcp.log.token'), t('mcp.log.tool'), t('mcp.log.datasource'), t('mcp.log.ms'), t('mcp.log.rows'), t('mcp.log.status')].map((x, i) => h('th', { key: i }, x)))),
            h('tbody', null, rows.map(r => h('tr', { key: r.id, 'data-log-id': r.id, title: r.error ?? '' },
              h('td', { className: 'n2s-small' }, when(r.at)),
              h('td', { className: 'n2s-small' }, r.tokenName),
              h('td', { className: 'n2s-mono n2s-small' }, r.tool ?? r.method),
              h('td', { className: 'n2s-small' }, r.datasource ?? '—'),
              h('td', { className: 'n2s-small' }, r.ms),
              h('td', { className: 'n2s-small' }, r.rows ?? '—'),
              h('td', null, badge(r.status))))))))
    }

    function McpSection({ t, datasources }) {
      const st = useAsync(() => call('mcpStatus'), [])
      const [port, setPort] = useState('')
      const [busy, setBusy] = useState(false)
      const [creating, setCreating] = useState(false)
      const [editing, setEditing] = useState(null)
      const [fresh, setFresh] = useState(null) // { name, token } shown once
      useEffect(() => { if (st.value) setPort(String(st.value.port)) }, [st.value?.port])
      const s = st.value
      const when = (ms) => (ms ? new Date(ms).toLocaleString(uiLocale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : t('mcp.never'))
      const save = async (patch) => {
        setBusy(true)
        try { await call('saveMcpSettings', patch); st.reload() } catch (e) { notifyError(e) }
        setBusy(false)
      }
      const revoke = async (tok) => {
        if (!(await confirmDialog({ title: fmt(t, 'mcp.revokeConfirm', { name: tok.name }), message: t('mcp.revokeHint'), confirmLabel: t('mcp.revoke'), danger: true }))) return
        try { await call('revokeMcpToken', { id: tok.id }); if (fresh?.id === tok.id) setFresh(null); notify(t('mcp.revoked'), 'ok'); st.reload() } catch (e) { notifyError(e) }
      }
      const rotate = async (tok) => {
        if (!(await confirmDialog({ title: fmt(t, 'mcp.rotateConfirm', { name: tok.name }), message: t('mcp.rotateHint'), confirmLabel: t('mcp.rotate'), danger: true }))) return
        try { const r = await call('rotateMcpToken', { id: tok.id }); setFresh(r); notify(t('mcp.rotated'), 'ok'); st.reload() } catch (e) { notifyError(e) }
      }
      if (!s) return st.error ? h('div', { className: 'n2s-notice err' }, st.error.message) : h('div', { className: 'n2s-skel', style: { height: 200 } })
      const portDirty = port !== String(s.port)
      const toolNames = s.toolNames ?? []
      const limitsLabel = (tok) => [
        tok.expiresAt ? (tok.expired ? t('mcp.expired') : fmt(t, 'mcp.expiresOn', { date: new Date(tok.expiresAt).toLocaleDateString(uiLocale()) })) : null,
        Array.isArray(tok.tools) ? fmt(t, 'mcp.toolsN', { n: tok.tools.length }) : null,
        tok.rateLimit ? fmt(t, 'mcp.rateN', { n: tok.rateLimit }) : null,
      ].filter(Boolean)
      return h('div', { className: 'n2s-mcp' },
        h(SectionHead, { title: t('mcp.title'), desc: t('mcp.desc') }),
        h('div', { className: 'n2s-card n2s-mcp-server' },
          h('div', { className: 'n2s-row', style: { flexWrap: 'wrap', gap: 14 } },
            h('label', { className: 'n2s-switch' },
              h('input', { type: 'checkbox', role: 'switch', checked: s.enabled, disabled: busy, onChange: e => save({ enabled: e.target.checked }) }),
              h('span', null, s.enabled ? t('mcp.enabled') : t('mcp.disabled'))),
            h('span', { className: `n2s-statusdot ${s.running ? 'ok' : s.error ? 'err' : ''}`, 'data-mcp-status': s.running ? 'running' : 'stopped' }, s.running ? t('mcp.running') : t('mcp.stopped')),
            h('span', { className: 'n2s-grow' }),
            h('label', { className: 'n2s-row', style: { gap: 6 } }, h('span', { className: 'n2s-flabel' }, t('mcp.port')),
              h('input', { className: 'n2s-input n2s-mono', style: { width: 96 }, inputMode: 'numeric', value: port, 'aria-label': t('mcp.port'), onChange: e => setPort(e.target.value.replace(/\D/g, '').slice(0, 5)) }),
              portDirty && h('button', { type: 'button', className: 'n2s-btn small', disabled: busy || !port, onClick: () => save({ port: Number(port) }) }, t('mcp.applyPort')))),
          s.error && h('div', { className: 'n2s-notice err', role: 'alert', style: { marginTop: 10 } }, s.error),
          h('div', { className: 'n2s-mcp-endpoint' },
            h('span', { className: 'n2s-flabel' }, t('mcp.endpoint')),
            h('code', { className: 'n2s-mono', 'data-mcp-url': true }, s.url),
            h(McpCopy, { t, text: s.url })),
          h(McpSelfTest, { t, disabled: !s.running }),
          h('div', { className: 'n2s-faint n2s-small', style: { marginTop: 6 } }, t('mcp.localOnly'))),
        fresh && h('div', { className: 'n2s-card n2s-mcp-fresh', role: 'status' },
          h('div', { className: 'n2s-sechead-title' }, fmt(t, 'mcp.freshTitle', { name: fresh.name })),
          h('div', { className: 'n2s-notice warn', style: { margin: '8px 0' } }, t('mcp.freshHint')),
          h('div', { className: 'n2s-mcp-endpoint' }, h('code', { className: 'n2s-mono', 'data-mcp-token': true }, fresh.token), h(McpCopy, { t, text: fresh.token })),
          h(McpSnippets, { t, url: s.url, token: fresh.token }),
          h('div', { className: 'n2s-row', style: { justifyContent: 'flex-end', marginTop: 8 } }, h('button', { type: 'button', className: 'n2s-btn small', onClick: () => setFresh(null) }, t('mcp.done')))),
        h('div', { className: 'n2s-row', style: { margin: '18px 0 8px' } },
          h('div', { className: 'n2s-sechead-title n2s-grow' }, t('mcp.tokens')),
          !creating && h('button', { type: 'button', className: 'n2s-btn', onClick: () => setCreating(true) }, '+ ', t('mcp.newToken'))),
        creating && h(McpTokenForm, { t, datasources, toolNames, onCancel: () => setCreating(false), onCreated: (tok) => { setCreating(false); setFresh(tok); st.reload() } }),
        editing && h(McpTokenEditor, { key: editing.id, t, tok: editing, toolNames, onCancel: () => setEditing(null), onSaved: () => { setEditing(null); notify(t('mcp.saved'), 'ok'); st.reload() } }),
        s.tokens.length === 0 && !creating
          ? h('div', { className: 'n2s-empty' }, h('h3', null, t('mcp.noTokens')), h('div', null, t('mcp.noTokensHint')))
          : s.tokens.length > 0 && h('div', { className: 'n2s-table-wrap' }, h('table', { className: 'n2s-table n2s-mcp-tokens' },
            h('thead', null, h('tr', null, [t('mcp.col.name'), t('mcp.col.scope'), t('mcp.col.limits'), t('mcp.col.created'), t('mcp.col.lastUsed'), ''].map((x, i) => h('th', { key: i }, x)))),
            h('tbody', null, s.tokens.map(tok => h('tr', { key: tok.id, 'data-token-id': tok.id },
              h('td', null, h('div', null, tok.name), h('div', { className: 'n2s-faint n2s-small n2s-mono' }, `${tok.prefix}…`)),
              h('td', null, h(McpScopeLabel, { t, scope: tok.scope })),
              h('td', { className: 'n2s-small' }, limitsLabel(tok).length ? limitsLabel(tok).map((x, i) => h('span', { key: i, className: `n2s-badge ${tok.expired && i === 0 ? 'warn' : ''}` }, x)) : h('span', { className: 'n2s-faint' }, t('mcp.noLimits'))),
              h('td', { className: 'n2s-small' }, when(tok.createdAt)),
              h('td', { className: 'n2s-small' }, when(tok.lastUsedAt)),
              h('td', { className: 'n2s-mcp-actions' },
                h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => setEditing(tok) }, t('mcp.edit')),
                h('button', { type: 'button', className: 'n2s-btn small ghost', onClick: () => rotate(tok) }, t('mcp.rotate')),
                h('button', { type: 'button', className: 'n2s-btn small danger', onClick: () => revoke(tok) }, t('mcp.revoke')))))))),
        s.tokens.length > 0 && h(React.Fragment, null,
          h('div', { className: 'n2s-sechead-title', style: { margin: '18px 0 8px' } }, t('mcp.callLog')),
          h(McpCallLog, { t, tokens: s.tokens })),
        h('div', { className: 'n2s-sechead-title', style: { margin: '18px 0 8px' } }, t('mcp.setup')),
        h('div', { className: 'n2s-card' }, h(McpSnippets, { t, url: s.url, token: null }),
          h('div', { className: 'n2s-faint n2s-small', style: { marginTop: 8 } }, t('mcp.docsHint'))))
    }

    extend.adminSections.push({ id: 'mcp', label: (t) => t('mcp.nav'), icon: () => Icon.code(15), Component: McpSection })
    // ------------------------------------------------------------ apply

    return {
      inject: ['slots', 'locale', 'layout', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => {
          const el = document.createElement('style')
          el.dataset.plugin = PKG
          el.textContent = CSS
          document.head.appendChild(el)
          return () => el.remove()
        }, 'nl2sql: styles')
        ctx.effect(() => ctx.locale.register(NS, { zh, en, 'zh-CN': zh }), 'nl2sql: locale')
        const t = ctx.locale.bind(NS)
        // One feedback layer (toasts + confirm / prompt dialogs) for the page and every
        // tool view or reply action in conversations, mounted once outside the page.
        ctx.effect(() => mountFeedbackLayer(ctx), 'nl2sql: feedback layer')
        const Page = makePage(ctx)
        const PanelIcon = ({ size }) => Icon.db(size ?? 16)
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, Page))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, locale: NS, label: () => t('panel') }, PanelIcon))
        ctx.slots.inject('conversation.input.left', () => ctx.slots.register({ name: 'conversation.input.left', id: 'nl2sql-datasource', order: 50, locale: NS }, makeComposerControl(ctx)))
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'nl2sql_query', locale: NS }, makeToolView(ctx, 'query')))
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'nl2sql_chart', locale: NS }, makeToolView(ctx, 'chart')))
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: 'nl2sql_overview', locale: NS }, makeOverviewToolView(ctx)))
        for (const v of extend.toolViews) ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({ name: 'tool.call.toolview', key: v.key, locale: NS }, v.make(ctx)))
        ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({ name: 'conversation.chat.assistant-actions', id: 'nl2sql-send', order: 20, locale: NS }, makeReplyAction(ctx)))
      },
    }
  },
})

