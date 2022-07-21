const YoutubeMp3Downloader = require("youtube-mp3-downloader");
const path = require('path')
const fs = require('fs')
const _ = require('lodash')

const { replaceDiacritics } = require('./strings')({})  
    
module.exports = (app) => {

    const GetVideoId = (url) => {
        var regExp = /^.*((youtu.be\/)|(v\/)|(\/u\/\w\/)|(embed\/)|(watch\?))\??v?=?([^#&?]*).*/;
        var match = url.match(regExp);
        return (match&&match[7].length==11)? match[7] : false;
    }
    
    const Mp3Download = async ({ videoId, filename=undefined }) => new Promise( (res, rej) => {
      try{
        console.log("Youtube > Mp3Download > started hook", videoId, filename)
        
        if( !videoId ) return rej( new Error("YtMp3 Process - Video id not exists", {videoId}) )
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
          if( err ){
            console.log("Youtube > Mp3Download > Finished err", err)
            return rej(err);
          }
          console.log("Yt finished start", data)
          if( data.artist == 'Unknown' ){
            data.videoTitle = data.videoTitle.replace('a-ha', 'a_ha')
//             data.videoTitle = data.videoTitle.replace(/(\s)\1+/g, ' ').replace(/([^0-9a-zA-Z ])\1+/gm, " - ")
           //let titles = /^([^\-|\||'|"]+)\s[\-|\||'|"]\s?([^\-|\||'|"|\(]+)[\-|\||.|:|'|"|\(^]/gi.exec(data.videoTitle.trim())
            
           let titles = /^([^\-|\||"|:]+)\s[\-|–|\||"]\s?([^\-|\||'|"|\(\[\]]+)/g.exec( data.videoTitle.trim() ) 
           console.log("Yt finished Unkwnon titles", data.videoTitle.trim(), titles)
            
            let newFilename = _.get(titles, '[1]','').trim() +' - '+ _.get(titles, '[2]','').trim() 
            
            fs.renameSync(data.file, path.resolve( app.SOURCE_PATH,  newFilename +'.mp3' ) )
    
            data.file = path.resolve( app.SOURCE_PATH, newFilename +'.mp3' )
            data.meta = {
              artist: _.get(titles, '[1]','').trim(),
              title:  _.get(titles, '[2]','').trim()
            }
          }else{
            let newFilename
            if( !filename ){
              let titles = /^([^\-|\||"|:]+)\s[\-|–|\||"]\s?([^\-|\||'|"|\(\[\]]+)/g.exec( data.videoTitle.trim() )
              newFilename = _.get(titles, '[1]','').trim() +' - '+ _.get(titles, '[2]','').trim() +'.mp3'
            } else {
              newFilename = filename
            }
            
            fs.renameSync(data.file, path.resolve( app.SOURCE_PATH,  replaceDiacritics(newFilename) )  )
            
            data.file = path.resolve( app.SOURCE_PATH, replaceDiacritics(newFilename) )
            data.meta = {
              artist: data.artist,
              title: data.title
            }
            data.title = newFilename.replace('.mp3','')
          }
    
          console.log("Youtube > Mp3Download > Finished", data)
          res(data)
        });
    
        YD.on("error", function(error) { 
            console.log("Youtube > Mp3Download > Error fn", error)
            rej(error)
        });
    
    //     YD.on("progress", function(progress) {
    //         console.log(JSON.stringify(progress));
    //     });
      }catch(e){
        console.error('YtDownload errror', e)
        rej(e)
      }
    })

    return {
        GetVideoId,
        Mp3Download
    }
}