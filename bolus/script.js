document.querySelector('#year').textContent = new Date().getFullYear();

const heroVideo = document.querySelector('.hero-video');
const soundToggle = document.querySelector('.hero-sound');
let soundEnabled = false;

function updateSoundControl() {
  soundToggle.classList.toggle('muted', !soundEnabled);
  soundToggle.querySelector('span').textContent = soundEnabled ? 'SOUND ON' : 'SOUND OFF';
  soundToggle.setAttribute('aria-label', soundEnabled ? 'Mute background audio' : 'Turn background audio on');
}

heroVideo.volume = .8;
heroVideo.play().catch(() => {});
updateSoundControl();

soundToggle.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  heroVideo.muted = !soundEnabled;
  heroVideo.play().catch(() => {});
  updateSoundControl();
});

if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const orbit = document.querySelector('.orbit-two');
  let frame = false;
  const update = () => {
    const progress = Math.min(1, scrollY / Math.max(1, innerHeight));
    orbit.style.transform = `translate(-50%, -50%) rotate(${progress * 85 - 18}deg)`;
    frame = false;
  };
  addEventListener('scroll', () => {
    if (!frame) { requestAnimationFrame(update); frame = true; }
  }, { passive: true });
}
