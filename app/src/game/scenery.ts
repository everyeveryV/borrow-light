/** Painted scene layers. Decoration never participates in collision or replay. */
const W = 1120, H = 460;
export const scenePalettes = [
  ['#163d48', '#74929a', '#203f49', '#edc783'],
  ['#303750', '#9b8b91', '#263b4a', '#e6b98b'],
  ['#183c4c', '#8caeb4', '#214b58', '#c1dfce'],
  ['#262e51', '#777da4', '#29394e', '#d5cef0'],
  ['#322c40', '#9c7172', '#443746', '#efba78'],
];
export function paintScene(c: CanvasRenderingContext2D, id: number) {
  const [top, horizon, ink, light] = scenePalettes[id - 1];
  const rect = (x:number,y:number,w:number,h:number,color:string) => { c.fillStyle=color;c.fillRect(x,y,w,h); };
  const path = (p:number[][],color:string) => { c.beginPath();p.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=color;c.fill(); };
  const line = (p:number[][],color:string,width=1) => {c.beginPath();p.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.strokeStyle=color;c.lineWidth=width;c.stroke();};
  const oval = (x:number,y:number,rx:number,ry:number,color:string) => {c.beginPath();c.ellipse(x,y,rx,ry,0,0,Math.PI*2);c.fillStyle=color;c.fill();};
  const glow = (x:number,y:number,r:number,color:string) => {const g=c.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,color);g.addColorStop(1,'transparent');c.fillStyle=g;c.fillRect(x-r,y-r,r*2,r*2);};
  const roof = (x:number,y:number,w:number,color:string) => {path([[x-12,y+13],[x+12,y+3],[x+w*.45,y-9],[x+w*.55,y-9],[x+w-12,y+3],[x+w+12,y+13]],color);line([[x-12,y+13],[x+w+12,y+13]],'#a99c8b66',2);};
  const window = (x:number,y:number,w:number,h:number,lit:boolean) => {rect(x-2,y-2,w+4,h+4,'#1a293a');rect(x,y,w,h,lit?'#d3a66a':'#426074');line([[x+w/2,y],[x+w/2,y+h]],ink,2);line([[x,y+h*.55],[x+w,y+h*.55]],ink,2);if(lit)glow(x+w/2,y+h/2,w*2,'#e9b16b20');};
  const house = (x:number,y:number,w:number,h:number,color:string,lit=false) => {
    rect(x,y,w,h,color);roof(x,y-8,w,color);
    for(let row=0;row<Math.floor(h/57);row++)for(let col=0;col<Math.floor(w/37);col++)window(x+10+col*37,y+13+row*57,17,29,lit&&(col+row)%3===0);
    rect(x,y+h-5,w,5,'#192b39');line([[x+5,y],[x+5,y+h]],'#a0b0af22',3);
  };
  const sky=c.createLinearGradient(0,0,0,H);sky.addColorStop(0,top);sky.addColorStop(.66,horizon);sky.addColorStop(1,ink);c.fillStyle=sky;c.fillRect(0,0,W,H);
  glow(id===3?780:690,112,150,light+'28');oval(id===3?780:690,112,id===4?32:22,id===4?32:22,light+'99');
  for(let layer=0;layer<3;layer++) {
    const pts=[[0,320]];for(let x=0;x<=W;x+=35)pts.push([x,225+layer*28+Math.sin(x*.009+layer*2)*23+Math.sin(x*.022+layer)*12]);pts.push([W,380],[0,380]);path(pts,[ink+'45',ink+'66',ink+'99'][layer]);
  }
  if(id===2) {
    // A monumental three-arch crossing behind the playable paper bridges.
    for(let i=0;i<8;i++)house(i*155-20,188+(i%3)*14,118,112, '#35434f',i%2===0);
    c.save();c.beginPath();c.rect(0,240,W,115);for(const x of [245,560,875]){c.moveTo(x+110,355);c.arc(x,355,110,0,Math.PI,true);}c.fillStyle='#303f4b';c.fill('evenodd');c.restore();
    for(const x of [245,560,875]) {
      c.beginPath();c.arc(x,355,116,Math.PI,Math.PI*2);c.strokeStyle='#7e8584';c.lineWidth=12;c.stroke();
      for(let j=0;j<15;j++){const a=Math.PI+j/14*Math.PI;line([[x+110*Math.cos(a),355+110*Math.sin(a)],[x+123*Math.cos(a),355+123*Math.sin(a)]],'#313d47',2);}
    }
    path([[0,241],[170,226],[560,218],[950,226],[W,241],[W,253],[560,234],[0,253]],'#8b9290');
    for(let x=0;x<W;x+=43){const y=218+Math.abs(x-560)*.035;rect(x,y-22,5,23,'#8c9895');oval(x+2,y-24,5,4,'#b1b5a3');}
    line([[0,216],[280,199],[560,195],[840,199],[W,216]],'#a2ada5',3);
    house(32,150,92,198,'#344652',true);house(967,142,111,210,'#38454f',true);
    c.font='16px SimSun';c.fillStyle='#e2c593';c.fillText('三拱',1000,181);
  } else if(id===3) {
    const river=c.createLinearGradient(0,235,0,H);river.addColorStop(0,'#749caa');river.addColorStop(1,'#173c4b');c.fillStyle=river;c.fillRect(0,257,W,203);
    for(let i=0;i<45;i++){const x=(i*131)%W,y=272+(i*23)%180;line([[x,y],[x+25+i%40,y]],'#c2ded525');}
    path([[0,234],[60,211],[158,224],[232,256],[220,285],[0,290]],'#284a54');
    path([[W,217],[1060,204],[955,229],[856,271],[W,289]],'#315461');
    house(-25,163,171,180,'#304b56',true);roof(-35,148,200,'#263d49');
    for(const x of [299,830]){line([[x,236],[x,306]],'#253e49',3);path([[x+3,242],[x+47,279],[x+3,281]],'#a9b7a8');path([[x-35,303],[x+54,303],[x+35,316],[x-21,315]],'#283d46');}
    for(let i=0;i<25;i++){const x=960+i*7,y=323+(i%3)*7;line([[x,y+20],[x-6,y-30-(i%5)*6]],'#254c4d',2);oval(x-6,y-34-(i%5)*6,3,9,'#8b927a');}
    line([[872,310],[872,185],[1040,185]],'#354c51',5);line([[872,206],[991,185]],'#4e6a6c',2);
    for(let x=884;x<1020;x+=12)line([[x,188],[x-14,265]],'#bed0c236');
    for(let y=205;y<263;y+=13)line([[883,y],[1017-(y-200)*.25,y+4]],'#bed0c236');
  } else if(id===4) {
    // Two inhabited banks leave a moonlit void for the borrowed beam.
    for(let i=0;i<4;i++){house(i*71-40,100+(i%2)*38,64,244,'#26364c',true);house(850+i*80,115+(i%2)*31,73,230,'#2d3d54',true);}
    house(-12,180,222,166,'#3b4b5d',true);house(909,166,226,181,'#3d4a5d',true);
    for(const x of [16,935]){roof(x,160,170,'#29394c');for(let row=0;row<2;row++)for(let col=0;col<4;col++)window(x+12+col*40,186+row*62,24,39,(row+col)%2===0);}
    line([[196,197],[400,221],[720,225],[927,188]],'#9a9eac77',1.5);
    for(let i=0;i<7;i++){const x=288+i*82,y=208+Math.sin(i/6*Math.PI)*17;path([[x,y],[x+23,y+1],[x+20,y+32],[x+2,y+29]],['#798d9f','#ba9a94','#a0b6ad'][i%3]);}
    for(let i=0;i<20;i++)oval(270+i*29,112+Math.sin(i*2.8)*45,.8,.8,'#cfdbdc99');
    path([[430,313],[455,307],[644,309],[672,317],[660,325],[444,323]],'#1b3046');
  } else if(id===5) {
    for(let i=0;i<10;i++)house(i*121-22,158+(i%3)*20,110,178,['#4d454f','#51474f','#45444f'][i%3],true);
    for(let i=0;i<6;i++){
      const x=135+i*151,y=277+(i%2)*10;
      rect(x,y,116,70,'#594a43');rect(x+6,y+23,104,43,'#292e39');
      path([[x-12,y],[x+6,y-27],[x+108,y-27],[x+127,y]],i%2?'#ac8061':'#8e5354');
      for(let j=0;j<8;j++){const l=x-12+j*17;path([[l,y],[l+17,y],[l+13,y+8],[l+4,y+8]],i%2?'#dab78a':'#c78974');}
      for(let j=0;j<5;j++){oval(x+15+j*20,y+41,7,5,['#ba985e','#c89776','#9eae89'][j%3]);}
      line([[x+8,y],[x+8,y+68]],'#d2a576',3);line([[x+108,y],[x+108,y+68]],'#d2a576',3);
      rect(x+39,y-19,37,15,'#312e35');c.font='10px SimSun';c.fillStyle='#edce9c';c.fillText(['糖水','花灯','茶档','云吞','香铺','书摊'][i],x+46,y-8);
    }
    for(const x of [65,1040]){rect(x,152,12,199,'#684d44');roof(x-26,144,65,'#483c43');rect(x-16,171,44,78,'#a77858');c.font='20px SimSun';c.fillStyle='#f3dba9';c.fillText(x<100?'夜':'市',x-4,201);}
  }
  // Thin mist softens the painted layers without hiding the foreground route.
  const mist=c.createLinearGradient(0,200,0,355);mist.addColorStop(0,'transparent');mist.addColorStop(.7,horizon+'18');mist.addColorStop(1,ink+'99');c.fillStyle=mist;c.fillRect(0,200,W,155);
}
