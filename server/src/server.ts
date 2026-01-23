import { createServer } from 'node:http'
import app, { mongoReady } from './app.js'

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000

const server = createServer(app)

// Do not block startup on Mongo; connection errors are logged inside mongoReady
mongoReady.catch(() => {
  /* already logged in app.ts */
})

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
})

export default server
