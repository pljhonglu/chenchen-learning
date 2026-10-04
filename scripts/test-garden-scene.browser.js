/* Run only against `node scripts/preview-garden.cjs`:
   agent-browser eval --stdin < scripts/test-garden-scene.browser.js */
(async () => {
  const assert = (value, message) => { if (!value) throw new Error(message); };
  assert(window.GardenPreview, "Open the isolated garden preview first");
  const report = [];
  const q = selector => document.querySelector(selector);
  const water = () => q('[data-g-action="water"]').onclick();
  const timelines = () => gsap.globalTimeline.getChildren(false, false, true);
  async function until(predicate, message) {
    const end = performance.now() + 5000;
    while (!predicate()) { assert(performance.now() < end, message); await new Promise(resolve => setTimeout(resolve, 20)); }
  }
  async function reset(total, options) {
    const session = GardenPreview.reset(total, { delay: 0, ...options });
    await until(() => q('.g-scene-host').dataset.sceneReady === 'true', 'Artwork did not load');
    return session;
  }
  async function finish(promise) {
    await until(() => timelines().length > 0, 'Performance did not start');
    timelines().forEach(t => t.timeScale(20));
    await promise;
    assert(timelines().length === 0, 'A completed scene still has an active timeline');
  }
  // Real GSAP and real DOM: authoritative save, then one locked performance.
  const first = await reset(23, { todayWatered: 2 });
  const host = q('.g-scene-host');
  const firstPlay = water();
  await until(() => q('.g-home').classList.contains('g-performing'), 'No success performance');
  assert(q('.g-scene-host') === host, 'Watering replaced the scene DOM');
  assert(!q('.g-home').classList.contains('g-resting'), 'Third watering stopped its own success feedback');
  assert(q('[data-g-action="water"]').disabled, 'Water button unlocked during animation');
  await water();
  assert(first.requests.length === 1, 'Repeated click issued another server request');
  assert(!q('.g-gift-celebration'), 'Gift covered the tree before growth');
  await finish(firstPlay);
  assert(q('.g-home').classList.contains('g-resting'), 'Third watering did not settle into rest');
  assert(host.dataset.ambientState==='paused','The resting garden kept its ambient ticker');
  assert(q('.g-gift-celebration'), 'Milestone gift was lost after animation');
  assert(Object.keys(first.state.garden.watering).length === 24, 'Visual playback changed the ledger');
  report.push('Third watering completes growth, preserves DOM, locks repeat clicks, then rests and shows one gift');

  // Rendered geometry: roots stay fixed and growing leaves stay on their twigs.
  const screenPoint = (element, x, y) => new DOMPoint(x, y).matrixTransform(element.getScreenCTM());
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  await reset(47);
  const growth = water();
  await until(() => q('.g-home').classList.contains('g-performing'), 'No growth performance');
  const growthTimeline = timelines()[0].pause();
  const rootPoint = screenPoint(q('[data-tree-position]'), 0, 0);
  for (const time of [0, .6, 1.05, 1.4, 1.9, 2.4]) {
    growthTimeline.time(time);
    assert(distance(rootPoint, screenPoint(q('[data-tree-position]'), 0, 0)) < .1, 'Growth moved the root');
    for (const leaf of document.querySelectorAll('[data-leaf]')) {
      if (Number(leaf.getAttribute('opacity')) < .01) continue;
      const twig = q(`[data-branch="${leaf.dataset.leaf}"]`);
      const end = twig.getPointAtLength(twig.getTotalLength());
      assert(distance(screenPoint(twig, end.x, end.y), screenPoint(leaf, 0, 0)) < .1, `Detached leaf at ${time}s`);
    }
  }
  growthTimeline.progress(1); await growth;
  assert(timelines().length === 0, 'Growth retained its timeline');
  report.push('Growing branches and leaves keep their rendered joints attached to a fixed root');

  // The visible flower must open over time, rather than just replace the bud.
  await reset(71);
  const blooming = water();
  await until(() => q('.g-home').classList.contains('g-performing'), 'No flower performance');
  const bloomTimeline = timelines()[0].pause();
  bloomTimeline.time(1.08);
  const folded = q('[data-flower] [data-petal]').getCTM();
  bloomTimeline.time(1.8);
  const unfolded = q('[data-flower] [data-petal]').getCTM();
  assert(Math.hypot(unfolded.c, unfolded.d) > Math.hypot(folded.c, folded.d) * 1.5, 'Petals did not unfold');
  bloomTimeline.progress(1); await blooming;
  assert(q('[data-flower]').getAttribute('opacity') === '1' && q('[data-bud]').getAttribute('opacity') === '0', 'Bloom did not replace the bud');
  report.push('Flower petals unfold before the milestone gift appears');

  // The adult tree keeps its roots and reveals fresh leaves after the fruit cycle.
  await reset(191);
  const adult = water();
  await until(() => q('.g-home').classList.contains('g-performing'), 'Adult cycle did not start');
  await finish(adult);
  assert(q('[data-fresh]').getAttribute('opacity') === '1', 'Adult cycle has no fresh leaves');
  assert(q('[data-fruit]').getAttribute('opacity') === '0', 'Ripe fruit remained over the new cycle');
  assert(q('[data-tree-position]').getAttribute('transform') === 'translate(365 348)', 'Root moved during growth');
  report.push('Adult stage 15 → 12 settles to fresh leaves at the same root');

  // Leaving during a performance resolves the pending UI operation and disposes it.
  await reset(0);
  const leaving = water();
  await until(() => q('.g-home').classList.contains('g-performing'), 'No leaving performance');
  q('[data-g-action="calendar"]').onclick();
  await leaving;
  assert(!q('.g-scene-host') && timelines().length === 0, 'Calendar navigation left an active scene');
  q('[data-g-action="back"]').onclick();
  assert(!q('.g-home').classList.contains('g-performing'), 'Returning remained locked');
  report.push('Leaving during playback releases the timeline and returning is usable');

  const pending = await reset(0, { delay: 200 });
  const delayed = water();
  window.ChenchenGarden.stop();
  GardenPreview.reopen();
  await delayed;
  assert(Object.keys(pending.state.garden.watering).length === 1, 'Background response was lost');
  assert(!q('[data-g-action="water"]').disabled && !q('.g-home').classList.contains('g-performing'), 'Reopened page remained busy');
  report.push('Leaving and reopening during the request accepts its result without a stuck button');

  // Response lost after commit: retry the same ID, then play feedback just once.
  const lost = await reset(11, { loseOnce: true });
  await water();
  assert(q('[data-g-action="water"]').textContent.includes('重试'), 'Lost response has no retry');
  assert(Object.keys(lost.state.garden.watering).length === 11, 'Client showed an unconfirmed save');
  const retried = water();
  await until(() => q('.g-home').classList.contains('g-performing'), 'Retry did not recover');
  await finish(retried);
  assert(lost.requests.length === 2 && lost.requests[0] === lost.requests[1], 'Retry changed the request ID');
  assert(Object.keys(lost.state.garden.watering).length === 12, 'Retry spent a second water drop');
  report.push('Lost response retries one request ID and recovers one committed milestone');

  // Simulate the browser visibility event while the sequence is playing.
  await reset(35);
  const hidden = water();
  await until(() => q('.g-home').classList.contains('g-performing'), 'No background performance');
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  try { document.dispatchEvent(new Event('visibilitychange')); await hidden; }
  finally { delete document.hidden; }
  assert(timelines().length === 0 && !q('.g-home').classList.contains('g-performing'), 'Hidden page retained playback');
  assert(q('.g-scene-host').dataset.stage === '3', 'Hidden page failed to settle the new tree');
  report.push('Backgrounding settles the saved tree and releases playback');

  // Runtime unavailable: a successful save remains successful and usable.
  const savedGsap = window.gsap;
  window.ChenchenGarden.stop();
  window.gsap = undefined;
  try {
    const fallback = await reset(83);
    await water();
    assert(Object.keys(fallback.state.garden.watering).length === 84, 'Static fallback lost a save');
    assert(!q('.g-home').classList.contains('g-performing'), 'Static fallback stayed locked');
    assert(q('.g-gift-celebration'), 'Static fallback omitted the gift');
  } finally { window.ChenchenGarden.stop(); window.gsap = savedGsap; }
  report.push('Missing GSAP falls back to the saved static stage and gift');

  // Every business stage must produce a nonempty layered crown or seedling.
  for (let i = 0; i < 16; i++) {
    await reset(i * 12);
    const visible = [...document.querySelectorAll('[data-leaf]')].filter(el => Number(el.getAttribute('opacity')) > 0);
    assert(visible.length > 0, `Stage ${i} has no foliage`);
    assert(q('.g-scene-host').getAttribute('aria-label').includes(ChenchenGarden.helpers.stageAt(i * 12).title), `Stage ${i} label is stale`);
  }
  assert(!q('[data-tree-position] image'), 'Growing branches depend on bitmap parts');
  await until(() => q('.g-painted-backdrop').complete && q('.g-painted-backdrop').naturalWidth > 0, 'Painted backdrop failed to load');
  const cloud = new Image(); cloud.src = q('[data-cloud] image').getAttribute('href');
  await cloud.decode();
  assert(cloud.naturalWidth > 0, 'Painted cloud failed to load');
  assert(q('[data-bird]').getAttribute('opacity') === '1' && q('[data-nest]').getAttribute('opacity') === '1', 'Adult cycle lost established garden visitors');
  report.push('All 16 stages render vector growth and adult visitors over loaded painted scenery');
  // Ambient motion has its own cancellable ticker, separate from save feedback.
  // Track the public ticker subscription API to catch leaks on remount/navigation.
  const ticker=gsap.ticker, add=ticker.add, remove=ticker.remove, subscriptions=new Set();
  ticker.add=function(callback,...args){const result=add.call(this,callback,...args);subscriptions.add(callback);return result;};
  ticker.remove=function(callback,...args){subscriptions.delete(callback);return remove.call(this,callback,...args);};
  const scrollTail=document.createElement("div");
  scrollTail.style.height=`${innerHeight}px`; document.body.appendChild(scrollTail);
  try {
    const idle=await reset(168);
    const idleHost=q('.g-scene-host');
    idleHost.scrollIntoView({block:'center'});
    await until(()=>idleHost.dataset.ambientState==='running','Visible garden has no ambient motion');
    const ledger=JSON.stringify(idle.state), rootTransform=q('[data-tree-position]').getAttribute('transform');
    const leaf=q('[data-leaf]'), before=leaf.getAttribute('transform');
    await until(()=>leaf.getAttribute('transform')!==before,'Leaves remain static in the breeze');
    assert(subscriptions.size===1,'Garden added duplicate ambient tickers');
    assert(q('[data-tree-position]').getAttribute('transform')===rootTransform,'Breeze moved the roots');
    assert(JSON.stringify(idle.state)===ledger,'Ambient motion changed learning progress');
    report.push('Idle breeze animates leaves at a fixed root without touching the ledger');

    window.scrollTo(0,document.body.scrollHeight);
    await until(()=>idleHost.dataset.ambientState==='paused','Offscreen garden kept animating');
    assert(subscriptions.size===0,'Offscreen garden retained a ticker');
    idleHost.scrollIntoView({block:'center'});
    await until(()=>idleHost.dataset.ambientState==='running','Returning to the garden did not resume the breeze');
    Object.defineProperty(document,'hidden',{configurable:true,value:true});
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      assert(idleHost.dataset.ambientState==='paused'&&subscriptions.size===0,'Hidden garden retained a ticker');
    } finally { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); }
    await until(()=>idleHost.dataset.ambientState==='running','Foreground garden did not resume');
    window.ChenchenGarden.stop();
    assert(subscriptions.size===0,'Disposed garden leaked an ambient ticker');
    report.push('Breeze pauses offscreen/in the background, resumes once, and cleans up on navigation');
  } finally { window.ChenchenGarden.stop(); ticker.add=add; ticker.remove=remove; scrollTail.remove(); }
  window.ChenchenGarden.stop();
  return { passed: report.length, checks: report };
})()
