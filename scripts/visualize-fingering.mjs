import { readFile, writeFile } from 'node:fs/promises'

const [, , inputPath, outputPath = 'fingering-view.html'] = process.argv
if (!inputPath) {
  console.error('Usage: npm run analyzer:fingering:view -- <result.json> [output.html]')
  process.exit(2)
}

const result = JSON.parse(await readFile(inputPath, 'utf8'))
const trace = result.fingeringTrace
if (!Array.isArray(trace) || !trace.length) throw new Error('Result has no fingeringTrace. Re-run analyzer:fingering.')
const keyCount = Number(result.traceKeyCount ?? 0)
if (!Number.isFinite(keyCount) || keyCount < 1) throw new Error('Result has no valid traceKeyCount')
if (!Array.isArray(result.timing?.track) || !Array.isArray(result.timing?.segments)) throw new Error('Result has no playback track geometry. Re-run analyzer:fingering with adofai-timing-v0.4 or newer.')

const payload = JSON.stringify({
  modelVersion: result.modelVersion,
  keyCount,
  fingerProfile: result.fingerProfile ?? [],
  trace,
  input: result.input,
  traceStats: result.traceStats,
  warnings: result.warnings ?? [],
  timing: result.timing,
}).replaceAll('<', '\\u003c')

const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ELF ADOFAI Fingering Replay</title>
<style>
:root{color-scheme:dark;background:#090d18;color:#eef2ff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:#090d18;color:#eef2ff}main{width:min(1400px,100%);margin:auto;padding:12px}.top{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:10px}.title{font-size:18px;font-weight:650}.muted{color:#aeb8d0;font-size:12px}.stage{position:relative;width:100%;height:min(74vh,820px);min-height:480px;border:1px solid #28324c;border-radius:14px;overflow:hidden;background:#0c1323}canvas{display:block;width:100%;height:100%}.hud{position:absolute;inset:0;pointer-events:none}.status{position:absolute;top:14px;left:16px;background:#0b1020cc;border:1px solid #33405f;border-radius:10px;padding:8px 10px;font-size:13px;line-height:1.45}.keys{position:absolute;left:16px;bottom:18px;display:flex;gap:7px;align-items:flex-end}.key{min-width:54px;height:58px;padding:0 7px;border:2px solid #8290ad;background:#151d30dd;border-radius:8px;display:grid;place-items:center;font-weight:700;font-size:13px;transition:background .035s,transform .035s,border-color .035s}.key.left{border-color:#7898cf}.key.right{border-color:#cf7898}.key.on{background:#eef2ff;color:#111827;border-color:#fff;transform:translateY(3px)}.controls{display:grid;grid-template-columns:auto auto minmax(160px,1fr) auto auto;gap:10px;align-items:center;margin-top:10px;padding:10px 12px;border:1px solid #28324c;border-radius:12px;background:#11182c}.controls button,.controls select{background:#18213a;color:#eef2ff;border:1px solid #3a4767;border-radius:8px;padding:7px 10px;font:inherit}.controls input[type=range]{width:100%}.time{font-variant-numeric:tabular-nums;font-size:13px;white-space:nowrap}.warn{color:#ffd685;margin-left:auto}@media(max-width:700px){main{padding:6px}.stage{height:70vh;min-height:420px}.controls{grid-template-columns:auto auto 1fr}.controls .zoom,.controls .speedlabel{display:none}.key{min-width:42px;height:50px}.status{font-size:11px}}
</style></head><body><main>
<div class="top"><div class="title">ELF ADOFAI Fingering Replay</div><div id="subtitle" class="muted"></div><div id="warnings" class="muted warn"></div></div>
<div class="stage"><canvas id="stage"></canvas><div class="hud"><div id="status" class="status"></div><div id="keys" class="keys"></div></div></div>
<div class="controls"><button id="play" type="button">▶ Play</button><button id="restart" type="button">↺</button><input id="seek" type="range" min="0" max="1000" value="0"><span id="time" class="time">0:00.000 / 0:00.000</span><label class="speedlabel">Speed <select id="speed"><option>0.25</option><option>0.5</option><option selected>1</option><option>1.5</option><option>2</option></select>x</label><label class="zoom">Zoom <input id="zoom" type="range" min="35" max="150" value="82"></label></div>
</main><script>
const data=${payload};
const trace=data.trace,timing=data.timing,track=timing.track,segments=timing.segments.filter(s=>!s.midspin&&Number.isFinite(s.hitTimeMs)),visualEvents=timing.visualEvents||[];
const canvas=document.getElementById('stage'),ctx=canvas.getContext('2d'),seek=document.getElementById('seek'),play=document.getElementById('play'),speed=document.getElementById('speed'),zoom=document.getElementById('zoom');
const keys=document.getElementById('keys'),status=document.getElementById('status'),timeLabel=document.getElementById('time');
const duration=Math.max(trace[trace.length-1].timeMs,segments.length?segments[segments.length-1].hitTimeMs:0,1);
let current=0,playing=false,lastFrame=0;
document.getElementById('subtitle').textContent=data.modelVersion+' · '+data.keyCount+'K · '+trace.length+' presses · '+timing.extractorVersion;
document.getElementById('warnings').textContent=[...(data.warnings||[]),...(timing.warnings||[])].join(' · ');
const profile=data.fingerProfile?.length?data.fingerProfile:Array.from({length:data.keyCount},(_,i)=>({index:i,label:'K'+(i+1),hand:i<data.keyCount/2?'L':'R'}));
for(let i=0;i<data.keyCount;i++){const f=profile[i]||{label:'K'+(i+1),hand:i<data.keyCount/2?'L':'R'};const d=document.createElement('div');d.className='key '+(f.hand==='L'?'left':'right');d.id='key'+i;d.textContent=f.label;keys.appendChild(d)}
function fmt(ms){const s=Math.max(0,ms)/1000,m=Math.floor(s/60),r=s-m*60;return m+':'+r.toFixed(3).padStart(6,'0')}
function floorPoint(index){return track[Math.max(0,Math.min(track.length-1,index))]||track[0]}
function segmentAt(ms){let lo=0,hi=segments.length-1,ans=segments[0];while(lo<=hi){const mid=(lo+hi)>>1,s=segments[mid];if(ms<=s.hitTimeMs){ans=s;hi=mid-1}else lo=mid+1}return ans||segments[segments.length-1]}
function previousPlayableFloor(floor){for(let i=floor-1;i>=0;i--){if(track[i]&&!track[i].midspin)return track[i]}return floorPoint(floor)}
function orbitState(ms){const s=segmentAt(ms);if(!s)return{floor:0,bpm:timing.baseBpm,pivot:floorPoint(0),moving:floorPoint(0),direction:-1};const pivot=floorPoint(s.sourceFloor),target=floorPoint(s.targetFloor),prev=previousPlayableFloor(s.sourceFloor),travelStart=Number.isFinite(s.travelStartMs)?s.travelStartMs:Math.max(0,s.hitTimeMs-s.travelMs);let p=ms<=travelStart?0:(ms-travelStart)/Math.max(1,s.travelMs);p=Math.max(0,Math.min(1,p));const startA=Math.atan2(prev.y-pivot.y,prev.x-pivot.x),a=startA+(s.direction||-1)*(s.travelDegrees||180)*Math.PI/180*p,radius=Math.max(.001,Math.hypot(target.x-pivot.x,target.y-pivot.y));return{floor:s.sourceFloor,bpm:s.bpm,pivot,moving:{x:pivot.x+Math.cos(a)*radius,y:pivot.y+Math.sin(a)*radius},target,progress:p,direction:s.direction||-1}}
function activeFingers(ms){const out=new Set();const pressWindowMs=82;for(let i=trace.length-1;i>=0;i--){const p=trace[i];if(p.timeMs>ms+16)continue;if(ms-p.timeMs>pressWindowMs)break;if(ms>=p.timeMs-16)out.add(p.finger)}return out}
function drawRoundedTile(x,y,size,active,alpha){const half=size/2,r=Math.max(3,size*.22);ctx.beginPath();ctx.roundRect(x-half,y-half,size,size,r);ctx.fillStyle=active?'rgba(238,242,255,.98)':'rgba(47,59,85,'+alpha+')';ctx.fill();ctx.lineWidth=Math.max(1.5,size*.09);ctx.strokeStyle=active?'rgba(255,255,255,1)':'rgba(151,166,197,'+Math.min(1,alpha+.2)+')';ctx.stroke();ctx.beginPath();ctx.roundRect(x-half+size*.12,y-half+size*.12,size*.76,size*.76,Math.max(2,r*.65));ctx.lineWidth=Math.max(1,size*.035);ctx.strokeStyle=active?'rgba(112,125,154,.7)':'rgba(104,120,153,'+alpha*.65+')';ctx.stroke()}
function eventLabel(e){if(e.eventType==='Twirl')return e.directionAfter>0?'↺':'↻';if(e.eventType==='SetSpeed'){if(e.speedType==='Multiplier'&&Number.isFinite(e.bpmMultiplier))return '×'+Number(e.bpmMultiplier).toFixed(2).replace(/\.00$/,'');return Math.round(e.bpmAfter)+' BPM'}return e.eventType}
function resize(){const dpr=devicePixelRatio||1,r=canvas.getBoundingClientRect();canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);draw()}
function draw(){const r=canvas.getBoundingClientRect(),w=r.width,h=r.height,state=orbitState(current),scale=Number(zoom.value),cx=w*.53,cy=h*.48,cam=state.pivot;ctx.clearRect(0,0,w,h);ctx.fillStyle='#0c1323';ctx.fillRect(0,0,w,h);const sx=p=>cx+(p.x-cam.x)*scale,sy=p=>cy-(p.y-cam.y)*scale,center=state.floor,tileSize=Math.max(20,scale*.46);
 ctx.lineCap='round';for(let i=Math.max(1,center-35);i<Math.min(track.length,center+45);i++){const a=track[i-1],b=track[i];if(!a||!b||a.midspin||b.midspin)continue;const d=Math.abs(i-center),alpha=Math.max(.08,1-d/48);ctx.strokeStyle='rgba(83,99,132,'+alpha+')';ctx.lineWidth=Math.max(8,tileSize*.48);ctx.beginPath();ctx.moveTo(sx(a),sy(a));ctx.lineTo(sx(b),sy(b));ctx.stroke();ctx.strokeStyle='rgba(31,41,64,'+alpha+')';ctx.lineWidth=Math.max(3,tileSize*.2);ctx.stroke()}
 for(let i=Math.max(0,center-30);i<Math.min(track.length,center+40);i++){const p=track[i];if(!p||p.midspin)continue;const d=Math.abs(i-center),alpha=Math.max(.12,1-d/38);drawRoundedTile(sx(p),sy(p),tileSize,i===center,alpha);if(d<4){ctx.fillStyle=i===center?'#111827':'#b8c3da';ctx.font=Math.max(9,tileSize*.22)+'px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i),sx(p),sy(p))}}
 for(const e of visualEvents){if(Math.abs(e.floor-center)>9)continue;const p=floorPoint(e.floor);if(!p||p.midspin)continue;const x=sx(p),y=sy(p)-tileSize*.78;ctx.font='700 '+Math.max(12,tileSize*.3)+'px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle=e.eventType==='Twirl'?'#d7b7ff':'#ffd27a';ctx.fillText(eventLabel(e),x,y)}
 const pr=Math.max(11,scale*.17);ctx.fillStyle='#ff5a6f';ctx.beginPath();ctx.arc(sx(state.pivot),sy(state.pivot),pr,0,Math.PI*2);ctx.fill();ctx.fillStyle='#55a7ff';ctx.beginPath();ctx.arc(sx(state.moving),sy(state.moving),pr,0,Math.PI*2);ctx.fill();
 const active=activeFingers(current);for(let i=0;i<data.keyCount;i++)document.getElementById('key'+i).classList.toggle('on',active.has(i));status.innerHTML='floor <b>'+state.floor+'</b> / '+(track.length-1)+'<br>BPM <b>'+Number(state.bpm||0).toFixed(2)+'</b><br>direction <b>'+(state.direction>0?'CCW':'CW')+'</b><br>DP <b>'+data.keyCount+'K</b>';seek.value=String(Math.round(current/duration*1000));timeLabel.textContent=fmt(current)+' / '+fmt(duration)}
function frame(ts){if(playing){if(!lastFrame)lastFrame=ts;current+=Math.max(0,ts-lastFrame)*(Number(speed.value)||1);if(current>=duration){current=duration;playing=false;play.textContent='▶ Play'}lastFrame=ts;draw()}else lastFrame=ts;requestAnimationFrame(frame)}
play.addEventListener('click',()=>{playing=!playing;play.textContent=playing?'❚❚ Pause':'▶ Play';lastFrame=performance.now()});document.getElementById('restart').addEventListener('click',()=>{current=0;draw()});seek.addEventListener('input',()=>{current=Number(seek.value)/1000*duration;draw()});zoom.addEventListener('input',draw);addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();play.click()}else if(e.code==='ArrowRight'){current=Math.min(duration,current+1000);draw()}else if(e.code==='ArrowLeft'){current=Math.max(0,current-1000);draw()}});addEventListener('resize',resize);resize();requestAnimationFrame(frame);
</script></body></html>`

await writeFile(outputPath, html, 'utf8')
console.log(`Wrote ${outputPath}`)
