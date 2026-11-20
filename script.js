const burger = document.getElementById('burger');
const navLinks = document.getElementById('navLinks');
const navLinkItems = document.querySelectorAll('.nav-link');
const header = document.getElementById('navbar');
const sections = [...document.querySelectorAll('main section[id]')].filter(s => document.querySelector('.nav-link[href="#' + s.id + '"]'));

function closeMenu() {
  navLinks.classList.remove('open');
  burger.classList.remove('open');
  burger.setAttribute('aria-expanded', 'false');
}

burger.addEventListener('click', () => {
  const open = navLinks.classList.toggle('open');
  burger.classList.toggle('open', open);
  burger.setAttribute('aria-expanded', open);
});

navLinkItems.forEach(a => a.addEventListener('click', closeMenu));

window.addEventListener('scroll', () => {
  header.classList.toggle('scrolled', window.scrollY > 40);
  let current = '';
  sections.forEach(section => {
    if (window.scrollY >= section.offsetTop - 200) current = section.id;
  });
  navLinkItems.forEach(link => {
    link.classList.toggle('active', link.getAttribute('href') === '#' + current);
  });
}, { passive: true });

const yearSpan = document.getElementById('current-year');
if (yearSpan) yearSpan.textContent = new Date().getFullYear();

const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('in');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.15, rootMargin: '0px 0px -50px 0px' });
document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

const canvas = document.getElementById('hero-canvas');
const ctx = canvas.getContext('2d');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const barCount = 26;
let cw, ch, frame = 0;

function resizeCanvas() {
  cw = canvas.width = canvas.offsetWidth * devicePixelRatio;
  ch = canvas.height = canvas.offsetHeight * devicePixelRatio;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

function roundedBar(x, y, bw, bh, r) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, bw, bh, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + bw, y, x + bw, y + bh, r);
    ctx.arcTo(x + bw, y + bh, x, y + bh, r);
    ctx.arcTo(x, y + bh, x, y, r);
    ctx.arcTo(x, y, x + bw, y, r);
  }
  ctx.closePath();
}

function drawBars() {
  ctx.clearRect(0, 0, cw, ch);
  const gap = cw / barCount;
  const barW = gap * 0.42;
  for (let i = 0; i < barCount; i++) {
    const amp = Math.sin(frame * 0.018 + i * 0.65) * 0.5 + 0.5;
    const barH = ch * 0.12 + amp * ch * 0.55;
    const x = i * gap + gap * 0.29;
    const y = ch / 2 - barH / 2;
    const grad = ctx.createLinearGradient(0, y, 0, y + barH);
    grad.addColorStop(0, 'rgba(0,5,9,0)');
    grad.addColorStop(0.32, 'rgba(0,140,255,0.55)');
    grad.addColorStop(0.62, 'rgba(45,226,255,0.85)');
    grad.addColorStop(1, 'rgba(0,5,9,0)');
    ctx.fillStyle = grad;
    roundedBar(x, y, barW, barH, barW / 2);
    ctx.fill();
  }
  if (!reduceMotion) {
    frame++;
    requestAnimationFrame(drawBars);
  }
}
drawBars();

const form = document.getElementById('contactForm');
const formStatus = document.getElementById('formStatus');

form.addEventListener('submit', async e => {
  e.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  formStatus.className = 'form-note';
  formStatus.textContent = 'Enviando...';
  try {
    const res = await fetch('https://formsubmit.co/ajax/aquilesangelocont@gmail.com', {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: new FormData(form)
    });
    const data = await res.json();
    if (!res.ok || String(data.success) === 'false') throw new Error(data.message || 'erro');
    form.reset();
    formStatus.className = 'form-note ok';
    formStatus.textContent = 'Mensagem enviada! Obrigado pelo contato.';
  } catch (err) {
    formStatus.className = 'form-note err';
    formStatus.textContent = 'Não foi possível enviar agora. Tente de novo ou escreva para aquilesangelocont@gmail.com.';
  } finally {
    button.disabled = false;
  }
});
