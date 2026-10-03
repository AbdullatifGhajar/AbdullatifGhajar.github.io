/*
 * Liquid glass for static pages. The fragment shader is taken verbatim (except float precision)
 * from liquid-glass-js by Armagan Amcalar, MIT License:
 * https://github.com/dashersw/liquid-glass-js (commit 78cb6cc)
 *
 * Unlike the original, the glass is drawn *behind* an existing element ([data-glass]) so links,
 * focus and text selection keep working, and the page is re-captured when the layout changes.
 * Without WebGL, or when the page is too tall for one texture, the CSS frosted fallback stays.
 */
(() => {
  const VS = `
    attribute vec2 a_position;
    attribute vec2 a_texcoord;
    varying vec2 v_texcoord;
    void main() {
      gl_Position = vec4(a_position, 0, 1);
      v_texcoord = a_texcoord;
    }`

  // highp: mediump is 16-bit on mobile GPUs, too coarse for page-sized texture coordinates
  const FS = `
    precision highp float;
    uniform sampler2D u_image;
    uniform vec2 u_resolution;
      uniform vec2 u_textureSize;
      uniform float u_scrollY;
      uniform float u_pageHeight;
      uniform float u_viewportHeight;
      uniform float u_blurRadius;
      uniform float u_borderRadius;
      uniform vec2 u_containerPosition;
      uniform float u_warp;
      uniform float u_edgeIntensity;
      uniform float u_rimIntensity;
      uniform float u_baseIntensity;
      uniform float u_edgeDistance;
      uniform float u_rimDistance;
      uniform float u_baseDistance;
      uniform float u_cornerBoost;
      uniform float u_rippleEffect;
      uniform float u_tintOpacity;
    varying vec2 v_texcoord;

      // Function to calculate distance from rounded rectangle edge
      float roundedRectDistance(vec2 coord, vec2 size, float radius) {
        vec2 center = size * 0.5;
        vec2 pixelCoord = coord * size;
        vec2 toCorner = abs(pixelCoord - center) - (center - radius);
        float outsideCorner = length(max(toCorner, 0.0));
        float insideCorner = min(max(toCorner.x, toCorner.y), 0.0);
        return (outsideCorner + insideCorner - radius);
      }
      
      // Function to calculate distance from circle edge (negative inside, positive outside)
      float circleDistance(vec2 coord, vec2 size, float radius) {
        vec2 center = vec2(0.5, 0.5);
        vec2 pixelCoord = coord * size;
        vec2 centerPixel = center * size;
        float distFromCenter = length(pixelCoord - centerPixel);
        return distFromCenter - radius;
      }
      
      // Check if this is a pill (border radius is approximately 50% of height AND width > height)
      bool isPill(vec2 size, float radius) {
        float heightRatioDiff = abs(radius - size.y * 0.5);
        bool radiusMatchesHeight = heightRatioDiff < 2.0;
        bool isWiderThanTall = size.x > size.y + 4.0; // Must be significantly wider
        return radiusMatchesHeight && isWiderThanTall;
      }
      
      // Check if this is a circle (border radius is approximately 50% of smaller dimension AND roughly square)
      bool isCircle(vec2 size, float radius) {
        float minDim = min(size.x, size.y);
        bool radiusMatchesMinDim = abs(radius - minDim * 0.5) < 1.0;
        bool isRoughlySquare = abs(size.x - size.y) < 4.0; // Width and height are similar
        return radiusMatchesMinDim && isRoughlySquare;
      }
      
      // Function to calculate distance from pill edge (capsule shape)
      float pillDistance(vec2 coord, vec2 size, float radius) {
        vec2 center = size * 0.5;
        vec2 pixelCoord = coord * size;
        
        // Proper capsule: line segment with radius
        // The capsule axis runs horizontally from (radius, center.y) to (size.x - radius, center.y)
        vec2 capsuleStart = vec2(radius, center.y);
        vec2 capsuleEnd = vec2(size.x - radius, center.y);
        
        // Project point onto the capsule axis (line segment)
        vec2 capsuleAxis = capsuleEnd - capsuleStart;
        float capsuleLength = length(capsuleAxis);
        
        if (capsuleLength > 0.0) {
          vec2 toPoint = pixelCoord - capsuleStart;
          float t = clamp(dot(toPoint, capsuleAxis) / dot(capsuleAxis, capsuleAxis), 0.0, 1.0);
          vec2 closestPointOnAxis = capsuleStart + t * capsuleAxis;
          return length(pixelCoord - closestPointOnAxis) - radius;
        } else {
          // Degenerate case: just a circle
          return length(pixelCoord - center) - radius;
        }
      }

    void main() {
        vec2 coord = v_texcoord;
        
        // Calculate which area of the page should be visible through the container
        float scrollY = u_scrollY;
        vec2 containerSize = u_resolution;
        vec2 textureSize = u_textureSize;
        
        // Container position in viewport coordinates
        vec2 containerCenter = u_containerPosition + vec2(0.0, scrollY);
        
        // Convert container coordinates to page coordinates
        vec2 containerOffset = (coord - 0.5) * containerSize;
        vec2 pagePixel = containerCenter + containerOffset;
        
        // Convert to texture coordinate (0 to 1)
        vec2 textureCoord = pagePixel / textureSize;
        
        // Glass refraction effects
        float distFromEdgeShape;
        vec2 shapeNormal; // Normal vector pointing away from shape surface
        
        if (isPill(u_resolution, u_borderRadius)) {
          distFromEdgeShape = -pillDistance(coord, u_resolution, u_borderRadius);
          
          // Calculate normal for pill shape
          vec2 center = vec2(0.5, 0.5);
          vec2 pixelCoord = coord * u_resolution;
          vec2 capsuleStart = vec2(u_borderRadius, center.y * u_resolution.y);
          vec2 capsuleEnd = vec2(u_resolution.x - u_borderRadius, center.y * u_resolution.y);
          vec2 capsuleAxis = capsuleEnd - capsuleStart;
          float capsuleLength = length(capsuleAxis);
          
          if (capsuleLength > 0.0) {
            vec2 toPoint = pixelCoord - capsuleStart;
            float t = clamp(dot(toPoint, capsuleAxis) / dot(capsuleAxis, capsuleAxis), 0.0, 1.0);
            vec2 closestPointOnAxis = capsuleStart + t * capsuleAxis;
            vec2 normalDir = pixelCoord - closestPointOnAxis;
            shapeNormal = length(normalDir) > 0.0 ? normalize(normalDir) : vec2(0.0, 1.0);
          } else {
            shapeNormal = normalize(coord - center);
          }
        } else if (isCircle(u_resolution, u_borderRadius)) {
          distFromEdgeShape = -circleDistance(coord, u_resolution, u_borderRadius);
          vec2 center = vec2(0.5, 0.5);
          shapeNormal = normalize(coord - center);
        } else {
          distFromEdgeShape = -roundedRectDistance(coord, u_resolution, u_borderRadius);
      vec2 center = vec2(0.5, 0.5);
          shapeNormal = normalize(coord - center);
        }
        distFromEdgeShape = max(distFromEdgeShape, 0.0);
        
        float distFromLeft = coord.x;
        float distFromRight = 1.0 - coord.x;
        float distFromTop = coord.y;
        float distFromBottom = 1.0 - coord.y;
        float distFromEdge = distFromEdgeShape / min(u_resolution.x, u_resolution.y);
        
        // Smooth glass refraction using shape-aware normal
        float normalizedDistance = distFromEdge * min(u_resolution.x, u_resolution.y);
        float baseIntensity = 1.0 - exp(-normalizedDistance * u_baseDistance);
        float edgeIntensity = exp(-normalizedDistance * u_edgeDistance);
        float rimIntensity = exp(-normalizedDistance * u_rimDistance);
        
        // Apply center warping only if warp is enabled, keep edge and rim effects always
        float baseComponent = u_warp > 0.5 ? baseIntensity * u_baseIntensity : 0.0;
        float totalIntensity = baseComponent + edgeIntensity * u_edgeIntensity + rimIntensity * u_rimIntensity;
        
        vec2 baseRefraction = shapeNormal * totalIntensity;
        
        float cornerProximityX = min(distFromLeft, distFromRight);
        float cornerProximityY = min(distFromTop, distFromBottom);
        float cornerDistance = max(cornerProximityX, cornerProximityY);
        float cornerNormalized = cornerDistance * min(u_resolution.x, u_resolution.y);
        
        float cornerBoost = exp(-cornerNormalized * 0.3) * u_cornerBoost;
        vec2 cornerRefraction = shapeNormal * cornerBoost;
        
        vec2 perpendicular = vec2(-shapeNormal.y, shapeNormal.x);
        float rippleEffect = sin(distFromEdge * 25.0) * u_rippleEffect * rimIntensity;
        vec2 textureRefraction = perpendicular * rippleEffect;
        
        vec2 totalRefraction = baseRefraction + cornerRefraction + textureRefraction;
        textureCoord += totalRefraction;
        
        // Gaussian blur
        vec4 color = vec4(0.0);
        vec2 texelSize = 1.0 / u_textureSize;
        float sigma = u_blurRadius / 2.0;
        vec2 blurStep = texelSize * sigma;
        
        float totalWeight = 0.0;
        
        for(float i = -6.0; i <= 6.0; i += 1.0) {
          for(float j = -6.0; j <= 6.0; j += 1.0) {
            float distance = length(vec2(i, j));
            if(distance > 6.0) continue;
            
            float weight = exp(-(distance * distance) / (2.0 * sigma * sigma));
            
            vec2 offset = vec2(i, j) * blurStep;
            color += texture2D(u_image, textureCoord + offset) * weight;
            totalWeight += weight;
          }
        }
        
        color /= totalWeight;
        
        // Simple vertical gradient
        float gradientPosition = coord.y;
        vec3 topTint = vec3(1.0, 1.0, 1.0);
        vec3 bottomTint = vec3(0.7, 0.7, 0.7);
        vec3 gradientTint = mix(topTint, bottomTint, gradientPosition);
        vec3 tintedColor = mix(color.rgb, gradientTint, u_tintOpacity);
        color = vec4(tintedColor, color.a);
        
        // Sampled gradient
        vec2 viewportCenter = containerCenter;
        float topY = (viewportCenter.y - containerSize.y * 0.4) / textureSize.y;
        float midY = viewportCenter.y / textureSize.y;
        float bottomY = (viewportCenter.y + containerSize.y * 0.4) / textureSize.y;
        
        vec3 topColor = vec3(0.0);
        vec3 midColor = vec3(0.0);
        vec3 bottomColor = vec3(0.0);
        
        float sampleCount = 0.0;
        for(float x = 0.0; x < 1.0; x += 0.05) {
          for(float yOffset = -5.0; yOffset <= 5.0; yOffset += 1.0) {
            vec2 topSample = vec2(x, topY + yOffset * texelSize.y);
            vec2 midSample = vec2(x, midY + yOffset * texelSize.y);
            vec2 bottomSample = vec2(x, bottomY + yOffset * texelSize.y);
            
            topColor += texture2D(u_image, topSample).rgb;
            midColor += texture2D(u_image, midSample).rgb;
            bottomColor += texture2D(u_image, bottomSample).rgb;
            sampleCount += 1.0;
          }
        }
        
        topColor /= sampleCount;
        midColor /= sampleCount;
        bottomColor /= sampleCount;
        
        vec3 sampledGradient;
        if (gradientPosition < 0.1) {
          sampledGradient = topColor;
        } else if (gradientPosition > 0.9) {
          sampledGradient = bottomColor;
        } else {
          float transitionPos = (gradientPosition - 0.1) / 0.8;
          if (transitionPos < 0.5) {
            float t = transitionPos * 2.0;
            sampledGradient = mix(topColor, midColor, t);
          } else {
            float t = (transitionPos - 0.5) * 2.0;
            sampledGradient = mix(midColor, bottomColor, t);
          }
        }
        
        vec3 finalTinted = mix(color.rgb, sampledGradient, u_tintOpacity * 0.3);
        color = vec4(finalTinted, color.a);
        
        // Shape mask (rounded rectangle, circle, or pill)
        float maskDistance;
        if (isPill(u_resolution, u_borderRadius)) {
          maskDistance = pillDistance(coord, u_resolution, u_borderRadius);
        } else if (isCircle(u_resolution, u_borderRadius)) {
          maskDistance = circleDistance(coord, u_resolution, u_borderRadius);
        } else {
          maskDistance = roundedRectDistance(coord, u_resolution, u_borderRadius);
        }
        float mask = 1.0 - smoothstep(-1.0, 1.0, maskDistance);
        
        gl_FragColor = vec4(color.rgb, mask);
      }
    `

  const PARAMS = {
    u_blurRadius: 6,
    u_edgeIntensity: 0.01,
    u_rimIntensity: 0.05,
    u_baseIntensity: 0.01,
    u_edgeDistance: 0.15,
    u_rimDistance: 0.8,
    u_baseDistance: 0.1,
    u_cornerBoost: 0.02,
    u_rippleEffect: 0.1,
    u_warp: 0
  }

  const instances = []
  // Refraction offsets are fractions of the page, not the element, so small glass samples far outside
  // itself; data-glass-refraction scales these down for it
  const SCALED = ['u_edgeIntensity', 'u_rimIntensity', 'u_baseIntensity', 'u_cornerBoost', 'u_rippleEffect']

  // Ranges from the randomizer in liquid-glass-js's controls.js; tint capped so light text stays readable
  const random = (min, max) => min + Math.random() * (max - min)
  function shuffle() {
    const params = {
      u_edgeIntensity: random(0.005, 0.03),
      u_rimIntensity: random(0.02, 0.15),
      u_baseIntensity: random(0.005, 0.03),
      u_edgeDistance: random(0.1, 0.4),
      u_rimDistance: random(0.3, 1.5),
      u_baseDistance: random(0.08, 0.25),
      u_cornerBoost: random(0.01, 0.06),
      u_rippleEffect: random(0.05, 0.3),
      u_blurRadius: random(2, 12),
      u_tintOpacity: random(0.05, 0.3),
      u_warp: Math.random() < 0.3 ? 1 : 0
    }
    instances.forEach(g => g.set(params))
  }

  class Glass {
    constructor(host) {
      this.host = host
      this.canvas = document.createElement('canvas')
      this.canvas.className = 'lg-canvas'
      this.canvas.setAttribute('aria-hidden', 'true')
      host.prepend(this.canvas)
      const gl = (this.gl = this.canvas.getContext('webgl', { premultipliedAlpha: false }))
      if (!gl) throw new Error('WebGL unavailable')

      const program = gl.createProgram()
      for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]) {
        const shader = gl.createShader(type)
        gl.shaderSource(shader, src)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader))
        gl.attachShader(program, shader)
      }
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
      gl.useProgram(program)
      this.loc = name => gl.getUniformLocation(program, name)

      const attrib = (name, data) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW)
        const loc = gl.getAttribLocation(program, name)
        gl.enableVertexAttribArray(loc)
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
      }
      attrib('a_position', [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1])
      attrib('a_texcoord', [0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0])

      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
      for (const [k, v] of [
        [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
        [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
        [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]
      ]) gl.texParameteri(gl.TEXTURE_2D, k, v)

      this.refraction = parseFloat(host.dataset.glassRefraction) || 1
      this.set(PARAMS)
      gl.uniform1f(this.loc('u_tintOpacity'), parseFloat(host.dataset.glass) || 0.1)
      this.last = ''
    }

    set(params) {
      for (const [name, value] of Object.entries(params)) {
        this.gl.uniform1f(this.loc(name), SCALED.includes(name) ? value * this.refraction : value)
      }
      this.last = ''
    }

    setSnapshot(image) {
      const gl = this.gl
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
      gl.uniform2f(this.loc('u_textureSize'), image.width, image.height)
      this.last = ''
    }

    // Cheap when nothing moved: in-flow glass only redraws on layout change, fixed glass on scroll.
    render() {
      const r = this.host.getBoundingClientRect()
      const w = Math.round(r.width)
      const h = Math.round(r.height)
      const key = `${w},${h},${r.left},${r.top + scrollY}`
      if (key === this.last || !w || !h) return
      this.last = key

      const gl = this.gl
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w
        this.canvas.height = h
        gl.viewport(0, 0, w, h)
      }
      const radius = parseFloat(getComputedStyle(this.host).borderTopLeftRadius) || 0
      gl.uniform2f(this.loc('u_resolution'), w, h)
      gl.uniform1f(this.loc('u_borderRadius'), Math.min(radius, h / 2, w / 2))
      gl.uniform1f(this.loc('u_scrollY'), scrollY)
      gl.uniform2f(this.loc('u_containerPosition'), r.left + w / 2, r.top + h / 2)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }
  }

  async function capture() {
    const page = await html2canvas(document.body, {
      scale: 1,
      backgroundColor: null,
      logging: false,
      scrollX: 0,
      scrollY: 0,
      windowWidth: document.documentElement.clientWidth,
      // Hide, don't remove: removing glass elements from the clone would reflow everything below them.
      // lg-snapshot lets the page restyle what html2canvas can't render.
      onclone: doc => {
        doc.documentElement.classList.add('lg-snapshot')
        doc.querySelectorAll('[data-glass]').forEach(el => (el.style.visibility = 'hidden'))
      }
    })
    instances.forEach(g => g.setSnapshot(page))
  }

  function loop() {
    instances.forEach(g => g.render())
    requestAnimationFrame(loop)
  }

  async function start() {
    if (!window.html2canvas || matchMedia('(prefers-reduced-transparency: reduce)').matches) return
    await document.fonts.ready

    const probe = document.createElement('canvas').getContext('webgl')
    const maxTexture = probe ? probe.getParameter(probe.MAX_TEXTURE_SIZE) : 0
    if (document.documentElement.scrollHeight > maxTexture) return

    try {
      document.querySelectorAll('[data-glass]').forEach(el => instances.push(new Glass(el)))
      await capture()
    } catch (err) {
      console.warn('Liquid glass disabled:', err)
      instances.forEach(g => g.canvas.remove())
      instances.length = 0
      return
    }
    document.documentElement.classList.add('lg-on')
    document.querySelectorAll('[data-glass-shuffle]').forEach(btn => btn.addEventListener('click', shuffle))
    loop()

    let timer
    let width = innerWidth
    addEventListener('resize', () => {
      // Mobile browsers fire resize when the URL bar collapses; only width changes reflow the page
      if (innerWidth === width) return
      width = innerWidth
      clearTimeout(timer)
      timer = setTimeout(capture, 300)
    })
  }

  if (document.readyState === 'complete') start()
  else addEventListener('load', start)
})()
