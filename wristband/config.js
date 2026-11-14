// Edit giveaway timing and copy here. No device-clock unlock or countdown.
export const giveaway = {
  availability: 'all night',
  item: 'Free light-up wristbands',
  headline: 'LIGHT ME UP!'
};

export function applyGiveawayCopy(root = document) {
  const copy = {
    headline: giveaway.headline,
    offer: `${giveaway.item} ${giveaway.availability}`,
    landingInstruction: 'Turn your phone sideways and show the DJ.',
    instruction: 'Show this screen to the DJ for a free light-up wristband.',
    holdInstruction: 'Hold your screen toward the DJ.'
  };
  root.querySelectorAll('[data-glow-copy]').forEach(node => {
    if (copy[node.dataset.glowCopy]) node.textContent = copy[node.dataset.glowCopy];
  });
}
