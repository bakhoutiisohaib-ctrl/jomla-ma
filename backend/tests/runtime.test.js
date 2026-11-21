process.env.CORS_ORIGIN='http://localhost:3000,http://localhost:5001'
const request=require('supertest'),mongoose=require('mongoose')
const app=require('../server')
test('health is live but not ready without a database',async()=>{
 expect((await request(app).get('/health/live')).status).toBe(200)
 expect(mongoose.connection.readyState).toBe(0)
 expect((await request(app).get('/health/ready')).status).toBe(503)
})
test('comma-separated configured origins produce one matching CORS origin',async()=>{
 const a=await request(app).get('/health/live').set('Origin','http://localhost:3000')
 const b=await request(app).get('/health/live').set('Origin','http://localhost:5001')
 const foreign=await request(app).get('/health/live').set('Origin','https://untrusted.example')
 expect(a.headers['access-control-allow-origin']).toBe('http://localhost:3000')
 expect(b.headers['access-control-allow-origin']).toBe('http://localhost:5001')
 expect(foreign.headers['access-control-allow-origin']).toBeUndefined()
})
