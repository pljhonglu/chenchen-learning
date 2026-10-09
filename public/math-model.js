/* Finite, solvable math questions and per-knowledge practice selection. */
(function(global) {
  "use strict";
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
    } else {
      for(const op of ["+","-"]) for(let a=0;a<=10;a++) for(let b=0;b<=(op==="+"?10-a:a);b++) {
        const answer=op==="+"?a+b:a-b;
        result.push({key:`${a}${op}${b}`,knowledgeId:`${op==="+"?"add-total":"sub-whole"}-${op==="+"?answer:a}`,text:`${a} ${op} ${b} = ?`,answer,meta:{a,b,op}});
      }
    }
    return result;
  }
  function plan(mode,state,today,count=10,random=Math.random) {
    const id=mode==="decomp"?"math-decomp-10":"math-addsub-10", progress=state.items?.[id]?.mathKnowledge || {};
    const previous=Object.values(state.activity || {}).filter(a=>a.id===id).sort((a,b)=>String(b.at||b.day||"").localeCompare(String(a.at||a.day||""))).slice(0,2);
    const recent=new Set(previous.flatMap(a=>a.details?.questionKeys || []));
    const byKnowledge=new Map();
    for(const question of shuffle(pool(mode),random)) {
      if(!byKnowledge.has(question.knowledgeId)) byKnowledge.set(question.knowledgeId,[]);
      byKnowledge.get(question.knowledgeId).push(question);
    }
    for(const questions of byKnowledge.values()) questions.sort((a,b)=>Number(recent.has(a.key))-Number(recent.has(b.key)));
    const ids=[...byKnowledge.keys()].sort((a,b)=>{
      const an=Number(a.split("-").at(-1)),bn=Number(b.split("-").at(-1));
      return an-bn || a.localeCompare(b);
    });
    const due=ids.filter(id=>progress[id]?.nextReview && progress[id].nextReview<=today).sort((a,b)=>{
      const x=progress[a],y=progress[b];
      return Number(["forgot","again","fuzzy","supported"].includes(y.lastResult))-Number(["forgot","again","fuzzy","supported"].includes(x.lastResult)) || x.nextReview.localeCompare(y.nextReview) || (Number(y.mistakes)||0)-(Number(x.mistakes)||0) || a.localeCompare(b);
    });
    const fresh=ids.filter(id=>!progress[id]);
    const selected=[],used=new Set();
    const take=id=>{
      const question=byKnowledge.get(id).find(q=>!used.has(q.key));
      if(!question || selected.length>=count)return false;
      used.add(question.key);selected.push({...question,reason:due.includes(id)?"review":fresh.includes(id)?"new":"practice"});return true;
    };
    // Cover all due skills first; a weak skill gets another changed question
    // before introducing new skills. More than ten due skills span later groups.
    due.forEach(take);
    if(due.length<count) due.filter(id=>["forgot","again","fuzzy","supported"].includes(progress[id].lastResult)).forEach(take);
    fresh.forEach(take);
    for(const tier of [due,fresh]) {
      let changed=true;
      while(selected.length<count && changed) {changed=false;for(const id of tier) changed=take(id)||changed;}
    }
    for(const question of selected) if(mode!=="decomp") {
      const wrong=shuffle(Array.from({length:11},(_,i)=>i).filter(i=>i!==question.answer),random).slice(0,3);
      question.choices=shuffle([question.answer,...wrong],random);
    }
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
      if(mode!=="decomp") {
        if(!Array.isArray(raw.choices) || raw.choices.length!==4 || new Set(raw.choices).size!==4 || !raw.choices.includes(question.answer) || raw.choices.some(n=>!Number.isInteger(n)||n<0||n>10))return null;
        restored.choices=raw.choices.slice();
      }
      questions.push(restored);
    }
    if(value.questionResults.length>questions.length || !Number.isInteger(value.index) || value.index<0 || value.index>value.questionResults.length || value.questionResults.length-value.index>1)return null;
    for(let i=0;i<value.questionResults.length;i++) {
      const result=value.questionResults[i],q=questions[i];
      if(result.key!==q.key || result.knowledgeId!==q.knowledgeId || !Number.isInteger(result.answer) || result.answer<0 || result.answer>10 || result.correct!==(result.answer===q.answer))return null;
    }
    return {...clone(value),questions};
  }
  function record(practice,answer) {
    const index=practice.index,question=practice.questions[index];
    if(!question)return null;
    if(practice.questionResults[index])return practice.questionResults[index];
    if(index!==practice.questionResults.length || !Number.isInteger(answer) || answer<0 || answer>10)return null;
    const result={key:question.key,knowledgeId:question.knowledgeId,correct:answer===question.answer,answer};
    practice.questionResults.push(result);
    return result;
  }
  global.ChenchenMath={pool,plan,restore,record};
})(typeof window!=="undefined"?window:globalThis);
