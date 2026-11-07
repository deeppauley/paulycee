const heroVideo = document.querySelector('.hero-video');
const soundButton = document.querySelector('.sound-toggle');
const modal = document.querySelector('.player-modal');
const fullVideo = modal.querySelector('video');
const remixAudio = document.querySelector('.remix-audio');
const remixPlay = document.querySelector('.remix-play');
const remixSeek = document.querySelector('.remix-seek');
const remixFill = document.querySelector('.remix-wave-fill');
const remixTime = document.querySelector('.remix-time');
const remixChoice = document.querySelector('.remix-track-select');
const remixTracks = [
  {title:'Another One',artist:'Roger Sanchez',src:'assets/pauly-cee-roger-sanchez-another-one-remix.mp3'},
  {title:"Movin' to the Sun",artist:'HUGEL',src:'assets/pauly-cee-movin-to-the-sun-remix-preview.mp3'}
];
let remixIndex = 0;
function remixLabels(){
  const track=remixTracks[remixIndex];
  document.querySelector('.remix-details strong').textContent=track.title.toUpperCase();
  document.querySelector('.remix-details>span').textContent=track.artist.toUpperCase()+' · PAULY CEE REMIX';
  document.querySelector('.remix-badge span').textContent=remixIndex===0?'LATEST REMIX':'REMIX PREVIEW';
  remixPlay.setAttribute('aria-label',(remixAudio.paused?'Play ':'Pause ')+track.title+' remix');
  remixChoice.value=String(remixIndex);
  document.querySelector('.remix-previous').disabled=remixIndex===0;
  document.querySelector('.remix-next').disabled=remixIndex===remixTracks.length-1;
}
function loadRemix(index,autoplay=false){
  remixAudio.pause();remixIndex=index;remixAudio.src=remixTracks[index].src;remixAudio.load();
  remixPlay.classList.remove('playing');remixPlay.querySelector('span').textContent='▶';
  remixLabels();updateRemixPlayer();if(autoplay)remixPlay.click();
}
remixChoice.addEventListener('change',()=>loadRemix(Number(remixChoice.value),!remixAudio.paused));
document.querySelector('.remix-previous').addEventListener('click',()=>{if(remixIndex>0)loadRemix(remixIndex-1,!remixAudio.paused);});
document.querySelector('.remix-next').addEventListener('click',()=>{if(remixIndex<remixTracks.length-1)loadRemix(remixIndex+1,!remixAudio.paused);});
remixLabels();

function trackEvent(name, parameters = {}) {
  if (typeof window.gtag === 'function') window.gtag('event', name, parameters);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function updateRemixPlayer() {
  const progress = remixAudio.duration ? (remixAudio.currentTime / remixAudio.duration) * 100 : 0;
  remixSeek.value = progress;
  remixFill.style.width = `${progress}%`;
  remixTime.textContent = `${formatTime(remixAudio.currentTime)} / ${formatTime(remixAudio.duration)}`;
}

remixPlay.addEventListener('click', async () => {
  if (remixAudio.paused) {
    heroVideo.muted = true;
    soundButton.classList.remove('on');
    soundButton.querySelector('.sound-label').textContent = 'SOUND OFF';
    await remixAudio.play().catch(() => {});
    if (!remixAudio.paused) trackEvent('remix_preview_play', { track_name: remixTracks[remixIndex].title, remix_artist: 'Pauly Cee' });
  } else {
    remixAudio.pause();
  }
});

remixAudio.addEventListener('play', () => { remixPlay.classList.add('playing'); remixPlay.querySelector('span').textContent = 'Ⅱ';remixLabels(); });
remixAudio.addEventListener('pause', () => { remixPlay.classList.remove('playing'); remixPlay.querySelector('span').textContent = '▶';remixLabels(); });
remixAudio.addEventListener('timeupdate', updateRemixPlayer);
remixAudio.addEventListener('loadedmetadata', updateRemixPlayer);
remixAudio.addEventListener('ended', () => {if(remixIndex<remixTracks.length-1)loadRemix(remixIndex+1,true);else{remixAudio.currentTime=0;updateRemixPlayer();} });
remixSeek.addEventListener('input', () => {
  if (remixAudio.duration) remixAudio.currentTime = (Number(remixSeek.value) / 100) * remixAudio.duration;
});

// Keep the atmospheric loop running when browsers restore a backgrounded tab.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !modal.open && heroVideo.paused) heroVideo.play().catch(() => {});
});

soundButton.addEventListener('click', () => {
  heroVideo.muted = !heroVideo.muted;
  soundButton.classList.toggle('on', !heroVideo.muted);
  soundButton.querySelector('.sound-label').textContent = heroVideo.muted ? 'SOUND OFF' : 'SOUND ON';
  soundButton.setAttribute('aria-label', heroVideo.muted ? 'Turn ambient video sound on' : 'Turn ambient video sound off');
  trackEvent('ambient_sound_toggle', { sound_state: heroVideo.muted ? 'off' : 'on' });
});

document.querySelectorAll('[data-open-player]').forEach(button => button.addEventListener('click', () => {
  remixAudio.pause();
  heroVideo.pause();
  modal.showModal();
  fullVideo.play().catch(() => {});
  trackEvent('full_set_play', { set_name: '36 Minutes in the Dark' });
}));

document.querySelector('.kspace-link')?.addEventListener('click', () => {
  trackEvent('select_content', { content_type: 'artist_link', item_id: 'dj_bolus' });
});

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
    trackEvent('generate_lead', { method: 'booking_form' });
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
  document.querySelector('.noir-video')?.pause();
  document.querySelector('.festival-background-video')?.pause();
} else {
  for (const noirVideo of document.querySelectorAll('.noir-video, .festival-background-video')) {
    new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) noirVideo.play().catch(() => {});
      else noirVideo.pause();
    }, { threshold: 0.15 }).observe(noirVideo);
  }
}
