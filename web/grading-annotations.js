(function(root){
'use strict';
const G=root.GradingCore;
function draw(ctx,layout,{scale=1}={}){
 const font='Arial,"PingFang SC","Microsoft YaHei",sans-serif';
 for(const item of layout.items){const {color,mark}=G.statusStyle[item.state.status],x=item.labelX,y=item.labelY;
  ctx.save();ctx.lineWidth=1.3*scale;ctx.strokeStyle=color;ctx.fillStyle=color;ctx.setLineDash(item.confirmed?[]:[4*scale,3*scale]);ctx.beginPath();ctx.moveTo(item.anchorX,item.anchorY);ctx.lineTo(x,y+layout.labelHeight/2);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.arc(item.anchorX,item.anchorY,3*scale,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='white';ctx.fillRect(x,y,layout.labelWidth,layout.labelHeight);ctx.strokeRect(x,y,layout.labelWidth,layout.labelHeight);ctx.fillStyle=color;ctx.textBaseline='top';
  const fit=(value,max)=>{let text=String(value);while(text.length>1&&ctx.measureText(text).width>max)text=text.slice(0,-1);return text===String(value)?text:text.slice(0,-1)+'…';};
  ctx.font='bold '+14*scale+'px '+font;ctx.fillText(fit(mark+' 第'+item.q.number+'题',layout.labelWidth-12*scale),x+6*scale,y+5*scale);
  ctx.font=11*scale+'px '+font;ctx.fillText(fit(G.scoreLabel(item.state),layout.labelWidth-12*scale),x+6*scale,y+23*scale);
  ctx.font=9*scale+'px '+font;ctx.fillStyle='#596861';ctx.fillText(item.confirmed?'位置已校准':'AI 位置 · 待核对',x+6*scale,y+39*scale);ctx.restore();
 }
}
root.GradingAnnotations={draw};
})(typeof window!=='undefined'?window:globalThis);
