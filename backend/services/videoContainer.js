// Bounded, dependency-free structural preflight only. Never use this result
// as proof of codec validity, decoded duration, rights, or safe playback.
const MAX_VIDEO_BYTES = 20 * 1024 * 1024
const MAX_ELEMENTS = 65536
const MP4_TYPES = new Set(['ftyp','moov','mdat','moof','free','skip','wide','sidx','styp','mfra','pdin'])
const WEBM_SEGMENT = new Set([0x114d9b74,0x1549a966,0x1654ae6b,0x1f43b675,0x1c53bb6b,0x1254c367,0x1941a469,0x1043a770,0xec,0xbf])
const WEBM_CLUSTER = new Set([0xe7,0xa3,0xa0,0xa7,0xab,0x5854,0xec,0xbf])
const fail = () => { throw Object.assign(new Error('Invalid or unsupported video container'), { status: 415, code: 'VIDEO_CONTAINER_INVALID' }) }

function inspectVideoContainer(buffer, mime) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) fail()
  if (buffer.length > MAX_VIDEO_BYTES) throw Object.assign(new Error('Video exceeds 20 MiB'), {status:413,code:'VIDEO_TOO_LARGE'})
  let count = 0
  const tick = () => { if (++count > MAX_ELEMENTS) fail() }
  if (mime === 'video/mp4') {
    let offset = 0, ftyp = 0, moov = 0, mdat = 0
    while (offset < buffer.length) {
      tick()
      const remaining = buffer.length - offset
      if (remaining < 8) fail()
      const size32 = buffer.readUInt32BE(offset), type = buffer.toString('latin1',offset+4,offset+8)
      let size = size32, header = 8
      // An open-ended box cannot establish a complete bounded upload.
      if (size32 === 0 || !MP4_TYPES.has(type)) fail()
      if (size32 === 1) {
        if (remaining < 16) fail()
        const extended = buffer.readBigUInt64BE(offset+8)
        if (extended > BigInt(remaining)) fail()
        size = Number(extended); header = 16
      }
      if (size < header || size > remaining || (offset === 0 && type !== 'ftyp')) fail()
      if (type === 'ftyp') {
        if (offset !== 0 || size-header < 8 || (size-header)%4 !== 0) fail()
        ftyp++
      }
      if (type === 'moov') { if (size === header) fail(); moov++ }
      if (type === 'mdat') { if (size === header) fail(); mdat++ }
      offset += size
    }
    if (ftyp !== 1 || moov !== 1 || !mdat) fail()
    return {mime, bytes:buffer.length, elements:count}
  }
  if (mime !== 'video/webm') fail()
  // EBML VINTs must be bounded by the containing element, not the whole file.
  function vint(offset,end,id=false) {
    if (offset >= end || buffer[offset] === 0) fail()
    let length=1, mask=128
    while (!(buffer[offset]&mask)) { length++; mask>>=1 }
    if (length>(id?4:8) || length>end-offset) fail()
    let value=BigInt(id?buffer[offset]:buffer[offset]&(mask-1))
    for(let i=1;i<length;i++) value=(value<<8n)|BigInt(buffer[offset+i])
    const unknown=!id&&value===(1n<<BigInt(7*length))-1n
    if (!unknown && value>BigInt(Number.MAX_SAFE_INTEGER)) fail()
    return {value:unknown?null:Number(value),next:offset+length}
  }
  function element(offset,end) {
    tick()
    const id=vint(offset,end,true), size=vint(id.next,end)
    if(size.value!==null&&size.value>end-size.next) fail()
    return {id:id.value,start:size.next,end:size.value===null?end:size.next+size.value,unknown:size.value===null}
  }
  const header=element(0,buffer.length)
  if(header.id!==0x1a45dfa3||header.unknown) fail()
  let docTypes=0
  for(let o=header.start;o<header.end;) {
    const e=element(o,header.end)
    if(e.unknown) fail()
    if(e.id===0x4282) { if(e.end-e.start!==4||buffer.toString('latin1',e.start,e.end)!=='webm') fail(); docTypes++ }
    o=e.end
  }
  if(docTypes!==1) fail()
  const segment=element(header.end,buffer.length)
  if(segment.id!==0x18538067||segment.end!==buffer.length) fail()
  let info=0,tracks=0,clusters=0,blocks=0
  for(let o=segment.start;o<segment.end;) {
    const e=element(o,segment.end)
    if(!WEBM_SEGMENT.has(e.id)||(e.unknown&&e.id!==0x1f43b675)) fail()
    if(e.id===0x1549a966) { if(e.start===e.end||clusters) fail(); info++ }
    if(e.id===0x1654ae6b) { if(e.start===e.end||clusters) fail(); tracks++ }
    if(e.id===0x1f43b675) {
      if(info!==1||tracks!==1) fail()
      clusters++
      // An unknown-sized Cluster is supported only as the final Cluster;
      // its immediate children must all have explicit, complete sizes.
      for(let p=e.start;p<e.end;) {
        const child=element(p,e.end)
        if(child.unknown||!WEBM_CLUSTER.has(child.id)) fail()
        if(child.id===0xa3||child.id===0xa0) {
          if(child.end===child.start) fail()
          blocks++
        }
        p=child.end
      }
    }
    o=e.end
  }
  if(info!==1||tracks!==1||!clusters||!blocks) fail()
  return {mime,bytes:buffer.length,elements:count}
}

module.exports={inspectVideoContainer,MAX_VIDEO_BYTES,MAX_ELEMENTS}
