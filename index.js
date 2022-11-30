const express = require('express');
const app = express();
const router = express.Router();
const { exec } = require("child_process");

const port = 8080;

app.get('/', function(req,res){
  res.send('Tudo ok')
});

app.get('/downloader/:name', function(req,res){ 
  exec("node downloader.js "+req.params.name, (error, stdout, stderr) => {
      if (error) {
          console.log(`error: ${error.message}`);
          return;
      }
      if (stderr) {
          console.log(`stderr: ${stderr}`);
          return;
      }
      console.log(`stdout: ${stdout}`);
  });
  res.send('Tudo ok '+req.params.name)
});

app.listen(port, function () {
  console.log('Example app listening on port 8080!')
})