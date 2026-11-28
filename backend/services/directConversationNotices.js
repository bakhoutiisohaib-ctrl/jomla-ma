const mongoose=require('mongoose')
const Conversation=require('../models/DirectConversation')
const supported=actor=>['buyer','supplier'].includes(actor.role)
const own=actor=>({[actor.role==='buyer'?'buyerId':'supplierId']:new mongoose.Types.ObjectId(actor.id)})
const other=actor=>actor.role==='buyer'?'supplier':'buyer'
const type='direct_message',resourceType='direct_conversation'
const noticeIdType={$type:'objectId'}
function matchMessage(actor){return {'messages.role':other(actor),'messages.noticeId':noticeIdType}}
function pipeline(actor){return [{$match:{...own(actor),messages:{$elemMatch:{role:other(actor),noticeId:noticeIdType}}}},{$project:{messages:{role:1,noticeId:1,noticeReadAt:1,sentAt:1}}},{$unwind:'$messages'},{$match:matchMessage(actor)}]}
function dto(row){return {_id:row._id,type,resourceType,resourceId:row.resourceId,createdAt:row.createdAt,readAt:row.readAt??null}}
async function inbox(actor){
 if(!supported(actor))return {data:[],unreadCount:0}
 const [result]=await Conversation.aggregate([...pipeline(actor),{$facet:{
  data:[{$sort:{'messages.sentAt':-1,'messages.noticeId':-1}},{$limit:100},{$project:{_id:'$messages.noticeId',resourceId:'$_id',createdAt:'$messages.sentAt',readAt:'$messages.noticeReadAt'}}],
  unread:[{$match:{'messages.noticeReadAt':null}},{$count:'count'}]
 }}]).read('primary').option({maxTimeMS:5000})
 return {data:result.data.map(dto),unreadCount:result.unread[0]?.count||0}
}
async function read(actor,id){
 if(!supported(actor))return null
 const noticeId=new mongoose.Types.ObjectId(id),filter={...own(actor),messages:{$elemMatch:{role:other(actor),noticeId}}}
 const row=await Conversation.findOneAndUpdate(filter,{$set:{'messages.$[message].noticeReadAt':new Date()}},{arrayFilters:[{'message.role':other(actor),'message.noticeId':noticeId,'message.noticeReadAt':null}],new:true,maxTimeMS:5000,writeConcern:{w:1,j:true}}).select('messages.role messages.noticeId messages.noticeReadAt messages.sentAt').lean()
 if(!row)return null
 const m=row.messages.find(m=>m.role===other(actor)&&String(m.noticeId)===id)
 if(!m||!(m.noticeReadAt instanceof Date))throw Error('Direct notification read not confirmed')
 return dto({_id:m.noticeId,resourceId:row._id,createdAt:m.sentAt,readAt:m.noticeReadAt})
}
async function readAll(actor){
 if(!supported(actor))return
 await Conversation.updateMany({...own(actor),messages:{$elemMatch:{role:other(actor),noticeId:noticeIdType,noticeReadAt:null}}},{$set:{'messages.$[message].noticeReadAt':new Date()}},{arrayFilters:[{'message.role':other(actor),'message.noticeId':noticeIdType,'message.noticeReadAt':null}],maxTimeMS:5000,writeConcern:{w:1,j:true}})
}
module.exports={inbox,read,readAll}
