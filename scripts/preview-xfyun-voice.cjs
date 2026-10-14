/* Small online TTS audition. Credentials stay outside the repository. Node 22+. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [credentialsPath, outputDir] = process.argv.slice(2);
if (!credentialsPath || !outputDir) throw new Error('Usage: node preview-xfyun-voice.cjs PRIVATE_CREDENTIALS_JSON OUTPUT_DIR');
const root = path.resolve(outputDir), publicDir = path.resolve(__dirname, '../public');
if (root === publicDir || root.startsWith(publicDir + path.sep)) throw new Error('Auditions must be staged outside public/');
const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
fs.mkdirSync(root, {recursive: true});
const texts = ['王。','太。','小船。','苹果。','毛荔枝。','太阳。','Apple.','Rambutan.','Durian.','Cherry.','Mouth.','Ball.'];
const voices = [{id:'x4_xiaoyan', name:'讯飞小燕'}, {id:'x4_yezi', name:'讯飞小露'}];
function signedUrl() {
  const date = new Date().toUTCString(), host = 'tts-api.xfyun.cn';
  const signature = crypto.createHmac('sha256', credentials.apiSecret).update(`host: ${host}\ndate: ${date}\nGET /v2/tts HTTP/1.1`).digest('base64');
  const auth = Buffer.from(`api_key="${credentials.apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`).toString('base64');
  return `wss://${host}/v2/tts?` + new URLSearchParams({authorization:auth,date,host});
}
function synthesize(text, voice) {
  return new Promise((resolve,reject)=>{
    const ws = new WebSocket(signedUrl()), chunks = [];
    let settled = false;
    const finish = (error) => {
      if (settled) return; settled = true; clearTimeout(timeout); ws.close();
      if (error) reject(error); else resolve(Buffer.concat(chunks));
    };
    const timeout = setTimeout(()=>finish(new Error('TTS request timed out')),30000);
    ws.addEventListener('open',()=>ws.send(JSON.stringify({common:{app_id:credentials.appId},business:{aue:'raw',auf:'audio/L16;rate=16000',vcn:voice,speed:45,pitch:50,volume:50,tte:'UTF8',reg:'0',bgs:0},data:{status:2,text:Buffer.from(text).toString('base64')}})));
    ws.addEventListener('message',event=>{
      try {
        const value = JSON.parse(event.data);
        if (value.code !== 0) return finish(new Error(`TTS error ${value.code}: ${value.message}`));
        if (value.data?.audio) chunks.push(Buffer.from(value.data.audio,'base64'));
        if (value.data?.status === 2) finish();
      } catch {finish(new Error('Invalid TTS response'));}
    });
    ws.addEventListener('error',()=>finish(new Error('TTS connection failed')));
    ws.addEventListener('close',()=>{if(!settled)finish(new Error('TTS connection closed before completion'));});
  });
}
function wav(pcm) {
  const h=Buffer.alloc(44);h.write('RIFF');h.writeUInt32LE(36+pcm.length,4);h.write('WAVEfmt ',8);h.writeUInt32LE(16,16);h.writeUInt16LE(1,20);h.writeUInt16LE(1,22);h.writeUInt32LE(16000,24);h.writeUInt32LE(32000,28);h.writeUInt16LE(2,32);h.writeUInt16LE(16,34);h.write('data',36);h.writeUInt32LE(pcm.length,40);return Buffer.concat([h,pcm]);
}
(async()=>{
  for (const voice of voices) {
    const pieces=[], rows=[];
    for(let i=0;i<texts.length;i++) {
      const filename=`${voice.id}-${i}.wav`, file=path.join(root,filename);
      const pcm=fs.existsSync(file)?fs.readFileSync(file).subarray(44):await synthesize(texts[i],voice.id);
      if(pcm.length<3200 || pcm.length%2)throw new Error('Invalid PCM audio');
      fs.writeFileSync(file,wav(pcm));pieces.push(pcm,Buffer.alloc(16000));
      rows.push({text:texts[i],file:filename,duration:pcm.length/32000,sha256:crypto.createHash('sha256').update(wav(pcm)).digest('hex')});
      console.log(voice.name,texts[i],(pcm.length/32000).toFixed(2)+'s');
    }
    fs.writeFileSync(path.join(root,`${voice.id}-preview.wav`),wav(Buffer.concat(pieces)));
    fs.writeFileSync(path.join(root,`${voice.id}-manifest.json`),JSON.stringify({provider:'iFLYTEK online TTS',voice:voice.id,name:voice.name,speed:45,pitch:50,volume:50,sampleRate:16000,clips:rows},null,2));
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
