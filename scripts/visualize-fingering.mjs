import { readFile, writeFile } from 'node:fs/promises'

const [, , inputPath, outputPath = 'fingering-view.html'] = process.argv
if (!inputPath) {
  console.error('Usage: npm run analyzer:fingering:view -- <result.json> [output.html]')
  process.exit(2)
}

const result = JSON.parse(await readFile(inputPath, 'utf8'))
const trace = result.fingeringTrace
if (!Array.isArray(trace) || !trace.length) {
  throw new Error('Result has no fingeringTrace. Re-run analyzer:fingering with the current analyzer version.')
}
const keyCount = Number(result.traceKeyCount ?? 0)
if (!Number.isFinite(keyCount) || keyCount < 1) throw new Error('Result has no valid traceKeyCount')
if (!Array.isArray(result.timing?.track) || !Array.isArray(result.timing?.segments)) {
  throw new Error('Result has no playback track geometry. Re-run analyzer:fingering with adofai-timing-v0.3 or newer.')
}

const payload = JSON.stringify({
  modelVersion: result.modelVersion,
  keyCount,
  trace,
  input: result.input,
  traceStats: result.traceStats,
  warnings: result.warnings ?? [],
  timing: result.timing,
}).replaceAll('<', '\\u003c')

const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ELF ADOFAI Fingering Replay</title>
<style>
:root{color-scheme:dark;background:#090d18;color:#eef2ff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;background:#090d18;color:#eef2ff}main{width:min(1400px,100%);margin:auto;padding:12px}.top{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:10px}.title{font-size:18px;font-weight:650}.muted{color:#aeb8d0;font-size:12px}.stage{position:relative;width:100%;height:min(74vh,820px);min-height:480px;border:1px solid #28324c;border-radius:14px;overflow:hidden;background:#0c1323}canvas{display:block;width:100%;height:100%}.hud{position:absolute;inset:0;pointer-events:none}.status{position:absolute;top:14px;left:16px;background:#0b1020cc;border:1px solid #33405f;border-radius:10px;padding:8px 10px;font-size:13px;line-height:1.45}.keys{position:absolute;left:16px;bottom:18px;display:flex;gap:7px;align-items:flex-end}.key{width:54px;height:58px;border:2px solid #8290ad;background:#151d30dd;border-radius:8px;display:grid;place-items:center;font-weight:700;font-size:14px;transition:background .04s,transform .04s,border-color .04s}.key.on{background:#eef2ff;color:#111827;border-color:#fff;transform:translateY(3px)}.controls{display:grid;grid-template-columns:auto auto minmax(160px,1fr) auto auto;gap:10px;align-items:center;margin-top:10px;padding:10px 12px;border:1px solid #28324c;border-radius:12px;background:#11182c}.controls button,.controls select{background:#18213a;color:#eef2ff;border:1px solid #3a4767;border-radius:8px;padding:7px 10px;font:inherit}.controls input[type=range]{width:100%}.time{font-variant-numeric:tabular-nums;font-size:13px;white-space:nowrap}.warn{color:#ffd685;margin-left:auto}@media(max-width:700px){main{padding:6px}.stage{height:70vh;min-height:420px}.controls{grid-template-columns:auto auto 1fr}.controls .zoom,.controls .speedlabel{display:none}.key{width:42px;height:50px}.status{font-size:11px}}
</style>
</head>
<body><main>
<div class="top"><div class="title">ELF ADOFAI Fingering Replay</div><div id="subtitle" class="muted"></div><div id="warnings" class="muted warn"></div></div>
<div class="stage"><canvas id="stage"></canvas><div class="hud"><div id="status" class="status"></div><div id="keys" class="keys"></div></div></div>
<div class="controls">
<button id="play" type="button">▶ Play</button>
<button id="restart" type="button">↺</button>
<input id="seek" type="range" min="0" max="1000" value="0">
<span id="time" class="time">0:00.000 / 0:00.000</span>
<label class="speedlabel">Speed <select id="speed"><option>0.25</option><option>0.5</option><option selected>1</option><option>1.5</option><option>2</option></select>x</label>
<label class="zoom">Zoom <input id="zoom" type="range" min="35" max="130" value="78"></label>
</div>
</main>
<script>
const data=${payload};
const trace=data.trace,timing=data.timing,track=timing.track,segments=timing.segments.filter(s=>!s.midspin&&Number.isFinite(s.hitTimeMs));
const canvas=document.getElementById('stage'),ctx=canvas.getContext('2d'),seek=document.getElementById('seek'),play=document.getElementById('play'),speed=document.getElementById('speed'),zoom=document.getElementById('zoom');
const keys=document.getElementById('keys'),status=document.getElementById('status'),timeLabel=document.getElementById('time');
const duration=Math.max(trace[trace.length-1].timeMs,segments.length?segments[segments.length-1].hitTimeMs:0,1);
let current=0,playing=false,lastFrame=0;
document.getElementById('subtitle').textContent=data.modelVersion+' · '+data.keyCount+'K · '+trace.length+' presses · '+timing.extractorVersion;
document.getElementById('warnings').textContent=[...(data.warnings||[]),...(timing.warnings||[])].join(' · ');
for(let i=0;i<data.keyCount;i++){const d=document.createElement('div');d.className='key';d.id='key'+i;d.textContent='K'+(i+1);keys.appendChild(d)}
function fmt(ms){const s=Math.max(0,ms)/1000,m=Math.floor(s/60),r=s-m*60;return m+':'+r.toFixed(3).padStart(6,'0')}
function floorPoint(index){return track[Math.max(0,Math.min(track.length-1,index))]||track[0]}
function segmentAt(ms){let lo=0,hi=segments.length-1,ans=segments[0];while(lo<=hi){const mid=(lo+hi)>>1,s=segments[mid];if(ms<=s.hitTimeMs){ans=s;hi=mid-1}else lo=mid+1}return ans||segments[segments.length-1]}
function previousPlayableFloor(floor){for(let i=floor-1;i>=0;i--){if(track[i]&&!track[i].midspin)return track[i]}return floorPoint(floor)}
function orbitState(ms){const s=segmentAt(ms);if(!s)return{floor:0,bpm:timing.baseBpm,pivot:floorPoint(0),moving:floorPoint(0)};const pivot=floorPoint(s.sourceFloor);const target=floorPoint(s.targetFloor);const prev=previousPlayableFloor(s.sourceFloor);const travelStart=Number.isFinite(s.travelStartMs)?s.travelStartMs:Math.max(0,s.hitTimeMs-s.travelMs);let p=ms<=travelStart?0:(ms-travelStart)/Math.max(1,s.travelMs);p=Math.max(0,Math.min(1,p));const startA=Math.atan2(prev.y-pivot.y,prev.x-pivot.x);const a=startA+(s.direction||-1)*(s.travelDegrees||180)*Math.PI/180*p;const radius=Math.max(.001,Math.hypot(target.x-pivot.x,target.y-pivot.y));return{floor:s.sourceFloor,bpm:s.bpm,pivot,moving:{x:pivot.x+Math.cos(a)*radius,y:pivot.y+Math.sin(a)*radius},target,progress:p}}
function activeFingers(ms){const out=new Set();const hold=95/Math.max(.25,Number(speed.value)||1);for(let i=trace.length-1;i>=0;i--){const p=trace[i];if(p.timeMs>ms+18)continue;if(ms-p.timeMs>hold)break;if(ms>=p.timeMs-18)out.add(p.finger)}return out}
function resize(){const dpr=devicePixelRatio||1,r=canvas.getBoundingClientRect();canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);draw()}
function draw(){const r=canvas.getBoundingClientRect(),w=r.width,h=r.height,state=orbitState(current),scale=Number(zoom.value),cx=w*.53,cy=h*.48,cam=state.pivot;ctx.clearRect(0,0,w,h);ctx.fillStyle='#0c1323';ctx.fillRect(0,0,w,h);const sx=p=>cx+(p.x-cam.x)*scale,sy=p=>cy-(p.y-cam.y)*scale;const center=state.floor;
 ctx.lineWidth=6;ctx.lineCap='round';for(let i=Math.max(1,center-35);i<Math.min(track.length,center+45);i++){const a=track[i-1],b=track[i];if(!a||!b||b.midspin)continue;const d=Math.abs(i-center),alpha=Math.max(.08,1-d/48);ctx.strokeStyle='rgba(112,130,166,'+alpha+')';ctx.beginPath();ctx.moveTo(sx(a),sy(a));ctx.lineTo(sx(b),sy(b));ctx.stroke()}
 for(let i=Math.max(0,center-30);i<Math.min(track.length,center+40);i++){const p=track[i];if(!p||p.midspin)continue;const d=Math.abs(i-center),alpha=Math.max(.12,1-d/38);ctx.fillStyle=i===center?'rgba(240,244,255,.95)':'rgba(45,58,88,'+alpha+')';ctx.strokeStyle='rgba(168,181,210,'+alpha+')';ctx.lineWidth=2;ctx.beginPath();ctx.arc(sx(p),sy(p),9,0,Math.PI*2);ctx.fill();ctx.stroke();if(d<5){ctx.fillStyle=i===center?'#111827':'#b8c3da';ctx.font='10px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(i),sx(p),sy(p))}}
 const pr=13;ctx.fillStyle='#ff5a6f';ctx.beginPath();ctx.arc(sx(state.pivot),sy(state.pivot),pr,0,Math.PI*2);ctx.fill();ctx.fillStyle='#55a7ff';ctx.beginPath();ctx.arc(sx(state.moving),sy(state.moving),pr,0,Math.PI*2);ctx.fill();
 const active=activeFingers(current);for(let i=0;i<data.keyCount;i++)document.getElementById('key'+i).classList.toggle('on',active.has(i));status.innerHTML='floor <b>'+state.floor+'</b> / '+(track.length-1)+'<br>BPM <b>'+Number(state.bpm||0).toFixed(2)+'</b><br>DP <b>'+data.keyCount+'K</b>';seek.value=String(Math.round(current/duration*1000));timeLabel.textContent=fmt(current)+' / '+fmt(duration)}
function frame(ts){if(playing){if(!lastFrame)lastFrame=ts;current+=Math.max(0,ts-lastFrame)*(Number(speed.value)||1);if(current>=duration){current=duration;playing=false;play.textContent='▶ Play'}lastFrame=ts;draw()}else lastFrame=ts;requestAnimationFrame(frame)}
play.addEventListener('click',()=>{playing=!playing;play.textContent=playing?'❚❚ Pause':'▶ Play';lastFrame=performance.now()});document.getElementById('restart').addEventListener('click',()=>{current=0;draw()});seek.addEventListener('input',()=>{current=Number(seek.value)/1000*duration;draw()});zoom.addEventListener('input',draw);addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();play.click()}else if(e.code==='ArrowRight'){current=Math.min(duration,current+1000);draw()}else if(e.code==='ArrowLeft'){current=Math.max(0,current-1000);draw()}});addEventListener('resize',resize);resize();requestAnimationFrame(frame);
</script></body></html>`

await writeFile(outputPath, html, 'utf8')
console.log(`Wrote ${outputPath}`)
