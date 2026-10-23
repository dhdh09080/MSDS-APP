let current=null,pending=null;
const localSource='local("HY헤드라인M"),local("HYHeadLine-Medium"),local("HYHeadLineM")';
const makeCss=source=>`@font-face{font-family:'BinderHY';src:${source};font-weight:100 900;font-style:normal;font-display:block;}`;
export async function loadBinderLocalFont() {
 if(current)return current;
 if(!pending)pending=(async()=>{try{
  const response=await fetch(`${import.meta.env.BASE_URL}fonts/hy-headline-m.ttf`);
  if(!response.ok)throw new Error('글꼴을 불러오지 못했습니다.');
  const buffer=await response.arrayBuffer();
  return await importBinderFont({size:buffer.byteLength,name:'HY헤드라인M.ttf',arrayBuffer:async()=>buffer},'첨부하신 HY헤드라인M');
 }catch{try{const face=new FontFace('BinderHY',localSource,{weight:'100 900'});await face.load();document.fonts.add(face);current={ready:true,css:makeCss(localSource),source:'설치된 HY헤드라인M'};}catch{current={ready:false,css:'',source:'HY헤드라인M 미설치'};}return current;}})();
 return pending;
}
function fontNames(buffer){
 const view=new DataView(buffer);if(view.byteLength<12)throw new Error('글꼴 파일을 읽을 수 없습니다.');
 const tag=String.fromCharCode(...new Uint8Array(buffer,0,4));if(view.getUint32(0)!==0x00010000&&tag!=='OTTO')throw new Error('TTF 또는 OTF 글꼴 파일을 선택해주세요.');
 const count=view.getUint16(4);let table;
 for(let i=0;i<count;i++){const at=12+i*16;if(at+16>view.byteLength)break;if(view.getUint32(at)===0x6e616d65)table=view.getUint32(at+8);}
 if(table===undefined||table+6>view.byteLength)throw new Error('글꼴 이름을 확인할 수 없습니다.');
 const records=view.getUint16(table+2),start=table+view.getUint16(table+4),names=[];
 for(let i=0;i<records;i++){const at=table+6+i*12;if(at+12>view.byteLength)break;const platform=view.getUint16(at),id=view.getUint16(at+6),length=view.getUint16(at+8),offset=start+view.getUint16(at+10);if(![1,4,6,16].includes(id)||offset+length>view.byteLength)continue;const bytes=new Uint8Array(buffer,offset,length);names.push(new TextDecoder(platform===0||platform===3?'utf-16be':'latin1').decode(bytes));}
 return names;
}
export async function importBinderFont(file,source='선택한 HY헤드라인M (현재 탭)') {
 if(!file||file.size>15*1024*1024)throw new Error('15MB 이하의 HY헤드라인M TTF/OTF 파일을 선택해주세요.');
 const buffer=await file.arrayBuffer(),names=fontNames(buffer);
 if(!names.some(name=>/HY.*(?:헤드라인|Head\s*Line)/i.test(name)))throw new Error('HY헤드라인M 글꼴로 확인되지 않습니다. 해당 글꼴 파일을 선택해주세요.');
 const face=new FontFace('BinderHY',buffer,{weight:'100 900'});await face.load();document.fonts.add(face);
 let binary='';for(const byte of new Uint8Array(buffer))binary+=String.fromCharCode(byte);
 current={ready:true,css:makeCss(`url(data:font/${file.name.toLowerCase().endsWith('.otf')?'otf':'ttf'};base64,${btoa(binary)})`),source};return current;
}
