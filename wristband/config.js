// Edit giveaway timing and copy here. No device-clock unlock or countdown.
export const giveaway = {
  startTime: '5 PM',
  item: 'Free light-up wristbands',
  headline: 'LIGHT ME UP!'
};

export function applyGiveawayCopy(root = document) {
  const copy = {
    headline: giveaway.headline,
    offer: `${giveaway.item} starting at ${giveaway.startTime}`,
    landingInstruction: `Turn your phone sideways and show the DJ after ${giveaway.startTime}.`,
    instruction: `After ${giveaway.startTime}, show this screen to the DJ.`,
    holdInstruction: `After ${giveaway.startTime}, hold your screen toward the DJ.`
  };
  root.querySelectorAll('[data-glow-copy]').forEach(node => {
    if (copy[node.dataset.glowCopy]) node.textContent = copy[node.dataset.glowCopy];
  });
}
