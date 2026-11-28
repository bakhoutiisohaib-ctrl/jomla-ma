require('dotenv').config()
const mongoose=require('mongoose')
const {initRedis}=require('./middleware/cache')
const {logInfo,logError}=require('./middleware/logger')
const app=require('./server')
let server, worker, decisionRecovery, creationRecovery, offerRecovery, rejectionRecovery, sourcingRecovery, messageRecovery, verificationRecovery, shuttingDown = false
async function start(){
 await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/jomla-ma',{serverSelectionTimeoutMS:10000})
 logInfo('Database connected')
 if(!process.env.DISABLE_REDIS) await initRedis()
 decisionRecovery=require('./services/rfqDecision').createDecisionRecovery({
   onError: error=>logError(new Error(error.code),'RFQ decision recovery')}).start()
 creationRecovery=require('./services/rfqCreation').createCreationRecovery({
   onError: error=>logError(new Error(error.code),'RFQ creation recovery')}).start()
 offerRecovery=require('./services/rfqOfferSubmission').createOfferRecovery({
   onError: error=>logError(new Error(error.code),'RFQ offer recovery')}).start()
 rejectionRecovery=require('./services/rfqSupplierRejection').createRejectionRecovery({
   onError: error=>logError(new Error(error.code),'RFQ supplier rejection recovery')}).start()
 sourcingRecovery=require('./services/sourcingRecovery').createSourcingRecovery({
   onError: error=>logError(new Error(error.code),'Sourcing offer recovery')}).start()
 messageRecovery=require('./services/rfqMessageDelivery').createMessageRecovery({
   onError: error=>logError(new Error(error.code),'RFQ message recovery')}).start()
 verificationRecovery=require('./services/supplierVerification').createVerificationRecovery({onError:error=>logError(new Error(error.code),'Supplier verification recovery')}).start()
 if ((process.env.JOB_WORKER_MODE || 'embedded') === 'embedded') {
  const {createWorker}=require('./services/jobQueue')
  const handlers=require('./services/jobHandlers')
  await require('./models/BackgroundJob').init()
  worker=createWorker({handlers,
    concurrency:process.env.JOB_CONCURRENCY === undefined ? undefined : Number(process.env.JOB_CONCURRENCY),
    leaseMs:process.env.JOB_LEASE_MS === undefined ? undefined : Number(process.env.JOB_LEASE_MS),
    pollMs:process.env.JOB_POLL_MS === undefined ? undefined : Number(process.env.JOB_POLL_MS),
    onError:error=>logError(new Error(error.code),'Background worker')}).start()
 }
 server=app.listen(Number(process.env.PORT)||5000,()=>logInfo('API listening; readiness endpoint /health/ready'))
 server.on('error',error=>{logError(new Error(error.code),'HTTP server');shutdown(1)})
}
async function shutdown(code=0){if(shuttingDown)return;shuttingDown=true;if(worker)await worker.stop({graceMs:15000});if(server?.listening)await new Promise(resolve=>server.close(resolve));if(decisionRecovery)await decisionRecovery.stop();if(creationRecovery)await creationRecovery.stop();if(offerRecovery)await offerRecovery.stop();if(rejectionRecovery)await rejectionRecovery.stop();if(sourcingRecovery)await sourcingRecovery.stop();if(messageRecovery)await messageRecovery.stop();if(verificationRecovery)await verificationRecovery.stop();await mongoose.disconnect();process.exit(code)}
process.on('SIGINT',()=>shutdown());process.on('SIGTERM',()=>shutdown())
start().catch(async error=>{logError(new Error(error.name),'Startup failed; API was not started');if(worker)await worker.stop({graceMs:1000});if(decisionRecovery)await decisionRecovery.stop();if(creationRecovery)await creationRecovery.stop();if(offerRecovery)await offerRecovery.stop();if(rejectionRecovery)await rejectionRecovery.stop();if(sourcingRecovery)await sourcingRecovery.stop();if(messageRecovery)await messageRecovery.stop();if(verificationRecovery)await verificationRecovery.stop();await mongoose.disconnect();process.exitCode=1})
