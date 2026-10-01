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
 loadState, getItem, markLearned, removeClassroomItem, reviewPatch, recordPractice,
 todayStr, addDays, dueItems, syncNow, commitOperations, completePractice,
 navigate, bindSessionExit, openReviewItem, startReview, renderHome,
 writingCharacters, openWriteCharacter, openParent, initializePage, customPoemFromForm, renderPoems, renderPoemDetail,
 setPoemFilter: value => poemFilter=value,
 setView: value => currentView=value,
 setSession: value => reviewSession=value,
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
const emptyState = () => ({items:{},activity:{},customPoems:{},customCharacters:{},hiddenCourses:{}});
const course = (id,type='poem',extra={}) => ({id,type,title:id,learned:true,stage:0,nextReview:'2026-10-01',
  createdAt:'2026-09-30T12:00:00Z',updatedAt:'2026-09-30T12:00:00Z',...extra});

function environment(initial = {}) {
  let now = new Date('2026-10-01T01:30:00+08:00').getTime();
  let database = {...emptyState(),...copy(initial)};
  let holdRequests = false;
  let timerId = 0;
  const requests = [], timers = new Map(), elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      id,style:{},dataset:{},textContent:'',innerHTML:'',value:'',disabled:false,open:false,
      classList:{toggle:()=>false,add:()=>{},remove:()=>{}},
      querySelectorAll:()=>[],querySelector:selector=>element(selector),
      setAttribute:()=>{},removeAttribute:()=>{},addEventListener:()=>{},
      showModal(){this.open=true;},close(){this.open=false;},reset(){this.value='';},
      getContext:()=>({}),getBoundingClientRect:()=>({left:0,top:0,width:600,height:600}),
    });
    return elements.get(id);
  };
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length?args:[now])); }
    static now() { return now; }
  }
  // Only the documented API contract is modeled: atomic entry operations,
  // merge cannot recreate deletions, deleting a course cascades its activity.
  function serverResponse(request) {
    if (request.method==='GET') return {status:200,data:{found:true,payload:copy(database),updatedAt:database.updatedAt||0}};
    assert.equal(request.method,'PATCH','Never PUT a whole stale browser snapshot');
    const {operations,...other}=request.body;
    assert.deepEqual(other,{});
    if(!Array.isArray(operations)||!operations.length||operations.length>100) return {status:400,data:{error:'invalid_operations'}};
    const next=copy(database);
    for(const operation of operations) {
      const entries=next[operation.collection]||={};
      if(operation.op==='merge') {
        if(!Object.hasOwn(entries,operation.key)) return {status:409,data:{error:'entry_not_found',payload:copy(database),updatedAt:database.updatedAt||0}};
        entries[operation.key]={...entries[operation.key],...copy(operation.value)};
      } else if(operation.op==='create') {
        if(!Object.hasOwn(entries,operation.key)) entries[operation.key]=copy(operation.value);
      } else if(operation.op==='set') entries[operation.key]=copy(operation.value);
      else if(operation.op==='delete') {
        delete entries[operation.key];
        if(operation.collection==='items') {
          for(const [key,event] of Object.entries(next.activity)) if(event.id===operation.key) delete next.activity[key];
        }
      } else assert.fail(`Unknown operation ${operation.op}`);
    }
    next.updatedAt=Math.max(now,(database.updatedAt||0)+1);database=next;
    return {status:200,data:{ok:true,payload:copy(database),updatedAt:database.updatedAt}};
  }
  const context=vm.createContext({
    Date:FakeDate,Math,console,AbortController,crypto:require('crypto').webcrypto,
    document:{getElementById:element,querySelectorAll:()=>[],querySelector:element,
      addEventListener:()=>{},createElement:()=>element(`new${elements.size}`),body:{appendChild:()=>{}}},
    window:{scrollTo:()=>{},addEventListener:()=>{},confirm:()=>true},confirm:()=>true,
    setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),
    fetch:(url,options={})=>new Promise((resolve,reject)=>{
      const request={url,options,method:options.method||'GET',settled:false,body:options.body?JSON.parse(options.body):null,
        reply(override) { assert.equal(this.settled,false);this.settled=true;const result=override||serverResponse(this);
          resolve({ok:result.status>=200&&result.status<300,status:result.status,json:async()=>{
            if(result.jsonError) throw new SyntaxError('Unexpected token <');return copy(result.data);
          }}); },
        fail(){this.settled=true;reject(new Error('network unavailable'));},
        commitThenLoseResponse(){this.settled=true;serverResponse(this);reject(new Error('response lost'));},
      };
      assert.equal(url,'/api/progress');requests.push(request);
      if(!holdRequests) queueMicrotask(()=>request.reply());
    }),
  });
  for(const name of ['localStorage','sessionStorage','indexedDB']) {
    Object.defineProperty(context,name,{get(){throw new Error(`${name} must not be used`);}});
  }
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/writing-vocabulary.js'),'utf8'),context);
  vm.runInContext(instrumented,context,{filename:sourcePath});
  context.subject.setView('poems');context.subject.setPoems([]);
  return {context,subject:context.subject,requests,timers,elements,element,db:()=>copy(database),
    alterServer:change=>change(database),hold:value=>{holdRequests=value;},
    at:date=>{now=new Date(`${date}T01:30:00+08:00`).getTime();},connect:()=>context.subject.syncNow(),
    async nextRequest(){await flush();const request=requests.find(request=>!request.settled);assert.ok(request,'Expected pending request');return request;},
  };
}

// The real media modules have separate playback tests. This probe observes the
// detail page's lifetime without fetching assets or simulating SVG rendering.
function writingMediaProbe(e) {
  const viewers=[],voices=[];
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
  return {viewers,voices};
}
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

test('classroom poems open directly for review without an enrollment button or unlearned filter',async()=>{
  const poem={id:'poem-1',title:'静夜思',author:'李白',dynasty:'唐',lines:[{text:'床前明月光',chars:[{c:'床',p:'chuáng'}]}]};
  const e=environment({items:{[poem.id]:course(poem.id,'poem',{title:poem.title})}}),t=e.subject;
  t.setPoems([poem]);await e.connect();await t.renderPoems();
  assert.match(e.element('poems-content').innerHTML,/今天复习/);
  assert.doesNotMatch(e.element('poems-content').innerHTML,/还没学过|data-f="new"|data-f="learned"/);
  await t.renderPoemDetail(poem.id);
  assert.match(e.element('poem-detail-content').innerHTML,/data-r="remember"/);
  assert.doesNotMatch(e.element('poem-detail-content').innerHTML,/btn-enroll|加入复习|课上学过吗/);
  assert.ok(e.requests.every(request=>request.method==='GET'),'Rendering must not enroll from a stale browser snapshot');
  await t.openParent();assert.doesNotMatch(e.element('parent-dialog').innerHTML,/id="add-class-poem"/);
  assert.match(e.element('parent-dialog').innerHTML,/已有古诗都是课上学过的，已自动安排复习/);
  await t.recordPractice(poem.id,'poem','remember');
  t.setPoemFilter('due');await t.renderPoems();assert.doesNotMatch(e.element('poems-content').innerHTML,/class="poem-card"/);
  assert.match(e.element('poems-content').innerHTML,/今天的古诗都复习好啦/);
});

test('removing a built-in poem saves a tombstone and the parent can explicitly restore review',async()=>{
  const poem={id:'poem-1',title:'静夜思',lines:[{text:'床前明月光',chars:[]}]};
  const e=environment({items:{[poem.id]:course(poem.id)}}),t=e.subject;
  t.setPoems([poem]);await e.connect();await t.removeClassroomItem(poem.id);
  assert.ok(t.loadState().hiddenCourses[poem.id]);assert.equal(t.getItem(poem.id),null);
  await t.renderPoems();assert.doesNotMatch(e.element('poems-content').innerHTML,/class="poem-card"/);
  await t.openParent();assert.match(e.element('parent-dialog').innerHTML,/恢复复习/);
  e.element('parent-poem').value=poem.id;
  await e.element('restore-class-poem').onclick({currentTarget:e.element('restore-class-poem')});
  assert.equal(t.loadState().hiddenCourses[poem.id],undefined);assert.equal(t.getItem(poem.id).learned,true);
  assert.equal(t.getItem(poem.id).nextReview,'2026-10-01');
});

test('local dates and intervals 1, 2, 4, 7, 15, 30; same-day and early practice never advance again',async()=>{
  const e=environment(),t=e.subject;await e.connect();
  assert.equal(t.todayStr(),'2026-10-01');assert.equal(t.addDays('2026-12-31',1),'2027-01-01');assert.equal(t.addDays('2024-02-28',1),'2024-02-29');
  await t.markLearned('a',{type:'poem',title:'课堂古诗'});assert.equal(t.getItem('a').nextReview,'2026-10-01');
  const schedule=[['2026-10-01','2026-10-02'],['2026-10-02','2026-10-04'],['2026-10-04','2026-10-08'],
    ['2026-10-08','2026-10-15'],['2026-10-15','2026-10-30'],['2026-10-30','2026-11-29'],['2026-11-29','2026-12-29']];
  for(const [day,next] of schedule) {
    e.at(day);await t.recordPractice('a','poem','remember');assert.equal(t.getItem('a').nextReview,next,`After ${day}`);
    const before=copy(t.getItem('a'));await t.recordPractice('a','poem','remember');
    assert.deepEqual(copy(t.getItem('a')),before,'Same-day/free practice must not advance the interval');
  }
  const before=copy(t.getItem('a'));await t.markLearned('a',{type:'poem',title:'again'});assert.deepEqual(copy(t.getItem('a')),before);
  e.at('2026-12-29');await t.recordPractice('a','poem','forgot');assert.equal(t.getItem('a').stage,0);assert.equal(t.getItem('a').nextReview,'2026-12-30');
  const sameDay=t.reviewPatch({...course('x'),stage:4,reviewDay:'2026-12-29',reviewStartStage:2},'remember');
  assert.equal(sameDay.stage,3);assert.equal(sameDay.nextReview,'2027-01-02');
});

test('today shows due items oldest first; no due items never falls back to all learned content',async()=>{
  const e=environment({items:{future:course('future','pinyin',{nextReview:'2026-10-04'})}}),t=e.subject;await e.connect();await t.renderHome();
  assert.equal(t.dueItems().length,0);assert.doesNotMatch(e.element('home-content').innerHTML,/data-review="future"/);
  assert.match(e.element('home-content').innerHTML,/id="start-review"[^>]*disabled/);await t.startReview();assert.equal(t.getSession(),null);
  e.alterServer(state=>{state.items.today=course('today','pinyin');state.items.overdue=course('overdue','pinyin',{nextReview:'2026-09-28'});state.items.inactive=course('inactive','pinyin',{learned:false});});
  await t.syncNow();assert.deepEqual(copy(t.dueItems().map(item=>item.id)),['overdue','today']);
  await t.startReview();assert.deepEqual(copy(t.getSession().items.map(item=>item.id)),['overdue','today']);
});

test('pending/failed save never updates progress, flowers or session; retry succeeds',async()=>{
  const item=course('pinyin-basic','pinyin'),e=environment({items:{[item.id]:item}}),t=e.subject;await e.connect();
  t.setSession({items:[item],index:0});e.hold(true);const operation=t.completePractice(item.id,'remember',item);const request=await e.nextRequest();
  assert.equal(request.method,'PATCH');assert.equal(t.getItem(item.id).stage,0);assert.equal(Object.keys(t.loadState().activity).length,0);assert.equal(t.getSession().index,0);
  request.fail();await operation;assert.equal(t.getItem(item.id).stage,0);assert.equal(t.getSession().index,0);assert.equal(Object.keys(t.loadState().activity).length,0);
  assert.doesNotMatch(e.element('home-content').innerHTML,/你的小花开啦/);
  const retry=t.completePractice(item.id,'remember',item);(await e.nextRequest()).reply();await retry;
  assert.equal(t.getItem(item.id).nextReview,'2026-10-02');assert.equal(Object.keys(t.loadState().activity).length,1);assert.equal(t.getSession(),null);
  assert.match(e.element('home-content').innerHTML,/你的小花开啦/);
});

test('queued PATCHes address only changed entries and preserve independent server additions',async()=>{
  const e=environment(),t=e.subject;await e.connect();e.hold(true);
  const a=t.markLearned('a',{type:'poem',title:'a'}),first=await e.nextRequest();const b=t.markLearned('b',{type:'write',title:'b'});await flush();
  assert.equal(e.requests.filter(r=>!r.settled).length,1);assert.equal(t.getItem('a'),null);assert.equal(t.getItem('b'),null);
  e.alterServer(state=>{state.items.remote=course('remote');});first.reply();await a;const second=await e.nextRequest();
  assert.ok(first.body.operations.every(op=>op.key==='a'));assert.ok(second.body.operations.every(op=>op.key==='b'));
  second.reply();await b;assert.deepEqual(Object.keys(t.loadState().items).sort(),['a','b','remote']);
});

test('stale enrollment uses insert-if-absent and cannot reset another device\'s course progress',async()=>{
  const e=environment(),t=e.subject;await e.connect();
  const advanced=course('a','poem',{stage:4,nextReview:'2026-10-15',lastResult:'remember'});
  e.alterServer(state=>{state.items.a=copy(advanced);});
  await t.markLearned('a',{type:'poem',title:'a'});
  assert.deepEqual(copy(t.getItem('a')),advanced);
});

test('legacy paused courses resume without losing their stage or next review date',async()=>{
  const paused=course('paused','poem',{learned:false,stage:3,nextReview:'2026-10-08'});
  const missingDate=course('missing-date','write',{learned:false,stage:2,nextReview:null});
  const e=environment({items:{paused,'missing-date':missingDate}}),t=e.subject;
  await e.connect();assert.equal(t.dueItems().length,0);
  await t.markLearned('paused',{type:'poem',title:'paused'});
  assert.equal(t.getItem('paused').learned,true);
  assert.equal(t.getItem('paused').stage,3);
  assert.equal(t.getItem('paused').nextReview,'2026-10-08');
  assert.equal(t.dueItems().length,0,'Resuming must not make a future review due immediately');
  await t.markLearned('missing-date',{type:'write',title:'missing-date'});
  assert.equal(t.getItem('missing-date').learned,true);
  assert.equal(t.getItem('missing-date').stage,2);
  assert.equal(t.getItem('missing-date').nextReview,'2026-10-01');
  assert.deepEqual(copy(t.dueItems().map(item=>item.id)),['missing-date']);
});

test('HTML or malformed JSON with HTTP 200 cannot be mistaken for a successful save',async()=>{
  for(const response of [{status:200,jsonError:true},{status:200,data:{}},{status:200,data:{ok:true,payload:{items:[]}}}]) {
    const item=course('pinyin-basic','pinyin'),e=environment({items:{[item.id]:item}}),t=e.subject;await e.connect();
    t.setSession({items:[item],index:0});e.hold(true);const attempt=t.completePractice(item.id,'remember',item);
    (await e.nextRequest()).reply(response);await attempt;
    assert.equal(t.getItem(item.id).stage,0);assert.equal(t.getSession().index,0);
    assert.equal(Object.keys(t.loadState().activity).length,0);assert.doesNotMatch(e.element('home-content').innerHTML,/你的小花开啦/);
  }
});

test('a lost completion acknowledgement can be retried without a second flower or interval advance',async()=>{
  const item=course('pinyin-basic','pinyin'),e=environment({items:{[item.id]:item}}),t=e.subject;await e.connect();
  t.setSession({items:[item],index:0});e.hold(true);const initial=t.completePractice(item.id,'remember',item);
  const first=await e.nextRequest();first.commitThenLoseResponse();await initial;
  assert.equal(Object.keys(e.db().activity).length,1);assert.equal(Object.keys(t.loadState().activity).length,0);assert.equal(t.getSession().index,0);
  const retry=t.completePractice(item.id,'remember',item),second=await e.nextRequest();
  assert.equal(first.body.operations.find(op=>op.collection==='activity').key,second.body.operations.find(op=>op.collection==='activity').key);
  second.reply();await retry;assert.equal(Object.keys(e.db().activity).length,1);assert.equal(t.getItem(item.id).stage,1);
});

test('remote deletion conflicts cannot recreate a course or award a flower',async()=>{
  const item=course('pinyin-basic','pinyin'),e=environment({items:{[item.id]:item}}),t=e.subject;await e.connect();
  t.setSession({items:[item],index:0});e.alterServer(state=>{delete state.items[item.id];});await t.completePractice(item.id,'remember',item);
  assert.equal(t.getItem(item.id),null);assert.equal(e.db().items[item.id],undefined);assert.equal(Object.keys(e.db().activity).length,0);
  assert.doesNotMatch(e.element('home-content').innerHTML,/你的小花开啦/);
  // Retrying after the 409 refresh must not degrade into activity-only success.
  await t.completePractice(item.id,'remember',item);assert.equal(Object.keys(e.db().activity).length,0);
  assert.doesNotMatch(e.element('home-content').innerHTML,/你的小花开啦/);
});

test('custom course enrollment persists together with content and routes to the exact character',async()=>{
  const e=environment(),t=e.subject;await e.connect();
  const poem={id:'custom-poem-class',title:'课堂小诗',titlePy:[],author:'老师',authorPy:[],dynasty:'',dynastyPy:[],lines:[{text:'春天来啦',chars:[{c:'春',p:''}]}]};
  const character={id:'custom-char-ming',c:'明',strokes:'8画',tip:'左日右月'};
  await t.markLearned(poem.id,{type:'poem',title:poem.title},[{op:'set',collection:'customPoems',key:poem.id,value:poem}]);
  await t.markLearned(character.id,{type:'write',title:'汉字·明'},[{op:'set',collection:'customCharacters',key:character.id,value:character}]);
  assert.ok(t.getItem(poem.id));assert.ok(t.getItem(character.id));assert.equal(e.requests.filter(r=>r.method==='PATCH').length,2);
  const fresh=environment(e.db());await fresh.connect();assert.equal(fresh.subject.loadState().customPoems[poem.id].title,poem.title);
  const session={items:[fresh.subject.getItem(character.id)],index:0};
  fresh.subject.setSession(session);fresh.subject.openReviewItem(character.id,'write');
  assert.equal(fresh.subject.getSession(),session,'Review routing must preserve the active session');
  assert.equal(fresh.subject.getView(),'write-detail');assert.equal(fresh.subject.getWritingId(),character.id);
  assert.match(fresh.element('write-detail-content').innerHTML,/明 字描红画布/);
  assert.doesNotMatch(fresh.element('write-detail-content').innerHTML,/data-write-id=/,'Review detail must not contain a character library');
  await fresh.element('write-finish').onclick();
  assert.equal(fresh.element('write-paper-confirm').hidden,false);
  assert.equal(fresh.subject.getItem(character.id).nextReview,'2026-10-01','Opening paper confirmation must not save progress');
  await fresh.element('write-paper').onclick();assert.equal(fresh.subject.getItem(character.id).nextReview,'2026-10-02');
  assert.equal(fresh.subject.getItem('write-basic'),null);assert.equal(fresh.subject.getItem(poem.id).nextReview,'2026-10-01');
});

test('parent poem form validates syllables and keeps one ID after a lost save acknowledgement',async()=>{
  const e=environment(),t=e.subject;await e.connect();await t.openParent();
  const form=e.element('custom-poem-form');
  form.elements={title:{value:'春晓'},author:{value:'孟浩然'},body:{value:'春眠不觉晓，\n处处闻啼鸟。'},pinyin:{value:'chūn mián bù jué xiǎo\nchù chù wén tí niǎo'}};
  const parsed=t.customPoemFromForm(form);assert.equal(parsed.lines[0].chars[0].p,'chūn');
  assert.equal(parsed.lines[0].chars.at(-1).p,'');
  form.elements.pinyin.value='chūn\nchù';assert.throws(()=>t.customPoemFromForm(form),/音节/);
  form.elements.pinyin.value='';e.hold(true);
  const event={preventDefault(){},currentTarget:form};
  const initial=form.onsubmit(event),first=await e.nextRequest();first.commitThenLoseResponse();await initial;
  assert.equal(Object.keys(e.db().customPoems).length,1);assert.equal(Object.keys(t.loadState().customPoems).length,0);
  e.at('2026-10-02');const retry=form.onsubmit(event),second=await e.nextRequest();
  assert.equal(first.body.operations.find(op=>op.collection==='customPoems').key,second.body.operations.find(op=>op.collection==='customPoems').key);
  second.reply();await retry;assert.equal(Object.keys(t.loadState().customPoems).length,1);assert.equal(Object.keys(t.loadState().items).length,1);
});

test('parent character form rejects non-single Han input and updates built-in hints without duplicate cards',async()=>{
  const e=environment(),t=e.subject;await e.connect();await t.openParent();const form=e.element('custom-character-form');
  form.elements={character:{value:'春天'},strokes:{value:''},tip:{value:''}};
  const event={preventDefault(){},currentTarget:form},initialRequests=e.requests.length;
  await form.onsubmit(event);assert.equal(e.requests.length,initialRequests);assert.match(e.element('character-form-error').textContent,/一个汉字/);
  form.elements.character.value='A';await form.onsubmit(event);assert.equal(e.requests.length,initialRequests);
  form.elements.character.value='木';form.elements.tip.value='老师说：横短竖长';await form.onsubmit(event);
  const cards=t.writingCharacters().filter(ch=>ch.c==='木');assert.equal(cards.length,1);assert.equal(cards[0].tip,'老师说：横短竖长');
  assert.ok(t.getItem(cards[0].id));assert.equal(t.getItem('write-basic'),null);
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
  assert.match(html,/木 字描红画布/);assert.match(html,/id="write-back"/);
  assert.doesNotMatch(html,/data-write-id=/,'The detail page must not repeat the character library');
  assert.equal(media.viewers.length,1);assert.equal(media.viewers[0].character,'木');
  e.element('write-strokes-play').onclick();assert.equal(media.viewers[0].playing,true);
  e.element('write-back').onclick();
  assert.equal(t.getView(),'write');assert.equal(t.getSession(),null);
  assert.equal(media.viewers[0].destroyed,true);assert.equal(media.voices[0].destroyed,true);
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
  assert.equal(media.viewers[0].destroyed,true);assert.equal(media.voices[0].destroyed,true);
  assert.deepEqual(e.db(),before);assert.equal(t.getItem(item.id).stage,0);
});

test('free writing returns to the library only after saving the selected character',async()=>{
  const e=environment(),t=e.subject;await e.connect();
  t.navigate('write');t.openWriteCharacter('write-char-6728');
  e.element('write-finish').onclick();assert.equal(e.element('write-paper-confirm').hidden,false);
  assert.equal(Object.keys(t.loadState().activity).length,0,'Opening paper confirmation is not completion');
  e.hold(true);const saving=e.element('write-paper').onclick(),request=await e.nextRequest();
  assert.equal(t.getView(),'write-detail');assert.equal(Object.keys(t.loadState().activity).length,0);
  request.reply();await saving;
  assert.equal(t.getView(),'write');assert.equal(t.getSession(),null);
  const activities=Object.values(t.loadState().activity);
  assert.equal(activities.length,1);assert.equal(activities[0].id,'write-char-6728');
  assert.deepEqual(e.db().items,{},'Free writing must not automatically enroll the character');
});

test('a delayed writing save cannot navigate away from another character opened meanwhile',async()=>{
  const e=environment(),t=e.subject;await e.connect();
  t.navigate('write');t.openWriteCharacter('write-char-6728');
  e.element('write-finish').onclick();e.hold(true);
  const saving=e.element('write-paper').onclick(),request=await e.nextRequest();
  e.element('write-back').onclick();assert.equal(t.getView(),'write');
  t.openWriteCharacter('write-char-6c34');
  assert.equal(t.getView(),'write-detail');assert.equal(t.getWritingId(),'write-char-6c34');
  const currentDetail=e.element('write-detail-content').innerHTML;
  request.reply();await saving;
  assert.equal(t.getView(),'write-detail','The old save must not send the new detail back to the library');
  assert.equal(t.getWritingId(),'write-char-6c34');assert.equal(e.element('write-detail-content').innerHTML,currentDetail);
  const activities=Object.values(t.loadState().activity);
  assert.equal(activities.length,1);assert.equal(activities[0].id,'write-char-6728');
  assert.equal(t.getSession(),null);assert.equal(e.requests.filter(request=>request.method==='PATCH').length,1);
});

test('course deletion removes custom data and 120 history entries without exceeding PATCH limits',async()=>{
  const id='custom-char-ming',activity=Object.fromEntries(Array.from({length:120},(_,i)=>[`event-${i}`,{day:'2026-09-30',id,type:'write'}]));
  activity.unrelated={day:'2026-09-30',id:'other',type:'poem'};
  const e=environment({items:{[id]:course(id,'write'),other:course('other')},activity,customCharacters:{[id]:{id,c:'明'}}}),t=e.subject;
  await e.connect();await t.removeClassroomItem(id);assert.equal(t.getItem(id),null);assert.equal(t.loadState().customCharacters[id],undefined);
  assert.equal(Object.values(t.loadState().activity).filter(event=>event.id===id).length,0);assert.ok(t.getItem('other'));assert.ok(t.loadState().activity.unrelated);
  assert.ok(e.requests.find(r=>r.method==='PATCH').body.operations.length<=100);await t.syncNow();assert.equal(t.getItem(id),null);
});

test('home/rest cancel sessions; delayed completion cannot advance a newly started session',async()=>{
  const item=course('pinyin-basic','pinyin'),e=environment({items:{[item.id]:item}}),t=e.subject;await e.connect();
  t.setSession({items:[item],index:0});t.navigate('home');await flush();assert.equal(t.getSession(),null);
  t.setSession({items:[item],index:0});t.bindSessionExit();e.element('session-exit').onclick();await flush();assert.equal(t.getSession(),null);
  t.setSession({items:[item],index:0});e.hold(true);const saved=t.completePractice(item.id,'remember',item),request=await e.nextRequest();
  t.navigate('home');await flush();
  // The home review tile can start a different session while its predecessor saves.
  t.setSession({items:[item],index:0});t.openReviewItem(item.id,item.type);
  const newSession=t.getSession();assert.ok(newSession);request.reply();await saved;
  assert.equal(t.getSession(),newSession,'Completion belongs to its original session');assert.equal(newSession.index,0);
});

test('initial connection failure has a retry and cannot report successful practice',async()=>{
  const e=environment(),t=e.subject;e.hold(true);const initialization=t.initializePage();(await e.nextRequest()).fail();await initialization;
  assert.equal(t.isReady(),false);assert.match(e.element('home-content').innerHTML,/id="retry-connection"/);
  const view=t.getView();t.navigate('pinyin');assert.equal(t.getView(),view);
  await t.completePractice('pinyin-basic','remember',{type:'pinyin'});assert.equal(Object.keys(t.loadState().activity).length,0);
  assert.doesNotMatch(e.element('home-content').innerHTML,/你的小花开啦/);
  const retry=e.element('retry-connection').onclick();(await e.nextRequest()).reply();await retry;assert.equal(t.isReady(),true);
});

test('English saved completion advances the shared review once without writing progress twice',async()=>{
  const word=course('english-cat','english'),other=course('pinyin-basic','pinyin');
  const e=environment({items:{[word.id]:word,[other.id]:other}}),t=e.subject;await e.connect();
  const opened=[];let stops=0;
  e.context.window.ChenchenEnglish={create:()=>({open:options=>opened.push(options),stop:()=>stops++,pause:()=>{}})};
  t.setSession({items:[word,other],index:0});t.openReviewItem(word.id,'english');
  assert.equal(t.getView(),'english');assert.equal(opened[0].itemId,word.id);
  const before=e.requests.length;opened[0].onDone();
  assert.equal(t.getView(),'pinyin');assert.equal(t.getSession().index,1);
  assert.equal(e.requests.length,before,'English module already saved; shared router must not save twice');
  assert.ok(stops>0);
  t.setSession({items:[word],index:0});t.openReviewItem(word.id,'english');
  const stale=opened[1].onDone;t.navigate('home');await flush();stale();
  assert.equal(t.getSession(),null);assert.doesNotMatch(e.element('home-content').innerHTML,/你的小花开啦/);
  await t.removeClassroomItem(word.id);assert.ok(t.loadState().hiddenCourses[word.id]);
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
