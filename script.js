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

document.querySelector('#booking-form').addEventListener('submit', event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const subject = encodeURIComponent(`Booking inquiry for Pauly Cee — ${data.get('name')}`);
  const body = encodeURIComponent(`Name: ${data.get('name')}\nEmail: ${data.get('email')}\n\nEvent details:\n${data.get('details')}`);
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
});

document.querySelector('#year').textContent = new Date().getFullYear();
