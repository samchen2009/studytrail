'use strict';
const sharp=require('sharp');
const VERSION='paper-tone-v1';
// Normalize photographed paper against a smooth local background estimate. This is
// tonal correction only: no thresholding, erasing, inpainting or stroke generation.
async function enhancePaper(bytes){
 const {data,info}=await sharp(bytes,{limitInputPixels:36_000_000}).rotate().flatten({background:'#fff'}).removeAlpha().toColourspace('srgb').raw().toBuffer({resolveWithObject:true});
 const {width,height,channels}=info,hist=new Uint32Array(256);let saturated=0;
 for(let i=0;i<data.length;i+=channels){const r=data[i],g=data[i+1],b=data[i+2];hist[Math.round((r+g+b)/3)]++;if(Math.max(r,g,b)-Math.min(r,g,b)>55)saturated++;}
 const percentile=(h,p,n)=>{let sum=0;for(let i=0;i<256;i++){sum+=h[i];if(sum>=n*p)return i;}return 255;};
 const count=width*height,white=percentile(hist,.9,count),black=Math.min(45,percentile(hist,.02,count));
 // Saturated drawings/photos are not monochrome paper; keep their original tones.
 if(saturated/count>.25||white<75)return {bytes,width,height,version:VERSION,changed:false};
 const tile=64,nx=Math.ceil(width/tile),ny=Math.ceil(height/tile),background=new Float64Array(nx*ny);
 for(let ty=0;ty<ny;ty++)for(let tx=0;tx<nx;tx++){
  const h=new Uint32Array(256);let n=0;
  for(let y=ty*tile;y<Math.min(height,(ty+1)*tile);y++)for(let x=tx*tile;x<Math.min(width,(tx+1)*tile);x++){const i=(y*width+x)*channels;h[Math.round((data[i]+data[i+1]+data[i+2])/3)]++;n++;}
  background[ty*nx+tx]=Math.max(white*.7,percentile(h,.9,n),80);
 }
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const fx=Math.max(0,Math.min(nx-1,x/tile-.5)),fy=Math.max(0,Math.min(ny-1,y/tile-.5)),x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(nx-1,x0+1),y1=Math.min(ny-1,y0+1),dx=fx-x0,dy=fy-y0;
  const bg=(background[y0*nx+x0]*(1-dx)+background[y0*nx+x1]*dx)*(1-dy)+(background[y1*nx+x0]*(1-dx)+background[y1*nx+x1]*dx)*dy;
  const gain=Math.min(2.5,252/Math.max(50,bg-black)),i=(y*width+x)*channels;
  for(let c=0;c<3;c++)data[i+c]=Math.max(0,Math.min(255,Math.round((data[i+c]-black)*gain)));
 }
 const result=await sharp(data,{raw:{width,height,channels}}).jpeg({quality:95,chromaSubsampling:'4:4:4'}).toBuffer();
 return {bytes:result,width,height,version:VERSION,changed:true};
}
module.exports={enhancePaper,VERSION};
