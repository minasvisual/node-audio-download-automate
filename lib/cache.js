const fs = require("fs")
const path = require("path")
const NodeCache = require("node-cache");
const cached = new NodeCache({
	stdTTL: 60 * 5 // 5 minutes
});

module.exports = (app) => {

	const caching =  async (key, take) => {
			if (cached.has(key))
				return cached.take(key)
			else
				return take().then(data => {
					cached.set(key, data);
					return data
				})
		}
	
	const setFileCache = async (filename, data) => {
			try {
				if ( !fs.existsSync(app.CACHE_PATH) )
					 fs.mkdirSync(app.CACHE_PATH, { recursive: true });

				let outputPath = path.resolve(app.CACHE_PATH, filename)
				
				fs.writeFileSync( outputPath, JSON.stringify(data, null, 4))
			} catch (e) {
				console.log("setFileCache fail", e)
				throw e
			}
		}
	
	const getFileCache = (filename, std=[]) => {
		try {
			if( fs.existsSync( path.resolve(app.CACHE_PATH, filename) ) )
				return require( path.resolve(app.CACHE_PATH, filename) )
			else
				return Promise.resolve( std )
		} catch(e) {
			console.log("getFileCache fail", e)
			throw e
		}
	}
	
	return {
		caching,
		set: cached.set,
		get: cached.take,

		setFileCache,
		getFileCache,
		
	}
	//end module
}