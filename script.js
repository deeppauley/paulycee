const heroVideo = document.querySelector('.hero-video');
const soundButton = document.querySelector('.sound-toggle');
const modal = document.querySelector('.player-modal');
const fullVideo = modal.querySelector('video');

// Keep the atmospheric loop running when browsers restore a backgrounded tab.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !modal.open && heroVideo.paused) heroVideo.play().catch(() => {});
});

soundButton.addEventListener('click', () => {
  heroVideo.muted = !heroVideo.muted;
  soundButton.classList.toggle('on', !heroVideo.muted);
  soundButton.querySelector('.sound-label').textContent = heroVideo.muted ? 'SOUND OFF' : 'SOUND ON';
  soundButton.setAttribute('aria-label', heroVideo.muted ? 'Turn ambient video sound on' : 'Turn ambient video sound off');
});

document.querySelectorAll('[data-open-player]').forEach(button => button.addEventListener('click', () => {
  heroVideo.pause();
  modal.showModal();
  fullVideo.play().catch(() => {});
}));

function closePlayer() {
  fullVideo.pause();
  modal.close();
  heroVideo.play().catch(() => {});
}

document.querySelector('.close-player').addEventListener('click', closePlayer);
modal.addEventListener('click', event => { if (event.target === modal) closePlayer(); });
modal.addEventListener('cancel', event => { event.preventDefault(); closePlayer(); });

document.querySelector('#booking-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector('.form-status');
  const data = Object.fromEntries(new FormData(form));
  button.disabled = true;
  button.firstChild.textContent = 'SENDING… ';
  status.textContent = '';

  try {
    const response = await fetch('https://formsubmit.co/ajax/pauleyc@gmail.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        name: data.name,
        email: data.email,
        'event details': data.details,
        _subject: `New Pauly Cee booking inquiry — ${data.name}`,
        _template: 'table',
        _honey: data._honey
      })
    });
    if (!response.ok) throw new Error('Submission failed');
    form.reset();
    status.textContent = 'Inquiry sent. Pauly will be in touch.';
  } catch {
    status.textContent = 'Something went wrong. Please try again in a moment.';
  } finally {
    button.disabled = false;
    button.firstChild.textContent = 'SEND INQUIRY ';
  }
});

document.querySelector('#year').textContent = new Date().getFullYear();

if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  document.querySelector('.rufus-video-wrap video')?.pause();
}
