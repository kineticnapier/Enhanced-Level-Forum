import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const inputPath = args.shift()
if (!inputPath) {
  console.error('Usage: npm run analyzer:fingering:view -- <result.json> [output.html] [--assets <Texture2D directory>]')
  process.exit(2)
}

let outputPath = 'fingering-view.html'
if (args[0] && !args[0].startsWith('--')) outputPath = args.shift()
let explicitAssetDir = null
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--assets') {
    explicitAssetDir = args[i + 1]
    i++
  }
}

const result = JSON.parse(await readFile(inputPath, 'utf8'))
const trace = result.fingeringTrace
if (!Array.isArray(trace) || !trace.length) throw new Error('Result has no fingeringTrace. Re-run analyzer:fingering.')
const keyCount = Number(result.traceKeyCount ?? 0)
if (!Number.isFinite(keyCount) || keyCount < 1) throw new Error('Result has no valid traceKeyCount')
if (!Array.isArray(result.timing?.track) || !Array.isArray(result.timing?.segments)) throw new Error('Result has no playback track geometry. Re-run analyzer:fingering with adofai-timing-v0.4 or newer.')

const REPLAY_ASSET_FILES = {
  tile: 'tile_unlit.png',
  planetRed: 'planet-red.png',
  planetBlue: 'planet-blue.png',
  twirlRed: 'swirl_red.png',
  twirlBlue: 'swirl_blue.png',
  speedUp: 'SetSpeed.png',
  speedDown: 'SpeedDown.png',
  speedSame: 'tile_samespeed.png',
}

async function tryRead(path) {
  try {
    return await readFile(path)
  } catch {
    return null
  }
}

async function loadReplayAssets(assetDir) {
  const defaultDir = fileURLToPath(new URL('./analyzer/replay-assets/', import.meta.url))
  const requested = resolve(assetDir ?? process.env.ELF_ADOFAI_ASSETS ?? defaultDir)
  const roots = [requested, join(requested, 'Texture2D')]
  const sources = {}
  const loaded = []
  const missing = []

  for (const [key, filename] of Object.entries(REPLAY_ASSET_FILES)) {
    let bytes = null
    for (const root of roots) {
      bytes = await tryRead(join(root, filename))
      if (bytes) break
    }
    if (bytes) {
      sources[key] = `data:image/png;base64,${bytes.toString('base64')}`
      loaded.push(filename)
    } else {
      missing.push(filename)
    }
  }

  return { requestedDir: requested, sources, loaded, missing }
}

const replayAssets = await loadReplayAssets(explicitAssetDir)
if (replayAssets.loaded.length) console.log(`Replay assets: ${replayAssets.loaded.join(', ')}`)
else console.log('Replay assets: none found; using vector fallback')
if (replayAssets.missing.length && replayAssets.loaded.length) console.log(`Replay assets missing: ${replayAssets.missing.join(', ')}`)

const customLayout = (result.config?.customLaneFingerMapKeyCounts ?? []).includes(keyCount)
const payload = JSON.stringify({
  modelVersion: result.modelVersion,
  keyCount,
  fingerProfile: result.fingerProfile ?? [],
  trace,
  input: result.input,
  traceStats: result.traceStats,
  warnings: result.warnings ?? [],
  timing: result.timing,
  replayAssets,
  customLayout,
}).replaceAll('<', '\\u003c')

const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ELF ADOFAI Fingering Replay</title>
<style>
:root{color-scheme:dark;background:#090d18;color:#eef2ff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:#090d18;color:#eef2ff}main{width:min(1400px,100%);margin:auto;padding:12px}.top{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:10px}.title{font-size:18px;font-weight:650}.muted{color:#aeb8d0;font-size:12px}.stage{position:relative;width:100%;height:min(74vh,820px);min-height:480px;border:1px solid #28324c;border-radius:14px;overflow:hidden;background:#0c1323}canvas{display:block;width:100%;height:100%}.hud{position:absolute;inset:0;pointer-events:none}.status{position:absolute;top:14px;left:16px;background:#0b1020cc;border:1px solid #33405f;border-radius:10px;padding:8px 10px;font-size:13px;line-height:1.45}.keys{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);width:min(720px,calc(100% - 32px));display:flex;flex-direction:column;gap:4px;align-items:stretch;min-width:0}.primary-rows{display:flex;flex-direction:column;gap:3px}.key-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:4px}.key-side{display:flex;gap:3px;min-width:0}.key-side.left-side{justify-content:flex-end}.key-side.right-side{justify-content:flex-start}.extra-keys{display:flex;flex-wrap:wrap;justify-content:center;gap:3px}.key{width:52px;min-width:0;height:48px;padding:3px 4px 2px;border:2px solid #7c3aed;background:#150b31e8;border-radius:5px;display:grid;grid-template-rows:1fr auto;place-items:center;font-weight:800;font-size:13px;line-height:1;transition:background .025s,transform .025s,border-color .025s;overflow:hidden;box-shadow:inset 0 0 0 1px #2b1558}.key-label{align-self:center}.key-count{font-size:9px;font-weight:650;color:#c4b5fd;font-variant-numeric:tabular-nums}.key.on{background:#ede9fe;color:#20103f;border-color:#c4b5fd;transform:translateY(2px)}.key.on .key-count{color:#4c1d95}.keys.compact .key{width:40px;height:38px;padding:2px;border-width:1.5px;font-size:10px}.keys.compact .key-count{font-size:8px}.kv-summary{height:25px;display:grid;grid-template-columns:1fr 1fr;border:2px solid #7c3aed;border-radius:5px;background:#150b31e8;color:#ede9fe;font-size:12px;font-weight:750;overflow:hidden}.kv-summary span{display:flex;align-items:center;gap:8px;padding:0 8px}.kv-summary span+span{border-left:1px solid #6d28d9}.kv-summary b{margin-left:auto;font-variant-numeric:tabular-nums}.controls{display:grid;grid-template-columns:auto auto minmax(160px,1fr) auto auto;gap:10px;align-items:center;margin-top:10px;padding:10px 12px;border:1px solid #28324c;border-radius:12px;background:#11182c}.controls button,.controls select{background:#18213a;color:#eef2ff;border:1px solid #3a4767;border-radius:8px;padding:7px 10px;font:inherit}.controls input[type=range]{width:100%}.time{font-variant-numeric:tabular-nums;font-size:13px;white-space:nowrap}.warn{color:#ffd685;margin-left:auto}@media(max-width:700px){main{padding:6px}.stage{height:70vh;min-height:420px}.controls{grid-template-columns:auto auto 1fr}.controls .zoom,.controls .speedlabel{display:none}.keys{bottom:10px;width:calc(100% - 16px)}.key{width:42px;height:40px;font-size:11px}.keys.compact .key{width:32px;height:32px;font-size:9px}.keys.compact .key-count{font-size:7px}.status{font-size:11px}}
</style></head><body><main>
<div class="top"><div class="title">ELF ADOFAI Fingering Replay</div><div id="subtitle" class="muted"></div><div id="warnings" class="muted warn"></div></div>
<div class="stage"><canvas id="stage"></canvas><div class="hud"><div id="status" class="status"></div><div id="keys" class="keys"><div id="primaryRows" class="primary-rows"><div class="key-row"><div id="leftKeys" class="key-side left-side"></div><div id="rightKeys" class="key-side right-side"></div></div><div id="secondaryRow" class="key-row"><div id="leftKeys2" class="key-side left-side"></div><div id="rightKeys2" class="key-side right-side"></div></div></div><div id="extraKeys" class="extra-keys"></div><div class="kv-summary"><span>KPS <b id="kps">0</b></span><span>Total <b id="total">0</b></span></div></div></div></div>
<div class="controls"><button id="play" type="button">▶ Play</button><button id="restart" type="button">↺</button><input id="seek" type="range" min="0" max="1000" value="0"><span id="time" class="time">0:00.000 / 0:00.000</span><label class="speedlabel">Speed <select id="speed"><option>0.25</option><option>0.5</option><option selected>1</option><option>1.5</option><option>2</option></select>x</label><label class="zoom">Zoom <input id="zoom" type="range" min="35" max="150" value="82"></label></div>
</main><script>
const data=${payload};
const trace=data.trace,timing=data.timing,track=timing.track,segments=timing.segments.filter(s=>!s.midspin&&Number.isFinite(s.hitTimeMs)),visualEvents=timing.visualEvents||[];
const canvas=document.getElementById('stage'),ctx=canvas.getContext('2d'),seek=document.getElementById('seek'),play=document.getElementById('play'),speed=document.getElementById('speed'),zoom=document.getElementById('zoom');
const keys=document.getElementById('keys'),leftKeys=document.getElementById('leftKeys'),rightKeys=document.getElementById('rightKeys'),leftKeys2=document.getElementById('leftKeys2'),rightKeys2=document.getElementById('rightKeys2'),secondaryRow=document.getElementById('secondaryRow'),extraKeys=document.getElementById('extraKeys'),status=document.getElementById('status'),timeLabel=document.getElementById('time'),kpsLabel=document.getElementById('kps'),totalLabel=document.getElementById('total');
const duration=Math.max(trace[trace.length-1].timeMs,segments.length?segments[segments.length-1].hitTimeMs:0,1);
let current=0,playing=false,lastFrame=0;
document.getElementById('subtitle').textContent=data.modelVersion+' · '+data.keyCount+'K · '+trace.length+' presses · '+timing.extractorVersion+(data.replayAssets.loaded.length?' · game textures':' · vector fallback');
document.getElementById('warnings').textContent=[...(data.warnings||[]),...(timing.warnings||[])].join(' · ');
const profile=data.fingerProfile?.length?data.fingerProfile:Array.from({length:data.keyCount},(_,i)=>({index:i,label:'K'+(i+1),hand:i<data.keyCount/2?'L':'R'}));
const laneTimes=Array.from({length:data.keyCount},()=>[]);
for(const p of trace){const lane=Number(p.finger);if(Number.isInteger(lane)&&lane>=0&&lane<laneTimes.length)laneTimes[lane].push(p.timeMs)}
function upperBoundTimes(values,ms){let lo=0,hi=values.length;while(lo<hi){const mid=(lo+hi)>>1;if(values[mid]<=ms)lo=mid+1;else hi=mid}return lo}
function traceCountAt(ms){let lo=0,hi=trace.length;while(lo<hi){const mid=(lo+hi)>>1;if(trace[mid].timeMs<=ms)lo=mid+1;else hi=mid}return lo}
function kpsAt(ms){return traceCountAt(ms)-traceCountAt(ms-1000)}
function makeKey(item,displayLabel){const i=item.index,d=document.createElement('div');d.className='key';d.id='key'+i;d.title=item.label&&item.label!==displayLabel?displayLabel+' ← '+item.label:item.label||displayLabel;const label=document.createElement('span');label.className='key-label';label.textContent=displayLabel;const count=document.createElement('span');count.className='key-count';count.id='keyCount'+i;count.textContent='0';d.append(label,count);return d}
function buildKeyViewer(){
  leftKeys.replaceChildren();rightKeys.replaceChildren();leftKeys2.replaceChildren();rightKeys2.replaceChildren();extraKeys.replaceChildren();
  const genericJrp=data.keyCount>10&&!data.customLayout;
  keys.classList.toggle('compact',data.keyCount>16);
  if(genericJrp){
    const left=profile.filter(f=>f.hand==='L'),right=profile.filter(f=>f.hand==='R');
    const leftDisplay=left.map((item,index)=>({item,label:'L'+(index+1)}));
    const rightDisplay=right.map((item,index)=>({item,label:'R'+(index+1)}));
    for(const x of leftDisplay.slice(0,4).reverse())leftKeys.appendChild(makeKey(x.item,x.label));
    for(const x of rightDisplay.slice(0,4))rightKeys.appendChild(makeKey(x.item,x.label));
    for(const x of leftDisplay.slice(4,8).reverse())leftKeys2.appendChild(makeKey(x.item,x.label));
    for(const x of rightDisplay.slice(4,8))rightKeys2.appendChild(makeKey(x.item,x.label));
    const leftExtra=leftDisplay.slice(8),rightExtra=rightDisplay.slice(8),extra=[];
    for(let rank=0;rank<Math.max(leftExtra.length,rightExtra.length);rank++){if(leftExtra[rank])extra.push(leftExtra[rank]);if(rightExtra[rank])extra.push(rightExtra[rank])}
    extra.forEach((x,index)=>extraKeys.appendChild(makeKey(x.item,'K'+(17+index))));
    secondaryRow.hidden=leftKeys2.childElementCount===0&&rightKeys2.childElementCount===0;
    extraKeys.hidden=extra.length===0;
  }else{
    const left=profile.filter(f=>f.hand==='L'),right=profile.filter(f=>f.hand==='R');
    for(const f of left)leftKeys.appendChild(makeKey(f,f.label||('K'+(f.index+1))));
    for(const f of right)rightKeys.appendChild(makeKey(f,f.label||('K'+(f.index+1))));
    secondaryRow.hidden=true;extraKeys.hidden=true;
  }
}
buildKeyViewer();

const images={};
function imageFromSource(key,src){return new Promise(resolve=>{if(!src){resolve();return}const img=new Image();img.onload=()=>{images[key]=img;resolve()};img.onerror=()=>resolve();img.src=src})}
const imageReady=Promise.all(Object.entries(data.replayAssets.sources||{}).map(([key,src])=>imageFromSource(key,src)));

function fmt(ms){const s=Math.max(0,ms)/1000,m=Math.floor(s/60),r=s-m*60;return m+':'+r.toFixed(3).padStart(6,'0')}
function floorPoint(index){return track[Math.max(0,Math.min(track.length-1,index))]||track[0]}
function segmentAt(ms){let lo=0,hi=segments.length-1,ansIndex=0;while(lo<=hi){const mid=(lo+hi)>>1,s=segments[mid];if(ms<=s.hitTimeMs){ansIndex=mid;hi=mid-1}else lo=mid+1}return{segment:segments[ansIndex]||segments[segments.length-1],index:ansIndex}}
function previousPlayableFloor(floor){for(let i=floor-1;i>=0;i--){if(track[i]&&!track[i].midspin)return track[i]}return floorPoint(floor)}
function orbitState(ms){const hit=segmentAt(ms),s=hit.segment;if(!s)return{floor:0,bpm:timing.baseBpm,pivot:floorPoint(0),moving:floorPoint(0),direction:-1,segmentIndex:0};const pivot=floorPoint(s.sourceFloor),target=floorPoint(s.targetFloor),prev=previousPlayableFloor(s.sourceFloor),travelStart=Number.isFinite(s.travelStartMs)?s.travelStartMs:Math.max(0,s.hitTimeMs-s.travelMs);let p=ms<=travelStart?0:(ms-travelStart)/Math.max(1,s.travelMs);p=Math.max(0,Math.min(1,p));const startA=Math.atan2(prev.y-pivot.y,prev.x-pivot.x),a=startA+(s.direction||-1)*(s.travelDegrees||180)*Math.PI/180*p,radius=Math.max(.001,Math.hypot(target.x-pivot.x,target.y-pivot.y));return{floor:s.sourceFloor,bpm:s.bpm,pivot,moving:{x:pivot.x+Math.cos(a)*radius,y:pivot.y+Math.sin(a)*radius},target,progress:p,direction:s.direction||-1,segmentIndex:hit.index}}
function activeFingers(ms){const out=new Set(),rate=Math.max(.1,Number(speed.value)||1),pressWindowMs=85*rate,leadMs=12*rate,end=traceCountAt(ms+leadMs);for(let i=end-1;i>=0;i--){const p=trace[i];if(ms-p.timeMs>pressWindowMs)break;if(ms>=p.timeMs-leadMs)out.add(p.finger)}return out}
function drawRoundedTile(x,y,size,active,alpha){const half=size/2,r=Math.max(3,size*.18);ctx.beginPath();ctx.roundRect(x-half,y-half,size,size,r);ctx.fillStyle=active?'rgba(238,242,255,.98)':'rgba(47,59,85,'+alpha+')';ctx.fill();ctx.lineWidth=Math.max(1.5,size*.07);ctx.strokeStyle=active?'rgba(255,255,255,1)':'rgba(151,166,197,'+Math.min(1,alpha+.2)+')';ctx.stroke()}
function drawCenteredImage(img,x,y,w,h,rotation=0,alpha=1){if(!img)return false;ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.globalAlpha=alpha;ctx.drawImage(img,-w/2,-h/2,w,h);ctx.restore();return true}
function drawTrackTile(p,x,y,size,active,alpha){const img=images.tile;if(img){drawCenteredImage(img,x,y,size,size,(Number(p.angle)||0)*Math.PI/180,alpha);ctx.save();ctx.globalAlpha=active?1:Math.max(.12,alpha);ctx.lineWidth=Math.max(1.5,size*.06);ctx.strokeStyle=active?'#ffffff':'#8c98af';ctx.strokeRect(x-size*.43,y-size*.43,size*.86,size*.86);if(active){ctx.fillStyle='rgba(255,255,255,.16)';ctx.fillRect(x-size*.43,y-size*.43,size*.86,size*.86)}ctx.restore()}else drawRoundedTile(x,y,size,active,alpha)}
function speedAsset(e){if(e.bpmAfter>e.bpmBefore+1e-9)return images.speedUp;if(e.bpmAfter<e.bpmBefore-1e-9)return images.speedDown;return images.speedSame}
function eventLabel(e){if(e.eventType==='Twirl')return e.directionAfter>0?'CCW':'CW';if(e.eventType==='SetSpeed'){if(e.speedType==='Multiplier'&&Number.isFinite(e.bpmMultiplier))return '×'+Number(e.bpmMultiplier).toFixed(2).replace(/\.00$/,'');return Math.round(e.bpmAfter)+' BPM'}return e.eventType}
function drawEvent(e,x,y,tileSize,offsetIndex=0){const iy=y+offsetIndex*tileSize*.24;let img=null;if(e.eventType==='Twirl')img=e.directionAfter>0?images.twirlBlue:images.twirlRed;else if(e.eventType==='SetSpeed')img=speedAsset(e);const iconSize=e.eventType==='Twirl'?tileSize*.72:tileSize*.58;if(img)drawCenteredImage(img,x,iy,iconSize,iconSize,0,.96);else{ctx.font='700 '+Math.max(12,tileSize*.3)+'px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=e.eventType==='Twirl'?'#d7b7ff':'#ffd27a';ctx.fillText(e.eventType==='Twirl'?(e.directionAfter>0?'↺':'↻'):'SPD',x,iy)}if(e.eventType==='SetSpeed'){ctx.font='700 '+Math.max(9,tileSize*.18)+'px system-ui';ctx.textAlign='center';ctx.textBaseline='top';ctx.lineWidth=3;ctx.strokeStyle='#0b1020';ctx.fillStyle='#fff2bd';const label=eventLabel(e),ly=iy+iconSize*.42;ctx.strokeText(label,x,ly);ctx.fillText(label,x,ly)}}
function drawPlanetSheet(img,x,y,size,frame){if(!img)return false;const frames=11,sw=img.naturalWidth/frames,sh=img.naturalHeight,index=((frame%frames)+frames)%frames;ctx.drawImage(img,index*sw,0,sw,sh,x-size/2,y-size/2,size,size);return true}
function drawPlanetPair(state,sx,sy,scale){const size=Math.max(24,scale*.36),frame=Math.floor(current/70)%11,pivotRed=state.segmentIndex%2===0;const pivotImg=pivotRed?images.planetRed:images.planetBlue,movingImg=pivotRed?images.planetBlue:images.planetRed;const px=sx(state.pivot),py=sy(state.pivot),mx=sx(state.moving),my=sy(state.moving);if(!drawPlanetSheet(pivotImg,px,py,size,frame)){ctx.fillStyle=pivotRed?'#ff5a6f':'#55a7ff';ctx.beginPath();ctx.arc(px,py,size*.36,0,Math.PI*2);ctx.fill()}if(!drawPlanetSheet(movingImg,mx,my,size,frame)){ctx.fillStyle=pivotRed?'#55a7ff':'#ff5a6f';ctx.beginPath();ctx.arc(mx,my,size*.36,0,Math.PI*2);ctx.fill()}}
function resize(){buildKeyViewer();const dpr=devicePixelRatio||1,r=canvas.getBoundingClientRect();canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);draw()}
function draw(){const r=canvas.getBoundingClientRect(),w=r.width,h=r.height,state=orbitState(current),scale=Number(zoom.value),cx=w*.53,cy=h*.48,cam=state.pivot;ctx.clearRect(0,0,w,h);ctx.fillStyle='#0c1323';ctx.fillRect(0,0,w,h);const sx=p=>cx+(p.x-cam.x)*scale,sy=p=>cy-(p.y-cam.y)*scale,center=state.floor,tileSize=Math.max(25,scale*.58);
 ctx.lineCap='round';for(let i=Math.max(1,center-35);i<Math.min(track.length,center+45);i++){const a=track[i-1],b=track[i];if(!a||!b||a.midspin||b.midspin)continue;const d=Math.abs(i-center),alpha=Math.max(.08,1-d/48);ctx.strokeStyle='rgba(30,39,58,'+alpha+')';ctx.lineWidth=Math.max(8,tileSize*.40);ctx.beginPath();ctx.moveTo(sx(a),sy(a));ctx.lineTo(sx(b),sy(b));ctx.stroke()}
 const eventsByFloor=new Map();for(const e of visualEvents){const list=eventsByFloor.get(e.floor)||[];list.push(e);eventsByFloor.set(e.floor,list)}
 for(let i=Math.max(0,center-30);i<Math.min(track.length,center+40);i++){const p=track[i];if(!p||p.midspin)continue;const d=Math.abs(i-center),alpha=Math.max(.14,1-d/38);drawTrackTile(p,sx(p),sy(p),tileSize,i===center,alpha);const floorEvents=eventsByFloor.get(i)||[];for(let j=0;j<floorEvents.length;j++)drawEvent(floorEvents[j],sx(p),sy(p),tileSize,j-(floorEvents.length-1)/2);if(d<4&&!floorEvents.length){ctx.fillStyle=i===center?'#111827':'#d2d9e7';ctx.font=Math.max(9,tileSize*.19)+'px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i),sx(p),sy(p))}}
 drawPlanetPair(state,sx,sy,scale);
 const active=activeFingers(current),total=traceCountAt(current);for(let i=0;i<data.keyCount;i++){const el=document.getElementById('key'+i);if(el)el.classList.toggle('on',active.has(i));const count=document.getElementById('keyCount'+i);if(count)count.textContent=String(upperBoundTimes(laneTimes[i]||[],current))}kpsLabel.textContent=String(kpsAt(current));totalLabel.textContent=String(total);status.innerHTML='floor <b>'+state.floor+'</b> / '+(track.length-1)+'<br>BPM <b>'+Number(state.bpm||0).toFixed(2)+'</b><br>direction <b>'+(state.direction>0?'CCW':'CW')+'</b><br>DP <b>'+data.keyCount+'K</b>';seek.value=String(Math.round(current/duration*1000));timeLabel.textContent=fmt(current)+' / '+fmt(duration)}
function frame(ts){if(playing){if(!lastFrame)lastFrame=ts;current+=Math.max(0,ts-lastFrame)*(Number(speed.value)||1);if(current>=duration){current=duration;playing=false;play.textContent='▶ Play'}lastFrame=ts;draw()}else lastFrame=ts;requestAnimationFrame(frame)}
play.addEventListener('click',()=>{playing=!playing;play.textContent=playing?'❚❚ Pause':'▶ Play';lastFrame=performance.now()});document.getElementById('restart').addEventListener('click',()=>{current=0;draw()});seek.addEventListener('input',()=>{current=Number(seek.value)/1000*duration;draw()});zoom.addEventListener('input',draw);speed.addEventListener('change',draw);addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();play.click()}else if(e.code==='ArrowRight'){current=Math.min(duration,current+1000);draw()}else if(e.code==='ArrowLeft'){current=Math.max(0,current-1000);draw()}});addEventListener('resize',resize);
imageReady.then(()=>{resize();requestAnimationFrame(frame)});
</script></body></html>`

await writeFile(outputPath, html, 'utf8')
console.log(`Wrote ${outputPath}`)
