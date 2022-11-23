const path = require('path')
const fs = require('fs')
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
  FTP_FOLDER: '/temp',
  FTP_FILENAME_CACHE: 'listdb.json',
  FFMPEG_PATH: 'ffmpeg',
	CACHE_PATH: path.resolve( __dirname, 'cache' ),
	YOUTUBE_CACHE_FILENAME:  'YoutubeDownloaded.json'
} 

const { connection, list, upload, download, deleteFile, disconnect, reconnect, rename } = Ftp(app) 
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
								link: row.path,
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
		axios.put(process.env.YOUTUBE_LIST_URL + '/' + id, payload).then( ({data}) => console.log('UpdateWebYtList', data) )
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

const BitrateProcess = async ({ bitrate=96, removeConverted=true }) => {
  try{
    if(app.DEBUG) console.log("BitrateProcess Start") 
       
    const { getFiles } = Explorer(app)
    const { changeBitrate, readTags, writeTags } = Audio(app)  
		
		
    let files = getFiles( app.SOURCE_PATH ).map(i => ({ filename: i.replace( app.SOURCE_PATH+'/', ''), filepath: i }))
    if( !files.length ) return console.log("UploadProcess stoped - source empty", app.FTP_SOURCE)  
		
		for(let file of files ) { 
			let source = path.resolve( app.SOURCE_PATH, file.filename)
			let output = path.resolve( app.OUTPUT_PATH, file.filename)	
			console.log('converting', file.filename	)

			let audioFile = await changeBitrate({
				source,
				output,
				bitrate
			})

			if( removeConverted && fs.existsSync(output) )
					fs.unlinkSync(source)
			
			console.log('done converting', file.filename	)
		}
     
		await UploadProcess({})
      
    if(app.DEBUG) console.log("BitrateProcess END")
    
    return true
  }catch(e){
    console.error("erro", e)
  }
}

const mapId3Ftp = async () => {
	try{
    if(app.DEBUG) console.log("map Id3 Ftp list Start")
		
    const { readTags, writeTags } = Audio(app) 
		const connParams = { host:process.env.FTP_HOST, user:process.env.FTP_USER, password:process.env.FTP_PASS, keepalive: 1000 * 60 }
     
    await connection(connParams)
    
		let status = true
		let dir = {}
    let folder = 'geral3'//await list('/').filter(i => i.type == 'd').map(i => i.name) 
		const db = new Database(`./cache/${folder}.json`);
		let outputPath = path.resolve( app.CACHE_PATH, `${folder}.json`)  

		let files = await list(`/${folder}`).filter(i => i.type == '-')

		let queue = _.chunk(files, 25)
		
		queue = queue.slice(0, 8)
		
    for(let [k, rows] of queue.entries()){ 
			 
			for(let file of rows ){
				//console.log('Started file '+ file.name )
				let filePath = path.resolve( app.OUTPUT_PATH, file.name)  
				try{ 
					let downloaded = await download(`/${folder}/${file.name}`, filePath) 

					let meta = await readTags(filePath) 
					let key = file.name.replace(/\s/g,'_').replace(/\.mp3/g,'') 

					db.set( `/${folder}/${key}`, _.pick(meta, ['artist','performerInfo',`title`,'bitrate']) )

					fs.unlinkSync(filePath)

					console.log('Ended file '+ file.name, `/${folder}/${key}`)
				}catch(e){
					console.log('Ended error file '+ `/${folder}/${file.name.replace(/\s/g,'_').replace(/\.mp3/g,'') }`, e)
					if( fs.existsSync(filePath) )
						fs.unlinkSync(filePath) 
				}
				
				await waiting(500)
			}
			
			console.log(`Ended row ${k} of ${queue.length}`)
    } 
    
		disconnect()
		
    if(app.DEBUG) console.log("map Id3 Ftp list END - items ", dir.length)
		
	}catch(e){
    console.error('map Id3 Ftp error', e) 
		return 0 
	}

	process.on('SIGTERM', () => {
		console.info('SIGTERM signal received.');
	});
}

const changeFileId3Ftp = async (ftpPath, name) => {
	try{
    if(app.DEBUG) console.log("changeFileId3Ftp Start")
		
		
    const { readTags, writeTags } = Audio(app) 
		const connParams = { host:process.env.FTP_HOST, user:process.env.FTP_USER, password:process.env.FTP_PASS, keepalive: 1000 * 60 }
     
    await connection(connParams) 

		//console.log('Started file '+ file.name )
		let filePath = path.resolve( app.OUTPUT_PATH, path.basename(ftpPath))  
		try{ 
			let downloaded = await download(ftpPath, filePath) 

			name = name.split(' - ')
 			let meta = await readTags(filePath) 
 
      meta.artist = name[0]
      meta.performerInfo = name[0]
      meta.title = name[1]
      meta.bitrate = 96 
      
		  await writeTags(filePath, meta) 
			
  		await upload(filePath, ftpPath) 
       
      fs.unlinkSync(filePath)

			console.log('Ended file '+ ftpPath, _.pick(meta, ['artist','performerInfo',`title`,'bitrate']))
		}catch(e){
			console.log('Ended error file '+ ftpPath, e)
			if( fs.existsSync(filePath) )
				fs.unlinkSync(filePath) 
		} 

		disconnect()
		
    if(app.DEBUG) console.log("changeFileId3Ftp END")
	}catch(e){
		disconnect()
    console.error('map Id3 Ftp error', e) 
		return 0 
	}
}

const getMetaFtp = async (ftpPaths, params = {}) => {
	try{
    if(app.DEBUG) console.log("getMetaFtp Start")
		
		let metas = []
    const { readTags, writeTags } = Audio(app) 
		const connParams = { host:process.env.FTP_HOST, user:process.env.FTP_USER, password:process.env.FTP_PASS, }
     
    await connection(connParams) 

		//console.log('Started file '+ file.name )
		if( !Array.isArray(ftpPaths) ) ftpPaths = [ftpPaths]
		for(let ftpPath of ftpPaths){
			let filePath = path.resolve( app.OUTPUT_PATH, path.basename(ftpPath))  
			try{ 
				let downloaded = await download(ftpPath, filePath) 

				let meta = await readTags(filePath) 

				fs.unlinkSync(filePath)

				console.log('Ended file '+ ftpPath )

				metas.push(meta)
				
				if( params.log !== false )
					console.log(meta)
			}catch(e){
				console.log('Ended error file '+ ftpPath, e)
				if( fs.existsSync(filePath) )
					fs.unlinkSync(filePath) 
			} 
		}

		disconnect()
		
		return metas
		
    if(app.DEBUG) console.log("getMetaFtp END")
	}catch(e){
		disconnect()
    console.error('getMetaFtp error', e) 
		return 0 
	}
}

const deleteFileFtp = async (ftpPath) => {
	try{
    if(app.DEBUG) console.log("deleteFileFtp Start")
		 
		const connParams = { host:process.env.FTP_HOST, user:process.env.FTP_USER, password:process.env.FTP_PASS, }
     
    await connection(connParams) 
 
		await deleteFile(ftpPath)

		disconnect()
		
    if(app.DEBUG) console.log("deleteFileFtp END")
	}catch(e){
		disconnect()
    console.error('deleteFileFtp error', e) 
		return 0 
	}
}

const listFiles = async (ftpPath) => {
	try{
    if(app.DEBUG) console.log("listFiles Start")
		 
		const connParams = { host:process.env.FTP_HOST, user:process.env.FTP_USER, password:process.env.FTP_PASS, }
     
    await connection(connParams) 
 
		let listed = await list(ftpPath)

		console.log(listed.map(i => i.name))
		
		disconnect()
		
    if(app.DEBUG) console.log("listFiles END")
	}catch(e){
		disconnect()
    console.error('listFiles error', e) 
		return 0 
	}
}

const renameFiles = async (oldPath, newPath) => {
	try{
    if(app.DEBUG) console.log("renameFiles Start")
		 
		const connParams = { host:process.env.FTP_HOST, user:process.env.FTP_USER, password:process.env.FTP_PASS, }
     
    await connection(connParams) 
 
		await rename(oldPath, newPath)

		disconnect()
		
    if(app.DEBUG) console.log("renameFiles END")
	}catch(e){
		disconnect()
    console.error('renameFiles error', e) 
		return 0 
	}
}

const open = async (list) => {
	try{ 
	 console.log("Open - registe mp3 start") 
   let dbList = require(`./${app.FTP_FILENAME_CACHE}`)
	 let queue = _.chunk(dbList, 20) 
	  
	 let { data:{ token } } = await axios.post(`${process.env.API_URL}/auth/login`, {
	 		email: process.env.API_USER,
	 		password: process.env.API_PASS,
	 })
	 
	 let metas = await getMetaFtp(queue[list], { log: false })
		 
	 for(let [k, item] of queue[list].entries() ){
		 await axios.post(`${process.env.API_URL}/ets/streaming`, {
			 path: item,
			 type: 'mp3',
			 sync: false,
			 download: true,
			 meta: _.pick(metas[k], ['artist','performerInfo',`title`,'bitrate']),
		 }, { headers: { 'access-token': token } }).catch(e => console.log(item, e.response.data) )
	 }
		 
	 console.log("Open - registe mp3 done", list, ' of ', queue.length)
			 
	}catch(e){
		console.error("open error", e)
	}
}

const installation = async () => {
  try{
    if (!fs.existsSync( path.resolve(__dirname, 'source') )){
      fs.mkdirSync(path.resolve(__dirname, 'source'));
    }
    if (!fs.existsSync( path.resolve(__dirname, 'processed') )){
      fs.mkdirSync(path.resolve(__dirname, 'processed'));
    }
    if (!fs.existsSync( path.resolve(__dirname, 'cache') )){
      fs.mkdirSync(path.resolve(__dirname, 'cache'));
    }
    await generateList()
  }catch(e){
    console.log("error instalation", e)
  }
}
console.log("Options", Args)

let [task, param1, param2] = Args  
if( task == "mapId3Ftp"  )
	mapId3Ftp()
else if( task == "installation"  )
  installation()
else if( task == "getMetaFtp" && param1 )
	getMetaFtp(param1)
else if( task == "deleteFileFtp" && param1 )
	deleteFileFtp(param1)
else if( task == "listFtp" && param1 )
	listFiles(param1)
else if( task == "renameFileFtp" && param1 && param2 )
	renameFiles(param1, param2)
else if( task == "changeMetaFtp"  )
	changeFileId3Ftp(param1, param2)
else if( task == "generateList"  )
	generateList()
else if( task == 'bitrateProcess' )
	BitrateProcess({})
else if( task == 'open' )
	open(param1, param2)
else {
	console.log("Nenhuma opcao escolhida") 
	console.log("mapId3Ftp")
	console.log("deleteFileFtp - FTP_PATH")
	console.log("listFtp - FTP_PATH")
	console.log("renameFileFtp - OLD_FTP_PATH - NEW_FTP_PATH")
	console.log("changeMetaFtp - FTP_Path - New_Name_-_New_Title")
	console.log("generateList")
	console.log("bitrateProcess")
	console.log("open - FTP_Path - New_Name_-_New_Title")
	
	console.log('Open Parou no 115')
}


process.on('SIGTERM', () => {
  console.info('SIGTERM signal received.');
	
	disconnect()
});
