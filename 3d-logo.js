
/*
  Transição por scroll: a logo 3D vem do fundo de um túnel de grade,
  gira, para no centro e depois passa voando pela câmera.
  O progresso (0 → 1) vem da posição da seção na tela.
*/

(function () {
'use strict';

const section = document.getElementById('modelo');
const container = document.getElementById('logo-canvas');
const quote = document.getElementById('logoQuote');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const MODEL_URL = 'model/logo.glb';
const FALLBACK_LOGO_URL = 'img/logo-sem-fundo.png';
/*GLB_SOURCE*/ const getModelBuffer = () => fetch(MODEL_URL).then(res => {
  if (!res.ok) throw new Error('Modelo não encontrado: ' + MODEL_URL);
  return res.arrayBuffer();
});

/*
  Remove texturas e extensões do GLB antes de carregar.
  O material é substituído por um brilho azul, então a textura não é usada,
  e decodificá-la exige requisições extras que alguns ambientes bloqueiam
  (uma textura que falha derruba o carregamento do modelo inteiro).
*/
function stripTextures(buffer) {
  try {
    const dv = new DataView(buffer);
    if (dv.getUint32(0, true) !== 0x46546c67) return buffer; // não é um GLB
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLen)));
    delete json.textures;
    delete json.images;
    delete json.samplers;
    json.extensionsUsed = (json.extensionsUsed || []).filter(e => e !== 'KHR_materials_volume');
    (json.materials || []).forEach(mat => {
      const pbr = mat.pbrMetallicRoughness;
      if (pbr) { delete pbr.baseColorTexture; delete pbr.metallicRoughnessTexture; }
      delete mat.normalTexture; delete mat.occlusionTexture; delete mat.emissiveTexture;
      delete mat.extensions;
    });
    const text = new TextEncoder().encode(JSON.stringify(json));
    const padded = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(0x20);
    padded.set(text);
    const rest = new Uint8Array(buffer, 20 + jsonLen);
    const out = new Uint8Array(20 + padded.length + rest.length);
    out.set(new Uint8Array(buffer, 0, 20));
    out.set(padded, 20);
    out.set(rest, 20 + padded.length);
    const odv = new DataView(out.buffer);
    odv.setUint32(8, out.length, true);
    odv.setUint32(12, padded.length, true);
    return out.buffer;
  } catch (e) {
    return buffer;
  }
}

const clamp01 = v => Math.min(1, Math.max(0, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
const easeInCubic = t => t * t * t;
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

let started = false;
let visible = false;
let running = false;
let renderFrame = () => {};

function init() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000509, 22, 62);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 120);
  camera.position.z = 15;

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.physicallyCorrectLights = true; // mesma convenção de luz das versões novas
  container.appendChild(renderer.domElement);

  // luzes seguem a logo para ela brilhar em qualquer profundidade
  const lightRig = new THREE.Group();
  scene.add(lightRig);
  lightRig.add(new THREE.AmbientLight(0x2a8fd0, 1.5));
  const cyanLight = new THREE.PointLight(0x2de2ff, 80, 100);
  cyanLight.decay = 2;
  cyanLight.position.set(6, 4, 8);
  lightRig.add(cyanLight);
  const blueLight = new THREE.PointLight(0x0052ff, 70, 100);
  blueLight.decay = 2;
  blueLight.position.set(-7, -3, 6);
  lightRig.add(blueLight);

  // ---- piso em grade (estilo Tron) ----
  const CELL = 2;
  const grid = new THREE.GridHelper(140, 70, 0x2de2ff, 0x0a6fb0);
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  grid.position.set(0, -4.6, -35);
  scene.add(grid);

  // ---- riscos de luz cruzando o túnel ----
  const STREAKS = 150;
  const SPAN = 110;
  const streakData = [];
  for (let i = 0; i < STREAKS; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 4.5 + Math.random() * 10;
    streakData.push({
      x: Math.cos(angle) * radius,
      y: Math.max(-4.2, Math.sin(angle) * radius * 0.6),
      z0: Math.random() * SPAN
    });
  }
  const streakGeo = new THREE.BufferGeometry();
  const streakPos = new Float32Array(STREAKS * 6);
  streakGeo.setAttribute('position', new THREE.BufferAttribute(streakPos, 3));
  const streakMat = new THREE.LineBasicMaterial({
    color: 0x2de2ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false
  });
  const streaks = new THREE.LineSegments(streakGeo, streakMat);
  streaks.frustumCulled = false;
  scene.add(streaks);

  // ---- logo ----
  const anchor = new THREE.Group();
  scene.add(anchor);
  const fills = [];
  const outlines = [];

  let maxDim = 1;
  let pointerX = 0;
  let pointerY = 0;
  let fitScale = 1;

  function fit() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const visibleH = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const visibleW = visibleH * camera.aspect;
    const target = Math.min(visibleH * 0.52, visibleW * 0.7);
    fitScale = target / maxDim;
    anchor.scale.setScalar(fitScale);
    if (reduceMotion) renderFrame();
  }

  // plano B: se o GLB falhar, mostra a logo em PNG (também gira e cruza a câmera)
  function addFallbackLogo() {
    new THREE.TextureLoader().load(FALLBACK_LOGO_URL, tex => {
      const aspect = tex.image.height / tex.image.width;
      const mat = new THREE.MeshBasicMaterial({
        map: tex, color: 0x9be9ff, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide, fog: false
      });
      anchor.add(new THREE.Mesh(new THREE.PlaneGeometry(1, aspect), mat));
      fills.push({ m: mat, max: 0.95 });
      maxDim = Math.max(1, aspect);
      fit();
    }, undefined, err => console.error('Erro ao carregar a logo de reserva.', err));
  }

  getModelBuffer()
    .then(buffer => new Promise((resolve, reject) => {
      new THREE.GLTFLoader().parse(stripTextures(buffer), '', resolve, reject);
    }))
    .then(gltf => {
      const model = gltf.scene;
      // o logo.glb foi exportado com a face voltada para o eixo X: gira para encarar a câmera
      model.rotation.y = -Math.PI / 2;
      model.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      maxDim = Math.max(size.x, size.y, size.z) || 1;
      model.position.sub(center);

      model.traverse(child => {
        if (!child.isMesh) return;
        const fill = new THREE.MeshStandardMaterial({
          color: 0x9be9ff,
          emissive: 0x0077ff,
          emissiveIntensity: 0.9,
          roughness: 0.35,
          metalness: 0.3,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide
        });
        child.material = fill;
        fills.push({ m: fill, max: 0.42 });

        // contorno brilhante, como os circuitos do Tron
        const edgeMat = new THREE.LineBasicMaterial({ color: 0x7ff6ff, transparent: true, opacity: 0 });
        child.add(new THREE.LineSegments(new THREE.EdgesGeometry(child.geometry, 25), edgeMat));
        outlines.push(edgeMat);
      });

      anchor.add(model);
      fit();
    })
    .catch(error => {
      console.error('Erro ao carregar o modelo 3D.', error);
      addFallbackLogo();
    });

  new ResizeObserver(fit).observe(container);
  fit();

  section.addEventListener('pointermove', event => {
    const rect = container.getBoundingClientRect();
    pointerX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    pointerY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
  }, { passive: true });

  const clock = new THREE.Clock();
  let progress = reduceMotion ? 0.52 : 0;
  let prevProgress = progress;
  let tiltX = 0;
  let tiltY = 0;

  function scrollProgress() {
    if (reduceMotion) return 0.52;
    const rect = section.getBoundingClientRect();
    const vh = window.innerHeight;
    const lead = vh * 0.5; // a logo começa a aparecer antes do palco travar
    const total = rect.height - vh + lead;
    return clamp01((lead - rect.top) / total);
  }

  renderFrame = () => {
    const t = reduceMotion ? 0 : clock.getElapsedTime();

    // suaviza o scroll para dar inércia ao movimento
    progress += (scrollProgress() - progress) * (reduceMotion ? 1 : 0.1);
    const p = progress;
    const speed = Math.abs(p - prevProgress);
    prevProgress = p;

    // trajetória: chega ao centro, paira, e depois cruza a câmera
    let z, arrive;
    if (p < 0.45) {
      arrive = easeOutCubic(p / 0.45);
      z = lerp(-45, 0, arrive);
    } else if (p < 0.62) {
      arrive = 1;
      z = lerp(0, 1.5, (p - 0.45) / 0.17);
    } else {
      arrive = 1;
      z = lerp(1.5, 12.6, easeInCubic((p - 0.62) / 0.38));
    }
    const leave = easeInCubic(clamp01((p - 0.62) / 0.38));
    anchor.position.set(
      lerp(-4.5, 0, arrive) + leave * 2.4,
      lerp(-2.2, 0, arrive) + Math.sin(t * 0.9) * 0.15 + leave * 0.8,
      z
    );
    lightRig.position.z = z;

    // gira ~2,5 voltas e fica de frente para o público quando paira no centro
    const spin = (p - 0.52) * Math.PI * 5;
    tiltY += (pointerX * 0.35 - tiltY) * 0.06;
    tiltX += (pointerY * 0.2 - tiltX) * 0.06;
    anchor.rotation.y = spin + tiltY;
    anchor.rotation.x = Math.sin(t * 0.4) * 0.06 + tiltX;
    anchor.rotation.z = (1 - arrive) * 0.5;

    // aparece e some suavemente
    const fade = smooth(0.0, 0.14, p) * (1 - smooth(0.86, 0.98, p));
    fills.forEach(f => { f.m.opacity = f.max * fade; });
    outlines.forEach(m => { m.opacity = fade; });

    // grade e riscos de luz avançam com o scroll
    const travel = p * 160;
    grid.position.z = -35 + (travel % CELL);
    grid.material.opacity = 0.5 * smooth(0.0, 0.1, p) * (1 - smooth(0.9, 1, p));

    const len = 1.5 + Math.min(speed * 900, 16);
    for (let i = 0; i < STREAKS; i++) {
      const d = streakData[i];
      const zFront = -75 + ((d.z0 + travel) % SPAN);
      const o = i * 6;
      streakPos[o] = d.x; streakPos[o + 1] = d.y; streakPos[o + 2] = zFront;
      streakPos[o + 3] = d.x; streakPos[o + 4] = d.y; streakPos[o + 5] = zFront - len;
    }
    streakGeo.attributes.position.needsUpdate = true;
    streakMat.opacity = 0.7 * smooth(0.0, 0.12, p) * (1 - smooth(0.88, 1, p));

    // frase aparece enquanto a logo paira no centro
    if (quote && !reduceMotion) {
      const q = smooth(0.3, 0.45, p) * (1 - smooth(0.66, 0.8, p));
      quote.style.opacity = q;
      quote.style.transform = 'translateY(' + ((1 - q) * 18) + 'px)';
    }

    renderer.render(scene, camera);
  };
}

function loop() {
  if (!visible) {
    running = false;
    return;
  }
  renderFrame();
  requestAnimationFrame(loop);
}

if (section && container) {
  if (typeof THREE === 'undefined') {
    console.error('Three.js não carregou (verifique a conexão ou o bloqueio da CDN).');
    section.classList.add('no-webgl');
    return;
  }
  if (reduceMotion) section.classList.add('is-static');

  new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting;
    if (visible && !started) {
      started = true;
      try {
        init();
      } catch (error) {
        console.error('WebGL indisponível.', error);
        section.classList.add('no-webgl');
        return;
      }
    }
    if (visible && started && !running && !reduceMotion) {
      running = true;
      loop();
    }
  }, { rootMargin: '300px 0px' }).observe(section);
}
})();
