const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { uploadx } = require('../lib');
const { auth } = require('./auth');
const { errorHandler } = require('./error-handler');

const app = express();
app.enable('trust proxy');
const corsOptions = {
  exposedHeaders: ['Range', 'Location']
};
app.use(cors(corsOptions));
app.use(bodyParser.json());

app.use(auth);

app.use(
  '/upload/',
  uploadx({
    maxUploadSize: '180MB',
    allowMIME: ['video/*'],
    destination: item => `/tmp/upload/${item.metadata.name}`
  }),
  (req, res) => {
    if (req.file) {
      res.json(req.file.metadata);
    } else {
      res.send();
    }
  }
);

app.use(errorHandler);

app.listen(3003);
