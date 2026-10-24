import {venueWelcome} from './welcome-config.js';
const banner=document.querySelector('#venue-welcome');
banner.querySelector('p').textContent=venueWelcome.message;
let expiry;
function updateWelcome(){
  clearTimeout(expiry);
  const now=Date.now(),start=Date.parse(venueWelcome.startsAt),end=Date.parse(venueWelcome.endsAt);
  banner.hidden=!(now>=start&&now<end);
  if(!banner.hidden)expiry=setTimeout(updateWelcome,Math.min(end-now,2147483647));
}
updateWelcome();
document.addEventListener('visibilitychange',updateWelcome);
window.addEventListener('pageshow',updateWelcome);
