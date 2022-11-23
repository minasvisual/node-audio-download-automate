const path = require('path')
const fs = require('fs')
const fse = require('fs-extra')
const _ = require('lodash')
const axios = require('axios')
const Database = require("easy-json-database");
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
  FTP_FOLDER: '/geral4',
  FTP_FILENAME_CACHE: 'listdb.json',
  FFMPEG_PATH: 'ffmpeg',
	CACHE_PATH: path.resolve( __dirname, 'cache' ),
	YOUTUBE_CACHE_FILENAME:  'YoutubeDownloaded.json',
  temp: {}
} 

const { connection, list, upload, download, deleteFile, disconnect, reconnect } = Ftp(app) 
//
// INPUT METHODS
//
const waiting = (timeout = 1000 * 1) => new Promise( (res, rej) => {
	setTimeout(res, timeout)
})
			
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
  
    if( fs.existsSync(outputPath) ){
      fs.unlinkSync(outputPath)
      console.log("output deleted")
    }
      
    await connection({ host:process.env.FTP_HOST, user:process.env.FTP_USER, password:process.env.FTP_PASS, })
    
    let folders = await list('/').filter(i => i.type == 'd').map(i => i.name)
    let dir = []
    for(let folder of folders){
      dir = [ ...dir, ...await list(`/${folder}`).filter(i => i.type == '-').map(i => `${folder}/${i.name}`) ]
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
			return await axios.get(process.env.YOUTUBE_LIST_URL + '?limit=100&sort=-id&filter=type,eq,link&filter=download,eq,0').then( ({data}) => data.rows.map(
					row => {
							return {
								...row,
								title: _.has(row, 'meta.artist') && _.has(row, 'meta.title') ? `${row.meta.artist} - ${row.meta.title}` : null
							}
					}) 
			)
		})
		
		return videos
	}catch(e){
		console.error("GetWebYtlist error", e)
		throw e 
	}
}

const UpdateWebYtList = async (id, payload) => {
	try{
		 const { caching, setFileCache, getFileCache } = Cache(app)
     let token = null
     
     if( !app.temp || !app.temp.apiToken )
       await axios.post(`${process.env.API_URL}/auth/login`, {
          email: process.env.API_USER,
          password: process.env.API_PASS,
       }).then( ({data}) => { 
         app.temp.apiToken = data.token;  
       })
     
    let opts =  { headers: { 'access-token': app.temp.apiToken } }
   
	  await axios.put(process.env.YOUTUBE_LIST_URL + '/' + id, payload, opts).then( ({data}) => console.log('UpdateWebYtList', data) )
	}catch(e){
		console.error('UpdateWebYtList error ', e)
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

const DownloadYtMp3 = async (video) => {
	try{ 
		const { Mp3Download, GetVideoId } = Youtube(app)
		const { caching, setFileCache, getFileCache } = Cache(app)
		const { parseArtistTitle, replaceDiacritics } = Strings(app)

		let downloaded = await getFileCache(app.YOUTUBE_CACHE_FILENAME, [])
 
		if( downloaded.some(i => i === video.link.replace('https:','http:')) ) {
      video = {
        ...video, 
        path: `${video.title}.mp3`,
        sync: true,
        download: true,
				repeated: true
      };
      
   		console.log("repetido?", video)
      
      return video
    }

		console.log("Download started ", video)
// 		let { artist=null, title=null } = await parseArtistTitle(video.title)
// 		let filename = artist && title ? `${artist} - ${title}.mp3` : undefined
 		let filename = video.title ? `${video.title}.mp3` : undefined

    let ended = await Mp3Download({ 
        videoId: GetVideoId(video.link), 
        filename
    })
    .catch( err => {
			console.error("YtMp3Process video error", video, err)
			throw err
		})
			
    if( !ended ) throw video
    
    downloaded.push( _.get(ended, 'youtubeUrl') )

    video = {
      ...video,
      ...ended,
      path: ended.file.replace(app.SOURCE_PATH+'/', ''), 
      download: true,
    }

		setFileCache(app.YOUTUBE_CACHE_FILENAME, downloaded)

    console.log("Video downloaded", video )
		
		return video
	} catch(e) {
		console.error("YtMp3Process error", e)
		throw e
	}
}

const ChangeMeta = async ({ filename, metaname, sourceFolder }) => {
  try{
    if(app.DEBUG) console.log("ChangeMeta Start", filename)
    if( !filename ) throw { message: 'Filename not exists' }
        
    const { readTags, writeTags } = Audio(app) 
    const { sanitizeFile, parseArtistTitle } = Strings(app)  
    
    let source = path.resolve( sourceFolder, filename)
    
//     let [, artist, title, ext] = /^(.*[^\s])\s?-\s?([^\s].*)\.(.*)/gm.exec(filename)
    console.log("changeMeta exec", (metaname || filename.trim()), /^([^\-|\||"|:]+)\s[\-|\||"]\s?([^\-|\||'|"|\(]+)[\-|\||.|:|'|"|\(^]/gi.exec( (metaname || filename.trim()) ) )
    let [, artist, title, ext] = /^([^\-|\||"|:]+)\s[\-|–|\||"]\s?([^\-|\||'|"|\(]+)[\-|\||.|:|'|"|\(^]/gi.exec( (metaname || filename.trim()) )
  
    let meta = await readTags(source) 

    if( !_.has(meta.artist) || !_.has(meta.title) ){
      meta.artist = artist
      meta.performerInfo = artist
      meta.title = title
    }
      
		await writeTags(source, meta) 
    
    let { filename:newFilename, filePath:newOutput } = await sanitizeFile({ filePath: source })
    filename = newFilename
      
    if(app.DEBUG) console.log("AudioProcess END", filename)
    
    return filename
  }catch(e){
    console.error("ChangeMeta error", e)
    return filename
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
    disconnect()
    
    console.error("erro", e)
  }
}
 
const GenerateYtCache = async ({}) => {
	try{
		 const { caching, setFileCache, getFileCache } = Cache(app)
     let token = null
        
	   let { data } = await axios.get(process.env.YOUTUBE_LIST_URL + '?filter=type,eq,mp3&filter=link,like,https%&fields=link')
		 
		 let links = _.map(data, 'link')
		 
		 console.log('Count links', links.length)
		
		 setFileCache(app.YOUTUBE_CACHE_FILENAME, links)
	}catch(e){
		console.error('UpdateWebYtList error ', e)
	}
}

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
//
// OPTIONS
//  
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
 
const ApiSchedule = async () => {
	try{ 
    let videos  =  await GetWebYtList()

    for( let video of videos ){
      // 	 let video = {
      //     "id": 2770,
      //     "type": "link",
      //     "path": "https://www.youtube.com/watch?v=kUU7FZfFI2g",
      //     "meta": {},
      //     "link": "https://www.youtube.com/watch?v=kUU7FZfFI2g",
      //     "sync": false,
      //     "download": false
      //   }

         if( !_.has(video, 'meta.artist') || !_.has(video, 'meta.title') ) {
					 continue;
					 console.warn({ message: "Sem titulo", video })
				 }

         video.title = `${video.meta.artist} - ${video.meta.title}`

         video = await DownloadYtMp3(video).catch( e => {	
					 console.log('test errr', e.message)
					 if( e.message && e.message.includes('Video unavailable') ){
							UpdateWebYtList(video.id, {
// 							console.log({
									"type": "error",  
									"path": `${ app.FTP_FOLDER.replace('/','') }/${video.path}`,
									"sync": true,
									..._.pick(video, ['link', 'meta', 'download'])
							 }) 
						 video.error = true
					 }else{
						 throw e
					 }
				 })
			
				 if( video.error )
					 continue;

				 if( video.repeated !== true ){
	         video.path = await ChangeMeta({ 
						 filename: video.path, 
						 metaname: (video.title || video.videoTitle) + '.mp3' ,
						 sourceFolder: app.SOURCE_PATH 
					 })

         	 fse.moveSync( 
						 `${app.SOURCE_PATH}/${video.path}`,
						 `${app.OUTPUT_PATH}/${video.path}`, 
						 { overwrite: true }
					 )
				 }
		
         await UpdateWebYtList(video.id, {
         // console.log({
            "type": "mp3",  
            "path": `${ app.FTP_FOLDER.replace('/','') }/${video.path}`,
            "sync": true,
            ..._.pick(video, ['link', 'meta', 'download'])
         })
    }

     await UploadProcess({})

     console.log("Finalizado")
	}catch(e){
		console.error("open error", e)
	}
}

console.log("Options", Args)
let [task, param1, param2] = Args 
if( task == "getYoutubeByApi" )
	ApiSchedule()
if( task == "generateYtCache" )
	GenerateYtCache({})
if( task == "getOneByYoutube" && param1 )
	YtUniqueVideoProcess(param1)   
else {
	console.log("Nenhuma opcao escolhida")
	console.log("generateYtCache") 
	console.log("getYoutubeByApi") 
	console.log("getOneByYoutube - URL") 
}

process.on('SIGTERM', () => {
  console.info('SIGTERM signal received.');
	
	disconnect()
});

//Up Against Down - Harmony Pulse.mp3