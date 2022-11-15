var fs = require('fs');
var PromiseFtp = require('promise-ftp');
  

module.exports = () => {
   var { connect, list, get, put, end, delete:deleteFile, getConnectionStatus, reconnect, rename } = new PromiseFtp();
   let connected

   const connection = ({ host, user, password, port=21, keepalive=undefined }) => {
      return connect({host, user, password, port, keepalive })
           .then(function (serverMessage) {
              console.log('Server message: '+serverMessage);
              connected = true
              return serverMessage
           })
   }
   
   const download =  (source, output) => new Promise( async (resolve, reject) => {
     try{ 
      if( !connected ) throw "Fail: disconnected"
     
      let stream = await get(source) 

      stream.once('close', resolve);
      stream.once('error', reject);
      stream.pipe(fs.createWriteStream(output))
     }catch(e){
       reject(e)
     }
   }); 
   
   const upload = (source, output) => {
      if( !connected ) return console.log("Fail: disconnected")
     
      return put(source, output) 
   }
   
   const disconnect = () => {
     if( !connected ) return true
     
     connected = false
     return end()
   }
    
   return {
     connection,
     list, 
     rename,
     download,
     upload,
     deleteFile,
     disconnect,
     connectionStatus: getConnectionStatus, 
     reconnect,
   }
}

