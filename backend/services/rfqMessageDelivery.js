// Durable RFQ free-message receipt, compatible with standalone MongoDB.
const crypto = require('crypto')
const mongoose = require('mongoose')
const Thread = require('../models/MessageThread')
const Notification = require('../models/Notification')
const RFQ = require('../models/QuoteRequest')
const WRITE = { writeConcern: { w: 1, j: true }, maxTimeMS: 10000, runValidators: true }
const same = (a,b) => a != null && b != null && String(a) === String(b)
const fail = (status,code,message) => Object.assign(new Error(message), {status,code})
const conflict = () => fail(409,'RFQ_MESSAGE_CONFLICT','معرف محاولة الرسالة يتعارض مع المحادثة المحفوظة')
const retry = () => fail(503,'RFQ_MESSAGE_RETRY','لم يتأكد إرسال الرسالة؛ أعد المحاولة بنفس المعرف')
const closed = () => fail(409,'RFQ_MESSAGE_CLOSED','المحادثة مغلقة')
const keyPattern = /^[A-Za-z0-9_-]{16,128}$/
const digest = values => crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex')
const scope = rfq => ({rfqId:rfq._id,buyerId:rfq.buyerId,supplierId:rfq.supplierId})
const load = filter => Thread.findOne(filter).read('primary').lean().maxTimeMS(5000)
function messageAt(thread,id) {
  const rows = (thread?.messages || []).filter(m=>same(m._id,id))
  if(rows.length>1)throw conflict()
  return rows[0]
}
function publicThread(thread) {
  if(!thread)return thread
  const out=thread.toObject?thread.toObject():thread
  return {...out,messages:(out.messages||[]).map(({delivery,...message})=>message)}
}
function identity(req,rfq,buyer,content) {
  const supplied=req.get('Idempotency-Key')
  if(supplied!==undefined&&!keyPattern.test(supplied))throw fail(400,'RFQ_MESSAGE_KEY','معرف محاولة الرسالة غير صالح')
  const key=supplied||'legacy_'+crypto.randomUUID()
  const hash=digest(['rfq-message-v1',String(rfq._id),req.supplier.id,key])
  const id=new mongoose.Types.ObjectId(hash.slice(0,24))
  const senderRole=buyer?'buyer':'supplier',recipientId=buyer?rfq.supplierId:rfq.buyerId
  return {id,hash,content,senderRole,senderId:req.supplier.id,recipientId}
}
function verify(thread,message,attempt) {
  const d=message?.delivery
  if(!d||d.version!==1||!['pending','completed'].includes(d.phase)||
    typeof d.hash!=='string'||!(/^[a-f0-9]{64}$/.test(d.hash))||!same(message._id,d.hash.slice(0,24))||
    !message.senderId||!['buyer','supplier'].includes(message.senderRole)||
    typeof message.content!=='string'||!message.content.trim()||message.content.length>5000||
    !(message.sentAt instanceof Date)||!Number.isFinite(message.sentAt.getTime())||
    !same(d.recipientId,message.senderRole==='buyer'?thread.supplierId:thread.buyerId)||
    (message.senderRole==='buyer'&&!same(message.senderId,thread.buyerId))||
    same(thread.buyerId,thread.supplierId)||
    (attempt&&(d.hash!==attempt.hash||!same(message.senderId,attempt.senderId)||message.senderRole!==attempt.senderRole||message.content!==attempt.content||!same(d.recipientId,attempt.recipientId))))throw conflict()
  return d
}
const pendingFilter=(thread,message)=>({_id:thread._id,rfqId:thread.rfqId,buyerId:thread.buyerId,supplierId:thread.supplierId,messages:{$elemMatch:{_id:message._id,'delivery.version':1,'delivery.hash':message.delivery.hash,'delivery.phase':'pending'}}})
async function complete(thread,message) {
  const d=verify(thread,message)
  if(d.phase==='completed')return
  if(!await RFQ.exists({_id:thread.rfqId,buyerId:thread.buyerId,supplierId:thread.supplierId}).read('primary').maxTimeMS(5000))throw conflict()
  const notice={_id:message._id,userId:d.recipientId,type:'message_received',resourceType:'rfq',resourceId:thread.rfqId}
  try {
    await Notification.updateOne(notice,{$setOnInsert:{...notice,createdAt:message.sentAt}},{...WRITE,upsert:true})
  }catch(e){
    if(!await Notification.exists(notice).read('primary').maxTimeMS(5000))throw e
  }
  if(!await Notification.exists(notice).read('primary').maxTimeMS(5000))throw retry()
  await Thread.updateOne(pendingFilter(thread,message),{$set:{'messages.$.delivery.phase':'completed'},$unset:{'messages.$.delivery.nextAttemptAt':1} },WRITE)
}
async function postpone(thread,message,now) {
  const attempts=message.delivery?.attempts||0
  const next=new Date(now.getTime()+Math.min(60000,1000*2**Math.min(attempts,6)))
  try {
    await Thread.updateOne(pendingFilter(thread,message),{$inc:{'messages.$.delivery.attempts':1},$set:{'messages.$.delivery.nextAttemptAt':next}},WRITE)
  }catch{/* A pending receipt remains discoverable. */}
}
async function sendMessage(req,rfq,buyer,content) {
  const a=identity(req,rfq,buyer,content),filter=scope(rfq)
  let thread=await load(filter),message=messageAt(thread,a.id),replayed=Boolean(message)
  if(!message){
    if(!['pending','responded'].includes(rfq.status)||thread?.status!=='open')throw closed()
    const now=new Date()
    try{
      const result=await Thread.updateOne({...filter,_id:thread._id,status:'open','messages._id':{$ne:a.id}},{
        $push:{messages:{_id:a.id,content:a.content,senderId:a.senderId,senderRole:a.senderRole,senderName:req.supplier.name,sentAt:now,
          delivery:{version:1,hash:a.hash,recipientId:a.recipientId,phase:'pending',attempts:0,nextAttemptAt:now}}},
        $max:{lastMessageAt:now}
      },WRITE)
      replayed=!result.modifiedCount
    }catch(e){
      thread=await load(filter);message=messageAt(thread,a.id)
      if(!message)throw retry()
    }
    thread=await load(filter);message=messageAt(thread,a.id)
    if(!message)throw closed()
  }
  verify(thread,message,a)
  try{
    await complete(thread,message)
  }catch(e){
    await postpone(thread,message,new Date())
    // Do not return 202: historical clients interpret any 2xx as completed.
    throw retry()
  }
  const fresh=await load(filter),saved=messageAt(fresh,a.id)
  if(verify(fresh,saved,a).phase!=='completed')throw retry()
  return {thread:publicThread(fresh),submission:{version:1,phase:'completed',messageId:String(a.id),replayed}}
}
async function recoverPendingMessages({limit=25,now=new Date(),onError}={}) {
  const due={'delivery.version':1,'delivery.phase':'pending','delivery.attempts':{$lt:10},'delivery.nextAttemptAt':{$lte:now}}
  const rows=await Thread.find({messages:{$elemMatch:due}},{rfqId:1,buyerId:1,supplierId:1,messages:{$elemMatch:due}})
    .sort({'messages.delivery.nextAttemptAt':1,_id:1}).limit(Math.min(100,Math.max(1,limit))).lean().maxTimeMS(5000)
  const result={processed:rows.length,completed:0,pending:0}
  for(const thread of rows){
    const message=thread.messages?.[0]
    try{
      await complete(thread,message)
      const saved=await load({_id:thread._id})
      if(verify(saved,messageAt(saved,message._id)).phase!=='completed')throw retry()
      result.completed++
    }catch{
      if(message?.delivery)await postpone(thread,message,now)
      result.pending++;onError?.({code:'RFQ_MESSAGE_RETRY',rfqId:String(thread.rfqId)})
    }
  }
  return result
}
function createMessageRecovery({pollMs=5000,onError}={}) {
  let stopped=false,started=false,timer,running
  const runOnce=()=>stopped?Promise.resolve({processed:0,completed:0,pending:0}):(running||=recoverPendingMessages({onError}).finally(()=>{running=null}))
  async function tick(){try{await runOnce()}catch{onError?.({code:'RFQ_MESSAGE_UNAVAILABLE'})}if(!stopped){timer=setTimeout(tick,pollMs);timer.unref?.()}}
  return {runOnce,start(){if(!started&&!stopped){started=true;tick()}return this},async stop({graceMs=15000}={}){
    stopped=true;clearTimeout(timer);let timeout
    try{await Promise.race([running||Promise.resolve(),new Promise(resolve=>{timeout=setTimeout(resolve,graceMs)})])}finally{clearTimeout(timeout)}
  }}
}

async function messageAttempt(req,rfq,buyer) {
  const supplied=req.get('Idempotency-Key')
  if(!supplied||!keyPattern.test(supplied))throw fail(400,'RFQ_MESSAGE_KEY','معرف محاولة الرسالة غير صالح')
  const a=identity(req,rfq,buyer,undefined),thread=await load(scope(rfq))
  if(!thread)throw conflict()
  const message=messageAt(thread,a.id)
  const submission=message?{version:1,phase:verify(thread,message,{...a,content:message.content}).phase,messageId:String(a.id)}:{version:1,phase:'absent'}
  return {rfqId:String(rfq._id),actorId:req.supplier.id,submission}
}
module.exports={sendMessage,messageAttempt,publicThread,recoverPendingMessages,createMessageRecovery}
