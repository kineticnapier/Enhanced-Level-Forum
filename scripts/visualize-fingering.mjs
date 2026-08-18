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

const payload = JSON.stringify({
  modelVersion: result.modelVersion,
  keyCount,
  trace,
  input: result.input,
  traceStats: result.traceStats,
  warnings: result.warnings ?? [],
}).replaceAll('<', '\\u003c')

const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ELF Fingering Trace</title>
<style>
:root{color-scheme:dark;background:#0b1020;color:#eef2ff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;padding:20px;background:#0b1020}main{max-width:1200px;margin:auto}.panel{background:#11182c;border:1px solid #28324c;border-radius:14px;padding:16px;margin-bottom:14px}h1{font-size:20px;margin:0 0 8px}.muted{color:#aeb8d0;font-size:13px}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}.metric{background:#171f36;border-radius:10px;padding:10px}.metric b{display:block;font-size:20px;margin-top:2px}.controls{display:grid;grid-template-columns:1fr 1fr;gap:14px}label{display:block;font-size:13px;color:#c5cee3}input[type=range]{width:100%}canvas{display:block;width:100%;height:520px;background:#0d1426;border:1px solid #28324c;border-radius:12px}.legend{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.chip{border:1px solid #34405e;border-radius:999px;padding:4px 8px;font-size:12px}.warn{color:#ffd685}@media(max-width:650px){body{padding:10px}.controls{grid-template-columns:1fr}canvas{height:420px}}
</style>
</head>
<body><main>
<div class="panel"><h1>ELF Fingering Trace</h1><div id="subtitle" class="muted"></div><div id="metrics" class="metrics" style="margin-top:12px"></div><div id="warnings" class="legend"></div></div>
<div class="panel controls">
<label>表示開始 <span id="startText"></span><input id="start" type="range" min="0" max="1000" value="0"></label>
<label>表示幅 <span id="windowText"></span><input id="window" type="range" min="250" max="30000" step="250" value="6000"></label>
</div>
<div class="panel"><canvas id="chart"></canvas><div class="muted" id="visible"></div></div>
</main>
<script>
const data=${payload};
const trace=data.trace;
const first=trace[0].timeMs,last=trace[trace.length-1].timeMs,duration=Math.max(1,last-first);
const canvas=document.getElementById('chart'),ctx=canvas.getContext('2d');
const start=document.getElementById('start'),win=document.getElementById('window');
const stats=data.traceStats||{};
document.getElementById('subtitle').textContent=data.modelVersion+' · '+data.keyCount+'K · '+trace.length+' presses';
document.getElementById('metrics').innerHTML=[['Keys',data.keyCount+'K'],['Presses',trace.length],['Cost / press',Number(stats.costPerPress||0).toFixed(4)],['Pruned',Number(stats.prunedStates||0).toLocaleString()]].map(x=>'<div class="metric"><span class="muted">'+x[0]+'</span><b>'+x[1]+'</b></div>').join('');
document.getElementById('warnings').innerHTML=(data.warnings||[]).map(x=>'<span class="chip warn">'+x+'</span>').join('');
function resize(){const dpr=devicePixelRatio||1;const r=canvas.getBoundingClientRect();canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);draw()}
function draw(){
 const rect=canvas.getBoundingClientRect(),w=rect.width,h=rect.height,left=54,right=14,top=18,bottom=30,pw=w-left-right,ph=h-top-bottom;
 const windowMs=Math.min(Number(win.value),duration);const maxStart=Math.max(0,duration-windowMs);const startMs=first+(Number(start.value)/1000)*maxStart;const endMs=startMs+windowMs;
 document.getElementById('startText').textContent=(startMs/1000).toFixed(2)+' s';document.getElementById('windowText').textContent=(windowMs/1000).toFixed(2)+' s';
 ctx.clearRect(0,0,w,h);ctx.font='12px system-ui';ctx.textBaseline='middle';
 for(let k=0;k<data.keyCount;k++){const y=top+(k+.5)*ph/data.keyCount;ctx.strokeStyle='#26324d';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(w-right,y);ctx.stroke();ctx.fillStyle='#b9c3dc';ctx.fillText('K'+(k+1),8,y)}
 let shown=0;ctx.fillStyle='#7aa2ff';
 for(const p of trace){if(p.timeMs<startMs||p.timeMs>endMs)continue;const x=left+(p.timeMs-startMs)/windowMs*pw;const y=top+(p.finger+.5)*ph/data.keyCount;ctx.beginPath();ctx.arc(x,y,Math.max(2,Math.min(5,ph/data.keyCount*.22)),0,Math.PI*2);ctx.fill();shown++}
 ctx.fillStyle='#95a2bf';ctx.textBaseline='top';for(let i=0;i<=6;i++){const t=startMs+windowMs*i/6,x=left+pw*i/6;ctx.fillText((t/1000).toFixed(1)+'s',x-12,h-bottom+7)}
 document.getElementById('visible').textContent='visible presses: '+shown+' / '+trace.length+' · '+(startMs/1000).toFixed(2)+'s — '+(endMs/1000).toFixed(2)+'s';
}
start.addEventListener('input',draw);win.addEventListener('input',draw);addEventListener('resize',resize);resize();
</script></body></html>`

await writeFile(outputPath, html, 'utf8')
console.log(`Wrote ${outputPath}`)
