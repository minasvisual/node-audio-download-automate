var PromiseFtp = require('promise-ftp');
  

module.exports = () => {
   var { connect, list, get, put, end } = new PromiseFtp();
   let connected

   const connection = ({ host, user, password, port=21 }) => {
      return connect({host, user, password, port})
           .then(function (serverMessage) {
              console.log('Server message: '+serverMessage);
              connected = true
              return serverMessage
           })
   }
   
   const download = (source, output) => {
      if( !connected ) return console.log("Fail: disconnected")
     
      return get(source)
            .then(function (stream) {
                return new Promise(function (resolve, reject) {
                  stream.once('close', resolve);
                  stream.once('error', reject);
                  stream.pipe(fs.createWriteStream(output));
                });
            }) 
   }
   
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
     download,
     upload,
     disconnect
   }
}

