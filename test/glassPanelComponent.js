// glassPanelComponent.js - Physical Glass with Screen-Space Refraction
// Each panel samples the background video at its actual screen position,
// so refraction correctly shows what's behind THAT specific panel.

async function createGlassPanel(userOptions = {}) {
  async function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) return res();
      const s = document.createElement('script');
      s.src = src;
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  if (!window.THREE) {
    await loadScript('https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js');
  }

  const defaults = {
    attachToElement: null,
    container: document.body,
    borderRadius: 44,
    resolutionMultiplier: 1.0,
    // Glass optics - tuned for subtle but visible refraction
    ior: 1.52,
    thickness: 4.2,
    absorption: 0.022,
    dispersion: 0.05,
    curvature: 0.004,
    refractionStrength: 0.08,
    tiltAmount: 0.04,
    mouseInfluence: 1.0,
    zIndex: 0,
    pointerEvents: 'none',
    videoElement: null,
  };
  const opts = Object.assign({}, defaults, userOptions);

  const element = opts.attachToElement;
  if (!element) throw new Error('attachToElement is required');

  if (getComputedStyle(element).position === 'static') {
    element.style.position = 'relative';
  }

  // Canvas sits behind content inside the panel
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `
    width:100%; height:100%; display:block; position:absolute;
    inset:0; z-index:${opts.zIndex}; border-radius:inherit; pointer-events:${opts.pointerEvents};
  `;
  element.insertBefore(canvas, element.firstChild);

  const elW = element.clientWidth;
  const elH = element.clientHeight;
  const W = Math.max(1, Math.floor(elW * opts.resolutionMultiplier));
  const H = Math.max(1, Math.floor(elH * opts.resolutionMultiplier));
  canvas.width = W;
  canvas.height = H;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setSize(W, H, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  // Video texture — shared across all panels
  let videoTexture = null;
  const videoElement = opts.videoElement || document.querySelector('video.background-video');
  if (videoElement) {
    videoTexture = new THREE.VideoTexture(videoElement);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    videoTexture.generateMipmaps = false;
    videoTexture.colorSpace = THREE.SRGBColorSpace;
  }

  // Fullscreen quad
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new THREE.PlaneGeometry(2, 2);

  const glassMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uBackground: { value: videoTexture },
      uResolution: { value: new THREE.Vector2(elW, elH) },
      // Screen-space mapping: where this panel sits relative to the full viewport
      uScreenOffset: { value: new THREE.Vector2(0, 0) },
      uScreenScale: { value: new THREE.Vector2(1, 1) },
      uOverlayColor: { value: new THREE.Vector3(16 / 255, 16 / 255, 26 / 255) },
      uOverlayAlpha: { value: 0.4 },
      // Glass optics
      uIOR: { value: opts.ior },
      uThickness: { value: opts.thickness },
      uAbsorption: { value: opts.absorption },
      uDispersion: { value: opts.dispersion },
      uCurvature: { value: opts.curvature },
      uRefractionStrength: { value: opts.refractionStrength },
      uTiltAmount: { value: opts.tiltAmount },
      uMouseInfluence: { value: opts.mouseInfluence },
      uBorderRadius: { value: opts.borderRadius },
      uAspect: { value: elW / elH },
      uTime: { value: 0 },
      uMouse: { value: new THREE.Vector2(0, 0) },
      uHover: { value: 0.0 },
      // Video aspect correction
      uVideoAspect: { value: 16 / 9 },
      uViewportAspect: { value: window.innerWidth / window.innerHeight },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying vec2 vUv;

      uniform sampler2D uBackground;
      uniform vec2 uResolution;
      uniform vec2 uScreenOffset;
      uniform vec2 uScreenScale;
      uniform vec3 uOverlayColor;
      uniform float uOverlayAlpha;
      uniform float uIOR;
      uniform float uThickness;
      uniform float uAbsorption;
      uniform float uDispersion;
      uniform float uCurvature;
      uniform float uRefractionStrength;
      uniform float uTiltAmount;
      uniform float uMouseInfluence;
      uniform float uBorderRadius;
      uniform float uAspect;
      uniform float uTime;
      uniform vec2 uMouse;
      uniform float uHover;
      uniform float uVideoAspect;
      uniform float uViewportAspect;

      // ── Rounded rect SDF ──
      float roundedBoxSDF(vec2 p, vec2 b, float r) {
        vec2 d = abs(p) - b + r;
        return length(max(d, 0.0)) - r + min(max(d.x, d.y), 0.0);
      }

      float panelMask(vec2 uv) {
        vec2 p = (uv - 0.5) * uResolution;
        vec2 halfSize = uResolution * 0.5;
        float d = roundedBoxSDF(p, halfSize, uBorderRadius);
        return 1.0 - smoothstep(-2.0, 1.0, d);
      }

      // ── Schlick Fresnel ──
      float fresnel(float cosTheta, float ior) {
        float r0 = pow((1.0 - ior) / (1.0 + ior), 2.0);
        return r0 + (1.0 - r0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
      }

      // ── Map panel UV → video UV (cover-fit, accounts for panel's screen position) ──
      vec2 panelToVideoUV(vec2 panelUV) {
        // Panel UV → screen UV (where this pixel is on the full viewport)
        vec2 screenUV = uScreenOffset + panelUV * uScreenScale;

        // Screen UV → video UV with cover-fit aspect correction
        // Same math as CSS object-fit: cover
        vec2 videoUV = screenUV;
        if (uViewportAspect > uVideoAspect) {
          // Viewport wider than video: video fills width, crops top/bottom
          float scale = uVideoAspect / uViewportAspect;
          videoUV.y = (videoUV.y - 0.5) * scale + 0.5;
        } else {
          // Viewport taller than video: video fills height, crops sides
          float scale = uViewportAspect / uVideoAspect;
          videoUV.x = (videoUV.x - 0.5) * scale + 0.5;
        }
        return videoUV;
      }

      // ── Curved surface normal with beveled edge/corners ──
      vec3 getSurfaceNormal(vec2 uv) {
        vec2 centered = (uv - 0.5) * 2.0;
        float dist = length(centered);

        // Exponential bevel curvature at edges and corners (reduced intensity)
        float bevel = pow(clamp(dist * 0.85, 0.0, 1.0), 3.0) * 0.32;

        // Mouse tilt
        vec2 tilt = uMouse * uTiltAmount * uMouseInfluence;

        // Combined normal deflection
        float nx = (-centered.x * (uCurvature * 20.0 + bevel)) * uAspect + tilt.x;
        float ny = -centered.y * (uCurvature * 20.0 + bevel) + tilt.y;

        return normalize(vec3(nx, ny, 1.0));
      }

      // ── Beer-Lambert absorption ──
      vec3 applyAbsorption(vec3 color, float pathLength, float coeff) {
        vec3 absorb = vec3(coeff * 1.2, coeff * 0.3, coeff * 1.0);
        return color * exp(-absorb * pathLength);
      }

      // ── Sample background with overlay baked in ──
      vec3 sampleBG(vec2 videoUV) {
        vec3 bg = texture2D(uBackground, clamp(videoUV, 0.0, 1.0)).rgb;
        // Apply the dark overlay (matches .background-overlay CSS)
        bg = mix(bg, uOverlayColor, uOverlayAlpha);
        return bg;
      }

      void main() {
        float mask = panelMask(vUv);
        if (mask < 0.001) discard;

        vec3 N = getSurfaceNormal(vUv);
        vec3 V = vec3(0.0, 0.0, 1.0);
        float cosTheta = max(dot(V, N), 0.0);

        // ── Chromatic refraction: different IOR per channel ──
        float iorR = uIOR - uDispersion;
        float iorG = uIOR;
        float iorB = uIOR + uDispersion;

        vec3 refR = refract(-V, N, 1.0 / iorR);
        vec3 refG = refract(-V, N, 1.0 / iorG);
        vec3 refB = refract(-V, N, 1.0 / iorB);

        // Make refraction stronger at edges and corners
        vec2 centered = (vUv - 0.5) * 2.0;
        float distFromCenter = length(centered);
        // Reduced edge boost: center = 1.0, edges = ~2.0
        float edgeBoost = 1.0 + distFromCenter * distFromCenter * 1.3;

        float strength = uRefractionStrength * uThickness * edgeBoost;

        // Offset in panel UV space, then convert to video UV
        vec2 uvR = panelToVideoUV(vUv + refR.xy * strength);
        vec2 uvG = panelToVideoUV(vUv + refG.xy * strength);
        vec2 uvB = panelToVideoUV(vUv + refB.xy * strength);

        float r = sampleBG(uvR).r;
        float g = sampleBG(uvG).g;
        float b = sampleBG(uvB).b;
        vec3 refracted = vec3(r, g, b);

        // ── Absorption ──
        float pathLength = uThickness / max(cosTheta, 0.05);
        refracted = applyAbsorption(refracted, pathLength, uAbsorption);

        // ── Fresnel ──
        float F = fresnel(cosTheta, uIOR);
        vec3 reflectionColor = vec3(0.88, 0.90, 1.0);

        // Subtle iridescent edge shimmer
        float edgeDist = length((vUv - 0.5) * 2.0);
        float hue = edgeDist * 3.0 + uTime * 0.2;
        reflectionColor += 0.06 * vec3(
          sin(hue),
          sin(hue + 2.094),
          sin(hue + 4.189)
        );

        // ── Specular highlights tracking mouse ──
        // Map mouse [-1,1] directly to UV space [0,1]
        vec2 mouseUV = uMouse * 0.5 + 0.5;

        // Primary specular: tight, bright, follows cursor exactly
        vec2 specPos = (vUv - mouseUV) * vec2(uAspect, 1.0);
        float specDist = length(specPos);
        float specular = exp(-specDist * specDist * 35.0) * 0.4 * uHover;

        // Secondary broader glow around cursor
        float specular2 = exp(-specDist * specDist * 8.0) * 0.1 * uHover;

        // ── Inner edge glow ──
        float edgeMask = 1.0 - mask;
        float innerEdge = smoothstep(0.04, 0.0, edgeMask);
        vec3 edgeGlow = vec3(1.0, 0.97, 0.94) * innerEdge * 0.18;
        // Brighter along top edge
        edgeGlow += vec3(1.0) * smoothstep(0.5, 0.0, vUv.y) * innerEdge * 0.12;

        // ── Combine ──
        vec3 color = mix(refracted, reflectionColor, F * 0.35);
        color += edgeGlow;
        color += vec3(1.0, 0.98, 0.95) * specular;
        color += vec3(0.95, 0.97, 1.0) * specular2;

        // Caustics at grazing angles
        float grazing = pow(1.0 - cosTheta, 4.0);
        color += vec3(1.0, 0.96, 0.9) * grazing * 0.06;

        // Dim the panel slightly (subtle darkening filter)
        color *= 0.92;

        // ── Alpha: glass is mostly see-through ──
        float alpha = mask * (0.94 + F * 0.06);
        alpha = max(alpha, specular * mask);
        alpha *= smoothstep(0.0, 0.015, mask);

        gl_FragColor = vec4(color, alpha);
      }
    `
  });

  const mesh = new THREE.Mesh(geometry, glassMaterial);
  scene.add(mesh);

  // --- State ---
  let running = true;
  let last = performance.now();
  let targetMouse = { x: 0, y: 0 };
  let smoothMouse = { x: 0, y: 0 };
  let isHovering = false;
  let targetHover = 0.0;
  let smoothHover = 0.0;

  // --- Update screen-space mapping each frame ---
  function updateScreenMapping() {
    const rect = element.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Where this panel's top-left sits in normalized viewport coords
    // Flip Y because UV 0,0 is bottom-left in GL but top-left in DOM
    glassMaterial.uniforms.uScreenOffset.value.set(
      rect.left / vw,
      1.0 - (rect.bottom / vh)
    );
    // How much of the viewport this panel covers
    glassMaterial.uniforms.uScreenScale.value.set(
      rect.width / vw,
      rect.height / vh
    );

    glassMaterial.uniforms.uViewportAspect.value = vw / vh;

    // Get actual video aspect if available
    if (videoElement && videoElement.videoWidth > 0) {
      glassMaterial.uniforms.uVideoAspect.value = videoElement.videoWidth / videoElement.videoHeight;
    }
  }

  // --- Animation loop ---
  function animate(now) {
    if (!running) return;
    if (document.hidden) {
      requestAnimationFrame(animate);
      return;
    }
    requestAnimationFrame(animate);

    const dt = (now - last) / 1000;
    last = now;

    glassMaterial.uniforms.uTime.value += dt;

    // Smooth mouse & hover
    const lerp = 1.0 - Math.pow(0.0005, dt);
    smoothMouse.x += (targetMouse.x - smoothMouse.x) * lerp;
    smoothMouse.y += (targetMouse.y - smoothMouse.y) * lerp;
    smoothHover += (targetHover - smoothHover) * lerp;

    glassMaterial.uniforms.uMouse.value.set(smoothMouse.x, smoothMouse.y);
    glassMaterial.uniforms.uHover.value = smoothHover;

    // Update screen position mapping every frame (handles scroll, resize, etc.)
    updateScreenMapping();

    renderer.clear();
    renderer.render(scene, camera);
  }
  requestAnimationFrame(animate);

  // --- Mouse tracking (only when hovering this specific panel) ---
  const onMove = (ev) => {
    if (!isHovering) return;
    const rect = element.getBoundingClientRect();
    targetMouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    // Flip Y: DOM has Y=0 at top, GL has Y=0 at bottom
    targetMouse.y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
  };

  const onEnter = (ev) => {
    isHovering = true;
    targetHover = 1.0;
    const rect = element.getBoundingClientRect();
    targetMouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    targetMouse.y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
  };

  const onLeave = () => {
    isHovering = false;
    targetHover = 0.0;
    targetMouse.x = 0;
    targetMouse.y = 0;
  };

  element.addEventListener('mouseenter', onEnter);
  element.addEventListener('mouseleave', onLeave);
  element.addEventListener('mousemove', onMove);

  // --- Resize ---
  const resizeObserver = new ResizeObserver(() => {
    const newW = element.clientWidth;
    const newH = element.clientHeight;
    if (newW === 0 || newH === 0) return;

    const rW = Math.max(1, Math.floor(newW * opts.resolutionMultiplier));
    const rH = Math.max(1, Math.floor(newH * opts.resolutionMultiplier));

    canvas.width = rW;
    canvas.height = rH;
    renderer.setSize(rW, rH, false);

    glassMaterial.uniforms.uResolution.value.set(newW, newH);
    glassMaterial.uniforms.uAspect.value = newW / newH;
  });
  resizeObserver.observe(element);

  // --- API ---
  function setOptions(newOpts = {}) {
    Object.assign(opts, newOpts);
    const map = {
      ior: 'uIOR', thickness: 'uThickness', absorption: 'uAbsorption',
      dispersion: 'uDispersion', curvature: 'uCurvature', tiltAmount: 'uTiltAmount',
      mouseInfluence: 'uMouseInfluence', borderRadius: 'uBorderRadius',
      refractionStrength: 'uRefractionStrength',
    };
    for (const [key, uniform] of Object.entries(map)) {
      if (key in newOpts) glassMaterial.uniforms[uniform].value = newOpts[key];
    }
  }

  function show() {
    canvas.style.display = 'block';
    running = true;
    last = performance.now();
    animate(last);
  }

  function hide() {
    canvas.style.display = 'none';
    running = false;
  }

  function destroy() {
    running = false;
    element.removeEventListener('mouseenter', onEnter);
    element.removeEventListener('mouseleave', onLeave);
    element.removeEventListener('mousemove', onMove);
    resizeObserver.disconnect();
    if (videoTexture) videoTexture.dispose();
    glassMaterial.dispose();
    geometry.dispose();
    renderer.dispose();
    if (canvas.parentElement) canvas.remove();
  }

  return { element, canvas, setOptions, show, hide, destroy, material: glassMaterial, mesh, renderer };
}

window.createGlassPanel = createGlassPanel;
