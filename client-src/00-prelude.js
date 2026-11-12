window.__ModuleLoader__.load({
  id: '@hedeqiang/dsh-nl2sql',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback, useSyncExternalStore } = React

    const PKG = '@hedeqiang/dsh-nl2sql'
    const PANEL_ID = 'nl2sql'
    const NS = 'nl2sql'
    const PRESET = 'nl2sql'
    const RPC_ROUTE = 'api/nl2sql.rpc'

