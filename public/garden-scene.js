/* Painted scenery + SVG growth. Animation presents committed growth; it never owns the ledger. */
(function () {
  "use strict";
  let instance = 0;
  const ROOT = { x: 365, y: 348 };
  const LEAVES = [
    { key: "tip-left", at: 1, reach: 0, rise: 0, angle: -49, length: 78, width: 28, stage: 0 },
    { key: "tip-right", at: 1, reach: 0, rise: 0, angle: 48, length: 70, width: 25, stage: 0 },
    { key: "new-left", at: .69, reach: -26, rise: 12, angle: -64, length: 62, width: 23, stage: 1 },
    { key: "new-right", at: .68, reach: 31, rise: 16, angle: 60, length: 65, width: 24, stage: 2 },
    { key: "branch-left", at: .4, reach: -66, rise: 33, angle: -54, length: 71, width: 27, stage: 3 },
    { key: "branch-right", at: .43, reach: 71, rise: 36, angle: 57, length: 72, width: 27, stage: 4 },
    { key: "crown-left", at: .76, reach: -35, rise: 21, angle: -25, length: 65, width: 23, stage: 4 },
    { key: "crown-right", at: .83, reach: 29, rise: 13, angle: 25, length: 60, width: 22, stage: 4 },
    { key: "low-left", at: .32, reach: -38, rise: 12, angle: -80, length: 57, width: 22, stage: 4 },
    { key: "low-right", at: .3, reach: 45, rise: 12, angle: 79, length: 55, width: 21, stage: 4 },
  ];
  // The same seedling opens into an asymmetric crown; no whole-tree scale swap.
  const ADULT = [
    { at: 1, reach: -8, rise: 1, angle: -38, length: 49, width: 21 },
    { at: .98, reach: 9, rise: 3, angle: 40, length: 48, width: 20 },
    { at: .73, reach: -58, rise: 26, angle: -60, length: 51, width: 22 },
    { at: .72, reach: 57, rise: 25, angle: 52, length: 51, width: 23 },
    { at: .45, reach: -93, rise: 35, angle: -72, length: 51, width: 23 },
    { at: .47, reach: 96, rise: 37, angle: 63, length: 53, width: 24 },
    { at: .88, reach: -36, rise: 15, angle: -24, length: 48, width: 21 },
    { at: .9, reach: 39, rise: 12, angle: 25, length: 46, width: 21 },
    { at: .49, reach: -48, rise: 5, angle: -123, length: 46, width: 23 },
    { at: .52, reach: 52, rise: 5, angle: 115, length: 47, width: 22 },
  ];
  const SPRAYS = [
    { x: -15, y: 1, angle: -77, length: 43, width: 20 },
    { x: -11, y: -11, angle: -30, length: 48, width: 22 },
    { x: 9, y: -13, angle: 21, length: 47, width: 22 },
    { x: 19, y: -1, angle: 72, length: 42, width: 21 },
  ];
  const mix = (a,b,t) => a+(b-a)*t;
  const BLOSSOMS = [
    { leaf: 2, x: -18, y: -23 }, { leaf: 3, x: 20, y: -24 },
    { leaf: 4, x: -20, y: -23 }, { leaf: 5, x: 24, y: -22 },
    { leaf: 0, x: 0, y: -19 },
  ];
  function stageConfig(index) {
    const i = Math.max(0, Math.min(15, Number(index) || 0));
    return {
      index: i, height: [91, 118, 151, 182, 208][Math.min(i, 4)],
      wood: Math.min(i / 4, 1), crown: [0,0,0,.4,1][Math.min(i,4)], buds: i === 5 || i === 13,
      flowers: i === 6 || i === 14, fruit: i >= 7 && i <= 11 || i === 15,
      fresh: i === 12, butterfly: i >= 9, bird: i >= 10, nest: i >= 11,
    };
  }
  const leafPath = (length, width) => `M0 0 C${-width*.8} ${-length*.13} ${-width*1.16} ${-length*.65} ${-width*.26} ${-length*.87} Q${-width*.06} ${-length*.95} 0 ${-length} C${width*.6} ${-length*.79} ${width*1.14} ${-length*.29} 0 0Z`;
  function sprayMarkup(index) {
    return `<g data-spray="${index}">${SPRAYS.map((leaf,j)=>{
      const size=.87+((index*3+j*2)%5)*.05;
      return `<g data-spray-leaf="${j}"><path d="M0 0Q${leaf.x*.4} ${leaf.y*.25} ${leaf.x} ${leaf.y}" stroke="#6f8f59" stroke-width="1.5" fill="none"/><g transform="translate(${leaf.x} ${leaf.y}) rotate(${leaf.angle+(index%3-1)*8}) scale(${size})"><path d="${leafPath(leaf.length,leaf.width)}" fill="url(#${(index+j)%3===0?'LIGHT':(index+j)%3===1?'LEAF':'DEEP'})"/><path d="M0 -2Q-2 ${-leaf.length*.45} 0 ${-leaf.length+7}" fill="none" stroke="#e3e9b8" stroke-width=".8" opacity=".45"/></g></g>`;
    }).join('')}</g>`;
  }
  function flowerMarkup() {
    return Array.from({ length: 5 }, (_, i) => `<g data-petal transform="rotate(${i * 72})"><ellipse cx="0" cy="-9" rx="8" ry="11" fill="url(#FLOWER)"/><path d="M0 -4V-13" stroke="#e9b3a5" stroke-width=".8" stroke-linecap="round"/></g>`).join("") + '<circle r="5.5" fill="#e9bc63"/><circle cx="-1.5" cy="-1.5" r="1.6" fill="#fff4b5"/>';
  }
  function markup(id) {
    const art = `<img class="g-painted-backdrop" src="/images/garden/meadow-painted.webp" width="1604" height="980" alt="" aria-hidden="true" decoding="async" fetchpriority="high">
    <svg class="g-scene-svg" viewBox="0 0 720 440" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="LEAF" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#a5c486"/><stop offset=".5" stop-color="#7ea568"/><stop offset="1" stop-color="#567e55"/></linearGradient>
        <linearGradient id="DEEP" x2=".8" y2="1"><stop stop-color="#89ae72"/><stop offset="1" stop-color="#60835b"/></linearGradient>
        <linearGradient id="LIGHT" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#c7d89b"/><stop offset="1" stop-color="#88af72"/></linearGradient>
        <linearGradient id="FLOWER" x2="0" y2="1"><stop stop-color="#fff1e8"/><stop offset="1" stop-color="#eeb6a6"/></linearGradient>
        <linearGradient id="WATER" x2=".6" y2="1"><stop stop-color="#c0e3e1"/><stop offset="1" stop-color="#6da9b5"/></linearGradient>
        <linearGradient id="FRUIT" x2=".8" y2="1"><stop stop-color="#f5cb89"/><stop offset="1" stop-color="#db8e66"/></linearGradient>
      </defs>
      <g data-cloud>
        <image href="/images/garden/cloud-painted.webp" x="480" y="86" width="158" height="53" opacity=".85"/>
        <image href="/images/garden/cloud-painted.webp" x="114" y="168" width="103" height="34" opacity=".56"/>
      </g>
      <ellipse cx="365" cy="350" rx="24" ry="5" fill="#9fa680" opacity=".16"/>
      <ellipse data-wet cx="${ROOT.x}" cy="${ROOT.y + 2}" rx="30" ry="7" fill="#99aa86" opacity="0"/>
      <g data-ripples transform="translate(${ROOT.x} ${ROOT.y + 2})" opacity="0" fill="none" stroke="#7caaa7" stroke-width="1.5"><ellipse data-ring rx="18" ry="5"/><ellipse data-ring rx="28" ry="8"/></g>
      <g data-tree-position transform="translate(${ROOT.x} ${ROOT.y})">
        <g data-branches>${LEAVES.map(l=>`<path data-branch="${l.key}" fill="none" stroke="#789267" stroke-linecap="round"/>`).join("")}</g>
        <path data-trunk fill="#829761"/><path data-stem-highlight fill="none" stroke="#d9c79b" stroke-width="1.6" opacity=".6"/><path data-bark fill="none" stroke="#8f815d" stroke-width="1.1" opacity="0"/>
        ${LEAVES.map((_,i)=>sprayMarkup(i)).join("")}
        ${LEAVES.map((l,i)=>`<g data-leaf="${l.key}"><path d="${leafPath(l.length,l.width)}" fill="url(#${i%3===0?"LIGHT":"LEAF"})" stroke="#628957" stroke-opacity=".25" stroke-width=".7"/><path d="M0 -2Q-3 ${-l.length*.47} 0 ${-l.length+7}M-1 ${-l.length*.37}l${-l.width*.48} ${-l.length*.19}M-1 ${-l.length*.56}l${l.width*.45} ${-l.length*.18}" fill="none" stroke="#e0e7b9" opacity=".53" stroke-width="1.2" stroke-linecap="round"/></g>`).join("")}
        ${BLOSSOMS.map((b,i)=>`<g data-bloom="${i}"><path data-pedicel d="M${-b.x} ${-b.y}Q${-b.x*.4} 5 0-3" fill="none" stroke="#819364" stroke-width="2"/>
          <g data-bud><path d="M0 3C-14-5-10-21 0-22C10-21 14-5 0 3" fill="#e4b4a1"/><path d="M0 4Q-10 3-11-7Q-3-8 0 1Q3-8 11-7Q10 3 0 4" fill="#8fa772"/></g>
          <g data-flower>${flowerMarkup()}</g>
          <g data-fruit><path data-fruit-body d="M0-11C-19-18-22 2-11 15Q-5 22 0 18Q6 22 12 15C23 0 17-18 0-11Z" fill="url(#FRUIT)"/><path data-fruit-green d="M0-11C-19-18-22 2-11 15Q-5 22 0 18Q6 22 12 15C23 0 17-18 0-11Z" fill="#b5c77d"/><path d="M0-9Q-2-16 2-20" fill="none" stroke="#8e7859" stroke-width="2.5" stroke-linecap="round"/><path d="M1-15Q6-28 16-22Q14-12 1-15Z" fill="#91a96b"/><path d="M-11-5Q-15-1-13 4" fill="none" stroke="#fff4cf" stroke-width="2.5" stroke-linecap="round" opacity=".6"/></g>
        </g>`).join("")}
        <g data-fresh>${[-1,1].map(s=>`<g transform="rotate(${s*31})"><path d="${leafPath(35,11)}" fill="#cadb96" stroke="#8eaa68" stroke-width=".8"/><path d="M0 0V-27" stroke="#eff3c8" stroke-width="1"/></g>`).join("")}</g>
        <g data-nest><path d="M-19 0Q-15 18 3 17Q23 16 25-1Z" fill="#b99c71"/><ellipse cx="3" cy="0" rx="22" ry="6" fill="#917955"/><ellipse cx="1" cy="-2" rx="5" ry="7" fill="#f2ebd4"/><path d="M-17 4L19 11M-13 12L22 4M-5 15L24 0" stroke="#d5be94" stroke-width="1.5" fill="none" stroke-linecap="round"/></g>
        <g data-bird><path d="M-14 10l-14 3 10-12" fill="#86a5a2"/><ellipse cy="0" rx="16" ry="12" fill="#9fbdb6"/><circle cx="11" cy="-9" r="10" fill="#b1cbc0"/><path d="M20-10l8 4-8 2" fill="#c59c67"/><path data-bird-wing d="M-10-3Q7-6 4 7Q-8 13-10-3" fill="#769c98"/><circle data-bird-eye cx="14" cy="-11" r="1.8" fill="#526c65"/><path d="M-4 11V16M4 11V16" stroke="#937c59" stroke-width="1.5" stroke-linecap="round"/></g>
      </g>
      <g data-butterfly><path data-wing-left d="M0 0C-7-21-24-15-19-2C-33 11-10 23 0 0" fill="#e9c389"/><path data-wing-right d="M0 0C7-21 24-15 19-2C33 11 10 23 0 0" fill="#f0d49e"/><path d="M0-7V10M0-6l-4-5M0-6l4-5" fill="none" stroke="#a48d65" stroke-width="1.5" stroke-linecap="round"/></g>
      <g data-water>${[0,1,2].map(i=>`<g data-drop="${i}" opacity="0"><path d="M0-13C-3-7-9-2-9 4A9 9 0 0 0 9 4C9-2 3-7 0-13Z" transform="translate(-4 0) scale(.85)" fill="url(#WATER)"/><path d="M-6 1Q-8 5-4 7" fill="none" stroke="#f2ffff" stroke-width="1.8" stroke-linecap="round" opacity=".8"/></g>`).join("")}</g>
      <g data-sparkles fill="#d5b975">${[[-91,-155],[99,-183],[-41,-250],[122,-91],[-125,-74]].map(([x,y])=>`<path data-sparkle d="M0-4Q0 0 4 0Q0 0 0 4Q0 0-4 0Q0 0 0-4" transform="translate(${ROOT.x+x} ${ROOT.y+y})"/>`).join("")}</g>
    </svg><p class="g-scene-caption" data-scene-caption>每一点成长，都算数。</p>`;
    // Each mounted scene owns its paint servers, including during navigation.
    return art.replace(/\b(LEAF|LIGHT|DEEP|FLOWER|WATER|FRUIT)\b/g, name => `${id}-${name.toLowerCase()}`);
  }

  function mount(root, options) {
    if (!root) return null;
    root.innerHTML = markup(`garden-${++instance}`);
    root.dataset.sceneReady = "true";
    root.dataset.ambientState = "paused";
    const q = selector => root.querySelector(selector);
    const gsap = window.gsap;
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let disposed = false, timeline = null, resolvePlay = null, finalStage = options.stage;
    let resting = options.resting;
    const plant = { height: 91, wood: 0, crown: 0, bend: 0 };
    const air = { time: 0, wind: 0, strength: 0 };
    let ambientRunning=false, lastAmbientTime=null, inView=true;
    let observer=null;
    const effects = { wet: 0, ripple: 0, ring: 0, sparkle: 0, flutter: 0, fresh: 0, butterfly: 0, bird: 0, nest: 0 };
    const leaves = LEAVES.map((l,i) => ({ ...l, adult: ADULT[i], index:i, spray:q(`[data-spray="${i}"]`), sprayLeaves:[...root.querySelectorAll(`[data-spray="${i}"] [data-spray-leaf]`)], alpha: 0, unfold: 1, sway: 0, node: q(`[data-leaf="${l.key}"]`), branch: q(`[data-branch="${l.key}"]`) }));
    const blooms = BLOSSOMS.map((b,i) => ({ ...b, bud: 0, flower: 0, fruit: 0, open: 1, ripeness: 0, node: q(`[data-bloom="${i}"]`), budNode: q(`[data-bloom="${i}"] [data-bud]`), flowerNode: q(`[data-bloom="${i}"] [data-flower]`), fruitNode: q(`[data-bloom="${i}"] [data-fruit]`), greenNode: q(`[data-bloom="${i}"] [data-fruit-green]`), petals: [...root.querySelectorAll(`[data-bloom="${i}"] [data-petal]`)] }));
    const drops = [0,1,2].map(i=>({ t: 0, alpha: 0, node: q(`[data-drop="${i}"]`) }));
    const el = { cloud:q("[data-cloud]"), bark:q("[data-bark]"), birdEye:q("[data-bird-eye]"), birdWing:q("[data-bird-wing]"), trunk:q("[data-trunk]"), highlight:q("[data-stem-highlight]"), fresh:q("[data-fresh]"), wet:q("[data-wet]"), ripple:q("[data-ripples]"), rings:[...root.querySelectorAll("[data-ring]")], sparkles:q("[data-sparkles]"), butterfly:q("[data-butterfly]"), wings:[q("[data-wing-left]"),q("[data-wing-right]")], bird:q("[data-bird]"), nest:q("[data-nest]"), caption:q("[data-scene-caption]") };
    const opacity = (node, value) => node.setAttribute("opacity", value);
    function stemPoint(t) {
      const u = 1-t, bend=plant.bend+air.wind;
      return { x:3*u*u*t*(-10-plant.crown*5)+3*u*t*t*(8+bend*.5)+t*t*t*bend, y:-plant.height*t };
    }
    function leafShape(l) {
      const shape={};
      for(const key of ['at','reach','rise','angle','length','width'])shape[key]=mix(l[key],l.adult[key],plant.crown);
      return shape;
    }
    function leafAnchor(l) {
      const shape=leafShape(l), base=stemPoint(shape.at);
      const flex=air.strength*(Math.sin(air.time*1.1-l.index*.43)*1.2+air.wind*.55);
      return { base, shape, flex, x:base.x+(shape.reach+flex)*l.unfold, y:base.y-(shape.rise+flex*.22)*l.unfold };
    }
    function draw() {
      const h=plant.height, b=plant.bend+air.wind, w=3.4+plant.wood*6.5, curve=-10-plant.crown*5;
      el.trunk.setAttribute("d",`M${-w*1.55} 1Q${-w*.85} -7 ${-w} -22C${curve-w*.7} ${-h/3} ${6+b*.5} ${-2*h/3} ${b-1.5} ${-h}Q${b} ${-h-2} ${b+1.5} ${-h}C${10+b*.5} ${-2*h/3} ${curve+w*.7} ${-h/3} ${w} -22Q${w*.8} -6 ${w*1.4} 1Q0 5 ${-w*1.55} 1Z`);
      el.trunk.setAttribute("fill",`rgb(${Math.round(126+plant.wood*34)},${Math.round(151-plant.wood*12)},${Math.round(96+plant.wood*8)})`);
      el.highlight.setAttribute("d",`M${-w*.5} -5C${curve-2} ${-h/3} ${6+b*.5} ${-2*h/3} ${b} ${-h+4}`);
      el.bark.setAttribute("d",`M3-12Q-3-34 0-56M-3-73l-2-14M2-44l2-9`); opacity(el.bark,plant.crown*.4);
      leaves.forEach(l => {
        const p=leafAnchor(l), shape=p.shape;
        opacity(l.node,l.alpha); opacity(l.branch,l.alpha); opacity(l.spray,l.alpha*plant.crown);
        l.branch.setAttribute("d",`M${p.base.x} ${p.base.y}Q${p.base.x+shape.reach*.52*l.unfold} ${p.base.y-4*plant.crown} ${p.x} ${p.y}`);
        l.branch.setAttribute("stroke-width",mix(l.stage>=3?2.7:2,l.index>3?5:3.4,plant.crown));
        l.branch.setAttribute("stroke",plant.crown>.3?"#a18f68":"#789267");
        const breeze=air.strength*(Math.sin(air.time*1.25-l.index*.42)*3+air.wind*.65);
        l.node.setAttribute("transform",`translate(${p.x} ${p.y}) rotate(${shape.angle+l.sway+b*.2+breeze}) scale(${l.unfold*shape.width/l.width} ${l.unfold*shape.length/l.length})`);
        l.spray.setAttribute("transform",`translate(${p.x} ${p.y}) rotate(${breeze*.65+l.sway*.45}) scale(${l.unfold*(.4+plant.crown*.6)})`);
        l.sprayLeaves.forEach((leaf,i)=>leaf.setAttribute("transform",`rotate(${air.strength*Math.sin(air.time*1.8-l.index*.45-i*.6)*2})`));
      });
      blooms.forEach(bloom => {
        const a = leafAnchor(leaves[bloom.leaf]);
        bloom.node.setAttribute("transform",`translate(${a.x+bloom.x} ${a.y+bloom.y}) rotate(${air.strength*Math.sin(air.time*1.3-bloom.leaf*.5)*2.2} ${-bloom.x} ${-bloom.y})`);
        opacity(bloom.node,Math.max(bloom.bud,bloom.flower,bloom.fruit));
        opacity(bloom.greenNode,1-bloom.ripeness);
        bloom.petals.forEach((petal,i)=>{
          const opening=Math.max(0,Math.min(1,bloom.open*1.35-i*.07));
          petal.setAttribute("transform",`rotate(${i*72}) scale(${.42+.58*opening} ${.2+.8*opening})`);
        });
        opacity(bloom.budNode,bloom.bud); opacity(bloom.flowerNode,bloom.flower); opacity(bloom.fruitNode,bloom.fruit);
        bloom.budNode.setAttribute("transform",`scale(${.55+bloom.open*.45})`);
        bloom.flowerNode.setAttribute("transform",`rotate(${-18*(1-bloom.open)}) scale(${.15+bloom.open*.85})`);
        bloom.fruitNode.setAttribute("transform",`translate(0 5) scale(${.6+bloom.open*.4})`);
      });
      const tip=stemPoint(1), perch=leafAnchor(leaves[5]);
      el.fresh.setAttribute("transform",`translate(${tip.x} ${tip.y-3}) scale(${.5+effects.fresh*.5})`); opacity(el.fresh,effects.fresh);
      el.bird.setAttribute("transform",`translate(${perch.x-6} ${perch.y-13})`); opacity(el.bird,effects.bird);
      el.nest.setAttribute("transform",`translate(${perch.x-6} ${perch.y+4})`); opacity(el.nest,effects.nest);
      el.butterfly.setAttribute("transform",`translate(${ROOT.x+160+effects.flutter*4+air.strength*Math.sin(air.time*.85)*12} ${ROOT.y-plant.height*.73-effects.flutter*5+air.strength*Math.sin(air.time*1.7)*8}) rotate(${-17+air.strength*Math.sin(air.time*.85)*9}) scale(.65)`); opacity(el.butterfly,effects.butterfly);
      el.wings.forEach(wing=>wing.setAttribute("transform",`scale(${1-effects.flutter*.55-air.strength*(.5+.5*Math.sin(air.time*12))*.65} 1)`));
      const blinkPhase=air.time%7.4;
      const blink=air.strength&&blinkPhase>6.8&&blinkPhase<7.04?.12:1;
      el.birdEye.setAttribute("transform",`translate(14 -11) scale(1 ${blink}) translate(-14 11)`);
      el.birdWing.setAttribute("transform",`rotate(${air.strength*Math.sin(air.time*1.1)*3} -5 0)`);
      el.cloud.setAttribute("transform",`translate(${air.strength*Math.sin(air.time*.18)*9} 0)`);
      opacity(el.wet,effects.wet); opacity(el.ripple,effects.ripple);
      el.rings.forEach((ring,i)=>ring.setAttribute("transform",`scale(${.65+effects.ring*(1+i*.2)})`));
      opacity(el.sparkles,effects.sparkle);
      drops.forEach((drop,i) => {
        const t=drop.t, u=1-t, x=u*u*(ROOT.x-67+i*14)+2*u*t*(ROOT.x-47)+t*t*ROOT.x;
        const y=u*u*(ROOT.y-145-i*13)+2*u*t*(ROOT.y-110)+t*t*ROOT.y;
        drop.node.setAttribute("transform",`translate(${x} ${y}) scale(${1-i*.12} ${1.1-i*.1})`); opacity(drop.node,drop.alpha);
      });
    }
    function pose(stage) {
      const c=stageConfig(stage.index);
      Object.assign(plant,{height:c.height,wood:c.wood,crown:c.crown,bend:0});
      leaves.forEach(l=>Object.assign(l,{alpha:c.index>=l.stage?1:0,unfold:1,sway:0}));
      blooms.forEach(b=>{
        Object.assign(b,{bud:+c.buds,flower:+c.flowers,fruit:+c.fruit,open:c.index===7?.65:1,ripeness:c.index===7?0:1});
      });
      Object.assign(effects,{fresh:+c.fresh,butterfly:+c.butterfly,bird:+c.bird,nest:+c.nest});
      root.dataset.stage=String(c.index);
      root.setAttribute("aria-label",`${stage.title}，在小花园里一点点长大`);
      draw();
    }
    function ambientAllowed() { return allowed() && inView && !resting && !resolvePlay; }
    function tickAmbient(time) {
      if(!ambientAllowed()){stopAmbient(true);return;}
      if(lastAmbientTime===null){lastAmbientTime=time;return;}
      const delta=time-lastAmbientTime;
      if(delta<1/30)return;
      lastAmbientTime=time;
      air.time+=Math.min(delta,.1);
      air.strength=Math.min(1,air.strength+delta*.7);
      const gust=.6+.4*Math.pow(Math.sin(air.time*.24),2);
      air.wind=air.strength*gust*(Math.sin(air.time*.95)*2.7+Math.sin(air.time*1.57)*.6);
      draw();
    }
    function startAmbient() {
      if(ambientRunning||!ambientAllowed())return;
      ambientRunning=true; lastAmbientTime=null;
      root.dataset.ambientState="running";
      gsap.ticker.add(tickAmbient);
    }
    function stopAmbient(reset=false) {
      if(ambientRunning)gsap.ticker.remove(tickAmbient);
      ambientRunning=false; lastAmbientTime=null;
      root.dataset.ambientState="paused";
      if(reset){air.wind=0;air.strength=0;draw();}
    }
    function resetEffects() {
      Object.assign(effects,{wet:0,ripple:0,ring:0,sparkle:0,flutter:0});
      drops.forEach(d=>Object.assign(d,{t:0,alpha:0}));
    }
    function cancel() {
      timeline?.kill(); timeline=null;
      const resolve=resolvePlay; resolvePlay=null;
      resetEffects(); pose(finalStage);
      if(resolve)resolve();
    }
    function allowed() { return !disposed && !!gsap && !media?.matches && !document.hidden; }
    function settle() {
      if(disposed)return;
      cancel(); root.dataset.sceneState=resting?"resting":"idle";
      el.caption.textContent=resting?"今天照顾好啦，明天见。":"谢谢你，又长大了一点点。";
      startAmbient();
    }
    function onVisibility() { if(document.hidden){stopAmbient(true);settle();}else startAmbient(); }
    function onMotion() { if(media.matches){stopAmbient(true);settle();}else startAmbient(); }
    document.addEventListener("visibilitychange",onVisibility);
    media?.addEventListener?.("change",onMotion);
    pose(finalStage);
    root.dataset.sceneState=resting?"resting":"idle";
    if(window.IntersectionObserver){
      observer=new IntersectionObserver(entries=>{
        inView=entries[0]?.isIntersecting??true;
        if(inView)startAmbient();else stopAmbient(true);
      });
      observer.observe(root);
    }
    startAmbient();
    return {
      setSnapshot(stage,isResting) {
        if(disposed)return;
        resting=isResting; finalStage=stage;
        if(!resolvePlay) {
          timeline?.kill(); timeline=null;
          pose(stage); root.dataset.sceneState=resting?"resting":"idle";
          if(resting){stopAmbient(true);el.caption.textContent="今天照顾好啦，明天见。";}else startAmbient();
        }
      },
      playWater(before,after,isResting) {
        if(disposed)return Promise.resolve();
        stopAmbient(); cancel(); resting=isResting; finalStage=after;
        if(!allowed()){settle();return Promise.resolve();}
        pose(before);
        root.dataset.sceneState="watering";
        const growing=before.index!==after.index;
        el.caption.textContent=growing?"看，有新的变化正在发生。":"一滴水，慢慢喝。";
        return new Promise(resolve=>{
          resolvePlay=resolve;
          const tl=timeline=gsap.timeline({onUpdate:draw,onComplete:settle});
          drops.forEach((drop,i)=>{
            const at=i*.14;
            tl.to(drop,{alpha:1,duration:.12},at)
              .to(drop,{t:1,duration:.58,ease:"power1.in"},at)
              .to(drop,{alpha:0,duration:.08},at+.54);
          });
          tl.to(effects,{ripple:.7,wet:.27,duration:.16},.5)
            .to(effects,{ring:1.1,duration:.9,ease:"power2.out"},.5)
            .to(effects,{ripple:0,duration:.6},.9)
            .to(plant,{bend:5,duration:.32,ease:"sine.out"},.63)
            .to(plant,{bend:-2,duration:.4,ease:"sine.inOut"},.95)
            .to(plant,{bend:0,duration:.48,ease:"sine.inOut"},1.35);
          leaves.filter(l=>l.alpha).forEach((l,i)=>{
            const at=.65+i*.025;
            tl.to(l,{sway:l.angle>0?5:-5,duration:.3,ease:"sine.out"},at)
              .to(l,{sway:0,duration:.7,ease:"sine.inOut"},at+.3);
          });
          if(growing) {
            const c=stageConfig(after.index);
            tl.call(()=>{root.dataset.sceneState="growing";},[],.9)
              .to(plant,{height:c.height,wood:c.wood,crown:c.crown,duration:1.1,ease:"sine.inOut"},.88);
            let entering=0;
            leaves.forEach(l=>{
              if(c.index>=l.stage&&!l.alpha) {
                tl.set(l,{unfold:.05,alpha:0},.85)
                  .to(l,{alpha:1,unfold:1,duration:.95,ease:"power2.out"},1.03+entering++*.09);
              }
            });
            blooms.forEach((b,i)=>{
              const at=1.03+i*.07;
              const newOrgan=c.buds&&!b.bud||c.flowers&&!b.flower||c.fruit&&!b.fruit;
              if(newOrgan)tl.set(b,{open:0},.9);
              tl.to(b,{bud:+c.buds,flower:+c.flowers,fruit:+c.fruit,open:c.index===7?.65:1,ripeness:c.index===7?0:1,duration:.85,ease:"sine.inOut"},at);
            });
            tl.to(effects,{fresh:+c.fresh,butterfly:+c.butterfly,bird:+c.bird,nest:+c.nest,duration:.7},1.25)
              .to(effects,{sparkle:.8,duration:.35},1.75).to(effects,{sparkle:0,duration:.65},2.1);
          }
          if(stageConfig(after.index).butterfly)tl.to(effects,{flutter:1,duration:.18,repeat:5,yoyo:true,ease:"sine.inOut"},.85);
          tl.to(effects,{wet:0,duration:.55},growing?2.2:1.35);
        });
      },
      finish:settle,
      destroy() {
        if(disposed)return;
        disposed=true; stopAmbient(true); observer?.disconnect(); cancel();
        document.removeEventListener("visibilitychange",onVisibility);
        media?.removeEventListener?.("change",onMotion);
      },
    };
  }
  window.ChenchenGardenScene={mount,helpers:{stageConfig}};
})();
