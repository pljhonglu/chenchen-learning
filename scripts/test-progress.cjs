// Browser-logic regressions use the actual app source and simulate only HTTP.
// SQLite transactions have separate Go tests. No production test hooks needed.
process.env.TZ = 'Asia/Shanghai';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const sourcePath = path.join(__dirname, '../public/app.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const instrumented = source.replace(/\}\)\(\);\s*$/, `
globalThis.subject = {
 loadState, getItem, saveStudyGroup, syncNow, completePractice, persistStudyDraft, currentStudyPhase,
 navigate, bindSessionExit, openReviewItem, startStudyGroup, renderHome, studyCatalog,
 writingCharacters, openWriteCharacter, initializePage, renderPoems, renderPoemDetail, openPoemFromList,
 setPoemFilter: value => poemFilter=value,
 getPoemQuery: () => poemQuery,
 getPoemId: () => selectedPoemId,
 setPoemsLoadPromise: value => poemsLoadPromise=value,
 setPoemIllustrations: value => POEM_ILLUSTRATIONS=value,
 setView: value => currentView=value,
 setSession: value => { if(value){value.entries ||= [];value.id ||= "test-group";value.type ||= value.items[0]?.type;value.count ||= value.items.length;value.title ||= value.type;value.mode ||= "review";}reviewSession=value; },
 getSession: () => reviewSession,
 getView: () => currentView,
 getWritingId: () => selectedWriteId,
 isReady: () => stateReady,
 setPoems: value => { BUILTIN_POEMS=value; POEMS=value; poemsLoadPromise=Promise.resolve(value); }
};
})();`);
assert.notEqual(instrumented, source, 'App must still be an IIFE for in-memory exports');
assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|indexedDB)\b/,
  'Course content and progress must never be persisted in the browser');
const copy = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setImmediate(resolve));
const emptyState = () => ({items:{},activity:{},customPoems:{},customCharacters:{},hiddenCourses:{},garden:{groups:{}},studySessions:{}});
const course = (id,type='poem',extra={}) => ({id,type,title:id,learned:true,stage:0,nextReview:'2026-10-01',
  createdAt:'2026-09-30T12:00:00Z',updatedAt:'2026-09-30T12:00:00Z',...extra});

function environment(initial = {}) {
  let now = new Date('2026-10-01T01:30:00+08:00').getTime();
  let database = {...emptyState(),...copy(initial)};
  let holdRequests = false;
  let writingCatalogUnavailable = false;
  let timerId = 0;
  const requests = [], scrolls = [], timers = new Map(), elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      id,style:{},dataset:{},textContent:'',innerHTML:'',value:'',disabled:false,open:false,listeners:{},
      classList:{toggle:()=>false,add:()=>{},remove:()=>{}},
      querySelectorAll:()=>[],querySelector:selector=>element(selector),
      setAttribute:()=>{},removeAttribute:()=>{},addEventListener(name,handler){this.listeners[name]=handler;},
      focus:()=>{},setSelectionRange:()=>{},
      showModal(){this.open=true;},close(){this.open=false;},reset(){this.value='';},appendChild(){},replaceChildren(){this.innerHTML='';},
      getContext:()=>({}),getBoundingClientRect:()=>({left:0,top:0,width:600,height:600}),
    });
    return elements.get(id);
  };
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length?args:[now])); }
    static now() { return now; }
  }
  // The current UI only reads progress and saves complete learning groups.
  // SQLite atomicity and legacy content-management operations have Go tests.
  function serverResponse(request) {
    if(request.url==='/data/writing-strokes.json') return writingCatalogUnavailable ? {status:503,data:{error:'unavailable'}} : {status:200,data:JSON.parse(fs.readFileSync(path.join(__dirname,'../public/data/writing-strokes.json'),'utf8'))};
    if (request.method==='GET') return {status:200,data:{found:true,payload:copy(database),updatedAt:database.updatedAt||0}};
    if(request.method==='POST') {
      if(request.url==='/api/study-sessions') {
        const draft=copy(request.body),previous=database.studySessions[draft.id];
        const day=context.window.ChenchenStudyGroups.day(new FakeDate());
        if(previous) {
          assert.deepEqual(draft.items,previous.items,'Saved plan cannot change');
          assert(draft.entries.length>=previous.entries.length,'Saved results cannot disappear');
        }
        draft.entries=draft.entries.map((entry,index)=>previous?.entries[index] || {...entry,day,at:new FakeDate().toISOString()});
        draft.createdAt=previous?.createdAt || new FakeDate().toISOString();
        database.studySessions[draft.id]=draft;
        return {status:200,data:{ok:true,payload:copy(database),updatedAt:now}};
      }
      assert.equal(request.url,'/api/study-groups');
      const group=request.body;
      if(database.garden.groups[group.id]) return {status:200,data:{ok:true,payload:copy(database)}};
      const count={poem:5,pinyin:10,write:5,english:5,math:1,decomp:1}[group.type];
      if(group.entries.length<1 || group.entries.length>count) return {status:400,data:{error:'invalid_group_size'}};
      if(group.mode==='review' && group.entries.some(entry=>database.hiddenCourses[entry.id] || group.type!=='poem' && !database.items[entry.id]?.learned)) return {status:409,data:{error:'entry_not_found'}};
      const next=copy(database),day=context.window.ChenchenStudyGroups.day(new FakeDate());
      group.entries.forEach((entry,index)=>{
        next.activity[`${group.id}-${index}`]={...copy(entry),schemaVersion:2,day:next.studySessions[group.id]?.entries[index]?.day || day,at:next.studySessions[group.id]?.entries[index]?.at || new FakeDate().toISOString()};
        next.items[entry.id]={...(next.items[entry.id]||{}),id:entry.id,type:entry.type,title:entry.title,learned:true};
      });
      next.garden.groups[group.id]={id:group.id,day,type:group.type,count:group.entries.length,contentIds:group.entries.map(entry=>entry.id),waterAwarded:1};
      delete next.studySessions[group.id];database=next;return {status:200,data:{ok:true,payload:copy(database),updatedAt:now}};
    }
    assert.fail(`Unexpected progress mutation: ${request.method}`);
  }
  const context=vm.createContext({
    Date:FakeDate,Math,console,AbortController,crypto:require('crypto').webcrypto,
    document:{getElementById:element,querySelectorAll:()=>[],querySelector:element,
      addEventListener:()=>{},createElement:()=>element(`new${elements.size}`),body:{appendChild:()=>{}}},
    window:{scrollY:0,scrollTo(options){this.scrollY=options.top;scrolls.push(copy(options));},addEventListener:()=>{},confirm:()=>true},confirm:()=>true,
    setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),
    fetch:(url,options={})=>new Promise((resolve,reject)=>{
      const request={url,options,method:options.method||'GET',settled:false,body:options.body?JSON.parse(options.body):null,
        reply(override) { assert.equal(this.settled,false);this.settled=true;const result=override||serverResponse(this);
          resolve({ok:result.status>=200&&result.status<300,status:result.status,json:async()=>{
            if(result.jsonError) throw new SyntaxError('Unexpected token <');return copy(result.data);
          }}); },
        fail(){this.settled=true;reject(new Error('network unavailable'));},
        commitWithoutResponse(){serverResponse(this);},
        commitThenLoseResponse(){this.settled=true;serverResponse(this);reject(new Error('response lost'));},
      };
      options.signal?.addEventListener('abort',()=>{
        if(request.settled)return;
        request.settled=true;
        const error=new Error('Request aborted');error.name='AbortError';reject(error);
      },{once:true});
      assert.ok(['/api/progress','/api/study-groups','/api/study-sessions','/data/writing-strokes.json'].includes(url));requests.push(request);
      if(!holdRequests || url==='/data/writing-strokes.json') queueMicrotask(()=>request.reply());
    }),
  });
  for(const name of ['localStorage','sessionStorage','indexedDB']) {
    Object.defineProperty(context,name,{get(){throw new Error(`${name} must not be used`);}});
  }
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/writing-vocabulary.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/pinyin-data.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/learning-model.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/study-groups.js'),'utf8'),context);
  context.window.ChenchenEnglish={create:()=>({catalog:async()=>[],stop(){},pause(){}})};
  context.window.ChenchenGarden={renderHome:hooks=>{context.lastGardenHooks=hooks;},stop(){}};
  vm.runInContext(instrumented,context,{filename:sourcePath});
  context.subject.setView('poems');context.subject.setPoems([]);
  return {context,subject:context.subject,requests,scrolls,timers,elements,element,db:()=>copy(database),
    alterServer:change=>change(database),hold:value=>{holdRequests=value;},catalogUnavailable:value=>{writingCatalogUnavailable=value;},
    at:date=>{now=new Date(`${date}T01:30:00+08:00`).getTime();},connect:()=>context.subject.syncNow(),
    async nextRequest(){await flush();const request=requests.find(request=>!request.settled);assert.ok(request,'Expected pending request');return request;},
  };
}

// The real media modules have separate playback tests. This probe observes the
// detail page's lifetime without fetching assets or simulating SVG rendering.
function writingMediaProbe(e, settings = {}) {
  const viewers=[],voices=[],practices=[];
  e.context.window.ChenchenWritingAudio={create(){
    const voice={destroyed:false,stops:0,stop(){this.stops++;},destroy(){this.destroyed=true;this.stop();},
      playStroke:()=>Promise.resolve(),playReading:()=>Promise.resolve()};
    voices.push(voice);return voice;
  }};
  e.context.window.ChenchenWritingStrokes={create(options){
    const viewer={destroyed:false,character:options.character,playing:false,
      notify(status){if(!this.destroyed) options.onState({status,total:1,completed:0,stroke:1});},
      play(){this.playing=true;this.notify('playing');return Promise.resolve(true);},
      stop(){this.playing=false;this.notify('ready');},
      restart(){this.stop();return true;},
      destroy(){this.playing=false;this.destroyed=true;},
    };
    viewers.push(viewer);viewer.notify('loading');
    viewer.ready=Promise.resolve().then(()=>{viewer.notify('ready');return !viewer.destroyed;});
    return viewer;
  }};
  e.context.window.ChenchenWritingPractice={create(options){
    const practice={destroyed:false,character:options.character,options,paused:false,restarts:0,
      current:{status:'loading',total:4,completed:0,totalMistakes:0,hintsUsed:0,outlineShown:!!options.showOutline},
      state(status,overrides={}) {
        Object.assign(this.current,overrides,{status});
        options.onState?.({...this.current});
      },
      getState(){return {...this.current};},
      pause(){if(['complete','error'].includes(this.current.status))return false;this.paused=true;this.state('paused');return true;},
      resume(){if(['complete','error'].includes(this.current.status))return false;this.paused=false;this.state('active');return true;},
      restart(next={}){this.restarts++;this.paused=false;this.state('active',{completed:0,totalMistakes:0,hintsUsed:0,outlineShown:next.showOutline??this.current.outlineShown});return Promise.resolve(true);},
      showHint(){this.state('active',{hintsUsed:this.current.hintsUsed+1});return Promise.resolve(true);},
      destroy(){this.destroyed=true;},
      fail(){this.state('error');options.onError?.('stroke-data-unavailable');},
      // Deliberately deliver even stale/error callbacks to verify page guards.
      complete(overrides={}) {
        if(!this.destroyed && this.current.status==='active')this.state('complete',{completed:this.current.total});
        return options.onComplete?.({engine:'hanzi-writer-3.7.3',method:'stroke-quiz',totalStrokes:this.current.total,completedStrokes:this.current.total,
          totalMistakes:this.current.totalMistakes,hintsUsed:this.current.hintsUsed,outlineShown:this.current.outlineShown,...overrides});
      },
    };
    practices.push(practice);practice.state('loading');
    practice.ready=Promise.resolve().then(()=>{
      if(practice.destroyed)return false;
      if(settings.failPractice){practice.fail();return false;}
      practice.state('active');return true;
    });
    return practice;
  }};
  return {viewers,voices,practices};
}

// The real playback module runs here; only the browser's media element is fake.
// That lets a detail-page click prove that resume keeps the recording position.
function poemMediaProbe(e) {
  const recordings=[];
  e.context.window.Audio=class {
    constructor(){this.currentTime=0;this.playCount=0;this.paused=true;recordings.push(this);}
    play(){this.playCount++;this.paused=false;return Promise.resolve();}
    pause(){this.paused=true;}
    load(){this.currentTime=0;}
    removeAttribute(name){delete this[name];}
    emit(name){this['on'+name]?.();}
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/speech.js'),'utf8'),e.context);
  e.context.ChenchenSpeech=e.context.window.ChenchenSpeech;
  return {recordings,speech:e.context.ChenchenSpeech};
}

const samplePoems=()=>[
  {id:'poem-01',title:'静夜思',author:'李白',dynasty:'唐',lines:[{text:'床前明月光',chars:[{c:'床',p:'chuáng'}]}]},
  {id:'poem-02',title:'春晓',author:'孟浩然',dynasty:'唐',lines:[{text:'春眠不觉晓',chars:[{c:'春',p:'chūn'}]}]},
  {id:'poem-03',title:'早发白帝城',author:'李白',dynasty:'唐',lines:[{text:'朝辞白帝彩云间',chars:[{c:'朝',p:'zhāo'}]}]},
];
const tests=[];
function test(name,run){tests.push({name,run});}

test('server is sole source; GET-only loading and a fresh page read current server data',async()=>{
  const e=environment({items:{a:course('a')}}),t=e.subject;
  assert.equal(t.isReady(),false);assert.deepEqual(copy(t.loadState().items),{});
  assert.equal(await e.connect(),true);assert.equal(t.getItem('a').title,'a');
  assert.equal(e.requests.length,1);assert.equal(e.requests[0].method,'GET');
  e.alterServer(state=>{delete state.items.a;state.items.b=course('b');});await t.syncNow();
  assert.equal(t.getItem('a'),null);assert.ok(t.getItem('b'));assert.ok(e.requests.every(r=>r.method==='GET'));
  const other=environment(e.db());await other.connect();assert.equal(other.subject.getItem('a'),null);assert.ok(other.subject.getItem('b'));
});


test('poem detail returns to the same filtered search and list scroll position',async()=>{
  const poems=samplePoems(),items=Object.fromEntries(poems.map(poem=>[poem.id,course(poem.id)]));
  const e=environment({items}),t=e.subject;t.setPoems(poems);await e.connect();
  t.navigate('poems');
  e.element('#poem-search').listeners.input({target:{value:'李白'}});
  t.setPoemFilter('due');await t.renderPoems();
  const list=e.element('poems-content').innerHTML;
  assert.match(list,/value="李白"/);assert.match(list,/data-f="due" class="active"/);
  assert.equal((list.match(/class="poem-card"/g)||[]).length,2);
  e.context.window.scrollY=864;t.openPoemFromList('poem-03');await flush();
  assert.equal(t.getView(),'poem-detail');assert.equal(t.getPoemId(),'poem-03');
  assert.equal(e.context.window.scrollY,0,'Opening a poem starts at the detail heading');
  e.element('back-poems').onclick();await flush();
  assert.equal(t.getView(),'poems');assert.equal(t.getPoemQuery(),'李白');
  assert.equal(e.element('poems-content').innerHTML,list,'Returning must preserve both the search and due filter');
  assert.equal(e.context.window.scrollY,864,'Returning must restore the originating list position');
  assert.equal(e.scrolls.at(-1).behavior,'instant','A queued smooth scroll must not fight list restoration');
  assert.ok(e.requests.every(request=>request.method==='GET'),'Browsing must not record practice');
});


test('a poem opened from scheduled review returns to the list top without stale browsing scroll',async()=>{
  const poems=samplePoems(),item=course('poem-02'),e=environment({items:{[item.id]:item}}),t=e.subject;
  t.setPoems(poems);await e.connect();t.navigate('poems');
  e.context.window.scrollY=1240;t.openPoemFromList('poem-01');await flush();
  e.element('back-poems').onclick();await flush();assert.equal(e.context.window.scrollY,1240);
  t.navigate('home');await flush();
  const session={items:[item],index:0};t.setSession(session);t.openReviewItem(item.id,'poem');await flush();
  assert.equal(t.getView(),'poem-detail');assert.equal(t.getSession(),session);
  e.element('back-poems').onclick();await flush();
  assert.equal(t.getView(),'poems');assert.equal(e.context.window.scrollY,0);
  assert.equal(t.getSession(),null);assert.equal(t.getItem(item.id).stage,0);
  assert.equal(Object.keys(t.loadState().activity).length,0);
  assert.ok(e.requests.every(request=>request.method==='GET'));
});


test('poem detail has one reading button without hide toggles or playback instructions',async()=>{
  const poems=samplePoems(),e=environment({items:{'poem-01':course('poem-01')}}),t=e.subject;
  t.setPoems(poems);t.setPoemIllustrations({'poem-01':{src:'images/poems/poem-01.png',hint:'看图背古诗'}});
  await e.connect();t.openPoemFromList('poem-01');await flush();
  const html=e.element('poem-detail-content').innerHTML;
  assert.equal((html.match(/id="btn-speak"/g)||[]).length,1);
  assert.doesNotMatch(html,/id="(?:hide-poem|hide-pinyin|btn-speak-pause|btn-speak-stop|audio-caption)"/);
  assert.doesNotMatch(html,/藏起汉字|隐藏汉字|收起拼音|隐藏拼音|AI\s*合成|自然语音|看图想一想|看图背古诗/);
  assert.match(html,/class="py">chuáng/,'Pinyin stays visible with the poem');
  assert.match(html,/class="hz">床/,'Characters stay visible with the poem');
  assert.match(html,/<figure class="poem-picture">/,'Removing instructions must retain the illustration');
});


test('one poem reading button pauses while loading or speaking and resumes the same recording',async()=>{
  const poems=samplePoems(),e=environment(),t=e.subject;t.setPoems(poems);await e.connect();
  const media=poemMediaProbe(e),before=e.db();t.openPoemFromList('poem-01');await flush();
  const button=e.element('btn-speak');assert.equal(button.textContent,'▶ 朗读');
  button.onclick();assert.equal(media.speech.getStatus(),'loading');assert.equal(button.textContent,'Ⅱ 暂停');
  assert.equal(button.disabled,false,'Loading must still allow the same button to pause');
  const recording=media.recordings[0];assert.equal(recording.src,'/audio/poems/poem-01.mp3');
  button.onclick();assert.equal(media.speech.getStatus(),'paused');assert.equal(button.textContent,'▶ 继续');
  assert.equal(recording.paused,true);
  button.onclick();assert.equal(media.recordings.length,1,'Resume must not restart a new recording');
  assert.equal(recording.playCount,2);recording.emit('playing');recording.currentTime=7.5;
  button.onclick();assert.equal(media.speech.getStatus(),'paused');assert.equal(button.textContent,'▶ 继续');
  button.onclick();assert.equal(recording.currentTime,7.5,'Continue must retain the paused time');
  assert.equal(recording.playCount,3);assert.equal(media.recordings.length,1);
  recording.emit('playing');assert.equal(button.textContent,'Ⅱ 暂停');
  recording.emit('ended');assert.equal(media.speech.getStatus(),'idle');assert.equal(button.textContent,'▶ 朗读');
  assert.deepEqual(e.db(),before);assert.ok(e.requests.every(request=>request.method==='GET'),'Listening is not completion');
});


test('leaving a poem detail stops its loading or playing audio without recording completion',async()=>{
  for(const playing of [false,true]) {
    const poems=samplePoems(),e=environment(),t=e.subject;t.setPoems(poems);await e.connect();
    const media=poemMediaProbe(e);t.openPoemFromList('poem-01');await flush();
    e.element('btn-speak').onclick();const recording=media.recordings[0];
    if(playing) recording.emit('playing');
    e.element('back-poems').onclick();await flush();
    assert.equal(t.getView(),'poems');assert.equal(media.speech.getStatus(),'idle');
    assert.equal(recording.paused,true);assert.equal(recording.src,undefined,'Leaving must release the media request');
    assert.equal(Object.keys(t.loadState().activity).length,0);
    assert.ok(e.requests.every(request=>request.method==='GET'));
  }
});


test('late poem detail rendering cannot replace a newer selection or reopen a closed detail',async()=>{
  for(const next of ['poem-03','poems']) {
    const poems=samplePoems(),e=environment(),t=e.subject;t.setPoems(poems);await e.connect();
    let release;t.setPoemsLoadPromise(new Promise(resolve=>{release=resolve;}));
    const detail=e.element('poem-detail-content');detail.innerHTML='previous detail';
    t.openPoemFromList('poem-01');
    if(next==='poems') t.navigate('poems');
    else {
      t.setPoemsLoadPromise(Promise.resolve(poems));
      await t.openPoemFromList(next);
      assert.match(detail.innerHTML,/朝/,'The newer selection must render before the old request completes');
    }
    release(poems);await flush();
    if(next==='poems') {
      assert.equal(t.getView(),'poems');assert.equal(detail.innerHTML,'previous detail');
    } else {
      assert.equal(t.getView(),'poem-detail');assert.equal(t.getPoemId(),next);
      assert.match(detail.innerHTML,/朝/);assert.doesNotMatch(detail.innerHTML,/chuáng/);
    }
    assert.ok(e.requests.every(request=>request.method==='GET'));
  }
});


test('historical custom poems stay browsable while removed poems and all activity remain unchanged',async()=>{
  const poems=samplePoems(),removed=poems[0].id;
  const custom={id:'custom-poem-legacy',title:'旧课堂诗',author:'',lines:[{text:'春天来了',chars:[{c:'春',p:'chūn'}]}]};
  const activity={old:{day:'2026-09-30',id:removed,type:'poem'},custom:{day:'2026-09-30',id:custom.id,type:'poem'}};
  const e=environment({items:{[custom.id]:course(custom.id)},customPoems:{[custom.id]:custom},hiddenCourses:{[removed]:{removedAt:'2026-09-30T12:00:00Z'}},activity}),t=e.subject;
  t.setPoems(poems);const before=e.db();await e.connect();await t.renderPoems();
  assert.match(e.element('poems-content').innerHTML,/data-id="custom-poem-legacy"/);
  assert.ok(!e.element('poems-content').innerHTML.includes(`data-id="${removed}"`));
  await t.openPoemFromList(custom.id);assert.equal(t.getPoemId(),custom.id);
  assert.match(e.element('poem-detail-content').innerHTML.replace(/<[^>]*>/g,''),/旧课堂诗/);
  assert.deepEqual(copy(t.loadState().customPoems[custom.id]),custom);
  assert.deepEqual(copy(t.loadState().activity),activity);assert.deepEqual(e.db(),before);
  assert.ok(e.requests.every(request=>request.method==='GET'));
});


test('one writing library sorts by stroke count and preserves custom identity, pronunciation and words',async()=>{
  const character={id:'custom-classroom-mu',c:'木',strokes:'4画',tip:'老师的提示'};
  const e=environment({customCharacters:{[character.id]:character}}),t=e.subject;await e.connect();
  const cards=t.writingCharacters(),counts=cards.map(ch=>Number.parseInt(ch.strokes,10));
  assert.equal(cards.length,151);assert.equal(cards[0].c,'一');assert.equal(cards.at(-1).c,'蓝');
  assert.ok(counts.every((count,index)=>!index || count>=counts[index-1]),'Simpler stroke counts must come first');
  const custom=cards.find(ch=>ch.id===character.id);
  assert.equal(custom.id,character.id);assert.equal(custom.tip,'老师的提示');assert.equal(custom.pinyin,'mù');
  assert.equal(custom.words.length,3);assert.ok(custom.words.every(word=>word.text.includes('木')));
  t.navigate('write');assert.equal(t.getWritingId(),null,'Opening the library must not choose a character');
  assert.doesNotMatch(e.element('write-content').innerHTML,/data-write-level|class="write-group"/);
  assert.ok(e.requests.every(request=>request.method==='GET'),'Opening the expanded library must not enroll or complete anything');
});


test('writing opens a list of all 150 characters without a canvas, media or progress mutation',async()=>{
  const e=environment(),t=e.subject;await e.connect();const media=writingMediaProbe(e);
  const before=e.db();t.navigate('write');
  assert.equal(t.getView(),'write');assert.equal(t.getWritingId(),null);
  const html=e.element('write-content').innerHTML;
  assert.equal((html.match(/data-write-id=/g)||[]).length,150,'Every character must be selectable from the first page');
  assert.doesNotMatch(html,/<canvas\b|id="write-strokes-play"|id="write-finish"/,'The library must not include writing-detail controls');
  assert.equal(media.viewers.length,0);assert.equal(media.voices.length,0);
  assert.deepEqual(e.db(),before);assert.ok(e.requests.every(request=>request.method==='GET'));
});


test('selecting a character opens its detail and returning stops media without completing it',async()=>{
  const e=environment(),t=e.subject;await e.connect();const media=writingMediaProbe(e);
  t.navigate('write');t.openWriteCharacter('write-char-6728');await flush();
  assert.equal(t.getView(),'write-detail');assert.equal(t.getWritingId(),'write-char-6728');
  const html=e.element('write-detail-content').innerHTML;
  assert.match(html,/id="write-practice-layer"/);assert.match(html,/id="write-back"/);
  assert.doesNotMatch(html,/<canvas\b|家长确认|id="write-(?:finish|paper|check-independent)"/);
  assert.doesNotMatch(html,/data-write-id=/,'The detail page must not repeat the character library');
  assert.equal(media.viewers.length,1);assert.equal(media.viewers[0].character,'木');
  e.element('write-strokes-play').onclick();assert.equal(media.viewers[0].playing,true);
  e.element('write-back').onclick();
  assert.equal(t.getView(),'write');assert.equal(t.getSession(),null);
  assert.equal(media.viewers[0].destroyed,true);assert.equal(media.voices[0].destroyed,true);assert.equal(media.practices[0].destroyed,true);
  assert.equal(Object.keys(t.loadState().activity).length,0);assert.deepEqual(e.db().items,{});
  assert.ok(e.requests.every(request=>request.method==='GET'),'Leaving an unfinished detail must not save completion');
});


test('returning from a scheduled writing detail exits the session without advancing review',async()=>{
  const item=course('write-char-6728','write'),e=environment({items:{[item.id]:item}}),t=e.subject;
  await e.connect();const media=writingMediaProbe(e),before=e.db();
  const session={items:[item],index:0};t.setSession(session);t.openReviewItem(item.id,'write');await flush();
  assert.equal(t.getView(),'write-detail');assert.equal(t.getSession(),session);
  e.element('write-back').onclick();
  assert.equal(t.getView(),'write');assert.equal(t.getSession(),null);
  assert.equal(media.viewers[0].destroyed,true);assert.equal(media.voices[0].destroyed,true);assert.equal(media.practices[0].destroyed,true);
  assert.deepEqual(e.db(),before);assert.equal(t.getItem(item.id).stage,0);
});


test('initial connection failure has a retry and cannot report successful practice',async()=>{
  const e=environment(),t=e.subject;e.hold(true);const initialization=t.initializePage();(await e.nextRequest()).fail();await initialization;
  assert.equal(t.isReady(),false);assert.match(e.element('home-content').innerHTML,/id="retry-connection"/);
  const view=t.getView();t.navigate('pinyin');assert.equal(t.getView(),view);
  await t.completePractice('pinyin-basic','remember',{type:'pinyin'});assert.equal(Object.keys(t.loadState().activity).length,0);
  assert.doesNotMatch(e.element('home-content').innerHTML,/你的小花开啦/);
  const retry=e.element('retry-connection').onclick();(await e.nextRequest()).reply();await retry;assert.equal(t.isReady(),true);
});


test('normal English navigation continues to open the card library',async()=>{
  const item=course('pinyin-basic','pinyin'),e=environment({items:{[item.id]:item}}),t=e.subject;
  await e.connect();const opened=[];
  e.context.window.ChenchenEnglish={create:()=>({open:options=>opened.push(options),stop:()=>{},pause:()=>{}})};
  t.setSession({items:[item],index:0});t.navigate('english');
  assert.equal(t.getView(),'english');assert.equal(t.getSession(),null);
  assert.equal(opened.length,1);assert.equal(opened[0],undefined,'The navigation tab must not start the daily lesson');
  assert.ok(e.requests.every(request=>request.method==='GET'));
});


function makeGroup(type='poem',mode='learn') {
  const size={poem:5,pinyin:10,write:5,english:5}[type];
  const entries=Array.from({length:size},(_,index)=>({id:`${type}-group-${index}`,type,title:`${type} ${index}`,skill:type==='poem'?'poem-recitation':type==='write'?'hanzi-writing':'pinyin-reading',source:'parent',result:['independent','supported','again'][index%3],details:{afterPractice:false}}));
  return {id:'complete-test-group',type,mode,title:type,count:size,unit:'个',items:entries.map(entry=>({id:entry.id,type,title:entry.title})),index:size,entries,saving:false};
}

function beginCompleted(e,group=makeGroup()) {
  e.subject.setSession(group);
  return {group,save:e.subject.saveStudyGroup(group)};
}

test('free poem cards keep reading available but never show completion ratings',async()=>{
  const e=environment(),t=e.subject;t.setPoems(samplePoems());await e.connect();await t.openPoemFromList('poem-01');
  assert.doesNotMatch(e.element('poem-detail-content').innerHTML,/id="poem-check-(?:independent|supported|again)"/);
  assert.match(e.element('poem-detail-content').innerHTML,/id="btn-speak"/);
  assert.ok(e.requests.every(request=>request.method==='GET'));
});

test('home offers even one due item without future filler',async()=>{
  const poems=[...samplePoems(),...samplePoems().slice(0,2).map((poem,i)=>({...poem,id:`poem-fill-${i}`}))];
  const items=Object.fromEntries(poems.map(poem=>[poem.id,course(poem.id,'poem',{nextReview:'2026-10-04'})]));
  const e=environment({items}),t=e.subject;t.setPoems(poems);await e.connect();t.setView('home');await t.renderHome();
  assert.equal(e.context.lastGardenHooks.reviewGroups.length,0);
  e.alterServer(state=>{state.items['poem-02'].nextReview='2026-09-28';});await t.syncNow();await t.renderHome();
  assert.equal(e.context.lastGardenHooks.reviewGroups.length,1);assert.equal(e.context.lastGardenHooks.reviewGroups[0].items.length,1);
  await t.startStudyGroup('poem','review');await flush();
  assert.equal(t.getSession().items[0].id,'poem-02');assert.equal(t.getSession().items.filter(item=>item.afterPractice).length,0);
  t.navigate('poems');assert.equal(t.getSession(),null);
  assert.ok(e.requests.filter(request=>request.method==='POST').every(request=>request.url==='/api/study-sessions'));
});

test('a daily plan saves its prefix and resumes after leaving or reloading',async()=>{
  const e=environment(),t=e.subject;await e.connect();await t.startStudyGroup('write','learn');await flush();
  const group=t.getSession();assert.equal(group.items.length,2);assert.equal(group.index,0);assert.equal(t.getView(),'write-detail');
  const item=group.items[0];await t.completePractice(item.id,'remember',{type:'write',title:item.title,skill:'hanzi-writing',details:{afterPractice:true}});
  assert.equal(group.entries.length,1);assert.equal(t.getSession().index,1);
  t.navigate('write');assert.equal(t.getSession(),null);assert.equal(Object.keys(t.loadState().activity).length,0);
  assert.equal(e.db().studySessions[group.id].entries.length,1);
  const resumed=environment(e.db());await resumed.connect();await resumed.subject.startStudyGroup('write','learn');await flush();
  assert.equal(resumed.subject.getSession().id,group.id);assert.equal(resumed.subject.getSession().index,1);
  assert.equal(resumed.subject.getWritingId(),group.items[1].id);
  assert.equal(Object.keys(resumed.db().garden.groups).length,0);
  assert.ok(e.requests.filter(request=>request.method==='POST').every(request=>request.url==='/api/study-sessions'));
});

test('pending and failed whole-group saves do not claim water or update the local snapshot',async()=>{
  const e=environment(),t=e.subject;await e.connect();e.hold(true);const {group,save}=beginCompleted(e),request=await e.nextRequest();
  assert.equal(request.method,'POST');assert.equal(Object.keys(t.loadState().activity).length,0);assert.equal(group.saving,true);
  request.fail();await save;assert.equal(Object.keys(t.loadState().activity).length,0);assert.equal(group.saving,false);
  assert.doesNotMatch(e.element('home-content').innerHTML,/收获一滴水/);
  const retry=t.saveStudyGroup(group);(await e.nextRequest()).reply();await retry;
  assert.equal(Object.keys(t.loadState().activity).length,5);assert.equal(t.getSession(),null);assert.match(e.element('home-content').innerHTML,/收获一滴水/);
});

test('a 15-second save timeout unlocks same-ID retry without treating the outcome as a definite failure',async()=>{
  for(const committed of [false,true]) {
    const e=environment(),t=e.subject;await e.connect();e.hold(true);
    const {group,save}=beginCompleted(e),first=await e.nextRequest(),body=copy(first.body);
    if(committed)first.commitWithoutResponse();
    const timeout=[...e.timers.values()].find(timer=>timer.delay===15000);
    assert.ok(timeout,'Every API request needs a bounded wait');timeout.fn();await save;
    assert.equal(first.options.signal.aborted,true);assert.equal(group.saving,false);
    assert.equal(group.definiteFailure,false);assert.equal(e.element('study-save-retry').hidden,false);
    assert.equal(Object.keys(t.loadState().activity).length,0);
    assert.ok(![...e.timers.values()].some(timer=>timer.delay===15000),'A settled request clears its deadline');
    t.navigate('write');assert.equal(t.getSession(),group);assert.equal(t.getView(),'home');
    const retry=e.element('study-save-retry').onclick(),second=await e.nextRequest();
    assert.deepEqual(second.body,body);second.reply();await retry;
    assert.equal(t.getSession(),null);assert.equal(Object.keys(e.db().activity).length,5);
    assert.equal(Object.keys(e.db().garden.groups).length,1);
    assert.ok(![...e.timers.values()].some(timer=>timer.delay===15000),'Successful retry clears its deadline too');
  }
});

test('malformed whole-group acknowledgements never look like a successful completion',async()=>{
  for(const response of [{status:200,jsonError:true},{status:200,data:{}},{status:200,data:{ok:true,payload:{items:[]}}}]) {
    const e=environment(),t=e.subject;await e.connect();e.hold(true);const {save}=beginCompleted(e);
    (await e.nextRequest()).reply(response);await save;
    assert.equal(Object.keys(t.loadState().activity).length,0);assert.ok(t.getSession());assert.doesNotMatch(e.element('home-content').innerHTML,/收获一滴水/);
  }
});

test('a lost group acknowledgement retries the same ID and evidence even across midnight',async()=>{
  const e=environment(),t=e.subject;await e.connect();e.hold(true);const {group,save}=beginCompleted(e);
  const first=await e.nextRequest();first.commitThenLoseResponse();await save;
  assert.equal(Object.keys(e.db().activity).length,5);assert.equal(Object.keys(t.loadState().activity).length,0);
  e.at('2026-10-02');const retry=t.saveStudyGroup(group),second=await e.nextRequest();
  assert.deepEqual(second.body,first.body);second.reply();await retry;
  assert.equal(Object.keys(e.db().activity).length,5);assert.equal(Object.keys(e.db().garden.groups).length,1);
  assert.equal(Object.values(t.loadState().activity)[0].day,'2026-10-01');
});

test('a definite review deletion conflict cannot recreate content and permits a fresh start',async()=>{
  const group=makeGroup('poem','review'),items=Object.fromEntries(group.items.map(item=>[item.id,course(item.id)]));
  const e=environment({items}),t=e.subject;await e.connect();e.alterServer(state=>{delete state.items[group.items[0].id];state.hiddenCourses[group.items[0].id]=true;});
  await beginCompleted(e,group).save;
  assert.equal(Object.keys(e.db().activity).length,0);assert.equal(Object.keys(e.db().garden.groups).length,0);
  assert.equal(t.getSession().definiteFailure,true);t.navigate('poems');assert.equal(t.getSession(),null);
});

test('an uncertain whole-group save prevents navigation and duplicate completion',async()=>{
  const e=environment(),t=e.subject;await e.connect();e.hold(true);const {group,save}=beginCompleted(e);const first=await e.nextRequest();
  t.navigate('write');assert.equal(t.getView(),'home');assert.equal(t.getSession(),group);
  await t.saveStudyGroup(group);assert.equal(e.requests.filter(r=>r.method==='POST').length,1);
  first.reply();await save;assert.equal(t.getSession(),null);
});

test('poem ratings and immediate audio exposure remain distinct inside the temporary group',async()=>{
  for(const result of ['independent','supported','again']) {
    const e=environment(),t=e.subject,poems=samplePoems();t.setPoems(poems);await e.connect();
    t.setSession({id:'poem-rating',type:'poem',mode:'review',title:'古诗',count:5,items:poems.map(poem=>({id:poem.id,type:'poem',title:poem.title})),index:0,entries:[]});
    t.openReviewItem('poem-01','poem');await flush();
    await e.element(`poem-check-${result}`).onclick();const entry=t.getSession().entries[0];
    assert.equal(entry.result,result);assert.equal(entry.source,'parent');assert.equal(entry.skill,'poem-recitation');assert.equal(entry.details.observedExposure,false);
    assert.ok(e.requests.filter(request=>request.method==='POST').every(request=>request.url==='/api/study-sessions'));
  }
  const e=environment(),t=e.subject,poems=samplePoems();t.setPoems(poems);await e.connect();const media=poemMediaProbe(e);
  t.setSession({items:poems.map(poem=>({id:poem.id,type:'poem',title:poem.title})),index:0});t.openReviewItem('poem-01','poem');await flush();
  e.element('btn-speak').onclick();media.recordings[0].emit('playing');media.recordings[0].emit('ended');await e.element('poem-check-independent').onclick();
  assert.equal(t.getSession().entries[0].details.observedExposure,true);assert.equal(Object.keys(t.loadState().activity).length,0);
});

function beginWritingReview(e,media,extra={}) {
  const ids=['write-char-6728','write-char-6c34','write-char-4e00'];
  e.subject.setSession({id:'write-review',type:'write',mode:'review',title:'汉字',count:ids.length,
    items:ids.map(id=>({id,type:'write'})),index:0,entries:[],...extra});
  e.subject.openReviewItem(ids[0],'write');
  return media.practices.at(-1);
}

test('writing review automatically records an unassisted stroke quiz without parent confirmation',async()=>{
  const e=environment(),t=e.subject;await e.connect();const media=writingMediaProbe(e);
  const practice=beginWritingReview(e,media);await flush();
  const html=e.element('write-detail-content').innerHTML;
  assert.match(html,/id="write-practice-layer"/);
  assert.doesNotMatch(html,/家长确认|纸上|id="write-(?:finish|paper|check-independent|assessment)"/);
  assert.equal(practice.options.showOutline,false,'Review must start without the character model');
  assert.match(html,/<[^>]*id="write-words-panel"[^>]*\bhidden\b[^>]*>/,'Word examples also reveal the answer');
  await e.element('write-pronounce').onclick();
  assert.equal(t.getSession().entries.length,0,'Hearing the prompt does not complete writing');
  await practice.complete();await flush();const entry=t.getSession().entries[0];
  assert.equal(entry.result,'independent');assert.equal(entry.source,'automatic');assert.equal(entry.skill,'hanzi-writing');
  assert.equal(entry.details.method,'stroke-quiz');assert.equal(entry.details.engine,'hanzi-writer-3.7.3');
  assert.equal(entry.details.totalStrokes,4);assert.equal(entry.details.completedStrokes,4);
  assert.equal(entry.details.afterPractice,false);assert.equal(entry.details.outlineShown,false);
  assert.equal(Object.keys(t.loadState().activity).length,0,'One character checkpoints the group; it does not award completion');
});

test('mistakes and every form of writing help produce supported evidence',async()=>{
  for(const assistance of ['mistake','hint','auto-hint','words','demo','restart','outline']) {
    const e=environment(),t=e.subject;await e.connect();const media=writingMediaProbe(e);
    let practice=beginWritingReview(e,media);await flush();
    if(assistance==='hint')await e.element('write-hint').onclick();
    if(assistance==='auto-hint')practice.state('active',{hintsUsed:1,totalMistakes:3});
    if(assistance==='words')e.element('write-show-words').onclick();
    if(assistance==='demo'){
      e.element('write-strokes-play').onclick();media.viewers.at(-1).notify('complete');
      assert.equal(t.getSession().entries.length,0,'A played demonstration must not complete the quiz');
    }
    if(assistance==='restart'){await e.element('write-clear').onclick();practice=media.practices.at(-1);}
    await practice.complete(assistance==='mistake'?{totalMistakes:1}:assistance==='outline'?{outlineShown:true}:{});await flush();
    const entry=t.getSession().entries[0];
    assert.equal(entry.result,'supported',`${assistance}: assisted writing must not become independent evidence`);
    assert.equal(entry.source,'automatic');
    if(['hint','auto-hint','words','demo','restart'].includes(assistance)) assert.equal(entry.details.afterPractice,true,`${assistance}: practice exposure must be retained`);
    if(assistance==='words')assert.equal(practice.options.showOutline,false,'Word reveal alone must not change initial quiz mode');
  }
});

test('duplicate writing completion and callbacks from a departed page cannot advance another character',async()=>{
  const e=environment(),t=e.subject;await e.connect();const media=writingMediaProbe(e);
  const first=beginWritingReview(e,media);await flush();
  const completion=first.complete(),duplicate=first.complete();await Promise.all([completion,duplicate]);await flush();
  assert.equal(t.getSession().entries.length,1);assert.equal(t.getSession().index,1);
  await first.complete();await flush();assert.equal(t.getSession().entries.length,1);
  const second=media.practices.at(-1);t.navigate('write');assert.equal(second.destroyed,true);
  await second.complete();await flush();assert.equal(t.getSession(),null);
  assert.equal(Object.values(e.db().studySessions)[0].entries.length,1);
  assert.equal(Object.keys(e.db().activity).length,0);assert.equal(Object.keys(e.db().garden.groups).length,0);
});

test('writing cannot complete during a demonstration or after a data loading error',async()=>{
  for(const mode of ['demo','error']) {
    const e=environment(),t=e.subject;await e.connect();const media=writingMediaProbe(e,{failPractice:mode==='error'});
    const practice=beginWritingReview(e,media);await flush();
    if(mode==='demo')e.element('write-strokes-play').onclick();
    await practice.complete();await flush();
    assert.equal(t.getSession().entries.length,0,`${mode}: unavailable input must never count as completed writing`);
    assert.ok(e.requests.every(request=>request.method==='GET'));
    if(mode==='error'){
      assert.equal(e.element('write-retry').hidden,false);
      assert.equal(e.element('write-hint').disabled,true);
    }
  }
});

test('free writing uses automatic feedback without creating a learning record',async()=>{
  const e=environment(),t=e.subject;await e.connect();const media=writingMediaProbe(e),before=e.db();
  t.openWriteCharacter('write-char-6728');await flush();const practice=media.practices.at(-1);
  assert.equal(practice.options.showOutline,true);
  await practice.complete();await flush();
  assert.equal(t.getSession(),null);assert.deepEqual(e.db(),before);
  assert.ok(e.requests.every(request=>request.method==='GET'));
});

test('seeing the free poem text counts as exposure even if playback fails, and expires next day',async()=>{
  for(const scenario of ['interrupted','failed','next-day']) {
    const e=environment(),t=e.subject,poems=samplePoems();t.setPoems(poems);await e.connect();const media=poemMediaProbe(e);
    await t.openPoemFromList('poem-01');e.element('btn-speak').onclick();
    media.recordings[0].emit(scenario==='failed'?'error':'playing');
    t.navigate('poems');if(scenario==='next-day')e.at('2026-10-02');
    assert.equal(Object.keys(t.loadState().activity).length,0);
    t.setSession({type:'poem',mode:'review',items:poems.map(poem=>({id:poem.id,type:'poem'})),index:0});
    t.openReviewItem('poem-01','poem');await flush();await e.element('poem-check-independent').onclick();
    const entry=t.getSession().entries[0];assert.equal(entry.result,'independent');
    assert.equal(entry.details.observedExposure,scenario!=='next-day');
    assert.equal(Object.keys(t.loadState().activity).length,0);assert.ok(e.requests.filter(request=>request.method==='POST').every(request=>request.url==='/api/study-sessions'));
  }
});

test('free character models remain rehearsal evidence for same-day blind review only',async()=>{
  for(const nextDay of [false,true]) {
    const e=environment(),t=e.subject;await e.connect();const media=writingMediaProbe(e);
    t.openWriteCharacter('write-char-6728');await flush();t.navigate('write');
    if(nextDay)e.at('2026-10-02');
    t.setSession({type:'write',mode:'review',items:[{id:'write-char-6728',type:'write'},{id:'write-char-6c34',type:'write'}],index:0});
    t.openReviewItem('write-char-6728','write');await flush();await media.practices.at(-1).complete();await flush();
    const entry=t.getSession().entries[0];assert.equal(entry.result,nextDay?'independent':'supported');assert.equal(entry.details.afterPractice,!nextDay);
    assert.equal(Object.keys(t.loadState().activity).length,0);assert.ok(e.requests.filter(request=>request.method==='POST').every(request=>request.url==='/api/study-sessions'));
  }
});

test('custom characters without local stroke data remain browsable but never enter automatic study plans',async()=>{
  const unavailable={id:'custom-char-da',c:'龘',strokes:'48画',tip:'老师教的字'};
  const available={id:'custom-classroom-mu',c:'木',strokes:'4画',tip:'老师教的字'};
  const characters=[unavailable,available];
  const e=environment({customCharacters:Object.fromEntries(characters.map(ch=>[ch.id,ch])),items:Object.fromEntries(characters.map(ch=>[ch.id,course(ch.id,'write')]))}),t=e.subject;
  await e.connect();writingMediaProbe(e);t.navigate('write');
  assert.match(e.element('write-content').innerHTML,/data-write-id="custom-char-da"/,'Missing data must not erase saved custom content');
  t.openWriteCharacter(unavailable.id);await flush();assert.equal(t.getWritingId(),unavailable.id);
  t.navigate('write');
  const catalog=await t.studyCatalog();
  assert.ok(!catalog.some(item=>item.id===unavailable.id));assert.ok(catalog.some(item=>item.id===available.id));
  await t.startStudyGroup('write','review');await flush();
  assert.deepEqual(copy(t.getSession().items.map(item=>item.id)),[available.id]);
  assert.equal(t.getSession().entries.length,0);assert.equal(Object.keys(e.db().activity).length,0);
});

test('an unavailable writing catalog cannot start or complete a group and can be retried',async()=>{
  const e=environment(),t=e.subject;await e.connect();const media=writingMediaProbe(e);e.catalogUnavailable(true);
  await t.startStudyGroup('write','learn');await flush();
  assert.equal(t.getSession(),null);assert.equal(media.practices.length,0);
  assert.ok(e.requests.every(request=>request.method==='GET'),'Missing stroke data must not fabricate a study plan or completed evidence');
  assert.equal(Object.keys(e.db().activity).length,0);assert.equal(Object.keys(e.db().garden.groups).length,0);
  e.catalogUnavailable(false);await t.startStudyGroup('write','learn');await flush();
  assert.equal(t.getSession().type,'write');assert.equal(t.getSession().entries.length,0);assert.equal(media.practices.length,1);
  assert.equal(e.requests.filter(request=>request.url==='/data/writing-strokes.json').length,2,'The failed catalog request must be retried');
});

test('custom characters without pronunciation use a visible model and only supported evidence',async()=>{
  const id='custom-char-chen',character={id,c:'辰',strokes:'7画',tip:'老师教的字'};
  const e=environment({customCharacters:{[id]:character}}),t=e.subject;await e.connect();const media=writingMediaProbe(e);
  t.setSession({type:'write',mode:'review',items:[{id,type:'write'},{id:'write-char-6728',type:'write'}],index:0});t.openReviewItem(id,'write');await flush();
  const practice=media.practices.at(-1);assert.equal(practice.options.showOutline,true);
  assert.match(e.element('write-detail-content').innerHTML,/id="write-practice-layer"/);
  await practice.complete();await flush();
  const entry=t.getSession().entries[0];assert.equal(entry.result,'supported');assert.equal(entry.source,'automatic');
  assert.equal(entry.details.afterPractice,true);assert.equal(entry.details.outlineShown,true);assert.equal(Object.keys(t.loadState().activity).length,0);
});

test('revealing a poem answer is saved as exposure and mixed writing plans still begin with recall',async()=>{
  const e=environment(),t=e.subject,poems=samplePoems();t.setPoems(poems);await e.connect();
  t.setSession({type:'poem',mode:'review',items:poems.map(p=>({id:p.id,type:'poem',title:p.title,phase:'review'})),index:0});
  t.openReviewItem(poems[0].id,'poem');await flush();
  assert.match(e.element('poem-detail-content').innerHTML,/id="poem-body" hidden/);
  e.element('poem-reveal').onclick();assert.equal(e.element('poem-body').hidden,false);
  await e.element('poem-check-independent').onclick();
  assert.equal(t.getSession().entries[0].details.observedExposure,true);
  t.navigate('write');const media=writingMediaProbe(e);
  t.setSession({id:'mixed-writing',type:'write',mode:'learn',items:[{id:'write-char-6728',type:'write',title:'木',phase:'review'},{id:'write-char-6c34',type:'write',title:'水',phase:'learn'}],index:0});
  t.openReviewItem('write-char-6728','write');await flush();
  assert.equal(media.practices.at(-1).options.showOutline,false);
  await media.practices.at(-1).complete();await flush();
  assert.equal(t.getSession().entries[0].details.afterPractice,false);
  assert.equal(t.getSession().entries[0].result,'independent');
  assert.equal(media.practices.at(-1).options.showOutline,true,'The next learn-phase character shows its model');
});
test('a fully checkpointed draft resumes directly into one final commit',async()=>{
  const group=makeGroup(),state=emptyState();
  state.studySessions[group.id]={id:group.id,type:group.type,mode:group.mode,items:group.items,entries:group.entries.map(entry=>({...entry,day:'2026-09-30',at:'2026-09-30T10:00:00Z'})),createdAt:'2026-09-30T10:00:00Z'};
  const e=environment(state);await e.connect();await e.subject.startStudyGroup('poem','learn');
  assert.equal(e.subject.getSession(),null);
  assert.equal(Object.keys(e.db().activity).length,5);
  assert.equal(Object.values(e.db().activity)[0].day,'2026-09-30');
  assert.equal(Object.keys(e.db().studySessions).length,0);
  assert.equal(Object.keys(e.db().garden.groups).length,1);
});
test('a stale device can adopt the server answer prefix after a conflict',async()=>{
  const e=environment(),t=e.subject;await e.connect();await t.startStudyGroup('write','learn');await flush();
  const group=t.getSession(),first=group.items[0],second=group.items[1];
  const saved={id:first.id,type:'write',title:first.title,skill:'hanzi-writing',result:'supported',source:'parent',details:{afterPractice:true},day:'2026-10-01',at:'2026-10-01T01:00:00Z'};
  e.alterServer(state=>{state.studySessions[group.id].entries=[saved];});
  e.hold(true);
  const completion=t.completePractice(first.id,'remember',{type:'write',title:first.title,skill:'hanzi-writing'});
  (await e.nextRequest()).reply({status:409,data:{error:'study_session_conflict',message:'另一个设备已保存',payload:e.db()}});
  await completion;
  assert.equal(group.draftConflict,true);assert.match(e.element('home-content').innerHTML,/继续服务器已保存的进度/);
  e.hold(false);await e.element('study-checkpoint-retry').onclick({currentTarget:e.element('study-checkpoint-retry')});await flush();
  assert.equal(t.getSession().index,1);assert.equal(t.getWritingId(),second.id);
  assert.equal(t.getSession().entries[0].result,'supported');
});

async function main(){
  for(const {name,run} of tests){
    let timer;
    try {await Promise.race([run(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Timed out: ${name}`)),5000);})]);}
    finally {clearTimeout(timer);}
    console.log(`PASS ${name}`);
  }
  console.log(`${tests.length} progress regression groups passed`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
