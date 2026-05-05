// IMPT Swarm Widget — React example
//
// Drop this into any React 18+ project. Loads the widget script once,
// then mounts an instance into the host div.
//
// Usage:
//   <ImptSwarm partnerKey="YOUR_KEY" dest="Dublin" />

import { useEffect, useRef } from 'react'

const SCRIPT_SRC = 'https://swarm.impt.io/widget.js'

function loadScript() {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.ImptSwarm) return Promise.resolve()
  if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) return new Promise((res) => {
    const s = document.querySelector(`script[src="${SCRIPT_SRC}"]`)
    s.addEventListener('load', res, { once: true })
  })
  return new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = SCRIPT_SRC
    s.async = true
    s.onload = res
    s.onerror = rej
    document.head.appendChild(s)
  })
}

export function ImptSwarm({ partnerKey, dest, cause = 'trees', title }) {
  const ref = useRef(null)

  useEffect(() => {
    let cancelled = false
    loadScript().then(() => {
      if (cancelled || !ref.current || !window.ImptSwarm) return
      window.ImptSwarm.mount(ref.current, { key: partnerKey, dest, cause, title })
    })
    return () => { cancelled = true }
  }, [partnerKey, dest, cause, title])

  return <div ref={ref} />
}
