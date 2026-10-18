const swaggerJsdoc = require('swagger-jsdoc')

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Jomla.ma API',
      version: '1.0.0',
      description: 'API documentation for Jomla.ma'
    }
    ,
    servers: [
      { url: process.env.SWAGGER_SERVER || 'http://localhost:5000' }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    }
  },
  apis: ['./routes/*.js']
}

const swaggerSpec = swaggerJsdoc(options)
module.exports = swaggerSpec
