import 'dotenv/config'
import { createServer } from 'node:http'
import app from './app.js'

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000

const server = createServer(app)

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
})

export default server
