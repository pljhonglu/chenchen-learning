#!/usr/bin/env node
// Local authoring preview. Uses real UI modules and an in-memory ledger only.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const base = path.resolve(__dirname, "../public");
const port = Number(process.env.PORT || 8766);
const fixture = `
(function(){
  const root=document.getElementById('home-content');
  const clone=value=>JSON.parse(JSON.stringify(value));
  const day='2026-10-04';
  let session;
  function reset(total=11,options={}){
    const state={garden:{groups:{},watering:{},gifts:{}}};
    for(let i=0;i<total+3;i++)state.garden.groups['g'+i]={id:'g'+i,day:i>=total?day:'2026-10-03',type:'poem',count:5,waterAwarded:1};
    for(let i=1;i<=total;i++)state.garden.watering['w'+i]={id:'w'+i,day:i>total-(options.todayWatered||0)?day:'2026-10-03',total:i};
    for(let i=1;i<=Math.floor(total/12);i++)state.garden.gifts[i]={id:'gift'+i,milestone:i,waterTotal:i*12,day:'2026-10-03'};
    const current=session={state:clone(state),server:state,requests:[],options:{delay:120,...options},active:true};
    const hooks={root,loadState:()=>current.state,todayStr:()=>day,isActive:()=>current.active,reviewGroups:[],
      acceptServerState(response){current.state=clone(response.payload)},
      async apiFetch(url,request){
        const {id}=JSON.parse(request.body);current.requests.push(id);
        await new Promise(resolve=>setTimeout(resolve,current.options.delay));
        if(current.options.reject)throw Object.assign(new Error('Rejected'),{status:429,data:{payload:clone(current.server)}});
        if(!current.server.garden.watering[id]){
          const total=Object.keys(current.server.garden.watering).length+1;
          current.server.garden.watering[id]={id,day,total};
          if(total%12===0)current.server.garden.gifts[total/12]={id:'gift'+total,milestone:total/12,waterTotal:total,day};
        }
        if(current.options.loseOnce){current.options.loseOnce=false;throw new Error('Lost response')}
        return {ok:true,payload:clone(current.server)};
      },
      navigate(){current.active=false;window.ChenchenGarden.stop();root.innerHTML='<div class="card">已离开花园；刷新页面可重新预览。</div>';},
    };
    current.hooks=hooks;window.ChenchenGarden.renderHome(hooks);
    return current;
  }
  window.GardenPreview={reset,get session(){return session},reopen(){session.active=true;window.ChenchenGarden.renderHome(session.hooks)}};
  window.previewGarden=(total,wateredToday)=>reset(total,{todayWatered:wateredToday});
  reset();
})();`;
const types = { ".html":"text/html; charset=utf-8", ".js":"application/javascript", ".css":"text/css", ".png":"image/png", ".json":"application/json", ".webp":"image/webp" };
http.createServer((req,res)=>{
  const name=decodeURIComponent(new URL(req.url,"http://localhost").pathname);
  res.setHeader("Cache-Control","no-store");
  if(name==="/__preview.js"){res.setHeader("Content-Type",types[".js"]);res.end(fixture);return;}
  if(name.startsWith("/api/")){res.writeHead(404);res.end("Preview has no persistent API");return;}
  const file=path.resolve(base,"."+(name==="/"?"/index.html":name));
  if(!file.startsWith(base+path.sep)){res.writeHead(403);res.end();return;}
  try{
    let data=fs.readFileSync(file);
    if(name==="/")data=data.toString().replace(/<script[\s\S]*?<\/script>/g,"").replace("</body>",'<script src="vendor/gsap-3.15.0.min.js"></script><script src="garden-scene.js"></script><script src="garden.js"></script><script src="/__preview.js"></script></body>');
    res.setHeader("Content-Type",types[path.extname(file)]||"application/octet-stream");res.end(data);
  }catch{res.writeHead(404);res.end();}
}).listen(port,"127.0.0.1",()=>console.log(`Garden animation preview: http://127.0.0.1:${port} (in-memory data only)`));
