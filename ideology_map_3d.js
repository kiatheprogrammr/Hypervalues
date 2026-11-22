/* Interactive ideology map: values in the scoring matrix determine each ideology's coordinates. */
const HV3DMap = (() => {
  const axes = [
    { label:'Economic', negative:'Socialism', positive:'Capitalism', positiveValues:['laissez_faire','countereconomics','basic_income_capitalism','state_capitalism','corporatocracy','free_market_distributism','Voluntaryism','technocapitalism'], negativeValues:['state_socialism','market_socialism','free_socialism','communization','utopian_socialism','agrarian_socialism','cybernetic_socialism','parecon','collective_distribution'] },
    { label:'Authority', negative:'Libertarianism', positive:'Authoritarianism', positiveValues:['theocracy','absolute','ethical_statism','religious_authoritarianism','autocracy','partocracy','oligarchy','centralism','hypercentralism','securitism','disciplinarianism','regimentalism','totalism'], negativeValues:['anarchism','civil_libertarianism','minarchism','communalism','councilism','polycentrism','confederalism','subsidiarity','anti_organizationalism','patchwork'] },
    { label:'Social', negative:'Progressivism', positive:'Conservatism', positiveValues:['conservatism','traditionalist_conservatism','reactionaryism','paleoconservatism','religious_traditionalism','perennial_traditionalism','cultural_nationalism'], negativeValues:['progressivism','social_progressivism','postmodernism','civil_liberalism','secular_humanism','multiculturalism','permissivism'] }
  ];
  const indexes = new Map(IDEOLOGY_MATRIX.values.map((id,i)=>[id,i]));
  function axisValue(axis, scores) {
    const avg = ids => { const found=ids.filter(id=>indexes.has(id)).map(id=>scores[indexes.get(id)]); return found.length?found.reduce((a,b)=>a+b,0)/found.length:0; };
    return Math.max(-1,Math.min(1,(avg(axis.positiveValues)-avg(axis.negativeValues))/2));
  }
  function render(host, options={}) {
    host.innerHTML=''; host.classList.add('ideology-map-wrap');
    const title=document.createElement('h2'); title.className='ins-heading'; title.textContent='3D ideology map';
    const intro=document.createElement('p'); intro.className='ins-intro'; intro.textContent='Drag to rotate. The axes run from socialism to capitalism, libertarianism to authoritarianism, and progressivism to conservatism. Select a dot to open its ideology.';
    const canvas=document.createElement('canvas'); canvas.className='ideology-map-canvas'; canvas.setAttribute('aria-label','Interactive three-dimensional map of political ideologies');
    const tools=document.createElement('div'); tools.className='ideology-map-tools';
    const save=document.createElement('button'); save.type='button'; save.textContent='Download map image';
    const hint=document.createElement('p'); hint.className='ideology-map-hint'; hint.textContent=Object.keys(IDEOLOGY_MATRIX.ideologies).length+' ideologies plotted. Drag to change the viewing angle.';
    const tip=document.createElement('p'); tip.className='ideology-map-tooltip'; tip.setAttribute('aria-live','polite'); tip.textContent=options.selected?'Highlighted: '+options.selected:'';
    tools.append(save,hint); host.append(title,intro,canvas,tools,tip);
    const ctx=canvas.getContext('2d'), points=Object.keys(IDEOLOGY_MATRIX.ideologies).map(name=>({name,xyz:axes.map(a=>axisValue(a,IDEOLOGY_MATRIX.ideologies[name].s)),color:(labelColors[name]||'#7a7a7a').slice(0,7),href:'description.html?id='+encodeURIComponent(name)+'&type=ideology',highlight:name===options.selected}));
    const userVals=new Map(); if(options.answers)Object.values(options.answers).forEach(list=>(list||[]).forEach(item=>userVals.set(item.value,Number(item.agree)||0)));
    let you=null; if(userVals.size)you={name:'You',xyz:axes.map(axis=>{const avg=ids=>{const a=ids.filter(id=>userVals.has(id)).map(id=>userVals.get(id));return a.length?a.reduce((x,y)=>x+y,0)/a.length:null;};const p=avg(axis.positiveValues),n=avg(axis.negativeValues);return Math.max(-1,Math.min(1,((p||0)-(n||0))/((p===null||n===null)?1:2)));}),color:'#27c4e8',href:'results.html'};
    let yaw=-.62,pitch=.42,drag=null,projected=[];
    function paint(){const dpr=Math.min(devicePixelRatio||1,2),rect=canvas.getBoundingClientRect();canvas.width=Math.round(rect.width*dpr);canvas.height=Math.round(rect.height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);const w=rect.width,h=rect.height,cx=w*.52,cy=h*.51,scale=Math.min(w,h)*.35;ctx.clearRect(0,0,w,h);ctx.fillStyle=getComputedStyle(document.body).getPropertyValue("--bg-color").trim()||"#111";ctx.fillRect(0,0,w,h);const css=getComputedStyle(document.body),text=css.getPropertyValue('--text-primary').trim()||'#fff',dim=css.getPropertyValue('--text-dim').trim()||'#999',edge=css.getPropertyValue('--card-border').trim()||'#777';
      const rot=([x,y,z])=>{const xx=x*Math.cos(yaw)-y*Math.sin(yaw),yy=x*Math.sin(yaw)+y*Math.cos(yaw);return[xx,yy*Math.cos(pitch)-z*Math.sin(pitch),yy*Math.sin(pitch)+z*Math.cos(pitch)];},proj=xyz=>{const[x,y,z]=rot(xyz);return{x:cx+x*scale,y:cy-z*scale,depth:y};};
      ctx.strokeStyle=edge;ctx.lineWidth=1;for(const [a,b] of [[[-1,0,0],[1,0,0]],[[0,-1,0],[0,1,0]],[[0,0,-1],[0,0,1]]]){const A=proj(a),B=proj(b);ctx.beginPath();ctx.moveTo(A.x,A.y);ctx.lineTo(B.x,B.y);ctx.stroke();}
      ctx.fillStyle=dim;ctx.font='12px system-ui';[[[-1,0,0],axes[0].negative],[[1,0,0],axes[0].positive],[[0,-1,0],axes[1].negative],[[0,1,0],axes[1].positive],[[0,0,-1],axes[2].negative],[[0,0,1],axes[2].positive]].forEach(([p,label])=>{const q=proj(p);ctx.fillText(label,q.x+4,q.y-4);});
      const all=points.map(point=>({point,...proj(point.xyz)}));if(you)all.push({point:you,...proj(you.xyz)});all.sort((a,b)=>a.depth-b.depth);projected=all;
      all.forEach(({point,x,y,depth})=>{const r=point.name==='You'?6:point.highlight?7:Math.max(2,3+depth);ctx.globalAlpha=point.name==='You'||point.highlight?1:.72;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=point.color;ctx.fill();if(point.highlight||point.name==='You'){ctx.lineWidth=2;ctx.strokeStyle=text;ctx.stroke();}ctx.globalAlpha=1;if(point.name==='You'||point.highlight){ctx.fillStyle=text;ctx.font='bold 12px system-ui';ctx.fillText(point.name,x+8,y-8);}});
    }
    function hit(e){const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;let best=null,distance=Infinity;projected.forEach(p=>{const d=Math.hypot(p.x-x,p.y-y);if(d<distance){best=p;distance=d;}});return distance<14?best:null;}
    canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,moved:false};canvas.setPointerCapture(e.pointerId);});
    canvas.addEventListener('pointermove',e=>{if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>2)drag.moved=true;yaw+=dx*.008;pitch=Math.max(-1.45,Math.min(1.45,pitch+dy*.008));drag.x=e.clientX;drag.y=e.clientY;paint();}const p=hit(e);tip.textContent=p?p.point.name+(p.point.name==='You'?' — your answers':''):options.selected?'Highlighted: '+options.selected:'';});
    canvas.addEventListener('pointerup',e=>{if(drag&&!drag.moved){const p=hit(e);if(p&&p.point.href)location.href=p.point.href;}drag=null;});canvas.addEventListener('pointerleave',()=>{if(!drag)tip.textContent=options.selected?'Highlighted: '+options.selected:'';});
    save.onclick=()=>{const a=document.createElement('a');a.download='hypervalues-ideology-map.png';a.href=canvas.toDataURL('image/png');a.click();};paint();if('ResizeObserver'in window)new ResizeObserver(paint).observe(canvas);else addEventListener('resize',paint);
  }
  return {render};
})();
