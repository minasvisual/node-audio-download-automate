const path = require('path')
const fs = require('fs')
const _ = require('lodash')
const axios = require('axios')
require('dotenv').config()

const Audio = require('./lib/audio')
const Strings = require('./lib/strings')
const Ftp = require('./lib/ftp')
const Explorer = require('./lib/explorer')
const Youtube = require('./lib/youtube')
const Cache = require('./lib/cache')
const Args = process.argv.slice(2);

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
	CACHE_PATH: path.resolve( __dirname, 'cache' ),
	YOUTUBE_CACHE_FILENAME:  'YoutubeDownloaded.json'
} 
//
// INPUT METHODS
//
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
    if(app.DEBUG) console.log("Generate list Start")
    
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

const GetWebYtList = async () => {
	try{ 
		const { caching, setFileCache, getFileCache } = Cache(app)
		
		let videos = await caching('videos' , async () => { 
			return await axios.get(process.env.YOUTUBE_LIST_URL).then( ({data}) => data.rows )
		})
		
		return videos
	}catch(e){
		console.error("GetWebYtlist error", e)
		throw e 
	}
}

const GetSourceFiles = async () => {
	try{
			//   DECLARATIONS
		 let { getFiles } = Explorer(app) 
		 let files = getFiles( app.SOURCE_PATH )
										.map(i => ({ 
											filename: i.replace( app.SOURCE_PATH+'/', ''),
											filepath: i,
										}))
		 return files
	 }catch(e){
		 console.error("GetSourceFiles error")
		 throw e
	 }
}
//
// PROCESSES
//
const YtMp3Process = async (videos = []) => {
	try{ 
		const { Mp3Download, GetVideoId } = Youtube(app)
		const { caching, setFileCache, getFileCache } = Cache(app)
		const { parseArtistTitle } = Strings(app)

		let downloaded = await getFileCache(app.YOUTUBE_CACHE_FILENAME, [])

		for(let [k, video] of videos.entries() ){
			console.log("repetido?", video.link, downloaded.includes(video.link))
			if( downloaded.includes(video.link) ) continue;

			console.log("Video started ", video)
			let { artist=null, title=null } = await parseArtistTitle(video.title)
			let filename = artist && title ? `${artist} - ${title}.mp3` : undefined
			
			let ended = await Mp3Download({ 
					videoId: GetVideoId(video.link), 
					filename
			})
			.catch( err => console.error("YtMp3Process video error", video, err))
			
			if( ended )
				downloaded.push( _.get(ended, 'youtubeUrl') )
			
			videos[k] = {
				...video,
				...ended,
				filename: ended.file.replace(app.SOURCE_PATH+'/', '')
			}
			
			console.log("Video ended", _.get(ended, 'videoTitle','FAILED') )
		}

		setFileCache('YoutubeDownloaded.json', downloaded)
		
		return videos
	} catch(e) {
		console.error("YtMp3Process error", e)
		throw e
	}
}

const AudioProcess = async ({ filename, bitrate=96, removeConverted=true }) => {
  try{
    if(app.DEBUG) console.log("AudioProcess Start", filename)
    if( !filename ) throw { message: 'Filename not exists' }
       
    const { changeBitrate, readTags, writeTags } = Audio(app) 
    const { sanitizeFile, parseArtistTitle } = Strings(app)  
    
    let source = path.resolve( app.SOURCE_PATH, filename)
    let output = path.resolve( app.OUTPUT_PATH, filename)
    
//     let [, artist, title, ext] = /^(.*[^\s])\s?-\s?([^\s].*)\.(.*)/gm.exec(filename)
    let [, artist, title, ext] = /^([^\-|\||"|:]+)\s[\-|\||"]\s?([^\-|\||'|"|\(]+)[\-|\||.|:|'|"|\(^]/gi.exec(filename.trim())

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
     
    }
      
		await writeTags(output, meta) 
    
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


//
// OPTIONS
// 
const ApiSchedule = async () => {
  try{
   console.log("Run - Process started") 
  
  // get list of links and title
  let videos = await GetWebYtList()
  // DOWNLOAD YOUTUBE VIDEOS
  await YtMp3Process(videos)
    
    //   DECLARATIONS 
   let newSongs = []  
   let files = await GetSourceFiles()
   
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

const YtUniqueVideoProcess = async (url) => {
	try{   
   let newSongs = []  
	 let [ended] = await YtMp3Process([{ link: url }]) 
		
    // GENERATE FTP CACHE AUDIO LIST IF NOT EXISTS
	 if( !fs.existsSync( path.resolve(__dirname, app.FTP_FILENAME_CACHE) ) ){
			await generateList()
	 }
   let dbList = require(`./${app.FTP_FILENAME_CACHE}`)
	 
	 if( dbList.includes( ended.filename.toLowerCase() ) )
        throw "YtUniqueVideoProcess - Filename already exists on cached list" 
		// COPY TO SOURCE_FOLDER TO OUTPUT_FOLDER WITH NEW AUDIO BITRATE 
		// CHANGE FILL METATAGS 
		// CHANGE SANITIZE FILE AND RENAME
		await AudioProcess({ filename: ended.filename })
      
      // UPDATE NEW AUDIO FILES VAR
		
		await UploadProcess({})
    
   // UPDATE FTP_FILENAME_CACHE WITH NEW AUDIO NAMES
   newSongs.push( ended.filename.toLowerCase() ) 
   if( newSongs.length > 0 )
     updateList([...dbList, ...newSongs]) 
		
		console.log("YtUniqueVideoProcess end", ended)
	}catch(e){
    console.error('YtUniqueVideoProcess error', e) 
		return 0
	}
} 

console.log("Options", Args)

let [task, param1] = Args 
if( task == "getOneByYoutube" && param1 )
	YtUniqueVideoProcess(param1)
else 
	return console.log("Nenhuma opcao escolhida")

//Up Against Down - Harmony Pulse.mp3