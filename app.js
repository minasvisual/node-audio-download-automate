const path = require('path')
const _ = require('lodash')
require('dotenv').config()

const Audio = require('./lib/audio')
const Strings = require('./lib/strings')
const Ftp = require('./lib/ftp')

let app = { 
  ROOT_PATH: __dirname
}


let main = async (filename = 'RATPAJAMA - Nunca mais.mp3') => {
  try{
    const { changeBitrate, readTags, writeTags } = Audio(app) 
    const { sanitizeFile } = Strings(app) 
    const { connection, list, upload, disconnect } = Ftp(app) 
    
    let source = path.resolve( __dirname, 'source', filename )
    let output = path.resolve( __dirname, 'processed', filename)
    
    let [, artist, title, ext] = /^(.*[^\s])\s?-\s?([^\s].*)\.(.*)/gm.exec(filename)

    let audioFile = await changeBitrate({
      source,
      output
    })
    
    let meta = await readTags(output) 

    if( !_.has(meta.artist) || !_.has(meta.title) ){
      meta.artist = artist
      meta.performerInfo = artist
      meta.title = title
      meta.bitrate = 96
     
      await writeTags(output, meta) 
      
      console.log("Write tags", meta)
    }
    
    let { filename:newFilename, filePath:newOutput } = await sanitizeFile({ filePath: output })
    output = newOutput
    filename = newFilename
    
    await connection({ host:process.env.FTP_HOST, user:process.env.FTP_USER, password:process.env.FTP_PASS, })
    
    await upload(output, `/temp/${filename}`)
    
    let tempFolder = await list('/temp')
    
    console.log("File", tempFolder)
    
    disconnect()
  }catch(e){
    console.error("erro", e)
  }
}

main()
//Up Against Down - Harmony Pulse.mp3