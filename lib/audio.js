const Lame = require("node-lame").Lame;
const NodeID3 = require('node-id3')

module.exports = (app) => {
  
   const changeBitrate = ({source, output, bitrate=96}) => {
     try{
        console.log("Change Bitrate", source, output)
        const encoder = new Lame({ output, bitrate, }).setFile(source);
       
        return encoder.encode()
       
     }catch(e){
        return Promise.reject(e)
     }
   }

  var writeTags = (file, tags) => new Promise( (res, rej) => {
      return NodeID3.update(tags, file, err => err ? rej(err):res(true))
  })
  
  var readTags = (file) => new Promise((res, rej) => {
      console.log("readTags", file)
      return NodeID3.read(file, (err) => err ? rej(err):res(true))
  })
  
  return {
    changeBitrate,
    writeTags,
    readTags
  }
}


 