const path = require('path')
const fs = require('fs')
const _ = require('lodash')
require('dotenv').config()

const Audio = require('./lib/audio')
const Strings = require('./lib/strings')
const Ftp = require('./lib/ftp')
const Explorer = require('./lib/explorer')
const YoutubeMp3Downloader = require("youtube-mp3-downloader");

let app = { 
  ROOT_PATH: __dirname,
  DEBUG: true,
  DOWNLOAD_URL: '',
  SOURCE_PATH: path.resolve( __dirname, 'source' ),
  OUTPUT_PATH: path.resolve( __dirname, 'processed' ),
  FTP_SOURCE: path.resolve( __dirname, 'processed' ),
  FTP_FOLDER: '/temp',
  FTP_FILENAME_CACHE: 'listdb.json',
  FFMPEG_PATH: 'ffmpeg',
} 

const updateList = async (dir) => {
  let outputPath = path.resolve(__dirname, app.FTP_FILENAME_CACHE)
  try{
    fs.writeFileSync( `./${app.FTP_FILENAME_CACHE}`, JSON.stringify(dir, null, 4))
  }catch(e){
    console.log("Generate list fail", e)
  }
}

const generateList = async ( ) => {
  try{
    if(app.DEBUG) console.log("Generate list Start", output)
    
    let outputPath = path.resolve(__dirname, app.FTP_FILENAME_CACHE)
    const { connection, list, upload, disconnect } = Ftp(app) 
  
    if( fs.existsSync(outputPath) ){
      fs.unlinkSync(outputPath)
      console.log("output deleted")
    }
      
    await connection({ host:process.env.FTP_HOST, user:process.env.FTP_USER, password:process.env.FTP_PASS, })
    
    let folders = await list('/').filter(i => i.type == 'd').map(i => i.name)
    let dir = []
    for(let folder of folders){
      dir = [ ...dir, ...await list(`/${folder}`).filter(i => i.type == '-').map(i => i.name.toLowerCase()) ]
    }
      
    updateList(dir)
    
    disconnect()
    
    if(app.DEBUG) console.log("Generate list END - items ", dir.length)
  }catch(e){
    console.log("Generate list fail", e)
  }
}

const YtMp3Process = async ({ videoId, filename=undefined }) => {
  try{
    if( !videoId ) return console.log("YtMp3 Process - Video id not exists", videoId)
    //Configure YoutubeMp3Downloader with your settings
    var YD = new YoutubeMp3Downloader({
        "ffmpegPath": app.FFMPEG_PATH,        // FFmpeg binary location
        "outputPath": app.SOURCE_PATH,    // Output file location (default: the home directory)
        "youtubeVideoQuality": "highestaudio",  // Desired video quality (default: highestaudio)
        "queueParallelism": 2,                  // Download parallelism (default: 1)
        "progressTimeout": 2000,                // Interval in ms for the progress reports (default: 1000)
        "allowWebm": false                      // Enable download from WebM sources (default: false)
    });

    //Download video and save as MP3 file
    YD.download(videoId, filename);

    YD.on("finished", function(err, data) { 
      if( data.artist == 'Unknown' ){
        data.videoTitle = data.videoTitle.replace('a-ha', 'a_ha')
        data.videoTitle = data.videoTitle.replace(/(\s)\1+/g, ' ').replace(/([^0-9a-zA-Z ])\1+/gm, " - ")
        let titles = /^([^\-|\||'|"]+)\s[\-|\||'|"]\s?([^\-|\||'|"|\(]+)[\-|\||.|:|'|"|\(^]/gi.exec(data.videoTitle.trim())
        console.log(data.videoTitle, _.get(titles, '[1]','').trim(), _.get(titles, '[2]','').trim())
        
        let newFilename =  _.get(titles, '[1]','').trim() +' - '+ _.get(titles, '[2]','').trim()
        
        fs.renameSync(data.file, path.resolve( app.SOURCE_PATH,  newFilename+'.mp3' ) )
      }
    });

    YD.on("error", function(error) {
        console.log(error);
    });

//     YD.on("progress", function(progress) {
//         console.log(JSON.stringify(progress));
//     });
  }catch(e){
    console.error('YtDownload errror', e)
  }
}

const AudioProcess = async ({ filename, bitrate=96, removeConverted=true }) => {
  try{
    if(app.DEBUG) console.log("AudioProcess Start", filename)
    if( !filename ) throw { message: 'Filename not exists' }
       
    const { changeBitrate, readTags, writeTags } = Audio(app) 
    const { sanitizeFile } = Strings(app)  
    
    let source = path.resolve( app.SOURCE_PATH, filename)
    let output = path.resolve( app.OUTPUT_PATH, filename)
    
    let [, artist, title, ext] = /^(.*[^\s])\s?-\s?([^\s].*)\.(.*)/gm.exec(filename)

    let audioFile = await changeBitrate({
      source,
      output,
      bitrate
    })
    
    if( removeConverted && fs.existsSync(output) )
        fs.unlinkSync(source)
    
    let meta = await readTags(output) 

    if( !_.has(meta.artist) || !_.has(meta.title) ){
      meta.artist = artist
      meta.performerInfo = artist
      meta.title = title
      meta.bitrate = bitrate
     
      await writeTags(output, meta) 
    }
    
    let { filename:newFilename, filePath:newOutput } = await sanitizeFile({ filePath: output })
    output = newOutput
    filename = newFilename
      
    if(app.DEBUG) console.log("AudioProcess END", filename)
    
    return true
  }catch(e){
    console.error("erro", e)
  }
}

const UploadProcess = async ({ removeUploaded=true }) => {
   try{
    if(app.DEBUG) console.log("UploadProcess Start")
    if( !app.FTP_SOURCE ) throw { message: 'sourceDir not exists' } 
     
    const { getFiles } = Explorer(app)
    const { connection, list, upload, disconnect } = Ftp(app) 
     
    let files = getFiles( app.FTP_SOURCE ).map(i => ({ filename: i.replace( app.FTP_SOURCE+'/', ''), filepath: i }))
    if( !files.length ) return console.log("UploadProcess stoped - source empty", app.FTP_SOURCE)  
    
    await connection({ host:process.env.FTP_HOST, user:process.env.FTP_USER, password:process.env.FTP_PASS, })
    for(let file of files){
      await upload(file.filepath, `/${app.FTP_FOLDER}/${file.filename}`) 
      
      if( removeUploaded )
        fs.unlinkSync(file.filepath)
    }
      
    disconnect()
     
    if(app.DEBUG) console.log("UploadProcess End")
  }catch(e){
    console.error("erro", e)
  }
}

const run = async () => {
  try{
   console.log("Run - Process started")
  
    // DOWNLOAD YOUTUBE VIDEOS
//    YtMp3Process({ videoId: 'PBQB9WPlz6k'})
    
    //   DECLARATIONS
   let { getFiles } = Explorer(app)
   let newSongs = []  
   let files = getFiles( app.SOURCE_PATH )
                  .map(i => ({ 
                    filename: i.replace( app.SOURCE_PATH+'/', ''),
                    filepath: i,
                  }))
   
   console.log("Run - Found files: ", files.length)
   
   // GENERATE FTP CACHE AUDIO LIST IF NOT EXISTS
   if( !fs.existsSync( path.resolve(__dirname, app.FTP_FILENAME_CACHE) ) ){
      generateList()
   }
   let dbList = require(`./${app.FTP_FILENAME_CACHE}`)
   
   // PROCESS FILES OF SOURCE FOLDER
   for( let file of files ){
      if( dbList.includes( file.filename.toLowerCase() ) ){
        console.log("Run - Filename already exists on cached list", file)
        continue;
      } 
     
      // COPY TO SOURCE_FOLDER TO OUTPUT_FOLDER WITH NEW AUDIO BITRATE 
      // CHANGE FILL METATAGS 
      // CHANGE SANITIZE FILE AND RENAME
      await AudioProcess({ ...file })
      
      // UPDATE NEW AUDIO FILES VAR
      newSongs.push(file.filename.toLowerCase())
   }
    
   // UPLOAD FILES FROM FTP_SOURCE FOLDER TO FTP_FOLDER
   await UploadProcess({})
    
   // UPDATE FTP_FILENAME_CACHE WITH NEW AUDIO NAMES
   if( newSongs.length > 0 )
     updateList([...dbList, ...newSongs]) 
    
    
   console.log("Process finished")
  }catch(e){
    console.error('RUN error', e)
  }
}

run()
//Up Against Down - Harmony Pulse.mp3