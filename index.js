const express = require('express');
const app = express();
const router = express.Router();

const port = 8080;

express.get('/', function(req,res){
  res.send('Tudo ok')
});

app.listen(port, function () {
  console.log('Example app listening on port 8080!')
})