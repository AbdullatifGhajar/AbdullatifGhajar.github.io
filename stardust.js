/*
 * Stardust cursor: fine dust carried on the pointer's wake, with a puff on click. Own take on the idea
 * behind React Bits Pro's Stardust Cursor (closed source); a swirling sine flow field stands in for its
 * fluid simulation. The canvas sits at z-index -1, so text, cards and buttons always paint over it.
 */
(() => {
  const canvas = document.querySelector('.stardust')
  if (!canvas || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const ctx = canvas.getContext('2d')

  const MAX = 20000
  const LIFE = 2.4 // seconds
  const DENSITY = 3 // grains per px of pointer travel
  const RADIUS = 252 // px the wake spawns across
  const DRAG = 0.94 // velocity kept per 60 Hz frame
  const OPACITY = 0.45
  const CYCLE = 900 // px of pointer travel from one colour to the next
  const COLORS = [[95, 214, 138], [90, 184, 255], [167, 139, 250]] // --accent, --accent-2, --accent-3
  // Colour and alpha are quantised so a frame is a few dozen fills instead of one per grain
  const HUES = COLORS.length * 4
  const ALPHAS = 8

  const palette = Array.from({ length: HUES }, (_, i) => {
    const t = (i / HUES) * COLORS.length
    const a = COLORS[Math.floor(t)]
    const b = COLORS[(Math.floor(t) + 1) % COLORS.length]
    const f = t % 1
    return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f))})`
  })
  const buckets = Array.from({ length: HUES * ALPHAS }, () => [])

  const x = new Float32Array(MAX)
  const y = new Float32Array(MAX)
  const vx = new Float32Array(MAX)
  const vy = new Float32Array(MAX)
  const age = new Float32Array(MAX)
  const life = new Float32Array(MAX)
  const size = new Float32Array(MAX)
  const hue = new Uint8Array(MAX)
  const seed = new Float32Array(MAX) // per-grain phase, so neighbours don't fade in lockstep
  let count = 0

  const jitter = s => (Math.random() - 0.5) * s

  function spawn(px, py, dx, dy, h) {
    if (count === MAX) return
    const i = count++
    x[i] = px
    y[i] = py
    vx[i] = dx
    vy[i] = dy
    age[i] = 0
    life[i] = LIFE * (0.35 + Math.random() * 0.65)
    size[i] = 1 + Math.random() * 1.4
    hue[i] = h
    seed[i] = Math.random() * Math.PI * 2
  }

  function kill(i) {
    const j = --count
    x[i] = x[j]
    y[i] = y[j]
    vx[i] = vx[j]
    vy[i] = vy[j]
    age[i] = age[j]
    life[i] = life[j]
    size[i] = size[j]
    hue[i] = hue[j]
    seed[i] = seed[j]
  }

  let px
  let py
  let travel = 0
  const currentHue = () => Math.floor((travel / CYCLE) * (HUES / COLORS.length)) % HUES

  // Velocities are in px per 60 Hz frame; pointer deltas arrive at roughly that rate
  addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return
    if (px !== undefined) {
      const dx = e.clientX - px
      const dy = e.clientY - py
      const dist = Math.hypot(dx, dy)
      const h = currentHue()
      for (let k = Math.min(dist * DENSITY, 600); k > 0; k--) {
        const t = Math.random()
        spawn(px + dx * t + jitter(RADIUS), py + dy * t + jitter(RADIUS), dx * 0.15 + jitter(3), dy * 0.15 + jitter(3), h)
      }
      travel += dist
      wake()
    }
    px = e.clientX
    py = e.clientY
  }, { passive: true })

  // Puff: a burst outwards in every direction, which the flow then breaks up
  addEventListener('pointerdown', e => {
    if (e.button !== 0) return
    const h = currentHue()
    for (let k = 0; k < 1200; k++) {
      const a = Math.random() * Math.PI * 2
      // Wake grains land within RADIUS / 2 of the pointer; drag stops a grain after v / (1 - DRAG) px,
      // so this reaches RADIUS: twice the hover radius. sqrt fills the disc evenly
      const s = Math.sqrt(Math.random()) * RADIUS * (1 - DRAG)
      spawn(e.clientX + jitter(10), e.clientY + jitter(10), Math.cos(a) * s, Math.sin(a) * s, h)
    }
    wake()
  }, { passive: true })

  let dpr
  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2)
    canvas.width = Math.round(innerWidth * dpr)
    canvas.height = Math.round(innerHeight * dpr)
  }
  resize()
  addEventListener('resize', resize)

  let running = false
  let last
  let lastScroll

  function wake() {
    if (running) return
    running = true
    last = performance.now()
    lastScroll = scrollY
    requestAnimationFrame(frame)
  }

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.05)
    const f = dt * 60
    const t = now / 1000
    last = now
    const drag = Math.pow(DRAG, f)
    // Dust belongs to the page, so it scrolls with it
    const scrolled = scrollY - lastScroll
    lastScroll = scrollY

    // Backwards, so the grain kill() swaps in has already been stepped
    for (let i = count - 1; i >= 0; i--) {
      age[i] += dt
      if (age[i] >= life[i]) {
        kill(i)
        continue
      }
      // (sin y, cos x) is divergence-free: dust curls into eddies instead of bunching up. It grips
      // older grains harder, so the wake billows out as it fades. A second layer at unrelated
      // frequencies keeps the eddies from tiling; the seed varies each grain's phase and grip
      const swirl = (0.05 + 0.2 * age[i] / life[i]) * (0.5 + seed[i] / Math.PI) * f
      vx[i] = vx[i] * drag + (Math.sin(y[i] * 0.02 + t * 0.7) + 0.7 * Math.sin(y[i] * 0.047 - t * 1.3 + seed[i])) * swirl
      vy[i] = vy[i] * drag + (Math.cos(x[i] * 0.02 - t * 0.6) + 0.7 * Math.cos(x[i] * 0.033 + t * 1.1 + seed[i])) * swirl
      x[i] += vx[i] * f
      y[i] += vy[i] * f - scrolled
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, innerWidth, innerHeight)
    ctx.globalCompositeOperation = 'lighter'
    for (let i = 0; i < count; i++) {
      const fade = 1 - age[i] / life[i]
      buckets[hue[i] * ALPHAS + Math.min(ALPHAS - 1, Math.floor(fade * ALPHAS))].push(i)
    }
    buckets.forEach((list, b) => {
      if (!list.length) return
      ctx.globalAlpha = (((b % ALPHAS) + 1) / ALPHAS) * OPACITY
      ctx.fillStyle = palette[Math.floor(b / ALPHAS)]
      ctx.beginPath()
      for (const i of list) {
        // Grains spread a little as they age
        const s = size[i] * (1 + age[i] * 0.3)
        ctx.rect(x[i] - s / 2, y[i] - s / 2, s, s)
      }
      ctx.fill()
      list.length = 0
    })

    if (count) requestAnimationFrame(frame)
    else running = false
  }
})()
