const {inspectVideoContainer:inspect,MAX_VIDEO_BYTES,MAX_ELEMENTS}=require('../services/videoContainer')
const mp4='video/mp4',webm='video/webm'
const cat=(...parts)=>Buffer.concat(parts)
function box(type,payload=Buffer.alloc(0),extended=false){
  const h=Buffer.alloc(extended?16:8)
  h.writeUInt32BE(extended?1:h.length+payload.length)
  h.write(type,4,4,'latin1')
  if(extended)h.writeBigUInt64BE(BigInt(h.length+payload.length),8)
  return cat(h,payload)
}
const ftyp=box('ftyp',Buffer.from('isom0000'))
const moov=box('moov',Buffer.from([1]))
const mdat=box('mdat',Buffer.from([1,2,3]))
const mp=cat(ftyp,moov,mdat)
function ebml(id,payload,unknown=false){
  const h=Buffer.from(id,'hex')
  if(unknown)return cat(h,Buffer.from([255]),payload)
  if(payload.length>126)throw Error('fixture too big')
  return cat(h,Buffer.from([128+payload.length]),payload)
}
const header=ebml('1a45dfa3',ebml('4282',Buffer.from('webm')))
const info=ebml('1549a966',Buffer.from([1]))
const tracks=ebml('1654ae6b',Buffer.from([1]))
const block=ebml('a3',Buffer.from([0x81,0,0,0x80,1]))
const cluster=ebml('1f43b675',cat(ebml('e7',Buffer.from([0])),block))
const segment=(...children)=>ebml('18538067',cat(...children))
const wm=cat(header,segment(info,tracks,cluster))
function denied(buffer,mime,status=415){
  try{inspect(buffer,mime);throw Error('Unexpected preflight success')}
  catch(e){expect(e.status).toBe(status);expect(e.code).toBe(status===413?'VIDEO_TOO_LARGE':'VIDEO_CONTAINER_INVALID')}
}
// These minimal envelopes deliberately do not represent decodable videos.
test('bounded MP4 envelopes and extended sizes pass structural preflight only',()=>{
  expect(inspect(mp,mp4)).toEqual({mime:mp4,bytes:mp.length,elements:3})
  expect(inspect(cat(ftyp,moov,box('mdat',Buffer.from([1]),true)),mp4).elements).toBe(3)
  expect(inspect(cat(ftyp,moov,box('moof',Buffer.from([1])),mdat,box('moof',Buffer.from([2])),mdat),mp4).elements).toBe(6)
})
test.each([
  ['no ftyp',cat(moov,mdat)],['duplicate ftyp',cat(ftyp,ftyp,moov,mdat)],
  ['no moov',cat(ftyp,mdat)],['duplicate moov',cat(ftyp,moov,moov,mdat)],
  ['no media',cat(ftyp,moov)],['empty media',cat(ftyp,moov,box('mdat'))],
  ['partial header',cat(mp,Buffer.from([1]))],['partial payload',mp.subarray(0,mp.length-1)],
  ['zero-sized box',cat(ftyp,moov,Buffer.from('000000006d64617401','hex'))],
  ['oversize extended',cat(ftyp,moov,Buffer.from('000000016d646174ffffffffffffffff','hex'))],
  ['truncated extended',cat(ftyp,moov,Buffer.from('000000016d646174','hex'))],
  ['undersized box',cat(ftyp,moov,Buffer.from('000000046d646174','hex'))],
  ['unsupported box',cat(ftyp,moov,box('uuid'),mdat)],
  ['high-bit disguised type',cat(ftyp,moov,box('\u00ed\u00e4\u00e1\u00f4',Buffer.from([1])))],
  ['empty moov',cat(ftyp,box('moov'),mdat)],
  ['malformed ftyp length',cat(box('ftyp',Buffer.alloc(9)),moov,mdat)]
])('rejects MP4 %s',(_name,b)=>denied(b,mp4))
test('bounded WebM envelope and final unknown-size Cluster with explicit children',()=>{
  expect(inspect(wm,webm).bytes).toBe(wm.length)
  const live=cat(header,ebml('18538067',cat(info,tracks,ebml('1f43b675',block,true)),true))
  expect(inspect(live,webm).bytes).toBe(live.length)
  denied(live.subarray(0,live.length-1),webm)
})
test.each([
  ['wrong DocType',cat(ebml('1a45dfa3',ebml('4282',Buffer.from('matroska'))),segment(info,tracks,cluster))],
  ['duplicate DocType',cat(ebml('1a45dfa3',cat(ebml('4282',Buffer.from('webm')),ebml('4282',Buffer.from('webm')))),segment(info,tracks,cluster))],
  ['missing tracks',cat(header,segment(info,cluster))],
  ['duplicate tracks',cat(header,segment(info,tracks,tracks,cluster))],
  ['cluster before info',cat(header,segment(cluster,info,tracks))],
  ['missing block',cat(header,segment(info,tracks,ebml('1f43b675',ebml('e7',Buffer.from([0])))))],
  ['unknown child size',cat(header,segment(info,tracks,ebml('1f43b675',ebml('a3',Buffer.from([1]),true))))],
  ['unknown nested segment child',cat(header,segment(ebml('1549a966',Buffer.from([1]),true),tracks,cluster))],
  ['trailing bytes',cat(wm,Buffer.from([1]))],
  ['truncated segment',wm.subarray(0,wm.length-1)],
  ['truncated vint',cat(header,Buffer.from('1853806701','hex'))],
  ['invalid zero vint',cat(header,Buffer.from('1853806700','hex'))],
  ['unknown cluster followed by segment metadata',cat(header,ebml('18538067',cat(info,tracks,ebml('1f43b675',block,true),ebml('1c53bb6b',Buffer.from([1]))),true))]
])('rejects WebM %s',(_name,b)=>denied(b,webm))
test('rejects false MIME, nonbuffer and arbitrary data',()=>{
  denied(mp,webm);denied(wm,mp4);denied(mp,'video/quicktime')
  denied(mp,'video/mp4; codecs=avc1');denied('not bytes',mp4)
  denied(Buffer.alloc(30),mp4);denied(Buffer.alloc(30),webm)
})
test('bounds byte and element work',()=>{
  denied(Buffer.alloc(MAX_VIDEO_BYTES+1),mp4,413)
  denied(cat(ftyp,moov,mdat,...Array(MAX_ELEMENTS).fill(box('free'))),mp4)
})

test('WebM bounds cumulative elements and rejects child crossing its parent',()=>{
  const over=cat(header,Buffer.from('18538067ff','hex'),info,tracks,...Array(MAX_ELEMENTS).fill(Buffer.from('ec80','hex')),cluster)
  denied(over,webm)
  const badChild=ebml('1f43b675',Buffer.from('a38a8100','hex'))
  denied(cat(header,segment(info,tracks,badChild)),webm)
})
test('deterministic malformed-input mutations never escape the typed error contract',()=>{
  let seed=0x20261128
  function next(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed}
  for(const [base,mime] of [[mp,mp4],[wm,webm]]){
    for(let i=0;i<1024;i++){
      const mutated=Buffer.from(base)
      for(let j=0;j<1+(i%4);j++)mutated[next()%mutated.length]=next()&255
      try{
        const out=inspect(mutated,mime)
        expect(out.mime).toBe(mime);expect(out.bytes).toBe(mutated.length)
        expect(out.elements).toBeLessThanOrEqual(MAX_ELEMENTS)
      }catch(e){expect(e.status).toBe(415);expect(e.code).toBe('VIDEO_CONTAINER_INVALID')}
    }
  }
})
