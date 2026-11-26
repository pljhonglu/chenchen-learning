/* Finite, solvable math questions and per-knowledge practice selection. */
(function(global) {
  "use strict";
  const courses = Object.freeze({
    addsub: {id:"math-addsub-10", type:"math", title:"10以内加减法", tab:"10以内加减法"},
    decomp: {id:"math-decomp-10", type:"decomp", title:"10以内分解组合", tab:"分解组合"},
    make10: {id:"math-make10-20", type:"make10", title:"凑十法", tab:"凑十法"},
    flat10: {id:"math-flat10-20", type:"flat10", title:"平十法", tab:"平十法"},
  });
  const modeForType = type => Object.keys(courses).find(mode=>courses[mode].type===type);
  const clone = value => JSON.parse(JSON.stringify(value));
  const shuffle = (list, random) => {
    const result = list.slice();
    for (let i=result.length-1;i>0;i--) { const j=Math.floor(random()*(i+1)); [result[i],result[j]]=[result[j],result[i]]; }
    return result;
  };
  function pool(mode) {
    const result=[];
    if (mode==="decomp") {
      for(let n=2;n<=10;n++) for(let left=0;left<=n;left++) for(const slot of ["left","right","whole"]) {
        const right=n-left, kind=slot==="whole"?"compose":"decomp";
        const blanks={whole:slot==="whole",left:slot==="left",right:slot==="right"};
        result.push({key:`${n}:${left}:${right}:${kind}:${["whole","left","right"].map(s=>Number(blanks[s])).join("")}`,knowledgeId:`bond-${slot==="whole"?"whole":"part"}-${n}`,n,left,right,mode:kind,blanks,answer:slot==="whole"?n:slot==="left"?left:right,answers:{whole:null,left:null,right:null},status:"open"});
      }
    } else if (mode==="addsub") {
      for(const op of ["+","-"]) for(let a=0;a<=10;a++) for(let b=0;b<=(op==="+"?10-a:a);b++) {
        const answer=op==="+"?a+b:a-b;
        result.push({key:`${a}${op}${b}`,knowledgeId:`${op==="+"?"add-total":"sub-whole"}-${op==="+"?answer:a}`,text:`${a} ${op} ${b} = ?`,answer,meta:{a,b,op}});
      }
    } else if (mode==="make10" || mode==="flat10") {
      const addition = mode==="make10";
      const op = addition ? "+" : "-";
      for (let a=addition ? 6 : 11; a<=(addition ? 9 : 18); a++) {
        const first = addition ? 10-a : a-10;
        for (let b=first+1; b<=(addition ? a : 9); b++) {
          const answer = addition ? a+b : a-b;
          result.push({key:`${a}${op}${b}`,knowledgeId:`${mode}-${a}`,answer,meta:{a,b,op},steps:[first,b-first,10]});
        }
      }
    }
    return result;
  }
  // Keep the complete pool for old drafts and server-owned knowledge history.
  // The two empty facts are reviewed only when an existing schedule is due.
  function practicePool(mode) {
    return pool(mode).filter(q=>mode!=="addsub" || q.meta.a!==0 || q.meta.b!==0);
  }
  function zeroFact(q) {
    return q.meta ? q.meta.op==="+" ? q.meta.a===0 || q.meta.b===0 : q.meta.b===0 : q.left===0 || q.right===0;
  }
  function difficultyRank(q) {
    if(zeroFact(q))return 3;
    if(!q.meta)return Math.min(q.left,q.right)===1 ? 2 : q.n<6 ? 1 : 0;
    const {a,b,op}=q.meta;
    if(b===1 || op==="+" && a===1 || op==="-" && a===b)return 2;
    return (op==="+" ? a+b : a)<6 ? 1 : 0;
  }
  function choices(answer,random=Math.random) {
    const wrong=shuffle(Array.from({length:11},(_,i)=>i).filter(i=>i!==answer),random)
      .sort((a,b)=>Math.abs(a-answer)-Math.abs(b-answer)).slice(0,3);
    return shuffle([answer,...wrong],random);
  }
  function plan(mode,state,today,count=10,random=Math.random) {
    const id=courses[mode].id, progress=state.items?.[id]?.mathKnowledge || {};
    const previous=Object.values(state.activity || {}).filter(a=>a.id===id).sort((a,b)=>String(b.at||b.day||"").localeCompare(String(a.at||a.day||""))).slice(0,2);
    const recent=new Set(previous.flatMap(a=>a.details?.questionKeys || []));
    const byKnowledge=new Map();
    for(const question of shuffle(pool(mode),random)) {
      if(!byKnowledge.has(question.knowledgeId)) byKnowledge.set(question.knowledgeId,[]);
      byKnowledge.get(question.knowledgeId).push(question);
    }
    for(const questions of byKnowledge.values()) questions.sort((a,b)=>difficultyRank(a)-difficultyRank(b) || Number(recent.has(a.key))-Number(recent.has(b.key)));
    const ids=shuffle([...byKnowledge.keys()],random);
    const regular=new Set(practicePool(mode).map(q=>q.knowledgeId));
    const rank=id=>difficultyRank(byKnowledge.get(id)[0]);
    const weak=id=>["forgot","again","fuzzy","supported"].includes(progress[id]?.lastResult);
    const due=ids.filter(id=>progress[id]?.nextReview && progress[id].nextReview<=today).sort((a,b)=>{
      const x=progress[a],y=progress[b];
      return Number(weak(b))-Number(weak(a)) || x.nextReview.localeCompare(y.nextReview) || (Number(y.mistakes)||0)-(Number(x.mistakes)||0);
    });
    const fresh=ids.filter(id=>regular.has(id) && !progress[id]).sort((a,b)=>rank(a)-rank(b));
    const selected=[],used=new Set(),kindCounts={};
    let zeroCount=0;
    const kind=q=>q.meta?.op || q.mode;
    const takeTier=(tier,once=false,prioritizeWeak=false)=>{
      const covered=new Set();
      while(selected.length<count) {
        const candidates=tier.filter(id=>!covered.has(id)).map(id=>({id,q:byKnowledge.get(id).find(q=>!used.has(q.key) && (!zeroFact(q) || zeroCount===0))})).filter(candidate=>candidate.q);
        if(!candidates.length)break;
        let candidate=candidates[0];
        // Due weak skills may outweigh the normal half-and-half distribution.
        if(!prioritizeWeak || !weak(candidate.id)) {
          const equallyUrgent=prioritizeWeak ? candidates.filter(other=>progress[other.id].nextReview===progress[candidate.id].nextReview) : candidates;
          const lessPracticed=equallyUrgent.find(other=>(kindCounts[kind(other.q)] || 0)<(kindCounts[kind(candidate.q)] || 0));
          if(lessPracticed)candidate=lessPracticed;
        }
        const {id,q}=candidate;
        used.add(q.key);zeroCount+=Number(zeroFact(q));
        kindCounts[kind(q)]=(kindCounts[kind(q)] || 0)+1;
        selected.push({...q,reason:due.includes(id)?"review":fresh.includes(id)?"new":"practice"});
        if(once)covered.add(id);
      }
    };
    // Cover all due skills first; a weak skill gets another changed question
    // before introducing new skills. More than ten due skills span later groups.
    takeTier(due,true,true);
    if(due.length<count)takeTier(due.filter(weak),true,true);
    takeTier(fresh,true);
    takeTier(due,false,true);
    takeTier(fresh);
    if (!selected.length) {
      const repeat=ids.filter(id=>regular.has(id)).sort((a,b)=>rank(a)-rank(b) ||
        String(progress[a]?.lastSeenAt || "").localeCompare(String(progress[b]?.lastSeenAt || "")) ||
        (progress[a]?.nextReview || "").localeCompare(progress[b]?.nextReview || ""));
      takeTier(repeat,true);
      takeTier(repeat);
    }
    for(const question of selected)if(mode==="addsub")question.choices=choices(question.answer,random);
    return {kind:"math",version:1,mode,questions:selected,questionResults:[],index:0};
  }
  function restore(value,mode) {
    if(!value || value.kind!=="math" || value.version!==1 || value.mode!==mode || !Array.isArray(value.questions) || (value.questions.length<1 || value.questions.length>10) || !Array.isArray(value.questionResults))return null;
    const canonical=new Map(pool(mode).map(q=>[q.key,q])),seen=new Set();
    const questions=[];
    for(const raw of value.questions) {
      const question=canonical.get(raw.key);
      if(!question || question.knowledgeId!==raw.knowledgeId || seen.has(raw.key))return null;
      seen.add(raw.key);
      const restored={...clone(question),reason:raw.reason};
      if(mode==="addsub") {
        if(!Array.isArray(raw.choices) || raw.choices.length!==4 || new Set(raw.choices).size!==4 || !raw.choices.includes(question.answer) || raw.choices.some(n=>!Number.isInteger(n)||n<0||n>10))return null;
        restored.choices=raw.choices.slice();
      }
      questions.push(restored);
    }
    if(value.questionResults.length>questions.length || !Number.isInteger(value.index) || value.index<0 || value.index>value.questionResults.length || value.questionResults.length-value.index>1)return null;
    for(let i=0;i<value.questionResults.length;i++) {
      const result=value.questionResults[i],q=questions[i];
      const expected=answerResult(q,result.answer,result.steps);
      if(!expected || result.key!==q.key || result.knowledgeId!==q.knowledgeId || result.correct!==expected.correct)return null;
    }
    return {...clone(value),questions};
  }
  function answerResult(question,answer,steps) {
    const limit=question.steps ? 20 : 10;
    const valid=value=>Number.isInteger(value) && value>=0 && value<=limit;
    if(!valid(answer))return null;
    let correct=answer===question.answer;
    if(question.steps) {
      if(!Array.isArray(steps) || steps.length!==question.steps.length || !Array.from(steps).every(valid))return null;
      correct=correct && steps.every((step,index)=>step===question.steps[index]);
    }
    return {key:question.key,knowledgeId:question.knowledgeId,correct,answer,...(question.steps ? {steps:[...steps]} : {})};
  }
  function record(practice,answer,steps) {
    const index=practice.index,question=practice.questions[index];
    if(!question)return null;
    if(practice.questionResults[index])return practice.questionResults[index];
    if(index!==practice.questionResults.length)return null;
    const result=answerResult(question,answer,steps);
    if(!result)return null;
    practice.questionResults.push(result);
    return result;
  }
  global.ChenchenMath={courses,modeForType,pool,practicePool,plan,restore,record,answerResult};
})(typeof window!=="undefined"?window:globalThis);
